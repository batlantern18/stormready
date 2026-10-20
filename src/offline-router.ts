import { httpFetch } from './net/http';

export type RouteCoordinate = [number, number];
export type RouteBounds = [number, number, number, number];
export type RoadWay = {
  id: string;
  nodes: string[];
  coordinates: RouteCoordinate[];
  name: string;
  highway: string;
  oneway: string;
};
export type OfflineRoadNetwork = { version: 1; bounds: RouteBounds; roads: RoadWay[]; savedAt: string };
export type OfflineDestination = {
  id: string;
  name: string;
  address: string;
  city: string;
  region: string;
  latitude: number;
  longitude: number;
};
export type OfflineDestinationIndex = { version: 1; bounds: RouteBounds; destinations: OfflineDestination[]; savedAt: string };
export type RouteStep = { instruction: string; distance: number; coordinateIndex: number };
export type OfflineRoute = {
  geometry: { type: 'LineString'; coordinates: RouteCoordinate[] };
  distance: number;
  duration: number;
  steps: RouteStep[];
};
export type RoutePoint = { latitude: number; longitude: number };

/** Thrown when a route cannot resolve because one or both points sit outside the
 * saved road network (or the network is disconnected). A larger/corridor network
 * downloaded on demand can fix it, so callers special-case this class. */
export class RouteOutOfAreaError extends Error {}

type OverpassWay = {
  type: 'node' | 'way'; id: number; nodes?: number[]; lat?: number; lon?: number;
  center?: { lat: number; lon: number };
  geometry?: ({ lat: number; lon: number } | null)[];
  tags?: Record<string, string>;
};

// Public Overpass mirrors. The main endpoint is often rate limited or busy, so
// a failed download is retried against the others before giving up.
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const ROUTABLE_HIGHWAYS = 'motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|road';
const MAX_NETWORK_BYTES = 50 * 1024 * 1024;
/** Overpass handles a small box far more reliably than a large one, so big areas
 * are fetched as a grid of tiles and stitched together. */
const TILE_DEGREES = 0.05;

/** Overpass can return a way whose geometry contains nulls (nodes it could not
 * resolve) or a length that does not match the node list. Such a way is
 * unusable for routing, so it is dropped instead of crashing the whole download. */
export function parseRoadWays(elements: OverpassWay[] = []): RoadWay[] {
  const roads: RoadWay[] = [];
  for (const way of elements) {
    const tags = way.tags || {};
    if (way.type !== 'way' || !way.nodes?.length || !way.geometry?.length) continue;
    if (way.nodes.length !== way.geometry.length) continue;
    const coordinates: RouteCoordinate[] = [];
    for (const point of way.geometry) {
      if (!point || typeof point.lat !== 'number' || typeof point.lon !== 'number') continue;
      coordinates.push([point.lon, point.lat]);
    }
    // A way needs at least two usable points to form an edge.
    if (coordinates.length < 2) continue;
    roads.push({
      id: String(way.id), nodes: way.nodes.map(String),
      coordinates,
      name: tags.name || tags.ref || '', highway: tags.highway || 'road',
      oneway: tags.oneway || (tags.junction === 'roundabout' ? 'yes' : 'no'),
    });
  }
  return roads;
}

export async function downloadOfflineRoadNetwork(bounds: RouteBounds): Promise<OfflineRoadNetwork> {
  const [west, south, east, north] = bounds;
  const box = `${south},${west},${north},${east}`;
  const query = `[out:json][timeout:90];way["highway"~"^(${ROUTABLE_HIGHWAYS})$"]["access"!~"^(no|private)$"]["motor_vehicle"!~"^(no|private)$"](${box});out body geom;`;
  let data: { elements?: OverpassWay[]; remark?: string } | null = null;
  let lastFailure: unknown = null;
  for (const url of OVERPASS_URLS) {
    try {
      const response = await httpFetch(url, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        timeoutMs: 120_000,
        retries: 1,
        userAgent: 'StormReady/1.1 (offline map data)',
      });
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength > MAX_NETWORK_BYTES) throw new Error('Road data for this area exceeds the 50 MB offline limit. Try a smaller nearby map area.');
      const parsed = await response.json() as { elements?: OverpassWay[]; remark?: string };
      if (parsed.remark && !(parsed.elements || []).length) throw new Error('The road data service could not finish this area. Try downloading again.');
      data = parsed;
      break;
    } catch (error) {
      lastFailure = error;
      if (error instanceof Error && error.message.includes('50 MB')) throw error;
    }
  }
  if (!data) {
    if (lastFailure instanceof Error && lastFailure.message.includes('50 MB')) throw lastFailure;
    throw new Error('The road data service could not be reached. Check your connection and try again.');
  }
  const roads = parseRoadWays(data.elements);
  if (!roads.length) throw new Error('No routable roads were found in this area. Download a nearby map area.');
  if (JSON.stringify(roads).length * 2 > MAX_NETWORK_BYTES) throw new Error('Road data for this area exceeds the 50 MB offline limit. Try a smaller nearby map area.');
  return { version: 1, bounds, roads, savedAt: new Date().toISOString() };
}

/** Splits a bounding box into small square-ish tiles that Overpass can serve
 * individually, so one failed or oversized tile never sinks the whole area. */
export function tileBounds(bounds: RouteBounds, sizeDegrees = TILE_DEGREES): RouteBounds[] {
  const [west, south, east, north] = bounds;
  const midLatitude = (south + north) / 2;
  const longitudeStep = sizeDegrees / Math.max(0.45, Math.cos(midLatitude * Math.PI / 180));
  const tiles: RouteBounds[] = [];
  for (let tileSouth = south; tileSouth < north - 1e-9; tileSouth += sizeDegrees) {
    for (let tileWest = west; tileWest < east - 1e-9; tileWest += longitudeStep) {
      tiles.push([
        tileWest,
        tileSouth,
        Math.min(tileWest + longitudeStep, east),
        Math.min(tileSouth + sizeDegrees, north),
      ] as RouteBounds);
    }
  }
  return tiles;
}

/**
 * Downloads a road network as a grid of tiles and stitches them into one graph.
 * Each tile is fetched independently, so a single busy or failing tile can be
 * retried without losing the tiles that already succeeded.
 */
export async function downloadOfflineRoadNetworkTiled(
  bounds: RouteBounds,
  onProgress?: (completed: number, total: number) => void,
): Promise<OfflineRoadNetwork> {
  const tiles = tileBounds(bounds);
  if (tiles.length === 1) return downloadOfflineRoadNetwork(bounds);
  const networks: OfflineRoadNetwork[] = [];
  const failures: string[] = [];
  for (let index = 0; index < tiles.length; index++) {
    try {
      networks.push(await downloadOfflineRoadNetwork(tiles[index]));
    } catch (error) {
      failures.push(error instanceof Error ? error.message : 'A map section could not be downloaded.');
    }
    onProgress?.(index + 1, tiles.length);
  }
  if (!networks.length) throw new Error(failures[0] || 'The road data service could not be reached. Check your connection and try again.');
  const merged = mergeOfflineRoadNetworks(...networks);
  if (failures.length) throw new Error(`${failures[0]} (${failures.length} of ${tiles.length} map sections could not be downloaded.)`);
  return merged;
}

export async function downloadOfflineDestinationIndex(bounds: RouteBounds): Promise<OfflineDestinationIndex> {
  const [west, south, east, north] = bounds;
  const box = `${south},${west},${north},${east}`;
  const query = `[out:json][timeout:90];(node["addr:housenumber"](${box});way["addr:housenumber"](${box});way["name"]["highway"~"^(${ROUTABLE_HIGHWAYS})$"](${box});nw["name"]["amenity"~"^(restaurant|cafe|hospital|clinic|school|pharmacy|fuel|parking|shelter|library|police|fire_station|townhall|place_of_worship)$"](${box});nw["name"]["shop"](${box});nw["name"]["tourism"](${box});nw["name"]["leisure"](${box});nw["name"]["place"](${box}););out center;`;
  let data: { elements?: OverpassWay[]; remark?: string } | null = null;
  for (const url of OVERPASS_URLS) {
    try {
      const response = await httpFetch(url, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        timeoutMs: 120_000,
        retries: 1,
        userAgent: 'StormReady/1.1 (offline map data)',
      });
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength > 20 * 1024 * 1024) throw new Error('This area has too many address and place records to save offline.');
      const parsed = await response.json() as { elements?: OverpassWay[]; remark?: string };
      if (parsed.remark && !(parsed.elements || []).length) throw new Error('The destination search data service could not finish this area. Try downloading again.');
      data = parsed;
      break;
    } catch (error) {
      if (error instanceof Error && error.message.includes('too many address')) throw error;
    }
  }
  if (!data) throw new Error('The offline destination search data service could not be reached. Check your connection and try again.');
  const destinations = new Map<string, OfflineDestination>();
  for (const element of data.elements || []) {
    const tags = element.tags || {};
    const coordinates = element.type === 'node' && element.lat != null && element.lon != null
      ? { lat: element.lat, lon: element.lon }
      : element.center;
    if (!coordinates || (!tags.name && !tags['addr:housenumber'])) continue;
    const house = tags['addr:housenumber'] || '';
    const street = tags['addr:street'] || '';
    const address = tags['addr:full'] || [house, street].filter(Boolean).join(' ') || tags.name || '';
    const name = tags.name || address;
    const key = `${element.type}/${element.id}`;
    if (!destinations.has(key)) destinations.set(key, {
      id: key,
      name,
      address,
      city: tags['addr:city'] || tags['addr:suburb'] || tags['addr:town'] || '',
      region: tags['addr:state'] || tags['addr:province'] || '',
      latitude: coordinates.lat,
      longitude: coordinates.lon,
    });
  }
  const records = [...destinations.values()];
  if (JSON.stringify(records).length * 2 > 20 * 1024 * 1024) throw new Error('This area has too many address and place records to save offline.');
  return { version: 1, bounds, destinations: records, savedAt: new Date().toISOString() };
}

/** Bounding box that covers both routing points plus a feel-around pad, used to
 * download road data for trips that leave the saved area. */
export function corridorBounds(start: RoutePoint, destination: RoutePoint, padDeg = 0.02): RouteBounds {
  const west = Math.min(start.longitude, destination.longitude) - padDeg;
  const south = Math.min(start.latitude, destination.latitude) - padDeg;
  const east = Math.max(start.longitude, destination.longitude) + padDeg;
  const north = Math.max(start.latitude, destination.latitude) + padDeg;
  return [west, south, east, north] as const;
}

export function boundsInclude(bounds: RouteBounds, target: RouteBounds) {
  return bounds[0] <= target[0] && bounds[1] <= target[1] && bounds[2] >= target[2] && bounds[3] >= target[3];
}

export function mergeOfflineRoadNetworks(...networks: OfflineRoadNetwork[]): OfflineRoadNetwork {
  const roads: RoadWay[] = [];
  const seen = new Set<string>();
  for (const network of networks) for (const road of network.roads) {
    if (seen.has(road.id)) continue;
    seen.add(road.id);
    roads.push(road);
  }
  const bounds = networks.reduce<RouteBounds>((union, network) => [
    Math.min(union[0], network.bounds[0]),
    Math.min(union[1], network.bounds[1]),
    Math.max(union[2], network.bounds[2]),
    Math.max(union[3], network.bounds[3]),
  ], networks[0].bounds);
  if (JSON.stringify(roads).length * 2 > MAX_NETWORK_BYTES) throw new Error('The combined road data for this area exceeds the 50 MB offline limit. Choose a nearer destination.');
  return { version: 1, bounds, roads, savedAt: new Date().toISOString() };
}

function normalizeSearchText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/\b(st)\b/g, 'street').replace(/\b(rd)\b/g, 'road').replace(/\b(ave)\b/g, 'avenue').replace(/\b(blvd)\b/g, 'boulevard').replace(/\b(dr)\b/g, 'drive').replace(/\b(ln)\b/g, 'lane').replace(/\b(hwy)\b/g, 'highway').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function searchOfflineDestinations(index: OfflineDestinationIndex, query: string, limit = 6): OfflineDestination[] {
  const normalized = normalizeSearchText(query);
  const terms = normalized.split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const matches = index.destinations.flatMap(destination => {
    const full = normalizeSearchText(`${destination.name} ${destination.address} ${destination.city} ${destination.region}`);
    if (!terms.every(term => full.includes(term))) return [];
    const exact = full === normalized ? 0 : full.startsWith(normalized) ? 1 : 2;
    const ordered = full.indexOf(terms.join(' ')) >= 0 ? 0 : 1;
    return [{ destination, score: exact * 2 + ordered }];
  });
  return matches.sort((a, b) => a.score - b.score || a.destination.name.localeCompare(b.destination.name)).slice(0, limit).map(match => match.destination);
}

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
function nearestNode(point: RoutePoint, coordinates: Map<string, RouteCoordinate>) {
  const target: RouteCoordinate = [point.longitude, point.latitude];
  let found = '', min = Infinity;
  for (const [id, coordinate] of coordinates) {
    const d = distance(target, coordinate);
    if (d < min) { min = d; found = id; }
  }
  return min <= 1200 ? found : '';
}
type Edge = { to: string; start: RouteCoordinate; end: RouteCoordinate; wayId: string; name: string; speed: number; meters: number };
class MinHeap {
  private values: { id: string; priority: number }[] = [];
  get size() { return this.values.length; }
  push(value: { id: string; priority: number }) {
    const a = this.values; a.push(value); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].priority <= value.priority) break; a[i] = a[p]; i = p; }
    a[i] = value;
  }
  pop() {
    const a = this.values; if (!a.length) return undefined;
    const first = a[0], last = a.pop()!;
    if (a.length) {
      let i = 0;
      while (true) { let child = i * 2 + 1; if (child >= a.length) break; if (child + 1 < a.length && a[child + 1].priority < a[child].priority) child++;
        if (a[child].priority >= last.priority) break; a[i] = a[child]; i = child; }
      a[i] = last;
    }
    return first;
  }
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

export function routeOffline(network: OfflineRoadNetwork, start: RoutePoint, destination: RoutePoint): OfflineRoute {
  const graph = new Map<string, Edge[]>();
  const coordinates = new Map<string, RouteCoordinate>();
  const [west, south, east, north] = network.bounds;
  const inBounds = ([longitude, latitude]: RouteCoordinate) => longitude >= west && longitude <= east && latitude >= south && latitude <= north;
  const connect = (from: string, edge: Edge) => { const list = graph.get(from) || []; list.push(edge); graph.set(from, list); };
  for (const road of network.roads) {
    for (let i = 0; i < road.nodes.length - 1; i++) {
      const a = road.coordinates[i], b = road.coordinates[i + 1];
      if (!a || !b || !inBounds(a) || !inBounds(b) || distance(a, b) === 0) continue;
      const from = road.nodes[i], to = road.nodes[i + 1];
      coordinates.set(from, a); coordinates.set(to, b);
      const meters = distance(a, b);
      const forward: Edge = { to, start: a, end: b, wayId: road.id, name: road.name, speed: roadSpeed(road), meters };
      const reverse: Edge = { ...forward, to: from, start: b, end: a };
      if (road.oneway !== '-1') connect(from, forward);
      if (road.oneway !== 'yes' && road.oneway !== '1' && road.oneway !== 'true') connect(to, reverse);
    }
  }
  const origin = nearestNode(start, coordinates), target = nearestNode(destination, coordinates);
  if (!origin || !target) throw new RouteOutOfAreaError('Start or destination is outside the saved offline road area. Download a map that covers both points, or pin a destination inside the saved area.');
  const scores = new Map<string, number>([[origin, 0]]);
  const previous = new Map<string, { from: string; edge: Edge }>();
  const open = new MinHeap(); open.push({ id: origin, priority: 0 });
  const targetCoordinate = coordinates.get(target)!;
  let visited = 0;
  while (open.size) {
    const next = open.pop()!;
    if (next.id === target) break;
    const nextScore = scores.get(next.id) ?? Infinity;
    const optimisticPriority = nextScore + distance(coordinates.get(next.id)!, targetCoordinate) / 35;
    if (next.priority > optimisticPriority + 1e-6) continue;
    visited++; if (visited > 700000) throw new Error('This offline route is too complex. Choose a closer destination.');
    const fromScore = scores.get(next.id)!;
    for (const edge of graph.get(next.id) || []) {
      const candidate = fromScore + edge.meters / edge.speed;
      if (candidate >= (scores.get(edge.to) ?? Infinity)) continue;
      scores.set(edge.to, candidate); previous.set(edge.to, { from: next.id, edge });
      const heuristic = distance(edge.end, targetCoordinate) / 35;
      open.push({ id: edge.to, priority: candidate + heuristic });
    }
  }
  if (origin !== target && !previous.has(target)) throw new RouteOutOfAreaError('No offline road route connects these points. Try another destination within your downloaded area.');
  const edges: Edge[] = [];
  for (let node = target; node !== origin;) { const item = previous.get(node); if (!item) throw new Error('Could not reconstruct the offline route.'); edges.unshift(item.edge); node = item.from; }
  if (!edges.length) throw new Error('You are already at this destination.');
  const coordinatesList: RouteCoordinate[] = [edges[0].start, ...edges.map(edge => edge.end)];
  const maneuvers: { instruction: string; coordinateIndex: number }[] = [];
  let segmentName = edges[0].name;
  for (let i = 0; i < edges.length; i++) {
    const next = edges[i + 1];
    if (!next) break;
    const roadChanged = next.name !== segmentName && (next.name || segmentName);
    const angle = Math.abs(((bearing(next.start, next.end) - bearing(edges[i].start, edges[i].end) + 540) % 360) - 180);
    if (roadChanged || angle >= 38) {
      const direction = maneuver(bearing(edges[i].start, edges[i].end), bearing(next.start, next.end));
      maneuvers.push({ instruction: `${direction}${next.name ? ` onto ${next.name}` : ''}`, coordinateIndex: i + 1 });
      segmentName = next.name;
    }
  }
  const steps: RouteStep[] = [{ instruction: `Head toward ${edges[0].name || 'your destination'}`, distance: 0, coordinateIndex: 0 }];
  steps.push(...maneuvers.map(({ instruction, coordinateIndex }) => ({ instruction, distance: 0, coordinateIndex })));
  for (let i = 0; i < steps.length - 1; i++) {
    let segmentMeters = 0;
    for (let edgeIndex = steps[i].coordinateIndex; edgeIndex < steps[i + 1].coordinateIndex; edgeIndex++) segmentMeters += edges[edgeIndex]?.meters || 0;
    steps[i] = { ...steps[i], distance: segmentMeters };
  }
  steps.push({ instruction: 'Arrive at your destination', distance: 0, coordinateIndex: coordinatesList.length - 1 });
  const distanceMeters = edges.reduce((total, edge) => total + edge.meters, 0);
  const duration = edges.reduce((total, edge) => total + edge.meters / edge.speed, 0);
  return { geometry: { type: 'LineString', coordinates: coordinatesList }, distance: distanceMeters, duration, steps };
}

export function distanceToRouteMeters(point: RoutePoint, line: RouteCoordinate[]) {
  const target: RouteCoordinate = [point.longitude, point.latitude];
  let nearestDistance = Infinity, nearestIndex = 0;
  for (let i = 0; i < line.length; i++) {
    const current = distance(target, line[i]);
    if (current < nearestDistance) { nearestDistance = current; nearestIndex = i; }
  }
  return { distance: nearestDistance, index: nearestIndex };
}

export function distanceAlongRouteMeters(line: RouteCoordinate[], fromIndex: number, toIndex: number) {
  let total = 0;
  for (let i = Math.max(0, fromIndex); i < Math.min(toIndex, line.length - 1); i++) total += distance(line[i], line[i + 1]);
  return total;
}
