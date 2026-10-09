// The isolate warm-up (src/warm-up.ts; DECISIONS.md D41, D63): it really reaches every path it is there to warm, it
// touches nothing outside itself, and a failure never stops the worker from loading.
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startWarmUp, WARM_UP_ACCOUNTS, WARM_UP_ROUNDS, warmUp } from '../src/warm-up.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('warmUp', () => {
  it('reaches every path in every round', async () => {
    const report = warmUp();
    const accounts = WARM_UP_ACCOUNTS * WARM_UP_ROUNDS;
    expect({ ...report, inspected: await report.inspected }).toEqual({
      rounds: WARM_UP_ROUNDS,
      // Every account changed (a Deactivate): decoded, not the fast path, one DEACTIVATED and a rescan pair each.
      decoded: accounts,
      events: accounts,
      rescanPairs: accounts,
      // A message to the main key's chat and one to the second key's, five alerts each: those five events are settled.
      messages: 2 * WARM_UP_ROUNDS,
      settled: 5 * WARM_UP_ROUNDS,
      // The rescan takes every locked account, the lookup and /api/watch every account.
      rescanRows: accounts,
      lookedUp: accounts,
      judged: accounts,
      // The stake-accounts query, the watch body, and 8 RPC requests (envelope and params each).
      schemas: 18 * WARM_UP_ROUNDS,
      // Protect, withdraw and rescue, accepted by the inspector with every signature missing.
      inspected: 3,
    });
  });

  it('does no I/O and uses no timer, randomness, clock or Web Crypto', async () => {
    const spies = [
      vi.spyOn(globalThis, 'fetch'),
      vi.spyOn(globalThis, 'setTimeout'),
      vi.spyOn(globalThis, 'setInterval'),
      vi.spyOn(crypto, 'getRandomValues'),
      vi.spyOn(crypto, 'randomUUID'),
      vi.spyOn(crypto.subtle, 'verify'),
      vi.spyOn(crypto.subtle, 'importKey'),
      vi.spyOn(crypto.subtle, 'digest'),
      vi.spyOn(Math, 'random'),
      vi.spyOn(Date, 'now'),
    ];
    await warmUp().inspected;
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe('startWarmUp', () => {
  it('logs nothing when the warm-up works', async () => {
    const log = vi.fn();
    await startWarmUp(warmUp, log);
    expect(log).not.toHaveBeenCalled();
  });

  it('never throws: a failing path is logged by its error name only', async () => {
    const log = vi.fn();
    const failing = () => {
      throw new RangeError('detail that stays out of the log');
    };
    let started: Promise<void> | undefined;
    expect(() => (started = startWarmUp(failing, log))).not.toThrow();
    await started;
    expect(log).toHaveBeenCalledExactlyOnceWith({ msg: 'warm-up failed', stage: 'paths', error: 'RangeError' });
  });

  it('logs a failed inspector run instead of leaving the rejection unhandled', async () => {
    const log = vi.fn();
    await startWarmUp(() => ({ inspected: Promise.reject(new TypeError('detail')) }), log);
    expect(log).toHaveBeenCalledExactlyOnceWith({ msg: 'warm-up failed', stage: 'inspector', error: 'TypeError' });
  });

  it('runs when the entry module loads, outside the handlers', () => {
    const source = env.TEST_WORKER_SOURCES['index.ts'] ?? '';
    expect(source.split('\n')).toContain('void startWarmUp();');
  });
});
