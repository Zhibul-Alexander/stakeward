/**
 * Client for the upstream Solana RPC (CLAUDE.md sections 3 and 12). RPC_URL (Helius, key in the URL) is the primary;
 * the optional RPC_FALLBACK_URL serves reads when the primary fails. URLs carry API keys, so they are never logged,
 * and neither are error messages, which may quote them.
 *
 * - Every attempt times out after `timeoutMs` (8 s), including reading the body.
 * - Reads: up to two retries, three attempts in all: primary, fallback (or primary again), primary.
 * - sendTransaction: one attempt on the primary. Resending the same signed bytes is safe, but the site owns retries.
 * - An attempt fails on a network error, a timeout or any non-2xx status. A 2xx body is returned as it is, JSON-RPC
 *   errors included; parsing it is the caller's business.
 */

export type UpstreamOptions = {
  timeoutMs: number;
  /** Pause before retry n is n x retryDelayMs. */
  retryDelayMs: number;
  /** Injected in tests; defaults to the global fetch, looked up at call time. */
  fetch?: typeof fetch;
};

export const DEFAULT_UPSTREAM_OPTIONS: UpstreamOptions = { timeoutMs: 8_000, retryDelayMs: 250 };

export type UpstreamEndpoints = { primary: string; fallback?: string | undefined };

export type UpstreamResult = { ok: true; body: string } | { ok: false; reason: 'timeout' | 'unavailable' };

type AttemptFailure = 'timeout' | 'network' | `http-${string}`;

/** POSTs a JSON-RPC payload upstream. Never throws. */
export async function callUpstream(
  endpoints: UpstreamEndpoints,
  payload: string,
  kind: 'read' | 'send',
  options: UpstreamOptions,
): Promise<UpstreamResult> {
  const fallback = endpoints.fallback !== undefined && endpoints.fallback !== '' ? endpoints.fallback : undefined;
  const plan: { name: 'primary' | 'fallback'; url: string }[] =
    kind === 'send'
      ? [{ name: 'primary', url: endpoints.primary }]
      : [
          { name: 'primary', url: endpoints.primary },
          fallback === undefined ? { name: 'primary', url: endpoints.primary } : { name: 'fallback', url: fallback },
          { name: 'primary', url: endpoints.primary },
        ];

  let last: AttemptFailure = 'network';
  for (const [index, endpoint] of plan.entries()) {
    if (index > 0 && options.retryDelayMs > 0) await sleep(index * options.retryDelayMs);
    const result = await attempt(endpoint.url, payload, options);
    if (typeof result === 'string') {
      last = result;
      const log = { msg: 'upstream rpc attempt failed', endpoint: endpoint.name, attempt: index + 1, reason: result };
      console.warn(JSON.stringify(log));
      continue;
    }
    return { ok: true, body: result.body };
  }
  return { ok: false, reason: last === 'timeout' ? 'timeout' : 'unavailable' };
}

async function attempt(
  url: string,
  payload: string,
  options: UpstreamOptions,
): Promise<{ body: string } | AttemptFailure> {
  const fetchFn = options.fetch ?? fetch;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Races the work against the timer as well, so a fetch that ignores its signal cannot hang the request.
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve('timeout');
    }, options.timeoutMs);
  });
  const work = (async (): Promise<{ body: string } | AttemptFailure> => {
    try {
      const response = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        return `http-${String(response.status)}`;
      }
      return { body: await response.text() };
    } catch {
      return controller.signal.aborted ? 'timeout' : 'network';
    }
  })();
  try {
    return await Promise.race([work, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
