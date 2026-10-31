/**
 * offline-router · destinations — the searchable address/place index for an area.
 *
 * A dense city is several megabytes of addresses, so the index is fetched as a
 * 4×4 grid and stitched, exactly like the road network. It reuses the download
 * layer's mirror pool, tile splitter and signal combiner.
 */
import {
  CORE_HIGHWAYS,
  RoadDownloadCancelledError,
  ROUTABLE_HIGHWAYS,
  type OfflineDestination,
  type OfflineDestinationIndex,
  type RoadDetail,
  type RouteBounds,
} from './types';
import { HttpError, HttpResponseTooLargeError, HttpResponseTruncatedError, httpJson } from '../net/http';
import { combineSignals, MirrorPool, overpassUrls, splitBounds, type OverpassWay } from './download';

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
  const mirrors = overpassUrls();
  const primary = mirrors[0];
  const candidates = [primary, ...options.pool.order(0).filter(url => url !== primary)]
    .slice(0, Math.min(3, mirrors.length));
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
