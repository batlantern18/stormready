import { HttpError, HttpResponseTooLargeError, HttpResponseTruncatedError, httpFetch, httpJson, networkErrorMessage } from '../src/net/http';

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

function streamedResponse(chunks: Uint8Array[], init: Partial<Response> = {}) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return { ...response(undefined, init), body: stream } as unknown as Response;
}

function hangingResponse() {
  const stream = new ReadableStream<Uint8Array>({ start() {}, cancel() {} });
  return { ...response({}), body: stream } as unknown as Response;
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
    expect(init.headers['User-Agent']).toContain('StormReady/1.2');
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

  it('parses a streamed body', async () => {
    const encoder = new TextEncoder();
    globalThis.fetch = jest.fn(async () => streamedResponse([
      encoder.encode('{"zone":'),
      encoder.encode('"A"}'),
    ])) as unknown as typeof fetch;
    await expect(httpJson<{ zone: string }>('https://example.gov/zone')).resolves.toEqual({ zone: 'A' });
  });

  it('reports a body that stops mid-JSON as truncated', async () => {
    // A public mirror that caps a chunked answer sends 200 and then stops in
    // the middle of a string. The downloader must be able to tell that apart
    // from a genuinely unreadable response so it can ask for a smaller box.
    const encoder = new TextEncoder();
    globalThis.fetch = jest.fn(async () => streamedResponse([
      encoder.encode('{"elements":[{"type":"way","id":1,"tags":{"name":"Main'),
    ])) as unknown as typeof fetch;
    await expect(httpJson('https://example.gov/data')).rejects.toBeInstanceOf(HttpResponseTruncatedError);
  });

  it('rejects an oversized declared body before reading it', async () => {
    globalThis.fetch = jest.fn(async () => response({}, {
      headers: { get: (name: string) => name.toLowerCase() === 'content-length' ? '99999999' : null } as unknown as Headers,
    })) as unknown as typeof fetch;
    await expect(httpJson('https://example.gov/big', { maxBytes: 100 }))
      .rejects.toBeInstanceOf(HttpResponseTooLargeError);
  });

  it('stops a chunked body that passes the byte limit', async () => {
    const encoder = new TextEncoder();
    globalThis.fetch = jest.fn(async () => streamedResponse([
      encoder.encode('{"data":"'),
      encoder.encode('x'.repeat(64)),
    ])) as unknown as typeof fetch;
    await expect(httpJson('https://example.gov/big', { maxBytes: 20 }))
      .rejects.toBeInstanceOf(HttpResponseTooLargeError);
  });

  it('times out when the body never finishes', async () => {
    jest.useFakeTimers();
    globalThis.fetch = jest.fn(async () => hangingResponse()) as unknown as typeof fetch;
    const pending = httpJson('https://example.gov/slow', { timeoutMs: 100 });
    const assertion = expect(pending).rejects.toThrow(/timed out/);
    await jest.advanceTimersByTimeAsync(150);
    await assertion;
  });
});

describe('networkErrorMessage', () => {
  it('uses the error message and falls back for unknown errors', () => {
    expect(networkErrorMessage(new Error('Offline'))).toBe('Offline');
    expect(networkErrorMessage(null, 'Fallback')).toBe('Fallback');
  });
});
