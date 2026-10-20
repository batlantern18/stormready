import {
  distanceAlongRouteMeters,
  distanceToRouteMeters,
  downloadOfflineDestinationIndex,
  downloadOfflineRoadNetwork,
  routeOffline,
  searchOfflineDestinations,
  type OfflineDestinationIndex,
  type OfflineRoadNetwork,
} from '../src/offline-router';

function network(overrides: Partial<OfflineRoadNetwork> = {}): OfflineRoadNetwork {
  return {
    version: 1,
    bounds: [-1, -1, 1, 1],
    savedAt: '2026-10-19T00:00:00.000Z',
    roads: [
      {
        id: '1',
        nodes: ['a', 'b'],
        coordinates: [[0, 0], [0, 0.01]],
        name: 'Main St',
        highway: 'residential',
        oneway: 'no',
      },
      {
        id: '2',
        nodes: ['b', 'd'],
        coordinates: [[0, 0.01], [0.01, 0.01]],
        name: 'Side St',
        highway: 'residential',
        oneway: 'no',
      },
    ],
    ...overrides,
  };
}

describe('routeOffline', () => {
  it('routes between the nearest nodes and builds maneuvers', () => {
    const route = routeOffline(network(), { latitude: 0, longitude: 0 }, { latitude: 0.01, longitude: 0.01 });
    expect(route.geometry.type).toBe('LineString');
    expect(route.geometry.coordinates).toHaveLength(3);
    expect(route.distance).toBeGreaterThan(2100);
    expect(route.duration).toBeGreaterThan(200);
    expect(route.steps[0].instruction).toContain('Main St');
    expect(route.steps.some(step => step.instruction.includes('Side St'))).toBe(true);
    expect(route.steps.at(-1)?.instruction).toBe('Arrive at your destination');
  });

  it('rejects a start outside the downloaded area', () => {
    expect(() => routeOffline(network(), { latitude: 5, longitude: 5 }, { latitude: 0.01, longitude: 0.01 }))
      .toThrow(/outside the saved offline road area/);
  });

  it('does not use one-way roads in reverse', () => {
    const oneWay = network({
      roads: [{
        id: '1',
        nodes: ['a', 'b'],
        coordinates: [[0, 0], [0.01, 0]],
        name: 'One Way',
        highway: 'residential',
        oneway: 'yes',
      }],
    });
    expect(() => routeOffline(oneWay, { latitude: 0, longitude: 0.01 }, { latitude: 0, longitude: 0 }))
      .toThrow(/No offline road route/);
  });

  it('throws when start and destination are the same node', () => {
    expect(() => routeOffline(network(), { latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 }))
      .toThrow(/already at this destination/);
  });
});

describe('offline destination search', () => {
  const index: OfflineDestinationIndex = {
    version: 1,
    bounds: [-1, -1, 1, 1],
    savedAt: '2026-10-19T00:00:00.000Z',
    destinations: [
      { id: 'node/1', name: 'Café Centro', address: '123 Main St', city: 'Austin', region: 'TX', latitude: 0, longitude: 0 },
      { id: 'node/2', name: 'Central Library', address: '500 Oak Rd', city: 'Austin', region: 'TX', latitude: 0, longitude: 0 },
    ],
  };

  it('normalizes accents, abbreviations, and word order', () => {
    expect(searchOfflineDestinations(index, 'cafe centro')[0].name).toBe('Café Centro');
    expect(searchOfflineDestinations(index, 'main st')[0].name).toBe('Café Centro');
    expect(searchOfflineDestinations(index, 'road oak')[0].name).toBe('Central Library');
  });

  it('returns nothing for empty or unmatched queries', () => {
    expect(searchOfflineDestinations(index, '   ')).toEqual([]);
    expect(searchOfflineDestinations(index, 'nonexistent')).toEqual([]);
  });

  it('respects the result limit', () => {
    expect(searchOfflineDestinations(index, 'austin', 1)).toHaveLength(1);
  });
});

describe('distance helpers', () => {
  const line: [number, number][] = [[0, 0], [0, 0.01], [0, 0.02]];

  it('finds the closest vertex and how far off the line a point is', () => {
    const result = distanceToRouteMeters({ latitude: 0.01, longitude: 0.001 }, line);
    expect(result.index).toBe(1);
    expect(result.distance).toBeGreaterThan(100);
    expect(result.distance).toBeLessThan(120);
  });

  it('adds up distance between route indexes', () => {
    expect(distanceAlongRouteMeters(line, 1, 1)).toBe(0);
    expect(distanceAlongRouteMeters(line, 0, 2)).toBeGreaterThan(2100);
    expect(distanceAlongRouteMeters(line, -5, 2)).toBeGreaterThan(2100);
  });
});

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

describe('offline downloads', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('posts an Overpass query and keeps roads with matching geometry', async () => {
    globalThis.fetch = jest.fn(async () => jsonResponse({
      elements: [
        {
          type: 'way', id: 10, nodes: [1, 2],
          geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 }],
          tags: { highway: 'residential', name: 'Main St' },
        },
        {
          type: 'way', id: 11, nodes: [1, 2], geometry: [{ lat: 0, lon: 0 }],
          tags: { highway: 'residential' },
        },
        { type: 'node', id: 1, lat: 0, lon: 0 },
      ],
    })) as unknown as typeof fetch;

    const result = await downloadOfflineRoadNetwork([-1, -1, 1, 1]);
    expect(result.roads).toHaveLength(1);
    expect(result.roads[0]).toMatchObject({ id: '10', name: 'Main St', highway: 'residential', oneway: 'no' });
    expect(result.roads[0].coordinates).toEqual([[0, 0], [0.01, 0]]);

    const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('overpass-api.de');
    expect(init.method).toBe('POST');
    expect(init.headers['User-Agent']).toContain('StormReady/1.1');
    expect(decodeURIComponent(init.body)).toContain('-1,-1,1,1');
  });

  it('fails when the service returns no roads or a remark', async () => {
    globalThis.fetch = jest.fn(async () => jsonResponse({ elements: [] })) as unknown as typeof fetch;
    await expect(downloadOfflineRoadNetwork([-1, -1, 1, 1])).rejects.toThrow(/No routable roads/);

    globalThis.fetch = jest.fn(async () => jsonResponse({ remark: 'runtime error' })) as unknown as typeof fetch;
    await expect(downloadOfflineRoadNetwork([-1, -1, 1, 1])).rejects.toThrow(/could not finish/);
  });

  it('builds a deduplicated destination index from nodes and way centers', async () => {
    globalThis.fetch = jest.fn(async () => jsonResponse({
      elements: [
        {
          type: 'node', id: 1, lat: 0, lon: 0,
          tags: { name: 'Café Centro', 'addr:housenumber': '123', 'addr:street': 'Main St', 'addr:city': 'Austin', 'addr:state': 'TX' },
        },
        {
          type: 'way', id: 2, center: { lat: 0.01, lon: 0.01 },
          tags: { 'addr:housenumber': '500', 'addr:street': 'Oak Rd', 'addr:city': 'Austin' },
        },
        { type: 'node', id: 1, lat: 0, lon: 0, tags: { name: 'Café Centro' } },
        { type: 'node', id: 3, lat: 0, lon: 0, tags: { amenity: 'bench' } },
      ],
    })) as unknown as typeof fetch;

    const result = await downloadOfflineDestinationIndex([-1, -1, 1, 1]);
    expect(result.destinations).toHaveLength(2);
    expect(result.destinations[0]).toMatchObject({
      id: 'node/1',
      name: 'Café Centro',
      address: '123 Main St',
      city: 'Austin',
      region: 'TX',
    });
    expect(result.destinations[1]).toMatchObject({ id: 'way/2', name: '500 Oak Rd', city: 'Austin' });
  });
});
