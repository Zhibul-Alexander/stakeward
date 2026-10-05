// Done-when of step 5: the pass marker is written (last, and only by a pass that succeeded), the lease keeps passes
// apart, and failures reach the admin chat at most once an hour.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runMonitorPass } from '../../src/monitor/pass.ts';
import type { StakeAccountSpec } from '../transactions.ts';
import { key, LOCK_UNTIL } from '../transactions.ts';
import { ADMIN_CHAT, createHarness, makeDeps, metaKeysOf, type Harness } from './harness.ts';

const MAIN = key(1);
const SECOND = key(2);
const STAKE = key(10);
const SPEC: StakeAccountSpec = { state: 'delegated', staker: MAIN, withdrawer: MAIN, custodian: SECOND, unixTimestamp: LOCK_UNTIL };

afterEach(() => {
  vi.restoreAllMocks();
});

async function watched(iso = '2026-10-05T01:00:00Z', env?: Record<string, string | undefined>): Promise<Harness> {
  const h = createHarness(env === undefined ? {} : { env });
  h.at(iso);
  h.chain.putStake(STAKE, SPEC);
  await h.seedWatched([STAKE]);
  return h;
}

const lease = async (h: Harness) => JSON.parse((await h.readMeta()).pass_lease ?? 'null') as unknown;

/** Pauses the first outbound call to a host `matches` once its answer is in (a pass stuck right after that call). */
function pausedAfter(h: Harness, matches: (host: string) => boolean) {
  let release!: () => void;
  let reached!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reachedPromise = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const route = h.deps.fetch;
  let first = true;
  h.deps.fetch = async (input, init) => {
    const response = await route(input, init);
    const host = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).hostname;
    if (first && matches(host)) {
      first = false;
      reached();
      await released;
    }
    return response;
  };
  return { reached: reachedPromise, release };
}

describe('the marker', () => {
  it('a successful pass writes last_pass_at = its start and releases the lease, in its last statement', async () => {
    const h = await watched();
    h.at('2026-10-05T01:02:00Z');
    const t0 = h.clock.ms;
    expect(await h.pass()).toMatchObject({ outcome: 'ok', stage: 'finish' });
    const meta = await h.readMeta();
    expect(meta.last_pass_at).toBe(String(t0));
    expect(JSON.parse(meta.pass_lease ?? '')).toEqual({ pass: 'pass-1', until: 0 });

    const last = h.db.journal.at(-1);
    expect(last?.name).toBe('PUT_META');
    expect(metaKeysOf(last ?? { name: '', via: 'run', call: 0, args: [] })).toEqual(['pass_lease', 'last_pass_at']);
    expect(h.db.journal.filter((e) => e.call === last?.call)).toHaveLength(1);
  });

  it('also last after the daily pass and a rescan', async () => {
    const h = await watched('2026-10-05T12:00:00Z');
    h.at('2026-10-05T12:02:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'ok', daily: true, rescans: 1 });
    const names = h.db.journal.map((e) => e.name);
    expect(names).toContain('KNOWN_LIVE');
    expect(metaKeysOf(h.db.journal.at(-1) ?? { name: '', via: 'run', call: 0, args: [] })).toEqual(
      expect.arrayContaining(['last_pass_at', 'daily_day', 'pass_lease']),
    );
  });

  it('the RPC down: no marker, read_failures counts up, rpc-down on the third pass and not again within the hour', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = await watched();
    h.at('2026-10-05T01:02:00Z');
    await h.pass();
    const marker = (await h.readMeta()).last_pass_at;

    for (const [n, minute] of [
      [1, '04'],
      [2, '06'],
      [3, '08'],
      [4, '10'],
    ] as const) {
      h.chain.failNext('getMultipleAccounts', [503, 503, 503]);
      h.at(`2026-10-05T01:${minute}:00Z`);
      expect(await h.pass()).toMatchObject({ outcome: 'read-failed', chunksFailed: 1 });
      const meta = await h.readMeta();
      expect(meta.read_failures).toBe(String(n));
      expect(meta.last_pass_at).toBe(marker);
      expect(JSON.parse(meta.pass_lease ?? '')).toMatchObject({ until: 0 });
    }
    expect(h.adminMessages()).toEqual([
      'Stakeward devnet monitor: the RPC could not be read for 3 passes in a row. Health turns red after 10 minutes.',
    ]);

    h.at('2026-10-05T01:12:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'ok' });
    const meta = await h.readMeta();
    expect(meta.read_failures).toBe('0');
    expect(meta.last_pass_at).toBe(String(h.clock.ms));
  });
});

describe('an exception in each stage', () => {
  type Stage = { stage: string; error: string; arrange: (h: Harness) => void; at?: string; env?: Record<string, string> };
  const STAGES: Stage[] = [
    { stage: 'config', error: 'MonitorConfigError', arrange: () => undefined, env: { MONITOR_PLAN: 'enterprise' } },
    {
      stage: 'load',
      error: 'Error',
      arrange: (h) => {
        h.db.failWhen = (e) => e.name === 'PAGE';
      },
    },
    {
      stage: 'chunks',
      error: 'Error',
      arrange: (h) => {
        h.chain.putStake(STAKE, { ...SPEC, deactivationEpoch: 951n });
        h.db.failWhen = (e) => e.name === 'CHUNK_UPDATE';
      },
    },
    {
      stage: 'daily',
      error: 'Error',
      at: '2026-10-05T12:00:00Z',
      arrange: (h) => {
        h.db.failWhen = (e) => e.name === 'DAILY_PAIRS';
      },
    },
    {
      stage: 'sends',
      error: 'Error',
      arrange: (h) => {
        h.db.failWhen = (e) => e.name === 'PENDING';
      },
    },
    {
      stage: 'rescans',
      error: 'Error',
      at: '2026-10-05T12:00:00Z',
      arrange: (h) => {
        h.db.failWhen = (e) => e.name === 'KNOWN_LIVE';
      },
    },
    {
      stage: 'finish',
      error: 'Error',
      arrange: (h) => {
        h.db.failWhen = (e) => metaKeysOf(e).includes('last_pass_at');
      },
    },
  ];

  for (const s of STAGES) {
    it(`${s.stage}: rejected, no marker, one pass-error alert, none again within the hour`, async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const h = await watched(s.at ?? '2026-10-05T01:00:00Z', s.env);
      s.arrange(h);
      h.advance(120_000);
      await expect(h.pass()).rejects.toThrow();

      expect((await h.readMeta()).last_pass_at).toBeUndefined();
      const text = `Stakeward devnet monitor: the pass failed at ${s.stage} (${s.error}). Health turns red after 10 minutes. See Workers Logs.`;
      expect(h.adminMessages()).toEqual([text]);
      expect(h.logs.find((l) => l.msg === 'monitor pass failed')).toMatchObject({ stage: s.stage, error: s.error, outcome: 'error' });
      // The lease is released, unless the pass never got it.
      expect(await lease(h)).toEqual(s.stage === 'config' || s.stage === 'load' ? null : { pass: 'pass-1', until: 0 });
      if (s.stage === 'config') expect(h.db.stats.statements).toBe(0);

      h.advance(120_000);
      await expect(h.pass()).rejects.toThrow();
      expect(h.adminMessages()).toEqual([text]);
      h.advance(3_600_000);
      await expect(h.pass()).rejects.toThrow();
      expect(h.adminMessages()).toEqual([text, text]);
      expect(log).not.toHaveBeenCalled();
    });
  }

  it('one admin alert a pass: an exception after the admin stage sends no second one', async () => {
    const h = await watched();
    h.at('2026-10-05T01:02:00Z');
    await h.setMeta({ pass_lease: JSON.stringify({ pass: 'died', until: h.clock.ms - 10_000 }) });
    h.db.failWhen = (e) => metaKeysOf(e).includes('last_pass_at');
    await expect(h.pass()).rejects.toThrow();
    expect(h.adminMessages()).toHaveLength(1);
    expect(h.adminMessages()[0]).toMatch(/the previous pass did not finish/);
  });

  it('the hourly throttle survives a cold isolate through meta.admin_alerts', async () => {
    const h = await watched();
    h.chain.putStake(STAKE, { ...SPEC, deactivationEpoch: 951n });
    h.db.failWhen = (e) => e.name === 'CHUNK_UPDATE';
    h.advance(120_000);
    await expect(h.pass()).rejects.toThrow();
    expect(h.adminMessages()).toHaveLength(1);
    expect(JSON.parse((await h.readMeta()).admin_alerts ?? '')).toEqual({ 'pass-error': h.clock.ms });

    const cold = makeDeps({ clock: h.clock, chain: h.chain, telegram: h.telegram, db: h.db });
    h.advance(120_000);
    await expect(runMonitorPass(cold.deps)).rejects.toThrow();
    expect(h.adminMessages()).toHaveLength(1);
  });
});

describe('the lease', () => {
  it('a lease left by a pass that died: the next pass takes over and alerts pass-died', async () => {
    const h = await watched();
    h.at('2026-10-05T01:02:00Z');
    await h.setMeta({ pass_lease: JSON.stringify({ pass: 'died', until: h.clock.ms - 10_000 }) });
    expect(await h.pass()).toMatchObject({ outcome: 'ok', previousDied: true });
    expect(h.adminMessages()).toEqual([
      'Stakeward devnet monitor: the previous pass did not finish, most likely the 10 ms CPU limit of the Workers Free plan. Check CPU time of cron invocations in Workers Logs.',
    ]);
    expect(await lease(h)).toEqual({ pass: 'pass-1', until: 0 });

    // A released lease is not a death.
    h.at('2026-10-05T01:04:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'ok', previousDied: false });
    expect(h.adminMessages()).toHaveLength(1);
  });

  it('a lease held by a running pass: skipped-lease, no fetch, nothing written', async () => {
    const h = await watched();
    h.at('2026-10-05T01:02:00Z');
    const held = { pass: 'running', until: h.clock.ms + 50_000 };
    await h.setMeta({ pass_lease: JSON.stringify(held), cursor: '' });
    const before = await h.readMeta();
    expect(await h.pass()).toMatchObject({ outcome: 'skipped-lease', stage: 'load', fetches: 0, statements: 3 });
    expect(h.net.calls).toEqual([]);
    expect(h.db.journal.map((e) => e.name)).toEqual(['LOAD_META', 'LEASE_ACQUIRE', 'PAGE']);
    expect(await h.readMeta()).toEqual(before);
    expect(await h.readEvents()).toEqual([]);
  });

  it('a pass inside its lease (paused after its read, 10 s on): the second pass is skipped without a fetch', async () => {
    const h = await watched();
    h.chain.putStake(STAKE, { ...SPEC, deactivationEpoch: 951n });
    const pause = pausedAfter(h, (host) => host === 'primary.rpc.test');
    h.at('2026-10-05T01:02:00Z');
    const running = h.pass();
    await pause.reached;
    h.advance(10_000);
    const fetches = h.net.calls.length;
    expect(await h.pass()).toMatchObject({ outcome: 'skipped-lease', fetches: 0 });
    expect(h.net.calls).toHaveLength(fetches);
    pause.release();
    expect(await running).toMatchObject({ outcome: 'ok', events: 1 });
    expect(await lease(h)).toEqual({ pass: 'pass-1', until: 0 });
  });

  it('a pass inside its lease (paused after its first send): the alert goes out once', async () => {
    const h = await watched();
    await h.linkChat(MAIN, '100001');
    h.chain.putStake(STAKE, { ...SPEC, deactivationEpoch: 951n });
    const pause = pausedAfter(h, (host) => host === 'api.telegram.org');
    h.at('2026-10-05T01:02:00Z');
    const running = h.pass();
    await pause.reached;
    h.advance(10_000);
    expect(await h.pass()).toMatchObject({ outcome: 'skipped-lease' });
    pause.release();
    expect(await running).toMatchObject({ outcome: 'ok', messages: 1 });
    h.advance(120_000);
    expect(await h.pass()).toMatchObject({ outcome: 'ok', pending: 0, messages: 0 });
    expect(h.telegram.delivered('100001')).toHaveLength(1);
  });

  it('Telegram 5xx on the admin alert: the pass still succeeds, the alert is not counted as sent', async () => {
    const h = await watched();
    h.at('2026-10-05T01:02:00Z');
    await h.setMeta({ pass_lease: JSON.stringify({ pass: 'died', until: h.clock.ms - 10_000 }) });
    h.telegram.replyTo(ADMIN_CHAT, 500);
    expect(await h.pass()).toMatchObject({ outcome: 'ok', previousDied: true });
    const meta = await h.readMeta();
    expect(meta.last_pass_at).toBe(String(h.clock.ms));
    expect(meta.admin_alerts).toBeUndefined();
  });

  it('Telegram refusing the bot token (401) on an admin alert: telegram-config, no marker', async () => {
    const h = await watched();
    h.at('2026-10-05T01:02:00Z');
    await h.setMeta({ pass_lease: JSON.stringify({ pass: 'died', until: h.clock.ms - 10_000 }) });
    h.telegram.replyTo(ADMIN_CHAT, 401);
    expect(await h.pass()).toMatchObject({ outcome: 'telegram-config' });
    expect((await h.readMeta()).last_pass_at).toBeUndefined();
    expect(h.logs).toContainEqual({ level: 'error', msg: 'telegram rejected the bot token or the site origin is invalid' });
  });
});
