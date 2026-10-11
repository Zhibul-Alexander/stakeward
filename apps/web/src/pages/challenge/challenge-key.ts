import { CHALLENGE } from './wallet.ts';

/** Same per-request limit as the other API reads (CLAUDE.md section 12). */
const TIMEOUT_MS = 8_000;

/**
 * Reads the challenge wallet's published main key from GET /api/challenge (apps/worker/src/challenge.ts). Rejects on
 * any status but 200, on a malformed body, and when the key's public half is not CHALLENGE.mainKey: the page never
 * shows a key it cannot tie to the wallet it describes.
 */
export async function fetchChallengeKey(options: { fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<string> {
  const fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const response = await fetchImpl('/api/challenge', {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
  });
  if (response.status !== 200) throw new Error(`GET /api/challenge answered HTTP ${String(response.status)}`);
  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null) throw new Error('GET /api/challenge answered a malformed body');
  const { mainKey, mainKeySecret } = body as Record<string, unknown>;
  if (typeof mainKeySecret !== 'string' || mainKey !== CHALLENGE.mainKey) {
    throw new Error('GET /api/challenge answered a key that is not the challenge wallet');
  }
  return mainKeySecret;
}
