import {
  RouteOutOfAreaError,
  boundsInclude,
  corridorBounds,
  mergeOfflineRoadNetworks,
  routeOffline,
  type OfflineRoadNetwork,
  type RoadWay,
} from '../src/offline-router';

const road = (id: string, nodes: string[], coordinates: [number, number][], oneway = 'no'): RoadWay => ({ id, nodes, coordinates, name: id, highway: 'residential', oneway });
const net = (bounds: OfflineRoadNetwork['bounds'], roads: RoadWay[]): OfflineRoadNetwork => ({ version: 1, bounds, roads, savedAt: '' });
const p = (latitude: number, longitude: number) => ({ latitude, longitude });

describe('corridorBounds and boundsInclude', () => {
  it('covers both points plus the pad', () => {
    expect(corridorBounds(p(10, 20), p(12, 18), 0.03)).toEqual([17.97, 9.97, 20.03, 12.03]);
  });

  it('is symmetric regardless of point order', () => {
    expect(corridorBounds(p(10, 20), p(12, 18))).toEqual(corridorBounds(p(12, 18), p(10, 20)));
  });

  it('detects containment correctly', () => {
    const outer: [number, number, number, number] = [-1, -1, 1, 1];
    expect(boundsInclude(outer, [-0.5, -0.5, 0.5, 0.5])).toBe(true);
    expect(boundsInclude(outer, [-1, -1, 1, 1])).toBe(true);
    expect(boundsInclude(outer, [-0.5, -0.5, 1.5, 0.5])).toBe(false);
    expect(boundsInclude(outer, [-2, -0.5, 0.5, 0.5])).toBe(false);
  });
});

describe('mergeOfflineRoadNetworks', () => {
  it('unions bounds and dedupes roads by id', () => {
    const base = net([0, 0, 0.1, 0.1], [road('a', ['1', '2'], [[0, 0], [0.1, 0]]), road('b', ['3', '4'], [[0, 0.05], [0.1, 0.05]])]);
    const extra = net([0.05, 0.05, 0.2, 0.2], [road('b', ['3', '4'], [[0, 0.05], [0.1, 0.05]]), road('c', ['5', '6'], [[0.15, 0.1], [0.2, 0.1]])]);
    const merged = mergeOfflineRoadNetworks(base, extra);
    expect(merged.roads.map(item => item.id)).toEqual(['a', 'b', 'c']);
    expect(merged.bounds).toEqual([0, 0, 0.2, 0.2]);
    expect(merged.version).toBe(1);
  });

  it('routes across the merged network', () => {
    const base = net([0, 0, 0.1, 0.1], [road('h1', ['1', '2'], [[0, 0], [0.1, 0]]), road('v1', ['1', '3'], [[0, 0], [0, 0.1]])]);
    const extra = net([0.1, 0, 0.2, 0.1], [road('h2', ['2', '4'], [[0.1, 0], [0.2, 0]]), road('v2', ['4', '5'], [[0.2, 0], [0.2, 0.05]])]);
    const merged = mergeOfflineRoadNetworks(base, extra);
    const route = routeOffline(merged, p(0.0005, -0.0005), p(0.001, 0.199));
    expect(route.distance).toBeGreaterThan(0);
  });
});

describe('RouteOutOfAreaError', () => {
  it('is thrown when a point is outside the network bounds', () => {
    const network = net([0, 0, 0.1, 0.1], [road('h1', ['1', '2'], [[0, 0], [0.1, 0]])]);
    try {
      routeOffline(network, p(0.02, 0.05), p(50, 50));
      throw new Error('expected routeOffline to reject');
    } catch (e) {
      expect(e).toBeInstanceOf(RouteOutOfAreaError);
      expect((e as Error).message).toMatch(/outside the saved offline road area/);
    }
  });

  it('is thrown when the network is disconnected', () => {
    const network = net([0, 0, 0.1, 0.1], [road('h1', ['1', '2'], [[0, 0.02], [0.1, 0.02]]), road('h2', ['3', '4'], [[0, 0.08], [0.1, 0.08]])]);
    expect(() => routeOffline(network, p(0.02, 0.05), p(0.08, 0.05))).toThrow(RouteOutOfAreaError);
  });
});
