import { describe, expect, it } from 'vitest';
import { fetchChallengeKey } from './challenge-key.ts';
import { CHALLENGE } from './wallet.ts';

const SECRET = 'published-main-key';

function answering(status: number, body: unknown): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetchFn: typeof fetch = (input) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  return { fetch: fetchFn, urls };
}

describe('fetchChallengeKey', () => {
  it('returns the key the worker serves for the challenge wallet', async () => {
    const api = answering(200, { mainKey: CHALLENGE.mainKey, mainKeySecret: SECRET });
    await expect(fetchChallengeKey({ fetch: api.fetch })).resolves.toBe(SECRET);
    expect(api.urls).toEqual(['/api/challenge']);
  });

  it('refuses a key of another wallet, a malformed body and any status but 200', async () => {
    const cases: [number, unknown][] = [
      [200, { mainKey: CHALLENGE.secondKey, mainKeySecret: SECRET }],
      [200, { mainKey: CHALLENGE.mainKey }],
      [200, null],
      [503, { error: 'challenge-not-configured' }],
    ];
    for (const [status, body] of cases) {
      await expect(fetchChallengeKey({ fetch: answering(status, body).fetch })).rejects.toThrow();
    }
  });
});
