import { describe, expect, it } from 'vitest';
import { fetchStats, parseStats } from './stats.ts';

const answer = (status: number, body: unknown) => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

const GOOD = { accountsLocked: 12, lamportsLocked: '1234567891234', alertsSent: 7, now: '2026-10-06T12:00:00.000Z' };

describe('parseStats', () => {
  it('reads a good body and ignores other keys', () => {
    expect(parseStats({ ...GOOD, extra: 'ignored' })).toEqual({
      accountsLocked: 12,
      lamportsLocked: 1_234_567_891_234n,
      alertsSent: 7,
    });
    expect(parseStats({ accountsLocked: 0, lamportsLocked: '0', alertsSent: 0 })).toEqual({
      accountsLocked: 0,
      lamportsLocked: 0n,
      alertsSent: 0,
    });
  });

  it('reads u64::MAX lamports exactly', () => {
    expect(parseStats({ ...GOOD, lamportsLocked: '18446744073709551615' }).lamportsLocked).toBe(18_446_744_073_709_551_615n);
  });

  it.each([
    ['a number', { ...GOOD, lamportsLocked: 1_234 }],
    ['a negative string', { ...GOOD, lamportsLocked: '-1' }],
    ['a fraction', { ...GOOD, lamportsLocked: '1.5' }],
    ['an empty string', { ...GOOD, lamportsLocked: '' }],
    ['a leading zero', { ...GOOD, lamportsLocked: '007' }],
    ['21 digits', { ...GOOD, lamportsLocked: '100000000000000000000' }],
    ['u64::MAX + 1', { ...GOOD, lamportsLocked: '18446744073709551616' }],
    ['a negative count', { ...GOOD, accountsLocked: -1 }],
    ['a fractional count', { ...GOOD, accountsLocked: 1.5 }],
    ['a count as a string', { ...GOOD, accountsLocked: '3' }],
    ['a count past 2^53', { ...GOOD, accountsLocked: 2 ** 53 }],
    ['no alertsSent', { accountsLocked: 12, lamportsLocked: '1', now: GOOD.now }],
    ['null', null],
    ['an array', []],
    ['a string', 'ok'],
  ])('rejects %s', (_name, body) => {
    expect(() => parseStats(body)).toThrow('Malformed /api/stats response');
  });
});

describe('fetchStats', () => {
  it('asks the worker on its own origin with a GET for JSON', async () => {
    const requests: { url: unknown; method: string; accept: string | null }[] = [];
    const stats = await fetchStats({
      fetch: (input, init) => {
        requests.push({ url: input, method: init?.method ?? 'GET', accept: new Headers(init?.headers).get('accept') });
        return answer(200, GOOD)();
      },
    });
    expect(requests).toEqual([{ url: '/api/stats', method: 'GET', accept: 'application/json' }]);
    expect(stats).toEqual({ accountsLocked: 12, lamportsLocked: 1_234_567_891_234n, alertsSent: 7 });
  });

  it('rejects the rate limit, a server failure and a body that is not JSON', async () => {
    await expect(fetchStats({ fetch: answer(429, { error: 'Too many requests' }) })).rejects.toThrow('GET /api/stats answered HTTP 429');
    await expect(fetchStats({ fetch: answer(500, { error: 'Internal error' }) })).rejects.toThrow('GET /api/stats answered HTTP 500');
    await expect(fetchStats({ fetch: () => Promise.resolve(new Response('<html>', { status: 200 })) })).rejects.toThrow(
      'Malformed /api/stats response',
    );
    await expect(fetchStats({ fetch: answer(200, { ...GOOD, alertsSent: null }) })).rejects.toThrow('Malformed /api/stats response');
  });

  it('gives up after the timeout, even when the fetch never settles (every wait is finite)', async () => {
    const never: typeof fetch = () => new Promise<Response>(() => undefined);
    await expect(fetchStats({ fetch: never, timeoutMs: 10 })).rejects.toMatchObject({
      name: 'TimeoutError',
      message: 'No answer within 0.01 s',
    });
  });

  it('aborts the request when the time is up', async () => {
    let signal: AbortSignal | undefined;
    const hanging: typeof fetch = (_input, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    };
    await expect(fetchStats({ fetch: hanging, timeoutMs: 10 })).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(signal?.aborted).toBe(true);
  });
});
