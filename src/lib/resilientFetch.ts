/**
 * fetch for the Supabase client that does not hang and recovers from short connection drops.
 *
 * Reads (GET / HEAD): each attempt times out after `timeoutMs` (5 s), and network errors, timeouts and
 * 408 / 429 / 5xx answers are retried with exponential backoff plus jitter (≈0.5 s, 1 s, 2 s).
 * Writes (POST / PATCH / PUT / DELETE) are never retried, because a write that reached the server but whose
 * answer was lost would run twice (double post, double comment). They get a longer timeout so a dead
 * connection still fails instead of spinning forever; uploads to Storage keep no timeout (big videos).
 * A caller's own AbortSignal still cancels immediately.
 */
export type ResilientOptions = {
  timeoutMs?: number;
  writeTimeoutMs?: number;
  retries?: number;
  baseDelayMs?: number;
  /** For tests. */
  sleep?: (ms: number) => Promise<void>;
};

const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`The connection timed out after ${Math.round(ms / 1000)} s`);
    this.name = 'TimeoutError';
  }
}

export function createResilientFetch(inner: typeof fetch = fetch, opts: ResilientOptions = {}): typeof fetch {
  const { timeoutMs = 5_000, writeTimeoutMs = 30_000, retries = 3, baseDelayMs = 500 } = opts;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function attempt(input: RequestInfo | URL, init: RequestInit | undefined, limit: number | null) {
    if (limit === null) return inner(input, init);
    const ctrl = new AbortController();
    const outer = init?.signal;
    const onAbort = () => ctrl.abort(outer?.reason);
    if (outer) {
      if (outer.aborted) ctrl.abort(outer.reason);
      else outer.addEventListener('abort', onAbort, { once: true });
    }
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, limit);
    try {
      return await inner(input, { ...init, signal: ctrl.signal });
    } catch (e) {
      if (timedOut) throw new TimeoutError(limit);
      throw e;
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onAbort);
    }
  }

  return async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const isRead = method === 'GET' || method === 'HEAD';
    if (!isRead) return attempt(input, init, url.includes('/storage/v1/object') ? null : writeTimeoutMs);

    for (let i = 0; ; i++) {
      try {
        const res = await attempt(input, init, timeoutMs);
        if (!RETRY_STATUS.has(res.status) || i >= retries) return res;
      } catch (e) {
        if (init?.signal?.aborted || i >= retries) throw e; // cancelled by the caller, or out of tries
      }
      await sleep(baseDelayMs * 2 ** i * (0.75 + Math.random() * 0.5));
    }
  };
}
