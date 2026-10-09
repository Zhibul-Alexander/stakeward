/**
 * Client for the upstream Solana RPC (CLAUDE.md sections 3 and 12). RPC_URL (Helius, key in the URL) is the primary;
 * the optional RPC_FALLBACK_URL serves reads when the primary fails. URLs carry API keys, so they are never logged,
 * and neither are error messages, which may quote them.
 *
 * - Every attempt times out after `timeoutMs` (8 s), including reading the body.
 * - Reads: up to two retries, three attempts in all: primary, fallback (or primary again), primary. A read pinned to
 *   one endpoint makes all three attempts there (the monitor's genesis check of the node that answered a chunk).
 * - sendTransaction: one attempt on the primary. Resending the same signed bytes is safe, but the site owns retries.
 * - An attempt fails on a network error, a timeout or any non-2xx status. A 2xx body is returned as it is, JSON-RPC
 *   errors included; parsing it is the caller's business.
 * - With `maxBodyBytes`, a body longer than that is not read on (`too-large`, not retried: another node would send
 *   the same answer). The monitor's rescans set it: anyone can make a pair's answer as large as they like.
 */

export type UpstreamOptions = {
  timeoutMs: number;
  /** Pause before retry n is n x retryDelayMs. */
  retryDelayMs: number;
  /** Injected in tests; defaults to the global fetch, looked up at call time. */
  fetch?: typeof fetch;
  /** A 2xx body longer than this many bytes is refused part way (`too-large`). */
  maxBodyBytes?: number;
};

export const DEFAULT_UPSTREAM_OPTIONS: UpstreamOptions = { timeoutMs: 8_000, retryDelayMs: 250 };

export type UpstreamEndpoints = { primary: string; fallback?: string | undefined };

export type EndpointName = 'primary' | 'fallback';

/** `endpoint`: the one that answered (the primary's URL when no fallback is set). */
export type UpstreamResult =
  | { ok: true; body: string; endpoint: EndpointName }
  | { ok: false; reason: 'timeout' | 'unavailable' | 'too-large' };

/**
 * One POST attempt: the HTTP status and, for a 2xx status only, the body text (any other body is cancelled unread);
 * or why no status came back, or `too-large` for a 2xx body over `maxBodyBytes`. The timeout covers reading the body
 * as well.
 */
export type AttemptResult = { status: number; body: string | null } | 'timeout' | 'network' | 'too-large';

type AttemptFailure = 'timeout' | 'network' | `http-${string}`;

/**
 * POSTs a JSON-RPC payload upstream. Never throws. `pin` (reads only): every attempt goes to that endpoint; a fallback
 * pin without a fallback set is the primary.
 */
export async function callUpstream(
  endpoints: UpstreamEndpoints,
  payload: string,
  kind: 'read' | 'send',
  options: UpstreamOptions,
  pin?: EndpointName,
): Promise<UpstreamResult> {
  const fallback = endpoints.fallback !== undefined && endpoints.fallback !== '' ? endpoints.fallback : undefined;
  const primary = { name: 'primary', url: endpoints.primary } as const;
  const second = fallback === undefined ? primary : ({ name: 'fallback', url: fallback } as const);
  const pinned = pin === 'fallback' ? second : primary;
  const plan: readonly { name: EndpointName; url: string }[] =
    kind === 'send' ? [primary] : pin === undefined ? [primary, second, primary] : [pinned, pinned, pinned];

  let last: AttemptFailure = 'network';
  for (const [index, endpoint] of plan.entries()) {
    if (index > 0 && options.retryDelayMs > 0) await sleep(index * options.retryDelayMs);
    const result = await attemptPost(endpoint.url, payload, options);
    if (result === 'too-large') {
      console.warn(JSON.stringify({ msg: 'upstream rpc answer too large', endpoint: endpoint.name, attempt: index + 1 }));
      return { ok: false, reason: 'too-large' };
    }
    if (typeof result === 'string' || result.body === null) {
      last = typeof result === 'string' ? result : `http-${String(result.status)}`;
      const log = { msg: 'upstream rpc attempt failed', endpoint: endpoint.name, attempt: index + 1, reason: last };
      console.warn(JSON.stringify(log));
      continue;
    }
    return { ok: true, body: result.body, endpoint: endpoint.name };
  }
  return { ok: false, reason: last === 'timeout' ? 'timeout' : 'unavailable' };
}

/**
 * One POST of a JSON `payload` to `url` within `timeoutMs`, reading the body too. Never throws and never logs (the URL
 * may carry a key or a bot token). Shared by the RPC client above and the Telegram client.
 */
export async function attemptPost(
  url: string,
  payload: string,
  options: { timeoutMs: number; fetch?: typeof fetch; maxBodyBytes?: number },
): Promise<AttemptResult> {
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
  const work = (async (): Promise<AttemptResult> => {
    try {
      const response = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        return { status: response.status, body: null };
      }
      if (options.maxBodyBytes === undefined) return { status: response.status, body: await response.text() };
      const body = await readCapped(response, options.maxBodyBytes);
      return body === null ? 'too-large' : { status: response.status, body };
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

/** The body as text, or null (the rest cancelled unread) once it is longer than `maxBytes`. */
async function readCapped(response: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(response.headers.get('Content-Length') ?? NaN);
  if (declared > maxBytes || response.body === null) {
    await response.body?.cancel();
    return response.body === null ? '' : null;
  }
  // A fetch body is bytes; the workers types leave its chunks untyped.
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
