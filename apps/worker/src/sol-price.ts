import type { Context } from 'hono';
import * as z from 'zod';
import type { UpstreamOptions } from './upstream.ts';
import type { AppEnv } from './app.ts';

/**
 * GET /api/sol-price (DECISIONS.md D132): a public SOL/USD spot rate, so the Costs tab can show rough dollar amounts
 * next to SOL. The browser only talks to our domain (CSP connect-src 'self'), so the worker reads the rate: Coinbase
 * first, CoinGecko if Coinbase fails; both are public, keyless and free. One answer is cached at the edge for 5
 * minutes for every visitor; failures are not cached. The site hides the dollar figures when this route fails.
 *
 * Body: `{ usd: number, at: string }`, `at` = when the worker read the rate (ISO). Nothing here signs or moves funds.
 */

export const SOL_PRICE_CACHE_SECONDS = 300;

export const SOL_PRICE_SOURCES = [
  {
    name: 'coinbase',
    url: 'https://api.coinbase.com/v2/prices/SOL-USD/spot',
    parse: (body: unknown) => coinbase.parse(body).data.amount,
  },
  {
    name: 'coingecko',
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
    parse: (body: unknown) => coingecko.parse(body).solana.usd,
  },
] as const;

/** A sane SOL/USD rate: anything else is a broken source, not a price. */
const rate = z.number().gt(0).lt(1_000_000);
const coinbase = z.object({
  data: z.object({ amount: z.string().regex(/^[0-9]{1,7}(\.[0-9]{1,18})?$/).transform(Number).pipe(rate) }),
});
const coingecko = z.object({ solana: z.object({ usd: rate }) });

export function solPriceHandler(upstream: UpstreamOptions, now: () => number) {
  return async (c: Context<AppEnv>): Promise<Response> => {
    const cacheKey = new Request(new URL('/api/sol-price', c.req.url).toString());
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached !== undefined) return respond(c, await cached.text());

    const usd = await readRate(upstream);
    if (usd === null) return c.json({ error: 'price-unavailable', message: 'The SOL price is unavailable' }, 502);

    const body = JSON.stringify({ usd, at: new Date(now()).toISOString() });
    try {
      await cache.put(
        cacheKey,
        new Response(body, {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': `public, max-age=${String(SOL_PRICE_CACHE_SECONDS)}`,
          },
        }),
      );
    } catch {
      console.warn(JSON.stringify({ msg: 'sol-price cache put failed' }));
    }
    return respond(c, body);
  };
}

function respond(c: Context<AppEnv>, body: string): Response {
  return c.body(body, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}

/** The first source that answers a sane rate within the upstream timeout, else null. Never throws. */
async function readRate(upstream: UpstreamOptions): Promise<number | null> {
  const fetchImpl = upstream.fetch ?? ((input, init) => globalThis.fetch(input, init));
  for (const source of SOL_PRICE_SOURCES) {
    try {
      const response = await fetchImpl(source.url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(upstream.timeoutMs),
      });
      if (!response.ok) {
        await response.body?.cancel();
        console.warn(JSON.stringify({ msg: 'sol-price source failed', source: source.name, status: response.status }));
        continue;
      }
      return source.parse(await response.json());
    } catch (error) {
      console.warn(JSON.stringify({ msg: 'sol-price source failed', source: source.name, error: error instanceof Error ? error.name : 'unknown' }));
    }
  }
  return null;
}
