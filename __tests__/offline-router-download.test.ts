import {
  MirrorPool,
  RoadDownloadCancelledError,
  downloadOfflineRoadNetwork,
  downloadOfflineRoadNetworkTiled,
  highwayFilter,
  isDetailRoad,
  overpassMirrorUrls,
  splitBounds,
} from '../src/offline-router';

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  } as unknown as Response;
}

/** A mirror that answers 200 and then cuts the body off mid-JSON, which is what
 * the public instance does to large chunked answers. */
function truncatedResponse() {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"elements":[{"type":"way","id":1,"tags":{"name":"Main'));
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: stream,
    json: async () => { throw new SyntaxError('truncated'); },
  } as unknown as Response;
}

const roadElement = (id: number, lon: number, lat: number) => ({
  type: 'way',
  id,
  nodes: [id * 2, id * 2 + 1],
  geometry: [{ lat, lon }, { lat: lat + 0.01, lon }],
  tags: { highway: 'residential', name: `Road ${id}` },
});

describe('splitBounds', () => {
  it('splits a box into four boxes that together cover it', () => {
    const parts = splitBounds([0, 0, 0.2, 0.2]);
    expect(parts).toHaveLength(4);
    for (const [west, south, east, north] of parts) {
      expect(west).toBeGreaterThanOrEqual(0);
      expect(south).toBeGreaterThanOrEqual(0);
      expect(east).toBeLessThanOrEqual(0.2);
      expect(north).toBeLessThanOrEqual(0.2);
    }
    // The four parts meet in the middle and reach every corner.
    const lons = parts.map(part => part[0]).sort((a, b) => a - b);
    const lats = parts.map(part => part[1]).sort((a, b) => a - b);
    expect(lons[0]).toBe(0);
    expect(lats[0]).toBe(0);
    expect(Math.max(...parts.map(part => part[2]))).toBe(0.2);
    expect(Math.max(...parts.map(part => part[3]))).toBe(0.2);
  });
});

describe('road detail levels', () => {
  it('leaves the small local roads out of the core network', () => {
    expect(highwayFilter('core')).not.toContain('service');
    expect(highwayFilter('full')).toContain('service');
    expect(highwayFilter('core')).toContain('residential');
  });

  it('knows which roads are the small local ones', () => {
    expect(isDetailRoad('service')).toBe(true);
    expect(isDetailRoad('residential')).toBe(false);
  });
});

describe('tiled road download', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('keeps the fast mirror as the first attempt after a dropped connection', async () => {
    const [primary, fallback] = overpassMirrorUrls();
    const pool = new MirrorPool();
    const calls: string[] = [];
    globalThis.fetch = jest.fn(async (url: string) => {
      calls.push(url);
      // The fast mirror drops this one request, which is what it does under
      // load. That must not push it out of the next section's candidates, which
      // would leave only services that never answer.
      if (url === primary) throw new TypeError('socket hang up');
      return jsonResponse({ elements: [roadElement(1, 0, 0)] });
    }) as unknown as typeof fetch;

    const options = { pool, mirrors: 2, retries: 0, timeoutMs: 5_000 } as const;
    await downloadOfflineRoadNetwork([0, 0, 0.2, 0.2], options);
    expect(calls).toEqual([primary, fallback]);

    calls.length = 0;
    const network = await downloadOfflineRoadNetwork([0, 0, 0.2, 0.2], options);
    expect(calls).toEqual([primary, fallback]);
    expect(network.roads).toHaveLength(1);
  });

  it('splits a section that fails and keeps the roads that arrive', async () => {
    let calls = 0;
    globalThis.fetch = jest.fn(async () => {
      calls++;
      // The first section fails on every mirror it tries, so it is split into
      // four smaller ones; each of those answers on its first mirror.
      if (calls <= 3) throw new Error('service unavailable');
      return jsonResponse({ elements: [roadElement(calls, 0, 0)] });
    }) as unknown as typeof fetch;

    const progress: { completed: number; total: number }[] = [];
    const network = await downloadOfflineRoadNetworkTiled([0, 0, 0.2, 0.2], (completed, total) => progress.push({ completed, total }), { tileDegrees: 0.2, deadlineMs: 5_000 });

    // Three failed mirror attempts plus four smaller sections.
    expect(calls).toBe(7);
    expect(network.roads.length).toBe(4);
    expect(network.partial).toBeUndefined();
    // The counter never goes past the number of sections.
    for (const entry of progress) expect(entry.completed).toBeLessThanOrEqual(entry.total);
  });

  it('splits a section the mirror cut off, and retries it on the same mirror', async () => {
    const mirrors = overpassMirrorUrls();
    const calls: string[] = [];
    let id = 0;
    globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
      calls.push(url);
      const body = decodeURIComponent(String(init.body ?? ''));
      // The full box is too big for the fast mirror, which answers 200 and then
      // stops mid-JSON. The four smaller boxes fit and answer normally.
      if (body.includes('(0,0,0.2,0.2)')) return truncatedResponse();
      id++;
      return jsonResponse({ elements: [roadElement(id, 0, 0)] });
    }) as unknown as typeof fetch;

    const network = await downloadOfflineRoadNetworkTiled([0, 0, 0.2, 0.2], undefined, { tileDegrees: 0.2, deadlineMs: 5_000 });

    expect(calls).toHaveLength(5);
    // No mirror rotation: every smaller section is asked of the service that
    // answered the first attempt, because only the box size was wrong.
    expect(new Set(calls)).toEqual(new Set([mirrors[0]]));
    expect(network.roads.length).toBe(4);
    expect(network.partial).toBeUndefined();
  });

  it('keeps the roads it got when some sections fail, and says so', async () => {
    let calls = 0;
    globalThis.fetch = jest.fn(async () => {
      calls++;
      // Only the very first attempt answers; everything else fails.
      if (calls === 1) return jsonResponse({ elements: [roadElement(1, 0, 0)] });
      throw new Error('service unavailable');
    }) as unknown as typeof fetch;

    const network = await downloadOfflineRoadNetworkTiled([0, 0, 0.4, 0.4], undefined, { tileDegrees: 0.2, deadlineMs: 5_000 });
    expect(network.roads.length).toBe(1);
    expect(network.partial).toBe(true);
    expect(network.missingSections).toBeGreaterThan(0);
  });

  it('stops right away when the download is cancelled', async () => {
    globalThis.fetch = jest.fn((_url: string, init: RequestInit) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(jsonResponse({ elements: [] })), 200);
      init.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    })) as unknown as typeof fetch;

    const controller = new AbortController();
    const promise = downloadOfflineRoadNetworkTiled([0, 0, 0.2, 0.2], undefined, { signal: controller.signal, deadlineMs: 5_000 });
    setTimeout(() => controller.abort(), 20);
    await expect(promise).rejects.toBeInstanceOf(RoadDownloadCancelledError);
  });

  it('fails with a clear message when nothing could be downloaded', async () => {
    globalThis.fetch = jest.fn(async () => { throw new Error('service unavailable'); }) as unknown as typeof fetch;
    await expect(downloadOfflineRoadNetworkTiled([0, 0, 0.2, 0.2], undefined, { tileDegrees: 0.2, deadlineMs: 5_000 }))
      .rejects.toThrow(/could not be reached/);
  });

  it('falls through to every mirror when the first ones are busy or unreachable', async () => {
    const mirrors = overpassMirrorUrls();
    const [first, second, third, fourth] = mirrors;
    const hosts: string[] = [];
    globalThis.fetch = jest.fn(async (url: string) => {
      hosts.push(url);
      if (url === first) {
        return { ok: false, status: 502, headers: { get: () => null }, json: async () => ({}) } as unknown as Response;
      }
      if (url === second || url === third) {
        throw new Error('TLS handshake failed');
      }
      return jsonResponse({ elements: [roadElement(1, 0, 0)] });
    }) as unknown as typeof fetch;

    // A small saved area is a single section, which used to try only one
    // mirror (and never the fourth) before giving up.
    const network = await downloadOfflineRoadNetworkTiled([0, 0, 0.07, 0.07], undefined, { deadlineMs: 5_000 });

    expect(network.roads.length).toBeGreaterThan(0);
    // The busy and the unreachable mirrors are both used, and the section
    // still ends up with roads from a mirror that works.
    expect(hosts).toContain(first);
    expect(hosts).toContain(second);
    expect(hosts).toContain(third);
    expect(hosts).toContain(fourth);
  });

  it('asks a section again on another mirror when the first one has no roads', async () => {
    const mirrors = overpassMirrorUrls();
    const hosts: string[] = [];
    globalThis.fetch = jest.fn(async (url: string) => {
      hosts.push(url);
      // The first mirror answers, but with no roads for this section.
      if (url === mirrors[0]) return jsonResponse({ elements: [] });
      return jsonResponse({ elements: [roadElement(1, 0, 0)] });
    }) as unknown as typeof fetch;

    const network = await downloadOfflineRoadNetworkTiled([0, 0, 0.07, 0.07], undefined, { deadlineMs: 5_000 });

    // The empty answer is not taken for the truth: another mirror is asked.
    expect(hosts.length).toBeGreaterThan(1);
    expect(hosts[0]).toBe(mirrors[0]);
    expect(hosts[1]).not.toBe(mirrors[0]);
    expect(network.roads.length).toBeGreaterThan(0);
  });

  it('says so when the area simply has no roads', async () => {
    globalThis.fetch = jest.fn(async () => jsonResponse({ elements: [] })) as unknown as typeof fetch;
    await expect(downloadOfflineRoadNetworkTiled([0, 0, 0.2, 0.2], undefined, { tileDegrees: 0.2, deadlineMs: 5_000 }))
      .rejects.toThrow(/No routable roads/);
  });
});
