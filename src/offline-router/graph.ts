/**
 * offline-router · graph — the on-device routing engine.
 *
 * A saved road network is packed into flat typed arrays (a city-sized area has
 * hundreds of thousands of nodes — as objects that runs a phone out of memory),
 * and routes are answered with an A* search plus a turn-by-turn step builder.
 * Shapes and the out-of-area error come from `./types`.
 */
import {
  RouteOutOfAreaError,
  type OfflineRoadNetwork,
  type OfflineRoute,
  type RoadWay,
  type RouteBounds,
  type RouteCoordinate,
  type RoutePoint,
  type RouteStep,
} from './types';

/** How far a geocoded address, shelter centroid, or GPS fix may be from a
 * routable road before snapping gives up. Shelter and building coordinates
 * are often placed inside a parcel rather than on the street, so a few hundred
 * meters is too strict for real destinations. */
const SNAP_MAX_METERS = 1_200;

function distance(a: RouteCoordinate, b: RouteCoordinate) {
  const rad = (n: number) => n * Math.PI / 180;
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
function roadSpeed(road: RoadWay) {
  const speed = { motorway: 29, motorway_link: 16, trunk: 25, trunk_link: 15, primary: 22, primary_link: 14, secondary: 18, secondary_link: 13, tertiary: 14, tertiary_link: 11, unclassified: 11, residential: 10, living_street: 6, service: 6, road: 10 }[road.highway] || 9;
  return speed;
}
/** Slip roads and motorway links. These are ramps that join a motorway, so a
 * route cannot start or end on one from an ordinary street. */
const RAMP_HIGHWAYS = new Set(['motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);

/** Spatial grid cell size in degrees (~1.1 km). Keeps nearest-road lookups fast
 * even in a dense city network with hundreds of thousands of nodes. */
const GRID_CELL = 0.01;

/** Hard ceilings for a graph that still fits comfortably in a phone's memory.
 * A saved area that would need more than this is trimmed when it is downloaded. */
const MAX_GRAPH_EDGES = 2_000_000;

/** Projects a point onto a segment and returns the distance to it. */
function projectOnSegment(target: RouteCoordinate, a: RouteCoordinate, b: RouteCoordinate): { ratio: number; meters: number; point: RouteCoordinate } {
  const scale = Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  const ax = a[0] * scale, ay = a[1], bx = b[0] * scale, by = b[1];
  const tx = target[0] * scale, ty = target[1];
  const dx = bx - ax, dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return { ratio: 0, meters: distance(target, a), point: a };
  let ratio = ((tx - ax) * dx + (ty - ay) * dy) / lengthSquared;
  ratio = Math.max(0, Math.min(1, ratio));
  const projected: RouteCoordinate = [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio];
  return { ratio, meters: distance(target, projected), point: projected };
}

function bearing(a: RouteCoordinate, b: RouteCoordinate) {
  const rad = (n: number) => n * Math.PI / 180;
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function maneuver(incoming: number, outgoing: number) {
  const turn = ((outgoing - incoming + 540) % 360) - 180;
  if (Math.abs(turn) >= 150) return 'Make a U-turn';
  if (turn >= 100) return 'Turn sharp right';
  if (turn >= 35) return 'Turn right';
  if (turn <= -100) return 'Turn sharp left';
  if (turn <= -35) return 'Turn left';
  return 'Continue';
}

function cellKey(cx: number, cy: number) {
  return (cx + 20000) * 40000 + (cy + 20000);
}

/** The routing graph stores nodes and edges in flat typed arrays rather than
 * JavaScript objects. A city-sized saved area has hundreds of thousands of nodes;
 * as objects that costs several hundred megabytes and Android kills the app, so
 * the whole graph is packed into about a tenth of the memory. */
export type RoutingGraph = {
  bounds: RouteBounds;
  nodeCount: number;
  /** Longitude/latitude pairs, two numbers per node. */
  coords: Float64Array;
  edgeCount: number;
  edgeFrom: Int32Array;
  edgeTo: Int32Array;
  edgeMeters: Float32Array;
  /** Travel speed in metres per second. */
  edgeSpeed: Uint8Array;
  /** Index into `names` and `highways`; kept as numbers so edges stay small. */
  edgeName: Int32Array;
  edgeHighway: Int32Array;
  names: string[];
  highways: string[];
  /** Adjacency: node `n` leaves along `outEdge[outStart[n] … outStart[n + 1]]`. */
  outStart: Int32Array;
  outEdge: Int32Array;
  maxSpeed: number;
  /** Edge ids bucketed by grid cell, for nearest-road lookups. */
  grid: Map<number, Int32Array>;
  scratch: SearchScratch;
};

type SearchScratch = {
  scores: Float64Array;
  previous: Int32Array;
  heap: NodeHeap;
  reachable: Uint8Array | null;
};

/** Binary min-heap over node indices, kept in typed arrays so a search does not
 * allocate one object per step. */
class NodeHeap {
  private ids: Int32Array;
  private priority: Float64Array;
  size = 0;
  topPriority = 0;
  constructor(capacity: number) {
    this.ids = new Int32Array(capacity);
    this.priority = new Float64Array(capacity);
  }
  clear() { this.size = 0; }
  push(id: number, priority: number): void {
    if (this.size >= this.ids.length) {
      const grownIds = new Int32Array(this.ids.length * 2);
      grownIds.set(this.ids);
      const grownPriorities = new Float64Array(this.priority.length * 2);
      grownPriorities.set(this.priority);
      this.ids = grownIds;
      this.priority = grownPriorities;
    }
    const ids = this.ids, priorities = this.priority;
    let index = this.size++;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (priorities[parent] <= priority) break;
      ids[index] = ids[parent];
      priorities[index] = priorities[parent];
      index = parent;
    }
    ids[index] = id;
    priorities[index] = priority;
  }
  pop() {
    const ids = this.ids, priorities = this.priority;
    const top = ids[0];
    this.topPriority = priorities[0];
    const lastId = ids[--this.size];
    const lastPriority = priorities[this.size];
    if (this.size > 0) {
      let index = 0;
      while (true) {
        let child = index * 2 + 1;
        if (child >= this.size) break;
        if (child + 1 < this.size && priorities[child + 1] < priorities[child]) child++;
        if (priorities[child] >= lastPriority) break;
        ids[index] = ids[child];
        priorities[index] = priorities[child];
        index = child;
      }
      ids[index] = lastId;
      priorities[index] = lastPriority;
    }
    return top;
  }
}

/** Open-addressed lookup from a rounded coordinate to a node index. Way geometry
 * is the only input, so two ways that share an OSM node share the same rounded
 * coordinate and therefore the same graph node. */
class NodeTable {
  private slots: Int32Array;
  private mask: number;
  count = 0;
  constructor(maxNodes: number) {
    let size = 16;
    while (size < maxNodes * 2) size <<= 1;
    this.slots = new Int32Array(size);
    this.mask = size - 1;
  }
  find(lon: number, lat: number, coords: Float64Array): number {
    const x = Math.round(lon * 1e6);
    const y = Math.round(lat * 1e6);
    let slot = ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0) & this.mask;
    const slots = this.slots;
    while (true) {
      const stored = slots[slot];
      if (stored === 0) {
        const index = this.count++;
        slots[slot] = index + 1;
        coords[index * 2] = lon;
        coords[index * 2 + 1] = lat;
        return index;
      }
      const index = stored - 1;
      if (coords[index * 2] === lon && coords[index * 2 + 1] === lat) return index;
      slot = (slot + 1) & this.mask;
    }
  }
}

/** Builds the packed graph. Nodes are identified by their rounded coordinate, so
 * the saved road file does not need to store an OSM node id per point — that is
 * roughly half the file and most of the memory it takes to parse. */
function buildRoutingGraph(network: OfflineRoadNetwork): RoutingGraph {
  const [west, south, east, north] = network.bounds;
  const inBounds = ([longitude, latitude]: RouteCoordinate) =>
    longitude >= west - 1e-9 && longitude <= east + 1e-9 && latitude >= south - 1e-9 && latitude <= north + 1e-9;

  // First pass: count exactly how many edges the graph will hold, so the typed
  // arrays can be allocated once at their final size.
  let pointSlots = 0;
  let edgeSlots = 0;
  for (const road of network.roads) {
    const points = road.coordinates;
    pointSlots += points.length;
    const reverseOnly = road.oneway === '-1';
    const forwardOnly = road.oneway === 'yes' || road.oneway === '1' || road.oneway === 'true';
    for (let index = 0; index < points.length - 1; index++) {
      const a = points[index], b = points[index + 1];
      if (!a || !b || !inBounds(a) || !inBounds(b)) continue;
      if (distance(a, b) === 0) continue;
      if (!reverseOnly) edgeSlots++;
      if (!forwardOnly) edgeSlots++;
    }
  }
  if (edgeSlots > MAX_GRAPH_EDGES) {
    throw new Error('This saved map area contains more roads than the phone can route offline. Save a smaller area or choose a nearer destination.');
  }

  const coords = new Float64Array(Math.max(2, pointSlots * 2));
  const table = new NodeTable(Math.max(16, pointSlots));
  const edgeFrom = new Int32Array(edgeSlots);
  const edgeTo = new Int32Array(edgeSlots);
  const edgeMeters = new Float32Array(edgeSlots);
  const edgeSpeed = new Uint8Array(edgeSlots);
  const edgeName = new Int32Array(edgeSlots);
  const edgeHighway = new Int32Array(edgeSlots);
  const names: string[] = [];
  const nameIndex = new Map<string, number>();
  const highways: string[] = [];
  const highwayIndex = new Map<string, number>();
  const buckets = new Map<number, number[]>();
  let maxSpeed = 1;
  let edgeCount = 0;

  const nameFor = (value: string) => {
    const existing = nameIndex.get(value);
    if (existing !== undefined) return existing;
    const index = names.length;
    names.push(value);
    nameIndex.set(value, index);
    return index;
  };
  const highwayFor = (value: string) => {
    const existing = highwayIndex.get(value);
    if (existing !== undefined) return existing;
    const index = highways.length;
    highways.push(value);
    highwayIndex.set(value, index);
    return index;
  };

  for (const road of network.roads) {
    const points = road.coordinates;
    if (points.length < 2) continue;
    const speed = roadSpeed(road);
    if (speed > maxSpeed) maxSpeed = speed;
    const name = nameFor(road.name || '');
    const highway = highwayFor(road.highway || '');
    const reverseOnly = road.oneway === '-1';
    const forwardOnly = road.oneway === 'yes' || road.oneway === '1' || road.oneway === 'true';
    let previousNode = -1;
    for (let index = 0; index < points.length; index++) {
      const point = points[index];
      if (!point || point.length < 2) { previousNode = -1; continue; }
      const node = table.find(point[0], point[1], coords);
      if (index > 0 && previousNode >= 0) {
        const a = points[index - 1], b = point;
        const meters = distance(a, b);
        if (meters > 0 && inBounds(a) && inBounds(b)) {
          const minLon = Math.min(a[0], b[0]), maxLon = Math.max(a[0], b[0]);
          const minLat = Math.min(a[1], b[1]), maxLat = Math.max(a[1], b[1]);
          const add = (from: number, to: number) => {
            const id = edgeCount++;
            edgeFrom[id] = from;
            edgeTo[id] = to;
            edgeMeters[id] = meters;
            edgeSpeed[id] = speed;
            edgeName[id] = name;
            edgeHighway[id] = highway;
            for (let cx = Math.floor(minLon / GRID_CELL); cx <= Math.floor(maxLon / GRID_CELL); cx++) {
              for (let cy = Math.floor(minLat / GRID_CELL); cy <= Math.floor(maxLat / GRID_CELL); cy++) {
                const key = cellKey(cx, cy);
                const list = buckets.get(key);
                if (list) list.push(id); else buckets.set(key, [id]);
              }
            }
          };
          if (!reverseOnly) add(previousNode, node);
          if (!forwardOnly) add(node, previousNode);
        }
      }
      previousNode = node;
    }
  }

  const nodeCount = table.count;
  // The coordinate table was sized for every point, but shared nodes collapse,
  // so trim the unused tail before it is kept for the life of the session.
  const packedCoords = coords.slice(0, Math.max(2, nodeCount * 2));

  // Compressed adjacency.
  const outStart = new Int32Array(nodeCount + 1);
  for (let edge = 0; edge < edgeCount; edge++) outStart[edgeFrom[edge] + 1]++;
  for (let node = 0; node < nodeCount; node++) outStart[node + 1] += outStart[node];
  const outEdge = new Int32Array(edgeCount);
  const cursor = outStart.slice(0, nodeCount);
  for (let edge = 0; edge < edgeCount; edge++) outEdge[cursor[edgeFrom[edge]]++] = edge;

  const grid = new Map<number, Int32Array>();
  for (const [key, list] of buckets) grid.set(key, Int32Array.from(list));

  return {
    bounds: network.bounds,
    nodeCount,
    coords: packedCoords,
    edgeCount,
    edgeFrom,
    edgeTo,
    edgeMeters,
    edgeSpeed,
    edgeName,
    edgeHighway,
    names,
    highways,
    outStart,
    outEdge,
    maxSpeed,
    grid,
    scratch: {
      scores: new Float64Array(nodeCount + 2),
      previous: new Int32Array(nodeCount + 2),
      heap: new NodeHeap(4096),
      reachable: null,
    },
  };
}

/** Builds the routing graph once and keeps it, so a route costs the same no
 * matter how many times the user asks for one. Rebuilding it for every request
 * is what made the app feel like it had frozen. */
const graphCache = new Map<string, RoutingGraph>();
/** Only the current area is worth keeping; old areas would slowly fill memory. */
const GRAPH_CACHE_LIMIT = 2;

/** A stable fingerprint of a road network, so two different networks never
 * share a cached graph. */
export function routingGraphKey(network: OfflineRoadNetwork) {
  let hash = 2166136261;
  const mix = (value: string) => {
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  };
  mix(network.savedAt);
  mix(network.bounds.join(','));
  for (const road of network.roads) { mix(road.id); mix(road.name); }
  return `${network.roads.length}-${(hash >>> 0).toString(36)}`;
}

export function prepareRoutingGraph(network: OfflineRoadNetwork, cacheKey?: string): RoutingGraph {
  const key = cacheKey ? `${cacheKey}|${routingGraphKey(network)}` : routingGraphKey(network);
  const cached = graphCache.get(key);
  if (cached) return cached;
  const prepared = buildRoutingGraph(network);
  graphCache.set(key, prepared);
  while (graphCache.size > GRAPH_CACHE_LIMIT) {
    const oldest = graphCache.keys().next().value;
    if (oldest === undefined || oldest === key) break;
    graphCache.delete(oldest);
  }
  return prepared;
}

type Snap = { edge: number; ratio: number; meters: number; point: RouteCoordinate };

/** Closest drivable segment to a point, searching outward ring by ring. */
function nearestEdge(graph: RoutingGraph, target: RouteCoordinate, maxMeters: number, usable?: (edge: number) => boolean): Snap | null {
  const { coords, edgeFrom, edgeTo, edgeHighway, highways, grid } = graph;
  let bestEdge = -1, bestRatio = 0, bestMeters = Infinity;
  let bestPoint: RouteCoordinate = target;
  const cx = Math.floor(target[0] / GRID_CELL), cy = Math.floor(target[1] / GRID_CELL);
  const maxRings = Math.ceil(maxMeters / (GRID_CELL * 111320));
  for (let ring = 0; ring <= maxRings; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
        const edges = grid.get(cellKey(cx + dx, cy + dy));
        if (!edges) continue;
        for (let index = 0; index < edges.length; index++) {
          const edge = edges[index];
          // A ramp cannot be reached from the street beside it, so it is never
          // used to start or finish a route.
          if (RAMP_HIGHWAYS.has(highways[edgeHighway[edge]])) continue;
          if (usable && !usable(edge)) continue;
          const from = edgeFrom[edge], to = edgeTo[edge];
          const a: RouteCoordinate = [coords[from * 2], coords[from * 2 + 1]];
          const b: RouteCoordinate = [coords[to * 2], coords[to * 2 + 1]];
          const projection = projectOnSegment(target, a, b);
          if (projection.meters > maxMeters) continue;
          const closer = projection.meters < bestMeters - 8;
          const faster = projection.meters <= bestMeters + 8 && graph.edgeSpeed[edge] > (bestEdge >= 0 ? graph.edgeSpeed[bestEdge] : 0);
          if (bestEdge < 0 || closer || faster) {
            bestEdge = edge;
            bestRatio = projection.ratio;
            bestMeters = projection.meters;
            bestPoint = projection.point;
          }
        }
      }
    }
    if (bestEdge >= 0 && bestMeters <= ring * GRID_CELL * 111320) break;
  }
  return bestEdge >= 0 ? { edge: bestEdge, ratio: bestRatio, meters: bestMeters, point: bestPoint } : null;
}

type RouteEdgeInfo = {
  name: string;
  highway: string;
  start: RouteCoordinate;
  end: RouteCoordinate;
  meters: number;
  speed: number;
};

export function routeOffline(network: OfflineRoadNetwork, start: RoutePoint, destination: RoutePoint): OfflineRoute {
  return routeWithGraph(prepareRoutingGraph(network), start, destination);
}

export function routeWithGraph(graph: RoutingGraph, start: RoutePoint, destination: RoutePoint): OfflineRoute {
  const { coords, nodeCount, edgeCount, edgeFrom, edgeTo, edgeMeters, edgeSpeed, edgeName, edgeHighway, names, highways, outStart, outEdge, maxSpeed, scratch } = graph;
  const startTarget: RouteCoordinate = [start.longitude, start.latitude];
  const endTarget: RouteCoordinate = [destination.longitude, destination.latitude];
  const startSnap = nearestEdge(graph, startTarget, SNAP_MAX_METERS);
  if (!startSnap) throw new RouteOutOfAreaError('Start or destination is outside the saved offline road area. Download a map that covers both points, or pin a destination inside the saved area.');

  // The snapped segment may be used in either direction; a one-way road only
  // allows the direction it is stored with.
  const hasReverse = (edge: number) => {
    const from = edgeFrom[edge], to = edgeTo[edge];
    for (let index = outStart[to]; index < outStart[to + 1]; index++) {
      const candidate = outEdge[index];
      if (edgeTo[candidate] === from && edgeMeters[candidate] === edgeMeters[edge]) return true;
    }
    return false;
  };
  const startLength = edgeMeters[startSnap.edge];
  // The stored direction always exists; the opposite one only if the road is
  // two-way.
  const startForward = true;
  const startBackward = hasReverse(startSnap.edge);
  const origin = nodeCount;
  const target = nodeCount + 1;

  // Virtual edges that join the road network to the exact start/end points.
  type VirtualEdge = RouteEdgeInfo & { from: number; to: number };
  const virtual: VirtualEdge[] = [];
  const addStart = (from: number, to: number, meters: number) => virtual.push({
    from, to, meters, speed: edgeSpeed[startSnap.edge],
    name: names[edgeName[startSnap.edge]], highway: highways[edgeHighway[startSnap.edge]],
    start: from === origin ? startSnap.point : [coords[from * 2], coords[from * 2 + 1]],
    end: to === origin ? startSnap.point : [coords[to * 2], coords[to * 2 + 1]],
  });
  if (startForward) addStart(origin, edgeTo[startSnap.edge], startLength * (1 - startSnap.ratio));
  if (startBackward) addStart(origin, edgeFrom[startSnap.edge], startLength * startSnap.ratio);
  if (!virtual.length) throw new RouteOutOfAreaError('Start or destination is outside the saved offline road area. Download a map that covers both points, or pin a destination inside the saved area.');
  const startVirtualCount = virtual.length;

  const coordinateOf = (node: number): RouteCoordinate =>
    node === origin ? startSnap.point : node >= nodeCount ? [0, 0] : [coords[node * 2], coords[node * 2 + 1]];

  // The destination's closest road is tried first. Only when that road cannot be
  // reached does the search work out which roads are reachable, because that is
  // the expensive part of routing.
  const plainEndSnap = nearestEdge(graph, endTarget, SNAP_MAX_METERS);
  const scores = scratch.scores;
  const previous = scratch.previous;

  const runSearch = (endSnap: Snap | null) => {
    if (!endSnap) return null;
    const endEdge = endSnap.edge;
    const endLength = edgeMeters[endEdge];
    const endPoint = endSnap.point;
    const endForwardFrom = edgeFrom[endEdge];
    const endBackwardFrom = edgeTo[endEdge];
    const endVirtualStart = virtual.length;
    const endHasReverse = hasReverse(endEdge);
    virtual.push({
      from: endForwardFrom, to: target, meters: endLength * endSnap.ratio,
      speed: edgeSpeed[endEdge], name: names[edgeName[endEdge]], highway: highways[edgeHighway[endEdge]],
      start: [coords[endForwardFrom * 2], coords[endForwardFrom * 2 + 1]], end: endPoint,
    });
    if (endHasReverse) {
      virtual.push({
        from: endBackwardFrom, to: target, meters: endLength * (1 - endSnap.ratio),
        speed: edgeSpeed[endEdge], name: names[edgeName[endEdge]], highway: highways[edgeHighway[endEdge]],
        start: [coords[endBackwardFrom * 2], coords[endBackwardFrom * 2 + 1]], end: endPoint,
      });
    }

    scores.fill(Infinity);
    previous.fill(-1);
    scores[origin] = 0;
    const heap = scratch.heap;
    heap.clear();
    // The heuristic can never exceed the real travel time, so it divides by the
    // fastest road in the network.
    const heuristic = (node: number) => {
      if (node === target) return 0;
      const [longitude, latitude] = coordinateOf(node);
      return distance([longitude, latitude], endPoint) / maxSpeed;
    };
    heap.push(origin, heuristic(origin));
    let visited = 0;
    while (heap.size) {
      const node = heap.pop();
      if (node === target) break;
      const base = scores[node];
      if (base === Infinity) continue;
      // A better path to this node was found after this queue entry was added.
      if (heap.topPriority > base + heuristic(node) + 1e-6) continue;
      visited++;
      if (visited > 700000) throw new Error('This offline route is too complex. Choose a closer destination.');
      if (node === origin) {
        for (let index = 0; index < startVirtualCount; index++) {
          const edge = virtual[index];
          const candidate = edge.meters / edge.speed;
          if (candidate >= scores[edge.to]) continue;
          scores[edge.to] = candidate;
          previous[edge.to] = edgeCount + index;
          heap.push(edge.to, candidate + heuristic(edge.to));
        }
      }
      for (let index = outStart[node]; index < outStart[node + 1]; index++) {
        const edge = outEdge[index];
        const to = edgeTo[edge];
        const candidate = base + edgeMeters[edge] / edgeSpeed[edge];
        if (candidate >= scores[to]) continue;
        scores[to] = candidate;
        previous[to] = edge;
        heap.push(to, candidate + heuristic(to));
      }
      // The virtual edges that finish at the destination leave from the two ends
      // of its snapped segment.
      if (node === endForwardFrom || (endHasReverse && node === endBackwardFrom)) {
        for (let index = endVirtualStart; index < virtual.length; index++) {
          const edge = virtual[index];
          if (edge.from !== node) continue;
          const candidate = base + edge.meters / edge.speed;
          if (candidate >= scores[target]) continue;
          scores[target] = candidate;
          previous[target] = edgeCount + index;
          heap.push(target, candidate);
        }
      }
    }
    if (previous[target] < 0) return null;
    const ids: number[] = [];
    for (let node = target; node !== origin;) {
      const id = previous[node];
      if (id < 0) return null;
      ids.push(id);
      node = id < edgeCount ? edgeFrom[id] : virtual[id - edgeCount].from;
    }
    ids.reverse();
    return { ids, endSnap };
  };

  let search = runSearch(plainEndSnap);
  if (!search) {
    // The closest road cannot be reached from here. Mark the roads that can be,
    // then snap the destination to the closest of those.
    if (!scratch.reachable) scratch.reachable = new Uint8Array(nodeCount);
    const reachable = scratch.reachable;
    reachable.fill(0);
    const stack: number[] = [edgeFrom[startSnap.edge], edgeTo[startSnap.edge]];
    reachable[stack[0]] = 1;
    reachable[stack[1]] = 1;
    while (stack.length) {
      const node = stack.pop()!;
      for (let index = outStart[node]; index < outStart[node + 1]; index++) {
        const to = edgeTo[outEdge[index]];
        if (reachable[to]) continue;
        reachable[to] = 1;
        stack.push(to);
      }
    }
    const usable = (edge: number) => reachable[edgeFrom[edge]] === 1 || reachable[edgeTo[edge]] === 1;
    const reachableSnap = nearestEdge(graph, endTarget, SNAP_MAX_METERS, usable)
      ?? nearestEdge(graph, endTarget, SNAP_MAX_METERS * 3, usable);
    if (reachableSnap) search = runSearch(reachableSnap);
  }
  if (!search) throw new RouteOutOfAreaError('No offline road route connects these points. Try another destination within your downloaded area.');
  const endSnap = search.endSnap;

  const edges: RouteEdgeInfo[] = search.ids.map(id => {
    if (id < edgeCount) {
      const from = edgeFrom[id], to = edgeTo[id];
      return {
        name: names[edgeName[id]], highway: highways[edgeHighway[id]],
        start: [coords[from * 2], coords[from * 2 + 1]], end: [coords[to * 2], coords[to * 2 + 1]],
        meters: edgeMeters[id], speed: edgeSpeed[id],
      };
    }
    const edge = virtual[id - edgeCount];
    return { name: edge.name, highway: edge.highway, start: edge.start, end: edge.end, meters: edge.meters, speed: edge.speed };
  });
  if (!edges.length) throw new Error('You are already at this destination.');
  if (distance(startSnap.point, endSnap.point) < 5 && edges.every(edge => edge.meters < 5)) throw new Error('You are already at this destination.');

  const coordinatesList: RouteCoordinate[] = [edges[0].start, ...edges.map(edge => edge.end)];
  // Group edges into legs of the same road, then describe the change between
  // consecutive legs the way a turn-by-turn engine does.
  const legs: { name: string; highway: string; startIndex: number; endIndex: number; endBearing: number }[] = [];
  for (let index = 0; index < edges.length; index++) {
    const edge = edges[index];
    const last = legs[legs.length - 1];
    if (last && last.name === edge.name && last.highway === edge.highway) {
      last.endIndex = index + 1;
      last.endBearing = bearing(edge.start, edge.end);
      continue;
    }
    legs.push({ name: edge.name, highway: edge.highway, startIndex: index, endIndex: index + 1, endBearing: bearing(edge.start, edge.end) });
  }
  const maneuvers: { instruction: string; coordinateIndex: number }[] = [];
  for (let index = 0; index < legs.length - 1; index++) {
    const leg = legs[index], next = legs[index + 1];
    const previousEdge = edges[leg.endIndex - 1], nextEdge = edges[next.startIndex];
    const turn = ((bearing(nextEdge.start, nextEdge.end) - leg.endBearing + 540) % 360) - 180;
    const magnitude = Math.abs(turn);
    const sameRoad = leg.name && next.name && leg.name === next.name;
    if (!sameRoad && !next.name && magnitude < 25) continue;
    if (sameRoad && magnitude < 20) continue;
    const direction = maneuver(previousEdge ? bearing(previousEdge.start, previousEdge.end) : leg.endBearing, nextEdge ? bearing(nextEdge.start, nextEdge.end) : leg.endBearing);
    const named = next.name ? ` onto ${next.name}` : '';
    const instruction = magnitude < 20 && next.name
      ? `Continue on ${next.name}`
      : sameRoad ? `${direction}` : `${direction}${named}`;
    maneuvers.push({ instruction, coordinateIndex: next.startIndex });
  }
  const steps: RouteStep[] = [{ instruction: `Head toward ${edges[0].name || 'your destination'}`, distance: 0, coordinateIndex: 0 }];
  steps.push(...maneuvers.map(({ instruction, coordinateIndex }) => ({ instruction, distance: 0, coordinateIndex })));
  for (let index = 0; index < steps.length - 1; index++) {
    let segmentMeters = 0;
    for (let edgeIndex = steps[index].coordinateIndex; edgeIndex < steps[index + 1].coordinateIndex; edgeIndex++) segmentMeters += edges[edgeIndex]?.meters || 0;
    steps[index] = { ...steps[index], distance: segmentMeters };
  }
  steps.push({ instruction: 'Arrive at your destination', distance: 0, coordinateIndex: coordinatesList.length - 1 });
  const distanceMeters = edges.reduce((total, edge) => total + edge.meters, 0);
  const duration = edges.reduce((total, edge) => total + edge.meters / edge.speed, 0);
  return { geometry: { type: 'LineString', coordinates: coordinatesList }, distance: distanceMeters, duration, steps };
}

export function distanceToRouteMeters(point: RoutePoint, line: RouteCoordinate[]) {
  const target: RouteCoordinate = [point.longitude, point.latitude];
  let nearestDistance = Infinity, nearestIndex = 0;
  // Project onto the nearest segment so the distance is accurate between the
  // route's points, not just at them. The reported index is the closest
  // vertex of that segment, so callers can use it to find the current step.
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    if (!a || !b) continue;
    const projection = projectOnSegment(target, a, b);
    if (projection.meters < nearestDistance) {
      nearestDistance = projection.meters;
      nearestIndex = distance(target, a) <= distance(target, b) ? i : i + 1;
    }
  }
  if (line.length === 1 && line[0]) { nearestDistance = distance(target, line[0]); nearestIndex = 0; }
  return { distance: nearestDistance, index: nearestIndex };
}

export function distanceAlongRouteMeters(line: RouteCoordinate[], fromIndex: number, toIndex: number) {
  let total = 0;
  for (let i = Math.max(0, fromIndex); i < Math.min(toIndex, line.length - 1); i++) total += distance(line[i], line[i + 1]);
  return total;
}
