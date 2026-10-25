export type HttpOptions = {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Time allowed for the response body itself. Defaults to `timeoutMs`.
   * Without this a service that sends headers and then trickles its body can
   * hold a download open forever, because the request has already returned. */
  bodyTimeoutMs?: number;
  /** Largest response body accepted by `httpJson`, in bytes. */
  maxBytes?: number;
  /** Safe read requests default to 2 retries; POST requests default to 0. */
  retries?: number;
  userAgent?: string;
  signal?: AbortSignal;
};

export const DEFAULT_USER_AGENT = 'StormReady/1.1 (local-first preparedness app)';

export class HttpError extends Error {
  readonly url: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(message: string, url: string, status?: number, retryable = false) {
    super(message);
    this.name = 'HttpError';
    this.url = url;
    this.status = status;
    this.retryable = retryable;
  }
}

/** Thrown when a response body is larger than the caller can keep in memory.
 * The body is abandoned instead of decoded, so a huge answer cannot crash the
 * app while it is being turned into a string. */
export class HttpResponseTooLargeError extends Error {
  readonly url: string;
  readonly maxBytes: number;

  constructor(url: string, maxBytes: number) {
    super('The service sent more data than this phone can keep. Try a smaller area.');
    this.name = 'HttpResponseTooLargeError';
    this.url = url;
    this.maxBytes = maxBytes;
  }
}

/** Thrown when a response arrives with a success status but is not valid JSON.
 *
 * Some public Overpass mirrors cut a large chunked answer off at a fixed size
 * instead of returning an error. The result is a 200 whose body simply stops in
 * the middle of a string. Treating that as a normal "unreadable response" makes
 * the downloader retry the same query on other mirrors, which are often slower
 * or unreachable, and the whole area fails. The tiled downloaders catch this
 * class and ask for a smaller box instead — the answer is not broken, it is too
 * big for one response. */
export class HttpResponseTruncatedError extends Error {
  readonly url: string;

  constructor(url: string) {
    super('The service sent an incomplete response. Try a smaller area.');
    this.name = 'HttpResponseTruncatedError';
    this.url = url;
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function retryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/**
 * Fetch wrapper with an explicit user agent, timeout, and exponential backoff
 * for safe read requests. Every remote call in the app goes through here.
 */
export async function httpFetch(url: string, options: HttpOptions = {}): Promise<Response> {
  const method = options.method ?? 'GET';
  const retries = options.retries ?? (method === 'GET' ? 2 : 0);
  const timeoutMs = options.timeoutMs ?? 15_000;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abortFromCaller = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener('abort', abortFromCaller, { once: true });

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Accept: 'application/json',
          'User-Agent': options.userAgent ?? DEFAULT_USER_AGENT,
          ...options.headers,
        },
        body: options.body,
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = new HttpError(
          `The service returned HTTP ${response.status}.`,
          url,
          response.status,
          retryableStatus(response.status),
        );
        if (error.retryable && attempt < retries) {
          lastError = error;
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw error;
      }
      return response;
    } catch (error) {
      lastError = error;
      const aborted = error instanceof Error && error.name === 'AbortError';
      const transient = aborted || !(error instanceof HttpError);
      if (attempt < retries && transient) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      if (aborted) {
        throw new HttpError('The request timed out. Check your connection and try again.', url);
      }
      throw error instanceof HttpError
        ? error
        : new HttpError('Could not reach the service. Check your connection and try again.', url);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  throw lastError instanceof HttpError
    ? lastError
    : new HttpError('Could not reach the service. Check your connection and try again.', url);
}

const DEFAULT_MAX_JSON_BYTES = 20 * 1024 * 1024;

function timeoutError(url: string) {
  return new HttpError('The request timed out. Check your connection and try again.', url);
}

/**
 * Reads a response body in chunks with a hard byte cap and its own timeout.
 *
 * `httpFetch` resolves as soon as the headers arrive, so its timeout no longer
 * covers the body. A service that sends headers and then stalls (or streams a
 * very large answer) would otherwise hold the download open forever and can
 * exhaust the native heap while the body is converted to a string.
 */
async function readBodyText(response: Response, maxBytes: number, options: HttpOptions): Promise<string> {
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: ((reason: unknown) => void) | null = null;
  // The rejection is handled by the race below or by this catch when the
  // stream finishes in the same tick that the timer fires.
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  void aborted.catch(() => {});
  const stop = () => {
    // Reject first: cancelling the reader can resolve its pending read, and the
    // race must report a timeout instead of an empty body.
    rejectAbort?.(timeoutError(response.url));
    void reader.cancel().catch(() => {});
  };
  if (options.signal?.aborted) stop();
  else options.signal?.addEventListener('abort', stop, { once: true });
  timer = setTimeout(stop, Math.max(1, options.bodyTimeoutMs ?? options.timeoutMs ?? 15_000));

  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        stop();
        throw new HttpResponseTooLargeError(response.url, maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener('abort', stop);
    try { reader.releaseLock(); } catch { /* the stream is already released */ }
  }

  if (!total) return '';
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export async function httpJson<T>(url: string, options: HttpOptions = {}): Promise<T> {
  const response = await httpFetch(url, { ...options, headers: { Accept: 'application/json', ...options.headers } });
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_JSON_BYTES;
  const declared = Number(response.headers?.get?.('content-length') || 0);
  if (declared > maxBytes) throw new HttpResponseTooLargeError(url, maxBytes);

  // expo/fetch exposes the body as a stream. Reading it in chunks keeps the
  // request abortable after the headers arrive and enforces the byte cap;
  // response.json() buffers the entire body in native memory first.
  if (response.body && typeof response.body.getReader === 'function') {
    const text = await readBodyText(response, maxBytes, options);
    try {
      return JSON.parse(text) as T;
    } catch {
      // A success status with a body that stops mid-JSON is what a mirror that
      // caps response size sends. The caller can ask for a smaller box.
      throw new HttpResponseTruncatedError(url);
    }
  }

  try {
    return await response.json() as T;
  } catch {
    throw new HttpError('The service returned an unreadable response.', url, response.status);
  }
}

export async function httpText(url: string, options: HttpOptions = {}): Promise<string> {
  const response = await httpFetch(url, options);
  return response.text();
}

export async function httpArrayBuffer(url: string, options: HttpOptions = {}): Promise<ArrayBuffer> {
  const response = await httpFetch(url, options);
  return response.arrayBuffer();
}

/** Maps a caught request error to a calm, user-facing sentence. */
export function networkErrorMessage(error: unknown, fallback = 'Could not reach the service. Check your connection and try again.') {
  return error instanceof Error && error.message ? error.message : fallback;
}
