import { HttpError, HttpResponseTooLargeError, HttpResponseTruncatedError, httpJson } from './net/http';

export type RouteCoordinate = [number, number];
export type RouteBounds = [number, number, number, number];
export type RoadWay = {
  id: string;
  /** OSM node ids, one per coordinate. Older saved files have them; new
   * downloads leave them out because the rounded coordinates already join ways. */
  nodes?: string[];
  coordinates: RouteCoordinate[];
  name: string;
  highway: string;
  oneway: string;
};
export type OfflineRoadNetwork = {
  version: 1;
  bounds: RouteBounds;
  roads: RoadWay[];
  savedAt: string;
  /** Set when some map sections could not be downloaded, so the saved roads are
   * usable but incomplete. */
  partial?: boolean;
  /** How many map sections are missing from a partial download. */
  missingSections?: number;
};
export type OfflineDestination = {
  id: string;
  name: string;
  address: string;
  city: string;
  region: string;
  latitude: number;
  longitude: number;
};
export type OfflineDestinationIndex = {
  version: 1;
  bounds: RouteBounds;
  destinations: OfflineDestination[];
  savedAt: string;
  /** Set when part of the area could not be indexed; search still works for
   * the tiles that did arrive. */
  partial?: boolean;
  /** How many address sections are missing from a partial index. */
  missingSections?: number;
};
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

/** Thrown when the user stops a road data download. The area itself is fine —
 * only the offline roads are missing. */
export class RoadDownloadCancelledError extends Error {}

/** Thrown when a piece of road data is too large for the phone to keep. The
 * piece is worth asking for again in smaller pieces. */
export class RoadDataTooLargeError extends Error {}

type OverpassWay = {
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

/** The mirrors the app asks for road data, in the order they are tried. */
export function overpassMirrorUrls(): string[] {
  return [...OVERPASS_URLS];
}
/** The roads a saved area starts with. Service roads, alleys and parking lanes
 * are the bulk of a city's road data — in a dense area they are most of the
 * payload — and they are only needed to reach a single address, so they are
 * added on demand instead of with every download. */
const CORE_HIGHWAYS = 'motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street';
/** The small local roads that are only fetched when a trip needs them. */
const DETAIL_HIGHWAYS = 'service|road';
const ROUTABLE_HIGHWAYS = `${CORE_HIGHWAYS}|${DETAIL_HIGHWAYS}`;
const DETAIL_ROAD_TYPES = new Set(['service', 'road']);
/** Estimated ceiling for a saved road file. Bigger than this and the parsed
 * network plus its graph needs more memory than a phone reliably has. */
const MAX_NETWORK_BYTES = 30 * 1024 * 1024;
/** Overpass handles a small box far more reliably than a large one, so big areas
 * are fetched as a grid of tiles and stitched together. A tile that fails is
 * split into smaller tiles rather than retried at the same size. */
const TILE_DEGREES = 0.10;
/** How far a geocoded address, shelter centroid, or GPS fix may be from a
 * routable road before snapping gives up. Shelter and building coordinates
 * are often placed inside a parcel rather than on the street, so a few hundred
 * meters is too strict for real destinations. */
const SNAP_MAX_METERS = 1_200;

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

export type RoadDetail = 'core' | 'full';

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
function combineSignals(first?: AbortSignal, second?: AbortSignal) {
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

export type DestinationIndexOptions = {
  timeoutMs?: number;
  /** Total time for all mirrors before the optional address index is skipped. */
  deadlineMs?: number;
  /** Stops the request when the download is cancelled. */
  signal?: AbortSignal;
  /** `core` skips the small local roads when collecting named streets. */
  detail?: RoadDetail;
  /** Reports saved-area sections that are fully downloaded, for the UI. */
  onProgress?: (completed: number, total: number) => void;
};

const DESTINATION_INDEX_MAX_BYTES = 20 * 1024 * 1024;
/** A saved core is requested as a 4×4 grid from the start. A dense city answers
 * the whole core (or even one quarter of it) with more than the ~1.5 MB that
 * some public mirrors will send in one chunked response, so asking for the big
 * box first only wastes a timeout per level. Sixteen small sections are enough
 * for every area tried and stay well under the cap. */
const INDEX_INITIAL_DEPTH = 2;
/** One more split is allowed for an unusually dense section. */
const MAX_INDEX_SPLIT_DEPTH = INDEX_INITIAL_DEPTH + 1;
const INDEX_CONCURRENCY = 4;

/** Asks one mirror for the addresses and places inside one box. */
async function fetchDestinationIndexTile(
  bounds: RouteBounds,
  options: { timeoutMs: number; signal?: AbortSignal; detail?: RoadDetail; pool: MirrorPool },
): Promise<OfflineDestination[]> {
  const [west, south, east, north] = bounds;
  const box = `${south},${west},${north},${east}`;
  const namedRoads = options.detail === 'core' ? CORE_HIGHWAYS : ROUTABLE_HIGHWAYS;
  const serverSeconds = Math.max(8, Math.min(45, Math.round(options.timeoutMs / 1000) - 2));
  const query = `[out:json][timeout:${serverSeconds}];(node["addr:housenumber"](${box});way["addr:housenumber"](${box});way["name"]["highway"~"^(${namedRoads})$"](${box});nw["name"]["amenity"~"^(restaurant|cafe|hospital|clinic|school|pharmacy|fuel|parking|shelter|library|police|fire_station|townhall|place_of_worship)$"](${box});nw["name"]["shop"](${box});nw["name"]["tourism"](${box});nw["name"]["leisure"](${box});nw["name"]["place"](${box}););out center;`;
  let data: { elements?: OverpassWay[]; remark?: string } | null = null;
  let lastFailure: unknown = null;
  const startedAt = Date.now();
  // The fast instance is the intended first try even after a dropped
  // connection demoted it; otherwise it would drop out of the three candidates
  // and every retry would ask services that never answer.
  const primary = OVERPASS_URLS[0];
  const candidates = [primary, ...options.pool.order(0).filter(url => url !== primary)]
    .slice(0, Math.min(3, OVERPASS_URLS.length));
  for (const url of candidates) {
    if (options.signal?.aborted) throw new RoadDownloadCancelledError('The download was cancelled.');
    // A busy mirror sometimes drops the connection instead of slowing down.
    // That is worth one more try on the same service — asking a different one
    // mostly just adds its connection setup. A timeout is different: it means
    // the box is too big, so it is thrown and split.
    for (let attempt = 0; attempt < 2; attempt++) {
      // The whole section gets one time budget. Giving every mirror its own
      // timeout means one busy service plus two unreachable ones can spend three
      // times the budget on the same box; the caller would rather split it.
      const remaining = options.timeoutMs - (Date.now() - startedAt);
      if (remaining < 3_000) break;
      try {
        const parsed = await httpJson<{ elements?: OverpassWay[]; remark?: string }>(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`,
          timeoutMs: remaining,
          bodyTimeoutMs: remaining,
          retries: 0,
          userAgent: 'StormReady/1.1 (offline map data)',
          signal: options.signal,
          maxBytes: DESTINATION_INDEX_MAX_BYTES,
        });
        options.pool.succeeded(url);
        if (parsed.remark && !(parsed.elements || []).length) throw new Error('The destination search data service could not finish this area. Try downloading again.');
        data = parsed;
        break;
      } catch (error) {
        lastFailure = error;
        if (options.signal?.aborted) throw new RoadDownloadCancelledError('The download was cancelled.');
        // A cut-off or oversized answer is a size problem: another mirror would
        // return the same thing, so the caller has to ask for a smaller box.
        if (error instanceof HttpResponseTruncatedError) throw error;
        if (error instanceof HttpResponseTooLargeError) throw error;
        if (error instanceof Error && error.message.includes('could not finish')) throw error;
        // A timeout is a size problem too. Repeating the same box on a mirror
        // that has not answered recently just spends the section's budget, so
        // the caller splits it instead.
        if (error instanceof HttpError && error.message.includes('timed out')) throw error;
        // No status means the request never reached the service. Try this
        // mirror once more, then move on. The primary mirror is kept in the
        // candidate list above, so demoting it only changes the fallback order.
        const droppedConnection = error instanceof HttpError && error.status === undefined;
        if (droppedConnection && attempt === 0) continue;
        options.pool.failed(url);
        break;
      }
    }
    if (data) break;
  }
  if (!data) {
    if (lastFailure instanceof HttpError && [408, 429, 502, 503, 504].includes(lastFailure.status ?? 0)) {
      throw new Error('The offline destination search data service is busy right now. Try again in a few minutes.');
    }
    throw new Error('The offline destination search data service could not be reached. Check your connection and try again.');
  }
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
  return [...destinations.values()];
}

/**
 * Downloads the searchable addresses and places for a saved area.
 *
 * One request for a dense city is several megabytes. Some public mirrors answer
 * a large chunked body with HTTP 200 and then simply stop at about 1.5 MB, which
 * leaves invalid JSON. A single request therefore fails for exactly the places
 * where offline search matters most. The saved core is requested as a 4×4 grid
 * so each answer is small enough to arrive whole; a section that is still cut
 * off (or times out) is split again. Sections that never arrive are reported
 * instead of throwing away the addresses that did.
 */
export async function downloadOfflineDestinationIndex(bounds: RouteBounds, options: DestinationIndexOptions = {}): Promise<OfflineDestinationIndex> {
  // Sixteen sections with four in flight take a while on a slow phone
  // connection, and the lost-section retries run after that. The deadline is a
  // safety valve, not the expected duration.
  const deadlineMs = options.deadlineMs ?? 120_000;
  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(() => deadlineController.abort(), deadlineMs);
  const signal = combineSignals(options.signal, deadlineController.signal);
  const pool = new MirrorPool();
  const timeoutMs = Math.min(options.timeoutMs ?? 18_000, 18_000);
  type IndexJob = { bounds: RouteBounds; depth: number; /** Which of the initial sections this piece belongs to. */ root: number };
  let initial: RouteBounds[] = [bounds];
  for (let depth = 0; depth < INDEX_INITIAL_DEPTH; depth++) {
    initial = initial.flatMap(part => splitBounds(part));
  }
  const tiles: OfflineDestination[][] = [];
  const failures: unknown[] = [];
  // A section that is lost at its smallest size stays here until a retry
  // succeeds, so the partial count is reported per saved-area section.
  const failedLeaves = new Map<string, IndexJob>();
  const failureCountByRoot = new Map<number, number>();
  const pendingByRoot = new Map<number, number>();
  const reportedRoots = new Set<number>();
  let cancelled = false;
  let timedOut = false;

  const leafKey = (job: IndexJob) => `${job.root}:${job.bounds.join(',')}`;
  const notePending = (job: IndexJob) => pendingByRoot.set(job.root, (pendingByRoot.get(job.root) ?? 0) + 1);
  const settle = (job: IndexJob) => {
    const left = Math.max(0, (pendingByRoot.get(job.root) ?? 1) - 1);
    pendingByRoot.set(job.root, left);
    if (left === 0 && !(failureCountByRoot.get(job.root) ?? 0) && !reportedRoots.has(job.root)) {
      reportedRoots.add(job.root);
      options.onProgress?.(reportedRoots.size, initial.length);
    }
  };

  const runPass = async (jobs: IndexJob[]) => {
    const queue = [...jobs];
    let inFlight = 0;
    let passCancelled = false;
    let passTimedOut = false;
    const worker = async () => {
      while (true) {
        if (options.signal?.aborted) { passCancelled = true; return; }
        if (deadlineController.signal.aborted) { passTimedOut = true; return; }
        if (!queue.length) {
          if (!inFlight) return;
          await new Promise(resolve => setTimeout(resolve, 5));
          continue;
        }
        const job = queue.shift()!;
        inFlight++;
        try {
          const destinations = await fetchDestinationIndexTile(job.bounds, {
            timeoutMs,
            signal,
            detail: options.detail,
            pool,
          });
          if (destinations.length) tiles.push(destinations);
          if (failedLeaves.delete(leafKey(job))) {
            failureCountByRoot.set(job.root, Math.max(0, (failureCountByRoot.get(job.root) ?? 1) - 1));
          }
          settle(job);
        } catch (error) {
          if (options.signal?.aborted) { passCancelled = true; return; }
          if (deadlineController.signal.aborted) { passTimedOut = true; return; }
          if (job.depth < MAX_INDEX_SPLIT_DEPTH) {
            const children = splitBounds(job.bounds).map(part => ({ bounds: part, depth: job.depth + 1, root: job.root }));
            for (const child of children) notePending(child);
            queue.unshift(...children);
            settle(job);
            continue;
          }
          const key = leafKey(job);
          if (!failedLeaves.has(key)) {
            failedLeaves.set(key, job);
            failureCountByRoot.set(job.root, (failureCountByRoot.get(job.root) ?? 0) + 1);
          }
          failures.push(error);
          settle(job);
        } finally {
          inFlight--;
        }
      }
    };
    await Promise.all(Array.from({ length: INDEX_CONCURRENCY }, worker));
    if (passCancelled) cancelled = true;
    if (passTimedOut) timedOut = true;
  };

  try {
    const initialJobs = initial.map((part, root) => ({ bounds: part, depth: INDEX_INITIAL_DEPTH, root }));
    for (const job of initialJobs) notePending(job);
    await runPass(initialJobs);
    // The mirror drops a random connection now and then. A lost section is
    // retried exactly as it was lost, after a short pause, before it is counted
    // as missing — splitting a small section again only makes the answer harder.
    for (let pass = 0; pass < 2 && !cancelled && !timedOut && failedLeaves.size; pass++) {
      await new Promise(resolve => setTimeout(resolve, 600));
      if (deadlineController.signal.aborted) { timedOut = true; break; }
      const retry = [...failedLeaves.values()];
      for (const job of retry) notePending(job);
      await runPass(retry);
    }
  } finally {
    clearTimeout(deadlineTimer);
  }
  if (cancelled) throw new RoadDownloadCancelledError('The download was cancelled.');
  if (!tiles.length) {
    if (timedOut) throw new Error('The offline address and place download ran out of time. Check your connection and try again.');
    const first = failures[0];
    throw first instanceof Error ? first : new Error('The offline destination search data service could not be reached. Check your connection and try again.');
  }
  const destinations = new Map<string, OfflineDestination>();
  for (const tile of tiles) for (const destination of tile) if (!destinations.has(destination.id)) destinations.set(destination.id, destination);
  const records = [...destinations.values()];
  if (JSON.stringify(records).length * 2 > 20 * 1024 * 1024) throw new Error('This area has too many address and place records to save offline.');
  const missingRoots = new Set([...failedLeaves.values()].map(job => job.root));
  // A section that was still in flight when the deadline expired never reached
  // the failure map, but its data is missing too.
  if (timedOut) for (const [root, pending] of pendingByRoot) if (pending > 0) missingRoots.add(root);
  const missing = missingRoots.size;
  return {
    version: 1,
    bounds,
    destinations: records,
    savedAt: new Date().toISOString(),
    ...(missing ? { partial: true, missingSections: missing } : {}),
  };
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
