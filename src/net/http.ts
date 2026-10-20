export type HttpOptions = {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
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

export async function httpJson<T>(url: string, options: HttpOptions = {}): Promise<T> {
  const response = await httpFetch(url, { ...options, headers: { Accept: 'application/json', ...options.headers } });
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
