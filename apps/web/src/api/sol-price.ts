/**
 * GET /api/sol-price of the worker (DECISIONS.md D132): a public SOL/USD spot rate, read by the worker and cached
 * there for 5 minutes. Body: `{ usd: number, at: string }`. Only for rough dollar figures next to SOL amounts: nothing
 * signed or checked depends on it, and a page that cannot read it shows SOL alone.
 */

const SOL_PRICE_URL = '/api/sol-price';
/** Same per-request limit as the RPC transport (CLAUDE.md section 12). */
const TIMEOUT_MS = 8_000;

export type SolPriceOptions = { fetch?: typeof fetch; timeoutMs?: number };

/** US dollars per SOL. Rejects on a network failure, a status other than 200, a malformed body or after the timeout. */
export async function fetchSolPrice(options: SolPriceOptions = {}): Promise<number> {
  const fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const response = await fetchImpl(SOL_PRICE_URL, {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
  });
  if (response.status !== 200) throw new Error(`GET /api/sol-price answered HTTP ${String(response.status)}`);
  const body: unknown = await response.json();
  const usd = typeof body === 'object' && body !== null && 'usd' in body ? body.usd : undefined;
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0) throw new Error('Malformed /api/sol-price response');
  return usd;
}

const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * Lamports as a rough dollar figure: one significant digit under $1 ("$0.002", "$0.2"), cents from $1 up ("$14.37").
 * The point is the order of magnitude, so a fee of a few thousand lamports still reads as a fraction of a cent.
 */
export function formatUsd(lamports: bigint, usdPerSol: number): string {
  const usd = (Number(lamports) / LAMPORTS_PER_SOL) * usdPerSol;
  const format =
    usd < 1
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumSignificantDigits: 1 })
      : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return format.format(usd);
}
