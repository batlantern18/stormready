import { HttpError, httpFetch, httpJson, networkErrorMessage } from '../src/net/http';

function response(body: unknown = {}, init: Partial<Response> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => String(body),
    arrayBuffer: async () => new ArrayBuffer(0),
    headers: { get: () => null },
    ...init,
  } as unknown as Response;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.useRealTimers();
});

describe('httpFetch', () => {
  it('adds a user agent and accept header', async () => {
    globalThis.fetch = jest.fn(async () => response({ ok: true })) as unknown as typeof fetch;
    await httpFetch('https://example.gov/data');
    const [, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(init.headers['User-Agent']).toContain('StormReady/1.1');
    expect(init.headers.Accept).toBe('application/json');
    expect(init.method).toBe('GET');
  });

  it('does not retry a non-retryable status', async () => {
    globalThis.fetch = jest.fn(async () => response({}, { ok: false, status: 404 })) as unknown as typeof fetch;
    await expect(httpFetch('https://example.gov/missing')).rejects.toMatchObject({
      name: 'HttpError',
      status: 404,
      retryable: false,
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries a 500 response and succeeds', async () => {
    jest.useFakeTimers();
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(response({}, { ok: false, status: 503 }))
      .mockResolvedValueOnce(response({ ok: true })) as unknown as typeof fetch;

    const pending = httpFetch('https://example.gov/data', { retries: 1 });
    await jest.advanceTimersByTimeAsync(600);
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('defaults POST requests to no retries', async () => {
    globalThis.fetch = jest.fn(async () => response({}, { ok: false, status: 503 })) as unknown as typeof fetch;
    await expect(httpFetch('https://example.gov/data', { method: 'POST', body: 'x' })).rejects.toMatchObject({ status: 503 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('maps network failures to a calm message', async () => {
    globalThis.fetch = jest.fn(async () => { throw new TypeError('Network request failed'); }) as unknown as typeof fetch;
    await expect(httpFetch('https://example.gov/data', { retries: 0 })).rejects.toThrow(/Could not reach the service/);
  });

  it('times out and reports a connection error', async () => {
    jest.useFakeTimers();
    globalThis.fetch = jest.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        reject(error);
      });
    })) as unknown as typeof fetch;

    const pending = httpFetch('https://example.gov/slow', { timeoutMs: 10, retries: 0 });
    const assertion = expect(pending).rejects.toThrow(/timed out/);
    await jest.advanceTimersByTimeAsync(20);
    await assertion;
  });

  it('honors an already-aborted caller signal', async () => {
    globalThis.fetch = jest.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      if (init?.signal?.aborted) {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        reject(error);
        return;
      }
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        reject(error);
      });
    })) as unknown as typeof fetch;

    const controller = new AbortController();
    controller.abort();
    await expect(httpFetch('https://example.gov/data', { retries: 0, signal: controller.signal }))
      .rejects.toBeInstanceOf(HttpError);
  });
});

describe('httpJson', () => {
  it('parses JSON', async () => {
    globalThis.fetch = jest.fn(async () => response({ zone: 'A' })) as unknown as typeof fetch;
    await expect(httpJson<{ zone: string }>('https://example.gov/zone')).resolves.toEqual({ zone: 'A' });
  });

  it('reports unreadable JSON', async () => {
    globalThis.fetch = jest.fn(async () => response(undefined, {
      json: async () => { throw new SyntaxError('bad'); },
    })) as unknown as typeof fetch;
    await expect(httpJson('https://example.gov/zone')).rejects.toThrow(/unreadable response/);
  });
});

describe('networkErrorMessage', () => {
  it('uses the error message and falls back for unknown errors', () => {
    expect(networkErrorMessage(new Error('Offline'))).toBe('Offline');
    expect(networkErrorMessage(null, 'Fallback')).toBe('Fallback');
  });
});
