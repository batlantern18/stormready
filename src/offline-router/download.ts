/**
 * offline-router · download — road data over the public Overpass mirrors.
 *
 * A saved map area is one small piece of OpenStreetMap. This layer asks a mirror
 * for the roads in a box, retries a busy one against the others, and stitches a
 * grid of tiles into one network — the work that fills the bytes of a download.
 * Types, error classes and the shared highway/size constants live in `./types`.
 */
import {
  CORE_HIGHWAYS,
  MAX_NETWORK_BYTES,
  RoadDataTooLargeError,
  RoadDownloadCancelledError,
  ROUTABLE_HIGHWAYS,
  type OfflineRoadNetwork,
  type RoadDetail,
  type RoadWay,
  type RouteBounds,
  type RouteCoordinate,
} from './types';
import { HttpError, HttpResponseTooLargeError, HttpResponseTruncatedError, httpJson } from '../net/http';

/** One raw OpenStreetMap way (or node) as Overpass returns it, before it is
 * parsed into a routable road. Exported so the destination index, which asks
 * Overpass for addresses the same way, can read the same shape. */
export type OverpassWay = {
  type: 'node' | 'way'; id: number; nodes?: number[]; lat?: number; lon?: number;
  center?: { lat: number; lon: number };
  geometry?: ({ lat: number; lon: number } | null)[];
  tags?: Record<string, string>;
};

// Public Overpass mirrors. The main endpoint is often rate limited or busy, so
// a failed download is retried against the others before giving up.
// Public Overpass mirrors. The main endpoint is often rate limited or busy, so
// a failed download is retried against the others before giving up.
//
// The order matters: the first mirror is the one most tiles start with, so it
// should be the one that answers fastest. `overpass-api.de` regularly needs
// tens of seconds for a small box, which is longer than a tile is allowed to
// take, so it sits behind the quicker community instances.
const DEFAULT_OVERPASS_URLS = [
  // The French instance is the only public mirror that reliably answers a
  // small box in about a second. It rate-limits under heavy parallel load
  // (it answers with a whitelist/empty body), so the shared MirrorPool
  // demotes it for the rest of a download if that happens, and the tiled
  // downloaders keep only a few requests in flight.
  'https://overpass.openstreetmap.fr/api/interpreter',
  // The global instance is complete but regularly needs tens of seconds for a
  // small box, so it is the fallback rather than the first choice.
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

/**
 * The mirror list can be replaced at build time with
 * `EXPO_PUBLIC_OVERPASS_MIRRORS`, a comma separated list of interpreter URLs.
 * This is how the app is pointed at a self-hosted Overpass instance (or a test
 * service) without changing the code. An empty or invalid value keeps the
 * public mirrors.
 */
function resolveOverpassUrls(): string[] {
  const configured = (process.env.EXPO_PUBLIC_OVERPASS_MIRRORS || '')
    .split(',')
    .map(value => value.trim())
    .filter(value => value.startsWith('http://') || value.startsWith('https://'));
  return configured.length ? configured : DEFAULT_OVERPASS_URLS;
}

const OVERPASS_URLS = resolveOverpassUrls();

/** The resolved mirror list, in the order it is tried. Exported so the
 * destination index download can start its retries on the same first mirror. */
export function overpassUrls(): string[] {
  return OVERPASS_URLS;
}

/** The mirrors the app asks for road data, in the order they are tried. */
export function overpassMirrorUrls(): string[] {
  return [...OVERPASS_URLS];
}
/** The small local roads that are only fetched when a trip needs them. */
const DETAIL_ROAD_TYPES = new Set(['service', 'road']);
/** Overpass handles a small box far more reliably than a large one, so big areas
 * are fetched as a grid of tiles and stitched together. A tile that fails is
 * split into smaller tiles rather than retried at the same size. */
const TILE_DEGREES = 0.10;
/** How much time one tile attempt may take, per depth level. A tile that does
 * not answer in time is split instead of being retried at the same size, so a
 * stalled mirror cannot hold up the whole download. */
const TILE_TIMEOUTS_MS = [20_000, 12_000, 10_000];
/** How many times a tile may be split before it is given up on. */
const MAX_TILE_SPLIT_DEPTH = TILE_TIMEOUTS_MS.length - 1;

/** How many tiles are fetched at the same time. Public Overpass mirrors
 * throttle parallel requests, so the number stays small. */
const TILE_CONCURRENCY = 4;
/** How many mirrors one section tries before it is split. A single busy
 * service must not be able to fail an entire area. */
const MIRRORS_PER_TILE = 3;

/** The Overpass highway filter for a detail level. */
export function highwayFilter(detail: RoadDetail = 'full') {
  return detail === 'core' ? CORE_HIGHWAYS : ROUTABLE_HIGHWAYS;
}

/** True for the small local roads that are only downloaded on demand. */
export function isDetailRoad(highway: string) {
  return DETAIL_ROAD_TYPES.has(highway);
}

/** Overpass can return a way whose geometry contains nulls (nodes it could not
 * resolve) or a length that does not match the node list. Such a way is
 * unusable for routing, so it is dropped instead of crashing the whole download.
 *
 * Only the coordinates are kept. Ways that meet at a shared OSM node have the
 * same rounded coordinate there, which is enough to join them into a graph — and
 * it leaves out a node id per point, which is about half of the saved file and
 * most of the memory needed to read it back on a phone. */
export function parseRoadWays(elements: OverpassWay[] = []): RoadWay[] {
  const roads: RoadWay[] = [];
  for (const way of elements) {
    const tags = way.tags || {};
    if (way.type !== 'way' || !way.nodes?.length || !way.geometry?.length) continue;
    if (way.nodes.length !== way.geometry.length) continue;
    const coordinates: RouteCoordinate[] = [];
    for (const point of way.geometry) {
      if (!point || typeof point.lat !== 'number' || typeof point.lon !== 'number') continue;
      // Round to about 10 cm. Overpass returns long floating point values and
      // rounding them keeps the saved road file small enough to store and fast
      // enough to load on a phone.
      coordinates.push([Math.round(point.lon * 1e6) / 1e6, Math.round(point.lat * 1e6) / 1e6]);
    }
    // A way needs at least two usable points to form an edge.
    if (coordinates.length < 2) continue;
    roads.push({
      id: String(way.id),
      coordinates,
      name: tags.name || tags.ref || '', highway: tags.highway || 'road',
      oneway: tags.oneway || (tags.junction === 'roundabout' ? 'yes' : 'no'),
    });
  }
  return roads;
}

export type RoadDownloadOptions = {
  timeoutMs?: number;
  retries?: number;
  /** Stops the request when the download is cancelled. */
  signal?: AbortSignal;
  /** `core` skips the small local roads, `full` includes them. */
  detail?: RoadDetail;
  /** Which mirror is tried first; the others follow in rotation. */
  mirrorOffset?: number;
  /** How many mirrors to try before this piece is given up on. */
  mirrors?: number;
  /** An area without roads is a valid result instead of an error. */
  allowEmpty?: boolean;
  /** Shared health record for one multi-tile download. */
  pool?: MirrorPool;
};

/** The public mirrors in rotation order, so parallel tiles spread their
 * requests over different services instead of hammering one of them. */
function rotatedMirrors(offset: number) {
  const count = OVERPASS_URLS.length;
  const start = ((offset % count) + count) % count;
  return [...OVERPASS_URLS.slice(start), ...OVERPASS_URLS.slice(0, start)];
}

/** Remembers which mirrors actually answered during one area download.
 *
 * Without this, a section that had to be split was handed to the *next* mirror
 * in the rotation — often one that is unreachable — and never went back to the
 * service that had just answered. A working mirror is kept first and a failed
 * one is moved to the back, so a split section asks the fast service for a
 * smaller box instead of spending its whole budget on dead services. */
export class MirrorPool {
  private readonly failures = new Map<string, number>();

  order(offset: number): string[] {
    return rotatedMirrors(offset)
      .map((url, index) => ({ url, index }))
      .sort((a, b) => {
        const difference = (this.failures.get(a.url) || 0) - (this.failures.get(b.url) || 0);
        return difference || a.index - b.index;
      })
      .map(item => item.url);
  }

  failed(url: string) {
    this.failures.set(url, (this.failures.get(url) || 0) + 1);
  }

  succeeded(url: string) {
    this.failures.delete(url);
  }
}

export async function downloadOfflineRoadNetwork(bounds: RouteBounds, options: RoadDownloadOptions = {}): Promise<OfflineRoadNetwork> {
  const [west, south, east, north] = bounds;
  const box = `${south},${west},${north},${east}`;
  const timeoutMs = options.timeoutMs ?? 120_000;
  // The service is asked to give up slightly before the app does, so a slow
  // answer comes back with a clear message instead of a dropped connection.
  const serverSeconds = Math.max(8, Math.min(90, Math.round(timeoutMs / 1000) - 4));
  const query = `[out:json][timeout:${serverSeconds}];way["highway"~"^(${highwayFilter(options.detail)})$"]["access"!~"^(no|private)$"]["motor_vehicle"!~"^(no|private)$"](${box});out body geom;`;
  const pool = options.pool ?? new MirrorPool();
  const offset = options.mirrorOffset ?? 0;
  const preferred = OVERPASS_URLS[((offset % OVERPASS_URLS.length) + OVERPASS_URLS.length) % OVERPASS_URLS.length];
  // Keep the intended first attempt even if it was demoted for an earlier
  // dropped connection. Without this, one random drop pushes the only fast
  // instance out of the three candidates and every later tile asks services
  // that never answer.
  const urls = [preferred, ...pool.order(offset).filter(url => url !== preferred)];
  const attempts = Math.max(1, Math.min(options.mirrors ?? urls.length, urls.length));
  let data: { elements?: OverpassWay[]; remark?: string } | null = null;
  let lastFailure: unknown = null;
  for (const url of urls.slice(0, attempts)) {
    if (options.signal?.aborted) throw new RoadDownloadCancelledError('The road data download was cancelled.');
    try {
      const parsed = await httpJson<{ elements?: OverpassWay[]; remark?: string }>(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        timeoutMs,
        // The body needs its own limit: headers can arrive long before the
        // answer finishes, and a slow mirror must not hold the tile open.
        bodyTimeoutMs: timeoutMs,
        retries: options.retries ?? 1,
        userAgent: 'StormReady/1.1 (offline map data)',
        signal: options.signal,
        maxBytes: MAX_NETWORK_BYTES,
      });
      pool.succeeded(url);
      if (parsed.remark && !(parsed.elements || []).length) throw new Error('The road data service could not finish this area. Try downloading again.');
      data = parsed;
      break;
    } catch (error) {
      // A service that answered but could not finish the area will answer the
      // same way on every mirror, so the message is kept.
      lastFailure = error;
      if (options.signal?.aborted) throw new RoadDownloadCancelledError('The road data download was cancelled.');
      if (error instanceof RoadDownloadCancelledError) throw error;
      if (error instanceof RoadDataTooLargeError) throw error;
      if (error instanceof HttpResponseTruncatedError) {
        // The mirror answered, but cut the answer off. Asking another mirror
        // for the same box does not help — the caller has to split the box.
        throw error;
      }
      if (error instanceof HttpResponseTooLargeError) throw new RoadDataTooLargeError('Road data for this area is larger than the phone can keep offline. Try a smaller nearby map area.');
      if (error instanceof Error && error.message.includes('could not finish')) throw error;
      // A timeout may simply mean the box was too big for this mirror, and a
      // smaller box often succeeds on the same service, so it is not counted
      // as a dead mirror. The intended first mirror stays in the candidate
      // list regardless (see `urls` above), so demotion only reorders fallbacks.
      const timedOut = error instanceof HttpError && error.message.includes('timed out');
      if (!timedOut) pool.failed(url);
    }
  }
  if (!data) {
    if (lastFailure instanceof RoadDataTooLargeError) throw lastFailure;
    if (lastFailure instanceof Error && lastFailure.message.includes('could not finish')) throw lastFailure;
    if (lastFailure instanceof HttpError && [408, 429, 502, 503, 504].includes(lastFailure.status ?? 0)) {
      throw new Error('The road data service is busy right now. Try again in a few minutes.');
    }
    throw new Error('The road data service could not be reached. Check your connection and try again.');
  }
  const roads = parseRoadWays(data.elements);
  if (!roads.length && !options.allowEmpty) throw new Error('No routable roads were found in this area. Download a nearby map area.');
  if (JSON.stringify(roads).length * 2 > MAX_NETWORK_BYTES) throw new RoadDataTooLargeError('Road data for this area is larger than the phone can keep offline. Try a smaller nearby map area.');
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

/** Splits a bounding box into four smaller boxes that together cover it. */
export function splitBounds(bounds: RouteBounds): RouteBounds[] {
  const [west, south, east, north] = bounds;
  const midLongitude = (west + east) / 2;
  const midLatitude = (south + north) / 2;
  return [
    [west, south, midLongitude, midLatitude],
    [midLongitude, south, east, midLatitude],
    [west, midLatitude, midLongitude, north],
    [midLongitude, midLatitude, east, north],
  ];
}

export type TiledDownloadOptions = {
  deadlineMs?: number;
  /** Stops the download when the user cancels it. */
  signal?: AbortSignal;
  /** `core` skips the small local roads, `full` includes them. */
  detail?: RoadDetail;
  /** How many tiles are fetched at the same time. */
  concurrency?: number;
  /** Size of the first tiles. A tile that fails is split into smaller ones. */
  tileDegrees?: number;
};

/**
 * Downloads a road network as a grid of tiles and stitches them into one graph.
 *
 * Tiles are fetched in parallel, each against a different public mirror, and
 * every tile has its own short time limit. A tile that does not answer in time
 * is not retried at the same size — it is split into four smaller tiles, which
 * is what an overloaded mirror can actually answer. A section that is still
 * missing at the end is reported, and the roads that did arrive are kept.
 */
export async function downloadOfflineRoadNetworkTiled(
  bounds: RouteBounds,
  onProgress?: (completed: number, total: number) => void,
  options: TiledDownloadOptions = {},
): Promise<OfflineRoadNetwork> {
  const detail = options.detail ?? 'full';
  const tileDegrees = options.tileDegrees ?? TILE_DEGREES;
  const deadlineMs = options.deadlineMs ?? 120_000;
  type TileJob = { bounds: RouteBounds; depth: number; mirror: number; retried?: boolean };
  // The first mirror is the fastest one, so every initial section starts
  // there. A mirror that turns out to be down is demoted by the shared pool,
  // and later sections move to the next service automatically.
  const queue: TileJob[] = tileBounds(bounds, tileDegrees).map(tile => ({ bounds: tile, depth: 0, mirror: 0 }));
  let total = queue.length;
  let completed = 0;
  const networks: OfflineRoadNetwork[] = [];
  const failures: string[] = [];
  let answered = 0;
  let inFlight = 0;
  let cancelled = false;
  let timedOut = false;

  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(() => deadlineController.abort(), deadlineMs);
  const signal = combineSignals(options.signal, deadlineController.signal);
  // One health record for the whole area: a service that answered once is kept
  // first for every later section and retry.
  const pool = new MirrorPool();

  const report = () => onProgress?.(completed, total);
  // The first report tells the screen how many sections to expect, so the
  // download shows progress before the first answer arrives.
  report();

  const worker = async () => {
    while (true) {
      if (options.signal?.aborted) { cancelled = true; return; }
      if (deadlineController.signal.aborted) { timedOut = true; return; }
      if (!queue.length) {
        // Nothing left to do — unless another worker is still working and may
        // split its section into smaller ones.
        if (!inFlight) return;
        await new Promise(resolve => setTimeout(resolve, 5));
        continue;
      }
      const job = queue.shift()!;
      inFlight++;
      try {
        const network = await downloadOfflineRoadNetwork(job.bounds, {
          timeoutMs: TILE_TIMEOUTS_MS[Math.min(job.depth, MAX_TILE_SPLIT_DEPTH)],
          retries: 0,
          detail,
          signal,
          mirrorOffset: job.mirror,
          mirrors: MIRRORS_PER_TILE,
          allowEmpty: true,
          pool,
        });
        answered++;
        if (network.roads.length) networks.push(network);
        else if (!job.retried) {
          // The mirror answered, but with no roads for this section. That is
          // normal for a sea, but it is also what a mirror that only carries
          // part of the world returns. The same section is asked once more on a
          // different mirror before it is accepted as empty.
          const nextMirror = pool.order(job.mirror + 1)[0];
          queue.unshift({ ...job, mirror: Math.max(0, OVERPASS_URLS.indexOf(nextMirror)), retried: true });
          report();
          continue;
        }
      } catch (error) {
        if (options.signal?.aborted) { cancelled = true; return; }
        if (deadlineController.signal.aborted) { timedOut = true; return; }
        if (job.depth < MAX_TILE_SPLIT_DEPTH) {
          // A tile that could not be answered is replaced by four smaller ones.
          // They start on the same service the parent used: with a smaller box
          // that fast mirror can answer, while rotating the children onto the
          // other mirrors sends them to services that may not work at all. The
          // shared pool still demotes a mirror that genuinely failed.
          const parts = splitBounds(job.bounds);
          parts.forEach(part => queue.unshift({
            bounds: part,
            depth: job.depth + 1,
            mirror: job.mirror,
          }));
          total += parts.length - 1;
          report();
          continue;
        }
        const message = error instanceof Error ? error.message : 'A map section could not be downloaded.';
        failures.push(message);
      } finally {
        inFlight--;
      }
      completed++;
      report();
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? TILE_CONCURRENCY) }, worker));
  } finally {
    clearTimeout(deadlineTimer);
  }
  if (cancelled) throw new RoadDownloadCancelledError('The road data download was cancelled.');
  if (!networks.length) {
    if (answered) throw new Error('No routable roads were found in this area. Download a nearby map area.');
    if (timedOut) throw new Error('The road data download ran out of time. Check your connection and try again.');
    throw new Error(failures[0] || 'The road data service could not be reached. Check your connection and try again.');
  }
  const merged = mergeOfflineRoadNetworks(...networks);
  const missing = failures.length + (total - completed);
  if (missing > 0) {
    merged.partial = true;
    merged.missingSections = missing;
  }
  return merged;
}

/** Combines two abort signals into one. */
export function combineSignals(first?: AbortSignal, second?: AbortSignal) {
  if (!first) return second;
  if (!second) return first;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (first.aborted || second.aborted) controller.abort();
  else {
    first.addEventListener('abort', abort, { once: true });
    second.addEventListener('abort', abort, { once: true });
  }
  return controller.signal;
}

/** Stitches several downloaded road networks (the tiles of one area) into a
 * single network: roads are deduped by id, bounds are unioned, and a section
 * that could not be downloaded is reported instead of swallowed. */
export function mergeOfflineRoadNetworks(...networks: OfflineRoadNetwork[]): OfflineRoadNetwork {
  const roads: RoadWay[] = [];
  const seen = new Set<string>();
  for (const network of networks) for (const road of network.roads) {
    if (seen.has(road.id)) continue;
    seen.add(road.id);
    roads.push(road);
  }
  if (!networks.length) return { version: 1, bounds: [0, 0, 0, 0], roads: [], savedAt: new Date().toISOString() };
  const bounds = networks.reduce<RouteBounds>((union, network) => [
    Math.min(union[0], network.bounds[0]),
    Math.min(union[1], network.bounds[1]),
    Math.max(union[2], network.bounds[2]),
    Math.max(union[3], network.bounds[3]),
  ], networks[0].bounds);
  // Estimate the stored size instead of stringifying the whole network: for a
  // large area that string alone can be hundreds of megabytes and run the phone
  // out of memory while it is being built.
  let points = 0;
  for (const road of roads) points += road.coordinates.length;
  if (points * 22 + roads.length * 90 > MAX_NETWORK_BYTES) {
    throw new Error('The combined road data for this area is larger than the phone can keep offline. Choose a nearer destination, or save a map area closer to it.');
  }
  const missing = networks.reduce((total, network) => total + (network.missingSections || 0), 0);
  const partial = networks.some(network => network.partial) || missing > 0;
  return { version: 1, bounds, roads, savedAt: new Date().toISOString(), ...(partial ? { partial: true, missingSections: missing } : {}) };
}

