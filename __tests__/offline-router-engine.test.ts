import {
  RouteOutOfAreaError,
  boundsInclude,
  corridorBounds,
  mergeOfflineRoadNetworks,
  parseRoadWays,
  prepareRoutingGraph,
  routeOffline,
  routeWithGraph,
  routingGraphKey,
  tileBounds,
  type OfflineRoadNetwork,
  type RoadWay,
} from '../src/offline-router';

const road = (id: string, nodes: string[], coordinates: [number, number][], oneway = 'no', highway = 'residential'): RoadWay => ({ id, nodes, coordinates, name: id, highway, oneway });
const net = (bounds: OfflineRoadNetwork['bounds'], roads: RoadWay[]): OfflineRoadNetwork => ({ version: 1, bounds, roads, savedAt: '' });
const p = (latitude: number, longitude: number) => ({ latitude, longitude });

describe('parseRoadWays', () => {
  it('keeps ways that contain a null geometry point instead of crashing', () => {
    // Overpass can return a null where it could not resolve a node.
    const ways = parseRoadWays([
      { type: 'way', id: 1, nodes: [10, 11, 12], geometry: [{ lat: 0, lon: 0 }, null, { lat: 0.01, lon: 0 }] as never, tags: { highway: 'residential', name: 'Broken St' } },
    ]);
    expect(ways).toHaveLength(1);
    // Coordinates are stored as [longitude, latitude].
    expect(ways[0].coordinates).toEqual([[0, 0], [0, 0.01]]);
    // Node ids are not stored: shared ways are joined by their rounded
    // coordinates, which keeps the saved file about half the size.
    expect(ways[0].nodes).toBeUndefined();
  });

  it('drops ways whose node list and geometry disagree', () => {
    const ways = parseRoadWays([
      { type: 'way', id: 2, nodes: [1, 2, 3], geometry: [{ lat: 0, lon: 0 }, { lat: 0.01, lon: 0 }] as never, tags: { highway: 'residential' } },
    ]);
    expect(ways).toHaveLength(0);
  });

  it('drops ways with fewer than two usable points', () => {
    const ways = parseRoadWays([
      { type: 'way', id: 3, nodes: [1], geometry: [null] as never, tags: { highway: 'residential' } },
    ]);
    expect(ways).toHaveLength(0);
  });

  it('parses ordinary ways unchanged', () => {
    const ways = parseRoadWays([
      { type: 'way', id: 4, nodes: [1, 2], geometry: [{ lat: 0, lon: 0 }, { lat: 0.01, lon: 0 }] as never, tags: { highway: 'residential', name: 'Main St', oneway: 'yes' } },
    ]);
    expect(ways).toEqual([{ id: '4', coordinates: [[0, 0], [0, 0.01]], name: 'Main St', highway: 'residential', oneway: 'yes' }]);
  });
});

describe('routeOffline with real-world road shapes', () => {
  // A simple L-shaped street network, like a real city block.
  const city = net([0, 0, 0.1, 0.1], [
    road('e1', ['a', 'b'], [[0, 0], [0.01, 0]], 'no'),
    road('e2', ['b', 'c'], [[0.01, 0], [0.01, 0.01]], 'no'),
  ]);

  it('routes between two points on the network and reports a real distance', () => {
    const route = routeOffline(city, p(0, 0), p(0.01, 0.01));
    expect(route.distance).toBeGreaterThan(1000);
    expect(route.geometry.coordinates.length).toBeGreaterThanOrEqual(3);
  });

  it('snaps a point that is slightly off the road onto the street', () => {
    const route = routeOffline(city, p(0.00005, 0), p(0.01, 0.01));
    expect(route.distance).toBeGreaterThan(0);
  });

  it('routes from a shelter or address centroid up to 1.2 km from a road', () => {
    // Real shelter pins and geocoded addresses can sit well inside a property,
    // rather than directly on the street. This point is about 780 m from the
    // nearest road in this fixture.
    const route = routeOffline(city, p(0.007, 0.004), p(0.01, 0.01));
    expect(route.distance).toBeGreaterThan(0);
  });

  it('does not route against a one-way street', () => {
    const oneWay = net([0, 0, 0.1, 0.1], [road('ow', ['a', 'b'], [[0, 0], [0.01, 0]], 'yes')]);
    expect(() => routeOffline(oneWay, p(0, 0.01), p(0, 0))).toThrow(RouteOutOfAreaError);
  });

  it('never snaps to a motorway ramp, which cannot be reached from a street', () => {
    // A ramp running alongside a street: the street must win even though the
    // ramp sits closer to the destination. Coordinates are [lon, lat].
    const withRamp = net([0, 0, 0.1, 0.1], [
      road('street', ['s1', 's2'], [[0, 0], [0, 0.01]], 'no', 'residential'),
      road('ramp', ['r1', 'r2'], [[0.0001, 0], [0.0001, 0.01]], 'yes', 'motorway_link'),
    ]);
    // Destination sits 11 m from the ramp and 11 m from the street.
    const route = routeOffline(withRamp, p(0.005, 0.0001), p(0.005, 0.00005));
    expect(route.distance).toBeGreaterThan(0);
    // The route stays on the street (longitude 0), never on the ramp.
    expect(route.geometry.coordinates.every(([longitude]) => Math.abs(longitude) < 0.00005)).toBe(true);
  });

  it('finds a route when the destination sits beside an unreachable motorway', () => {
    // A motorway tunnel the destination is next to, plus a normal street grid.
    const roads: RoadWay[] = [
      road('m1', ['m1', 'm2'], [[0.05, 0.02], [0.06, 0.02]], 'yes', 'motorway'),
      road('s1', ['a', 'b'], [[0, 0], [0, 0.01]], 'no', 'residential'),
      road('s2', ['b', 'c'], [[0, 0.01], [0.01, 0.01]], 'no', 'residential'),
      road('s3', ['c', 'd'], [[0.01, 0.01], [0.02, 0.01]], 'no', 'residential'),
    ];
    const withTunnel = net([0, 0, 0.1, 0.1], roads);
    // The destination is next to the tunnel but must be reached by the street.
    const route = routeOffline(withTunnel, p(0, 0), p(0.01, 0.015));
    expect(route.distance).toBeGreaterThan(1000);
  });

  it('rejects a point far outside every road', () => {
    expect(() => routeOffline(city, p(0, 0), p(0.05, 0.05))).toThrow(RouteOutOfAreaError);
  });
});

describe('routing graph cache', () => {
  it('reuses the prepared graph for the same network', () => {
    const city = net([0, 0, 0.1, 0.1], [road('a', ['a', 'b'], [[0, 0], [0, 0.01]])]);
    const first = prepareRoutingGraph(city);
    const second = prepareRoutingGraph(city);
    expect(second).toBe(first);
  });

  it('does not share a graph between different networks with the same size', () => {
    const first = net([0, 0, 0.1, 0.1], [road('a', ['a', 'b'], [[0, 0], [0, 0.01]])]);
    const second = net([0, 0, 0.1, 0.1], [road('z', ['z', 'y'], [[0, 0], [0, 0.01]])]);
    expect(prepareRoutingGraph(second)).not.toBe(prepareRoutingGraph(first));
  });

  it('gives a different fingerprint to different networks', () => {
    const first = net([0, 0, 0.1, 0.1], [road('a', ['a', 'b'], [[0, 0], [0, 0.01]])]);
    const second = net([0, 0, 0.1, 0.1], [road('z', ['z', 'y'], [[0, 0], [0, 0.01]])]);
    expect(routingGraphKey(first)).not.toBe(routingGraphKey(second));
  });

  it('routes with a prepared graph', () => {
    const city = net([0, 0, 0.1, 0.1], [
      road('e1', ['a', 'b'], [[0, 0], [0, 0.01]]),
      road('e2', ['b', 'c'], [[0, 0.01], [0.01, 0.01]]),
    ]);
    const route = routeWithGraph(prepareRoutingGraph(city), p(0, 0), p(0.01, 0.01));
    expect(route.distance).toBeGreaterThan(1000);
  });

  it('packs nodes and edges into typed arrays instead of objects', () => {
    const city = net([0, 0, 0.1, 0.1], [
      road('e1', ['a', 'b'], [[0, 0], [0, 0.01]]),
      road('e2', ['b', 'c'], [[0, 0.01], [0.01, 0.01]]),
    ]);
    const graph = prepareRoutingGraph(city);
    // Three points, two two-way ways: four directed edges over three nodes.
    expect(graph.nodeCount).toBe(3);
    expect(graph.edgeCount).toBe(4);
    expect(graph.coords).toBeInstanceOf(Float64Array);
    expect(graph.edgeTo).toBeInstanceOf(Int32Array);
    // The parsed network is not retained: it is several times larger than the
    // packed graph and would double the memory held for an offline area.
    expect('network' in graph).toBe(false);
  });

  it('joins ways that share a point even without OSM node ids', () => {
    // New downloads store coordinates only; the shared corner has to connect.
    const city = net([0, 0, 0.1, 0.1], [
      { id: 'e1', coordinates: [[0, 0], [0, 0.01]], name: 'First', highway: 'residential', oneway: 'no' },
      { id: 'e2', coordinates: [[0, 0.01], [0.01, 0.01]], name: 'Second', highway: 'residential', oneway: 'no' },
    ]);
    const graph = prepareRoutingGraph(city);
    expect(graph.nodeCount).toBe(3);
    const route = routeWithGraph(graph, p(0, 0), p(0.01, 0.01));
    expect(route.distance).toBeGreaterThan(1000);
    expect(route.steps.some(step => step.instruction.includes('Second'))).toBe(true);
  });
});

describe('corridor and tiling helpers', () => {
  it('covers both points plus the pad', () => {
    expect(corridorBounds(p(10, 20), p(12, 18), 0.03)).toEqual([17.97, 9.97, 20.03, 12.03]);
  });

  it('detects containment', () => {
    expect(boundsInclude([-1, -1, 1, 1], [-0.5, -0.5, 0.5, 0.5])).toBe(true);
    expect(boundsInclude([-1, -1, 1, 1], [-0.5, -0.5, 1.5, 0.5])).toBe(false);
  });

  it('splits a large area into smaller tiles that cover it', () => {
    const tiles = tileBounds([0, 0, 0.2, 0.2], 0.05);
    expect(tiles.length).toBeGreaterThan(1);
    expect(tiles[0][0]).toBeCloseTo(0);
    expect(tiles[tiles.length - 1][2]).toBeCloseTo(0.2);
    expect(tiles[tiles.length - 1][3]).toBeCloseTo(0.2);
    // Every tile stays inside the requested area.
    for (const [west, south, east, north] of tiles) {
      expect(west).toBeGreaterThanOrEqual(0);
      expect(south).toBeGreaterThanOrEqual(0);
      expect(east).toBeLessThanOrEqual(0.2000001);
      expect(north).toBeLessThanOrEqual(0.2000001);
    }
  });

  it('returns a single tile for a small area', () => {
    expect(tileBounds([0, 0, 0.01, 0.01], 0.05)).toHaveLength(1);
  });
});

describe('mergeOfflineRoadNetworks', () => {
  it('unions bounds and dedupes roads by id', () => {
    const base = net([0, 0, 0.1, 0.1], [road('a', ['1', '2'], [[0, 0], [0.1, 0]]), road('b', ['3', '4'], [[0, 0.05], [0.1, 0.05]])]);
    const extra = net([0.05, 0.05, 0.2, 0.2], [road('b', ['3', '4'], [[0, 0.05], [0.1, 0.05]]), road('c', ['5', '6'], [[0.15, 0.1], [0.2, 0.1]])]);
    const merged = mergeOfflineRoadNetworks(base, extra);
    expect(merged.roads.map(item => item.id)).toEqual(['a', 'b', 'c']);
    expect(merged.bounds).toEqual([0, 0, 0.2, 0.2]);
  });
});
