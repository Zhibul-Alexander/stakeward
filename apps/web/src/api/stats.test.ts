import { U64_MAX } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { fetchStats, parseStats, StatsHttpError, statsFailureKind } from './stats.ts';

const answer = (status: number, body: unknown) => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

/** What the worker's statsHandler writes (apps/worker/src/public-api.ts). */
const BODY = { accountsLocked: 12, lamportsLocked: '48250750000000', alertsSent: 7, now: '2026-10-06T12:00:00.000Z' };

describe('fetchStats', () => {
  it("reads the worker's numbers, the lamports exact beyond 2^53", async () => {
    expect(await fetchStats({ fetch: answer(200, BODY) })).toEqual({
      accountsLocked: 12,
      lamportsLocked: 48_250_750_000_000n,
      alertsSent: 7,
      countedAt: new Date('2026-10-06T12:00:00.000Z'),
    });
    // 2^53 + 1: a JSON number would read 9007199254740992.
    const exact = await fetchStats({ fetch: answer(200, { ...BODY, lamportsLocked: '9007199254740993' }) });
    expect(exact.lamportsLocked).toBe(9_007_199_254_740_993n);
  });

  it('reads zeros as zeros (an empty database)', async () => {
    expect(
      await fetchStats({ fetch: answer(200, { accountsLocked: 0, lamportsLocked: '0', alertsSent: 0, now: BODY.now }) }),
    ).toMatchObject({ accountsLocked: 0, lamportsLocked: 0n, alertsSent: 0 });
  });

  it('asks the worker on its own origin, for JSON', async () => {
    const calls: { url: string; accept: string | null }[] = [];
    await fetchStats({
      fetch: (input, init) => {
        calls.push({ url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, accept: new Headers(init?.headers).get('accept') });
        return answer(200, BODY)();
      },
    });
    expect(calls).toEqual([{ url: '/api/stats', accept: 'application/json' }]);
  });

  it('rejects any other status with its number, without reading the body', async () => {
    for (const status of [429, 500, 503, 404, 201]) {
      const failure = fetchStats({ fetch: answer(status, BODY) });
      await expect(failure).rejects.toBeInstanceOf(StatsHttpError);
      await expect(failure).rejects.toMatchObject({ status, message: `GET /api/stats answered HTTP ${String(status)}` });
    }
  });

  it('rejects a body that is not JSON', async () => {
    const html = () => Promise.resolve(new Response('<!doctype html><title>Stakeward</title>', { status: 200 }));
    await expect(fetchStats({ fetch: html })).rejects.toThrow(SyntaxError);
  });

  it('rejects a malformed body', async () => {
    await expect(fetchStats({ fetch: answer(200, { ...BODY, lamportsLocked: 48_250_750_000_000 }) })).rejects.toMatchObject({
      name: 'InvalidStatsResponseError',
      message: 'Malformed /api/stats response: lamportsLocked is not a decimal string of lamports',
    });
  });

  it('gives up after the timeout (every wait is finite)', async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    await expect(fetchStats({ fetch: hanging, timeoutMs: 10 })).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('the timeout also covers a body that never ends', async () => {
    const stalled: typeof fetch = (_input, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"accountsLocked":'));
          init?.signal?.addEventListener('abort', () => {
            controller.error(new DOMException('aborted', 'AbortError'));
          });
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    };
    await expect(fetchStats({ fetch: stalled, timeoutMs: 10 })).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});

describe('parseStats', () => {
  const malformed = (field: string) => new RegExp(`^Malformed /api/stats response: ${field} `);

  it('accepts the exact shape, milliseconds in the time optional', () => {
    expect(parseStats({ ...BODY, now: '2026-10-06T12:00:00Z' }).countedAt).toEqual(new Date('2026-10-06T12:00:00.000Z'));
    expect(parseStats({ ...BODY, lamportsLocked: U64_MAX.toString() }).lamportsLocked).toBe(U64_MAX);
    expect(parseStats({ ...BODY, alertsSent: Number.MAX_SAFE_INTEGER }).alertsSent).toBe(Number.MAX_SAFE_INTEGER);
    expect(Object.is(parseStats({ ...BODY, accountsLocked: -0 }).accountsLocked, 0)).toBe(true);
  });

  it.each([
    ['null', null],
    ['an array', [BODY]],
    ['a string', 'ok'],
    ['a number', 12],
  ])('rejects a body that is %s', (_name, body) => {
    expect(() => parseStats(body)).toThrow(/^Malformed \/api\/stats response: body is not an object$/);
  });

  it('rejects a missing or an unexpected field', () => {
    const { alertsSent: _dropped, ...withoutAlerts } = BODY;
    expect(() => parseStats(withoutAlerts)).toThrow('body misses the field "alertsSent"');
    expect(() => parseStats({ ...BODY, lastMonitorRunAt: null })).toThrow('body has an unexpected field "lastMonitorRunAt"');
  });

  it.each([
    ['a string', '12'],
    ['negative', -1],
    ['a fraction', 1.5],
    ['beyond 2^53', 2 ** 53],
    ['null', null],
  ])('rejects counts that are %s', (_name, value) => {
    expect(() => parseStats({ ...BODY, accountsLocked: value })).toThrow(malformed('accountsLocked'));
    expect(() => parseStats({ ...BODY, alertsSent: value })).toThrow(malformed('alertsSent'));
  });

  it.each([
    ['a number', 1_000_000_000],
    ['empty', ''],
    ['negative', '-5'],
    ['with a leading zero', '0100'],
    ['a fraction', '1.5'],
    ['in exponent form', '1e9'],
    ['with spaces', ' 100'],
    ['in SOL', '1,250.5 SOL'],
    ['above u64', (U64_MAX + 1n).toString()],
    ['21 digits', '1'.repeat(21)],
  ])('rejects lamports that are %s', (_name, value) => {
    expect(() => parseStats({ ...BODY, lamportsLocked: value })).toThrow(malformed('lamportsLocked'));
  });

  it.each([
    ['missing its zone', '2026-10-06T12:00:00.000'],
    ['not UTC', '2026-10-06T12:00:00.000+04:00'],
    ['a date only', '2026-10-06'],
    ['words', 'now'],
    ['a unix time', 1_791_288_000],
    ['an impossible day', '2026-02-30T00:00:00.000Z'],
    ['an impossible hour', '2026-10-06T24:00:00.000Z'],
    ['null', null],
  ])('rejects a time that is %s', (_name, value) => {
    expect(() => parseStats({ ...BODY, now: value })).toThrow(malformed('now'));
  });
});

describe('statsFailureKind', () => {
  const timeout = Object.assign(new Error('No answer within 8 s'), { name: 'TimeoutError' });

  it('tells a rate limit, a missing answer and a bad answer apart', async () => {
    expect(statsFailureKind(new StatsHttpError(429))).toBe('rate-limited');
    expect(statsFailureKind(timeout)).toBe('network');
    expect(statsFailureKind(new TypeError('Failed to fetch'))).toBe('network');
    expect(statsFailureKind(new DOMException('aborted', 'AbortError'))).toBe('network');
    expect(statsFailureKind(new StatsHttpError(500))).toBe('server');
    expect(statsFailureKind(new StatsHttpError(503))).toBe('server');
    expect(statsFailureKind(new SyntaxError('Unexpected token <'))).toBe('server');
    const invalid: unknown = await fetchStats({ fetch: answer(200, { ...BODY, now: 'now' }) }).catch((error: unknown) => error);
    expect(statsFailureKind(invalid)).toBe('server');
  });
});
