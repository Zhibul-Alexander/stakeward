import { beforeEach, describe, expect, it } from 'vitest';
import { SOL_PRICE_SOURCES } from '../src/sol-price.ts';
import { ORIGIN, testApp } from './fakes.ts';

/** A scripted price source: answers by URL, records each call. */
function fakeSources(answer: (url: string) => Response | 'network-error') {
  const calls: string[] = [];
  const fetchFn = (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    const outcome = answer(url);
    return outcome === 'network-error' ? Promise.reject(new TypeError('Network connection lost')) : Promise.resolve(outcome);
  };
  return { fetch: fetchFn, calls };
}

const [COINBASE, COINGECKO] = SOL_PRICE_SOURCES.map((source) => source.url) as [string, string];
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const coinbase = (amount: string) => json({ data: { amount, base: 'SOL', currency: 'USD' } });
const coingecko = (usd: unknown) => json({ solana: { usd } });
const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);

beforeEach(async () => {
  // The edge cache is shared by every test in the run.
  await caches.default.delete(`${ORIGIN}/api/sol-price`);
});

describe('GET /api/sol-price', () => {
  it('answers the Coinbase rate, then serves it from the 5-minute edge cache', async () => {
    const sources = fakeSources(() => coinbase('143.27'));
    const first = await testApp(sources, { now: () => NOW }).request('/api/sol-price');
    expect(first.status).toBe(200);
    expect(first.headers.get('Cache-Control')).toBe('no-store');
    expect(await first.json()).toEqual({ usd: 143.27, at: '2026-10-11T12:00:00.000Z' });

    const second = await testApp(sources).request('/api/sol-price');
    expect(await second.json()).toEqual({ usd: 143.27, at: '2026-10-11T12:00:00.000Z' });
    expect(sources.calls).toEqual([COINBASE]);
    const entry = await caches.default.match(`${ORIGIN}/api/sol-price`);
    expect(entry?.headers.get('Cache-Control')).toBe('public, max-age=300');
  });

  it('falls back to CoinGecko when Coinbase fails or answers nonsense', async () => {
    for (const broken of [new Response('', { status: 429 }), coinbase('-1'), json({ data: {} }), 'network-error' as const]) {
      await caches.default.delete(`${ORIGIN}/api/sol-price`);
      const sources = fakeSources((url) => (url === COINBASE ? broken : coingecko(150.5)));
      const response = await testApp(sources).request('/api/sol-price');
      expect(response.status).toBe(200);
      expect((await response.json<{ usd: number }>()).usd).toBe(150.5);
      expect(sources.calls).toEqual([COINBASE, COINGECKO]);
    }
  });

  it('answers 502 when no source gives a sane rate, and does not cache the failure', async () => {
    let healthy = false;
    const sources = fakeSources((url) => (!healthy ? (url === COINBASE ? 'network-error' : coingecko(0)) : coinbase('140')));
    const failed = await testApp(sources).request('/api/sol-price');
    expect(failed.status).toBe(502);
    expect(failed.headers.get('Cache-Control')).toBe('no-store');
    expect(await failed.json()).toEqual({ error: 'price-unavailable', message: 'The SOL price is unavailable' });

    healthy = true;
    const recovered = await testApp(sources).request('/api/sol-price');
    expect(recovered.status).toBe(200);
  });

  it('gives up on a source that never answers within the timeout', async () => {
    const hang = (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'TimeoutError'));
        });
      });
    const response = await testApp({ fetch: hang }, { timeoutMs: 50 }).request('/api/sol-price');
    expect(response.status).toBe(502);
  });
});
