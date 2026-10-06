// Done-when of step 5: every event appears once and never again (monitor passes against the fake chain and the
// real local D1).
import type { Address } from '@solana/kit';
import { GENESIS_HASH, I64_MAX, type MonitorEventType } from '@stakeward/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FALLBACK_URL, MONITOR_URL } from '../fakes.ts';
import type { StakeAccountSpec } from '../transactions.ts';
import { key, LOCK_UNTIL } from '../transactions.ts';
import { FakeChain } from './fake-chain.ts';
import { createHarness, type Harness } from './harness.ts';

const MAIN = key(1);
const SECOND = key(2);
const THIEF = key(3);
const NEW_WALLET = key(4);
const OTHER_SECOND = key(5);
const VOTER = key(42);
const OTHER_VOTER = key(43);
const STAKE = key(10);
const DAY_S = 86_400n;

const SPEC: StakeAccountSpec = {
  state: 'delegated',
  staker: MAIN,
  withdrawer: MAIN,
  custodian: SECOND,
  unixTimestamp: LOCK_UNTIL,
  voter: VOTER,
  activationEpoch: 800n,
};
const LAMPORTS = 10_000_000_000n;

afterEach(() => {
  vi.restoreAllMocks();
});

/** Quiet console: callUpstream warns on every failed attempt. */
function quiet() {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
}

/** Statements of the journal from `from` on that wrote events or rows. */
function writes(h: Harness, from: number) {
  return h.db.journal.slice(from).filter((e) => e.name === 'CHUNK_EVENTS' || e.name === 'CHUNK_UPDATE' || e.name === 'INSERT_WATCHED');
}

/** Watches STAKE (as POST /api/watch would) at 12:00 UTC, before 06:00 the next day: no daily pass in the way. */
async function watched(spec: StakeAccountSpec = SPEC, lamports = LAMPORTS): Promise<Harness> {
  const h = createHarness();
  h.at('2026-10-05T01:00:00Z');
  h.chain.putStake(STAKE, spec, lamports);
  await h.seedWatched([STAKE]);
  return h;
}

type Case = {
  name: string;
  change: (h: Harness) => void;
  type: MonitorEventType;
  details: unknown;
};

const CASES: Case[] = [
  {
    name: 'deactivated',
    change: (h) => {
      h.chain.putStake(STAKE, { ...SPEC, deactivationEpoch: 951n });
    },
    type: 'DEACTIVATED',
    details: { deactivationEpoch: '951' },
  },
  {
    name: 'delegated to another validator',
    change: (h) => {
      h.chain.putStake(STAKE, { ...SPEC, voter: OTHER_VOTER });
    },
    type: 'DELEGATION_CHANGED',
    details: { fromVoter: VOTER, toVoter: OTHER_VOTER },
  },
  {
    name: 'staker changed',
    change: (h) => {
      h.chain.putStake(STAKE, { ...SPEC, staker: THIEF });
    },
    type: 'STAKER_CHANGED',
    details: { from: MAIN, to: THIEF },
  },
  {
    name: 'withdrawer changed',
    change: (h) => {
      h.chain.putStake(STAKE, { ...SPEC, withdrawer: NEW_WALLET });
    },
    type: 'WITHDRAWER_CHANGED',
    details: { from: MAIN, to: NEW_WALLET },
  },
  {
    name: 'lock extended',
    change: (h) => {
      h.chain.putStake(STAKE, { ...SPEC, unixTimestamp: LOCK_UNTIL + 30n * DAY_S });
    },
    type: 'LOCKUP_CHANGED',
    details: {
      changes: ['extended'],
      fromLockUntil: LOCK_UNTIL.toString(),
      toLockUntil: (LOCK_UNTIL + 30n * DAY_S).toString(),
      fromCustodian: SECOND,
      toCustodian: SECOND,
    },
  },
  {
    name: 'lock shortened',
    change: (h) => {
      h.chain.putStake(STAKE, { ...SPEC, unixTimestamp: LOCK_UNTIL - 30n * DAY_S });
    },
    type: 'LOCKUP_CHANGED',
    details: {
      changes: ['shortened'],
      fromLockUntil: LOCK_UNTIL.toString(),
      toLockUntil: (LOCK_UNTIL - 30n * DAY_S).toString(),
      fromCustodian: SECOND,
      toCustodian: SECOND,
    },
  },
  {
    name: 'lock removed',
    change: (h) => {
      h.chain.putStake(STAKE, { ...SPEC, unixTimestamp: 0n });
    },
    type: 'LOCKUP_CHANGED',
    details: { changes: ['removed'], fromLockUntil: LOCK_UNTIL.toString(), toLockUntil: '0', fromCustodian: SECOND, toCustodian: SECOND },
  },
  {
    name: 'second key changed',
    change: (h) => {
      h.chain.putStake(STAKE, { ...SPEC, custodian: OTHER_SECOND });
    },
    type: 'LOCKUP_CHANGED',
    details: {
      changes: ['custodian-changed'],
      fromLockUntil: LOCK_UNTIL.toString(),
      toLockUntil: LOCK_UNTIL.toString(),
      fromCustodian: SECOND,
      toCustodian: OTHER_SECOND,
    },
  },
  {
    name: 'balance decreased',
    change: (h) => {
      h.chain.putStake(STAKE, SPEC, LAMPORTS - 1_000_000_000n);
    },
    type: 'BALANCE_DECREASED',
    details: { fromLamports: LAMPORTS.toString(), toLamports: (LAMPORTS - 1_000_000_000n).toString() },
  },
  {
    name: 'account closed',
    change: (h) => {
      h.chain.remove(STAKE);
    },
    type: 'ACCOUNT_CLOSED',
    details: {},
  },
];

describe('each event once', () => {
  for (const c of CASES) {
    it(`${c.name}: ${c.type} once with its details, nothing on the next pass`, async () => {
      const h = await watched();
      h.at('2026-10-05T01:02:00Z');
      expect(await h.pass()).toMatchObject({ outcome: 'ok', fastPath: 1, events: 0 });

      c.change(h);
      h.at('2026-10-05T01:04:00Z');
      const second = await h.pass();
      expect(second).toMatchObject({ outcome: 'ok', events: 1 });
      const events = await h.readEvents();
      expect(events.map((e) => [e.stake_account, e.type, e.details])).toEqual([[STAKE, c.type, c.details]]);
      expect(events[0]?.slot).toBe(h.chain.slot);

      h.at('2026-10-05T01:06:00Z');
      const before = h.db.journal.length;
      const accounts = await h.readAccounts();
      expect(await h.pass()).toMatchObject({ outcome: 'ok', events: 0 });
      expect(await h.readEvents()).toEqual(events);
      expect(writes(h, before)).toEqual([]);
      expect(await h.readAccounts()).toEqual(accounts);
    });
  }

  it('the lock end passing with unchanged data: the fast path hands the row to the diff, EXPIRED once', async () => {
    const h = createHarness();
    h.at('2027-04-12T23:58:00Z');
    h.chain.putStake(STAKE, SPEC);
    await h.seedWatched([STAKE]);
    h.at('2027-04-12T23:59:59Z');
    expect(await h.pass()).toMatchObject({ fastPath: 1, events: 0 });
    h.at('2027-04-13T00:01:59Z');
    expect(await h.pass()).toMatchObject({ fastPath: 0, decoded: 1, events: 1 });
    expect((await h.readEvents()).map((e) => [e.type, e.details])).toEqual([['EXPIRED', { lockUntil: LOCK_UNTIL.toString() }]]);
    h.at('2027-04-13T00:03:59Z');
    expect(await h.pass()).toMatchObject({ fastPath: 1, events: 0 });
    expect(await h.readEvents()).toHaveLength(1);
  });

  it('ACCOUNT_CLOSED once; the closed row is not read again', async () => {
    const h = await watched();
    h.chain.remove(STAKE);
    h.at('2026-10-05T01:02:00Z');
    expect(await h.pass()).toMatchObject({ closed: 1, events: 1 });
    expect((await h.readAccounts())[0]?.state).toBe('closed');

    const calls = h.chain.callsOf('getMultipleAccounts').length;
    h.at('2026-10-05T01:04:00Z');
    expect(await h.pass()).toMatchObject({ rows: 0, chunks: 0, events: 0 });
    expect(h.chain.callsOf('getMultipleAccounts')).toHaveLength(calls);
    expect((await h.readEvents()).map((e) => e.type)).toEqual(['ACCOUNT_CLOSED']);
  });

  it('a lock at i64::MAX: three passes, no LOCKUP_CHANGED, exact in D1', async () => {
    const h = createHarness();
    h.at('2026-10-05T01:00:00Z');
    const decodedOnce = key(11);
    h.chain.putStake(STAKE, { ...SPEC, unixTimestamp: I64_MAX });
    h.chain.putStake(decodedOnce, { ...SPEC, unixTimestamp: I64_MAX });
    await h.seedWatched([STAKE]);
    // No fingerprint: the first pass decodes it and compares the lock end as a bigint.
    await h.seedWatched([decodedOnce], { fingerprint: false });
    for (const minute of ['02', '04', '06']) {
      h.at(`2026-10-05T01:${minute}:00Z`);
      expect(await h.pass()).toMatchObject({ outcome: 'ok', events: 0 });
    }
    expect(await h.readEvents()).toEqual([]);
    expect((await h.readAccounts()).map((a) => a.lock_until)).toEqual([I64_MAX.toString(), I64_MAX.toString()]);
  });
});

describe('exactly once under failures and overlapping passes', () => {
  it('a chunk commit that fails: the next pass writes the same events once', async () => {
    const h = await watched();
    h.chain.putStake(STAKE, { ...SPEC, staker: THIEF, deactivationEpoch: 951n });
    h.db.failWhen = (entry) => entry.name === 'CHUNK_EVENTS';
    h.at('2026-10-05T01:02:00Z');
    await expect(h.pass()).rejects.toThrow(/D1_ERROR/);
    expect(await h.readEvents()).toEqual([]);

    h.db.failWhen = null;
    h.at('2026-10-05T01:04:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'ok', events: 2 });
    h.at('2026-10-05T01:06:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'ok', events: 0 });
    expect((await h.readEvents()).map((e) => e.type)).toEqual(['DEACTIVATED', 'STAKER_CHANGED']);
  });

  it('a pass paused past its lease: the next pass does the work, the late one adds nothing and its meta is fenced', async () => {
    quiet();
    const h = await watched();
    h.chain.putStake(STAKE, { ...SPEC, deactivationEpoch: 951n });
    const pause = pausedRead(h);

    h.at('2026-10-05T01:02:00Z');
    const t0a = h.clock.ms;
    const late = h.pass();
    await pause.reached;
    // A is stuck after its read; its 110 s lease runs out and B takes over.
    h.advance(111_000);
    const t0b = h.clock.ms;
    expect(await h.pass()).toMatchObject({ outcome: 'ok', previousDied: true, events: 1 });
    pause.release();
    const a = await late;
    expect(a.events).toBe(0);

    expect((await h.readEvents()).map((e) => e.type)).toEqual(['DEACTIVATED']);
    const meta = await h.readMeta();
    expect(JSON.parse(meta.pass_lease ?? '')).toEqual({ pass: 'pass-2', until: 0 });
    expect(meta.last_pass_at).toBe(String(t0b));
    expect(Number(meta.last_pass_at)).toBeGreaterThan(t0a);
  });

  it('two lock extensions around overlapping passes: two events, neither lost nor doubled', async () => {
    quiet();
    const h = await watched();
    const first = LOCK_UNTIL + 10n * DAY_S;
    const second = LOCK_UNTIL + 20n * DAY_S;
    h.chain.putStake(STAKE, { ...SPEC, unixTimestamp: first });
    const pause = pausedRead(h);

    h.at('2026-10-05T01:02:00Z');
    const late = h.pass();
    await pause.reached;
    h.advance(111_000);
    expect(await h.pass()).toMatchObject({ events: 1 });
    // The second extension lands while A still holds its stale read of the first.
    h.advance(5_000);
    h.chain.putStake(STAKE, { ...SPEC, unixTimestamp: second });
    pause.release();
    expect(await late).toMatchObject({ events: 0 });

    h.advance(120_000);
    expect(await h.pass()).toMatchObject({ events: 1 });
    const events = await h.readEvents();
    expect(events.map((e) => (e.details as { fromLockUntil: string; toLockUntil: string }))).toEqual([
      expect.objectContaining({ fromLockUntil: LOCK_UNTIL.toString(), toLockUntil: first.toString() }),
      expect.objectContaining({ fromLockUntil: first.toString(), toLockUntil: second.toString() }),
    ]);
    expect(new Set(events.map((e) => e.slot)).size).toBe(2);
  });

  it('a lagging node (the read is older than the row): no event, no write', async () => {
    const h = await watched();
    h.chain.putStake(STAKE, { ...SPEC, deactivationEpoch: 951n });
    h.chain.lagBy(1_000);
    h.at('2026-10-05T01:02:00Z');
    const before = h.db.journal.length;
    expect(await h.pass()).toMatchObject({ outcome: 'ok', stale: 1, events: 0 });
    expect(writes(h, before)).toEqual([]);
    h.chain.lagBy(0);
    h.at('2026-10-05T01:04:00Z');
    expect(await h.pass()).toMatchObject({ events: 1 });
  });
});

describe('accounts gone and the genesis check', () => {
  const STAKES = [10, 11, 12, 13].map((n) => key(n));

  async function allGone(): Promise<Harness> {
    const h = createHarness();
    h.at('2026-10-05T01:00:00Z');
    for (const address of STAKES) h.chain.putStake(address, SPEC);
    await h.seedWatched(STAKES);
    for (const address of STAKES) h.chain.remove(address);
    return h;
  }

  it('another cluster behind RPC_URL: no ACCOUNT_CLOSED, read-failed, the wrong-cluster alert, no marker', async () => {
    const h = await allGone();
    h.chain.genesis('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d');
    h.at('2026-10-05T01:02:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'read-failed', chunks: 0, chunksFailed: 1, events: 0 });
    expect(await h.readEvents()).toEqual([]);
    expect((await h.readAccounts()).every((a) => a.state === 'delegated')).toBe(true);
    expect(h.chain.callsOf('getGenesisHash')).toHaveLength(1);
    expect(h.adminMessages()).toEqual([
      'Stakeward devnet monitor: RPC_URL answers for another cluster. Account closures were not recorded.',
    ]);
    expect((await h.readMeta()).last_pass_at).toBeUndefined();
  });

  it('a genesis hash that cannot be read fails the chunk too', async () => {
    quiet();
    const h = await allGone();
    h.chain.failNext('getGenesisHash', [503, 503, 503]);
    h.at('2026-10-05T01:02:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'read-failed', events: 0 });
    expect(h.adminMessages()).toEqual([]);
  });

  it('the right cluster: the accounts are really gone, each closed once', async () => {
    const h = await allGone();
    h.at('2026-10-05T01:02:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'ok', closed: 4, events: 4 });
    expect(h.chain.callsOf('getGenesisHash')).toHaveLength(1);
    const events = await h.readEvents();
    expect(events.map((e) => e.type)).toEqual(Array<string>(4).fill('ACCOUNT_CLOSED'));
    expect(new Set(events.map((e) => e.stake_account))).toEqual(new Set<Address>(STAKES));
  });

  /** STAKES watched, with RPC_FALLBACK_URL on a node of its own (`fallback`) at a later slot. */
  async function withFallback(fallback: FakeChain): Promise<Harness> {
    const h = createHarness({ env: { RPC_FALLBACK_URL: FALLBACK_URL }, fallback });
    h.at('2026-10-05T01:00:00Z');
    for (const address of STAKES) h.chain.putStake(address, SPEC);
    await h.seedWatched(STAKES);
    h.at('2026-10-05T01:02:00Z');
    fallback.slot = h.chain.slot + 50_000_000;
    fallback.clock = { ...h.chain.clock };
    return h;
  }

  it('a fallback on another cluster answers the chunk after one 503: its genesis is checked, nothing closed', async () => {
    quiet();
    const fallback = new FakeChain();
    fallback.genesis(GENESIS_HASH.mainnet);
    const h = await withFallback(fallback);
    h.chain.failNext('getMultipleAccounts', [503]);
    expect(await h.pass()).toMatchObject({ outcome: 'read-failed', closed: 0, events: 0 });
    expect(fallback.callsOf('getGenesisHash')).toHaveLength(1);
    expect(h.chain.callsOf('getGenesisHash')).toEqual([]);
    expect(await h.readEvents()).toEqual([]);
    expect((await h.readAccounts()).every((a) => a.state === 'delegated')).toBe(true);
    // The admin is sent to the secret that answered, not to RPC_URL.
    expect(h.adminMessages()).toEqual([
      'Stakeward devnet monitor: RPC_FALLBACK_URL answers for another cluster. Account closures were not recorded.',
    ]);
  });

  it('RPC_URL on another cluster, a 503 on its genesis: the right fallback does not answer for it', async () => {
    quiet();
    const fallback = new FakeChain();
    const h = await withFallback(fallback);
    for (const address of STAKES) {
      const account = h.chain.accounts.get(address);
      if (account !== undefined) fallback.set(address, account);
      h.chain.remove(address);
    }
    h.chain.genesis(GENESIS_HASH.mainnet);
    h.chain.failNext('getGenesisHash', [503]);
    expect(await h.pass()).toMatchObject({ outcome: 'read-failed', closed: 0, events: 0 });
    expect(fallback.callsOf('getGenesisHash')).toEqual([]);
    expect(await h.readEvents()).toEqual([]);
  });

  for (const watchedRows of [1, 2]) {
    it(`${String(watchedRows)} of ${String(watchedRows)} rows gone: another cluster closes nothing, the right one closes them`, async () => {
      const h = createHarness();
      h.at('2026-10-05T01:00:00Z');
      const some = STAKES.slice(0, watchedRows);
      for (const address of some) h.chain.putStake(address, SPEC);
      await h.seedWatched(some);
      for (const address of some) h.chain.remove(address);
      h.chain.genesis(GENESIS_HASH.mainnet);
      h.at('2026-10-05T01:02:00Z');
      expect(await h.pass()).toMatchObject({ outcome: 'read-failed', closed: 0, events: 0 });
      expect(h.chain.callsOf('getGenesisHash')).toHaveLength(1);
      expect(await h.readEvents()).toEqual([]);

      h.chain.genesis(GENESIS_HASH.devnet);
      h.at('2026-10-05T01:04:00Z');
      expect(await h.pass()).toMatchObject({ outcome: 'ok', closed: watchedRows, events: watchedRows });
      expect(h.chain.callsOf('getGenesisHash')).toHaveLength(2);
    });
  }
});

describe("MONITOR_RPC_URL: the monitor's own RPC key", () => {
  const STAKES = [10, 11, 12, 13].map((n) => key(n));
  const rpcHosts = (h: Harness) => h.net.calls.map((call) => call.host).filter((host) => host.endsWith('.rpc.test'));

  /** STAKE watched and then deactivated, with MONITOR_RPC_URL (and `env`) set: the next pass has an event to find. */
  async function deactivated(env: Record<string, string> = {}): Promise<Harness> {
    const h = createHarness({ env: { MONITOR_RPC_URL: MONITOR_URL, ...env } });
    h.at('2026-10-05T01:00:00Z');
    h.chain.putStake(STAKE, SPEC);
    await h.seedWatched([STAKE]);
    h.chain.putStake(STAKE, { ...SPEC, deactivationEpoch: 951n });
    h.at('2026-10-05T01:02:00Z');
    return h;
  }

  it('the pass reads the chain through it, rescans included, never through the site RPC_URL', async () => {
    const h = await deactivated();
    expect(await h.pass()).toMatchObject({ outcome: 'ok', events: 1 });
    expect(h.chain.callsOf('getProgramAccounts').length).toBeGreaterThan(0);
    expect(rpcHosts(h).length).toBeGreaterThan(1);
    expect(new Set(rpcHosts(h))).toEqual(new Set(['monitor.rpc.test']));
  });

  for (const [env, second] of [
    [{}, 'primary'],
    [{ RPC_FALLBACK_URL: FALLBACK_URL }, 'fallback'],
  ] as const) {
    it(`when it fails, ${second === 'primary' ? 'the site RPC_URL reads (no RPC_FALLBACK_URL)' : 'RPC_FALLBACK_URL reads'}`, async () => {
      quiet();
      const h = await deactivated(env);
      h.chain.failNext('getMultipleAccounts', [503]);
      expect(await h.pass()).toMatchObject({ outcome: 'ok', events: 1 });
      const reads = h.chain.callsOf('getMultipleAccounts').map((call) => [call.endpoint, call.outcome]);
      expect(reads).toEqual([
        ['monitor', 503],
        [second, 'answer'],
      ]);
    });
  }

  for (const wrong of ['MONITOR_RPC_URL', 'RPC_URL'] as const) {
    it(`${wrong} on another cluster answers the chunk: its genesis is checked, nothing closed, the admin is told ${wrong}`, async () => {
      quiet();
      // The site's RPC_URL (h.chain) is the monitor's fallback here; the accounts are gone on the wrong node only.
      const monitor = new FakeChain();
      const h = createHarness({ env: { MONITOR_RPC_URL: MONITOR_URL }, monitor });
      h.at('2026-10-05T01:00:00Z');
      for (const address of STAKES) h.chain.putStake(address, SPEC);
      await h.seedWatched(STAKES);
      h.at('2026-10-05T01:02:00Z');
      monitor.slot = h.chain.slot;
      monitor.clock = { ...h.chain.clock };
      if (wrong === 'MONITOR_RPC_URL') {
        monitor.genesis(GENESIS_HASH.mainnet);
      } else {
        for (const address of STAKES) {
          const account = h.chain.accounts.get(address);
          if (account !== undefined) monitor.set(address, account);
          h.chain.remove(address);
        }
        h.chain.genesis(GENESIS_HASH.mainnet);
        monitor.failNext('getMultipleAccounts', [503]);
      }
      expect(await h.pass()).toMatchObject({ outcome: 'read-failed', closed: 0, events: 0 });
      expect(await h.readEvents()).toEqual([]);
      expect((await h.readAccounts()).every((a) => a.state === 'delegated')).toBe(true);
      expect(monitor.callsOf('getGenesisHash')).toHaveLength(wrong === 'MONITOR_RPC_URL' ? 1 : 0);
      expect(h.chain.callsOf('getGenesisHash')).toHaveLength(wrong === 'MONITOR_RPC_URL' ? 0 : 1);
      expect(h.adminMessages()).toEqual([
        `Stakeward devnet monitor: ${wrong} answers for another cluster. Account closures were not recorded.`,
      ]);
    });
  }
});

/** Pauses the first getMultipleAccounts after its answer is computed (a pass stuck right after its read). */
function pausedRead(h: Harness) {
  let release!: () => void;
  let reached!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reachedPromise = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let first = true;
  h.chain.onCall(async (call) => {
    if (!first || call.method !== 'getMultipleAccounts') return;
    first = false;
    reached();
    await released;
  });
  return { reached: reachedPromise, release };
}
