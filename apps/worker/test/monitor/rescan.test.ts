// Rescans by (main key, second key) pair (step 5 spec section 4.5, DECISIONS.md D52): accounts split off a watched one
// are watched from then on, live rows are never touched, closed rows revive, the queue survives every stop.
import { getAddressDecoder, type Address } from '@solana/kit';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StakeAccountSpec } from '../transactions.ts';
import { key, LOCK_UNTIL } from '../transactions.ts';
import { createHarness, type Harness } from './harness.ts';

const MAIN = key(1);
const SECOND = key(2);
const THIEF = key(3);
const NEW_WALLET = key(4);
const S1 = key(10);
const S2 = key(11);
const S3 = key(12);
const SPEC: StakeAccountSpec = { state: 'delegated', staker: MAIN, withdrawer: MAIN, custodian: SECOND, unixTimestamp: LOCK_UNTIL };
const LAMPORTS = 10_000_000_000n;

afterEach(() => {
  vi.restoreAllMocks();
});

/** Distinct addresses beyond key(0..255). */
function addr(i: number, fill = 0x77): Address {
  const bytes = new Uint8Array(32).fill(fill);
  bytes[0] = i >> 8;
  bytes[1] = i & 0xff;
  return getAddressDecoder().decode(bytes);
}

/** S1 watched at 01:00 UTC (no daily pass until 06:00). */
async function watched(): Promise<Harness> {
  const h = createHarness();
  h.at('2026-10-05T01:00:00Z');
  h.chain.putStake(S1, SPEC);
  await h.seedWatched([S1]);
  return h;
}

/** The (main key, second key) pairs of this harness's getProgramAccounts calls, in order. */
function searchedPairs(h: Harness): [string, string][] {
  return h.chain.callsOf('getProgramAccounts').map((call) => {
    const config = call.params[1] as { filters: { dataSize?: number; memcmp?: { offset: number; bytes: string; encoding: string } }[] };
    expect(config.filters[0]).toEqual({ dataSize: 200 });
    const at = (offset: number) => config.filters.find((f) => f.memcmp?.offset === offset)?.memcmp?.bytes ?? '';
    expect(config.filters).toHaveLength(3);
    return [at(44), at(92)];
  });
}

describe('which events search again', () => {
  const CASES: { name: string; change: (h: Harness) => void; searched: boolean }[] = [
    {
      name: 'DEACTIVATED',
      change: (h) => {
        h.chain.putStake(S1, { ...SPEC, deactivationEpoch: 951n });
      },
      searched: true,
    },
    {
      name: 'STAKER_CHANGED',
      change: (h) => {
        h.chain.putStake(S1, { ...SPEC, staker: THIEF });
      },
      searched: true,
    },
    {
      name: 'BALANCE_DECREASED',
      change: (h) => {
        h.chain.putStake(S1, SPEC, LAMPORTS - 1n);
      },
      searched: true,
    },
    {
      name: 'ACCOUNT_CLOSED',
      change: (h) => {
        h.chain.remove(S1);
      },
      searched: true,
    },
    {
      name: 'WITHDRAWER_CHANGED',
      change: (h) => {
        h.chain.putStake(S1, { ...SPEC, withdrawer: NEW_WALLET });
      },
      searched: false,
    },
    {
      name: 'LOCKUP_CHANGED',
      change: (h) => {
        h.chain.putStake(S1, { ...SPEC, unixTimestamp: LOCK_UNTIL + 86_400n });
      },
      searched: false,
    },
  ];
  for (const c of CASES) {
    it(`${c.name}: ${c.searched ? 'the stored pair is searched in the same pass' : 'no search'}`, async () => {
      const h = await watched();
      c.change(h);
      h.at('2026-10-05T01:02:00Z');
      expect(await h.pass()).toMatchObject({ outcome: 'ok', events: 1, rescans: c.searched ? 1 : 0 });
      expect(searchedPairs(h)).toEqual(c.searched ? [[MAIN, SECOND]] : []);
    });
  }

  it('a thief who takes the withdrawer and deactivates: the search uses the stored (old) pair', async () => {
    const h = await watched();
    h.chain.putStake(S1, { ...SPEC, staker: THIEF, withdrawer: THIEF, deactivationEpoch: 951n });
    h.at('2026-10-05T01:02:00Z');
    await h.pass();
    expect(searchedPairs(h)).toEqual([[MAIN, SECOND]]);
  });
});

describe('what a search watches', () => {
  it('a locked account split off: watched from then on without events; an unlocked one is not', async () => {
    const h = await watched();
    h.chain.putStake(S1, SPEC, LAMPORTS - 3_000_000_000n);
    h.chain.putStake(S2, SPEC, 3_000_000_000n);
    // Same keys, but its lock ended yesterday.
    h.chain.putStake(S3, { ...SPEC, unixTimestamp: BigInt(Date.parse('2026-10-04T01:00:00Z') / 1000) }, 1_000_000_000n);
    h.at('2026-10-05T01:02:00Z');
    expect(await h.pass()).toMatchObject({ events: 1, rescans: 1, autoWatched: 1, decoded: 3 });
    expect((await h.readEvents()).map((e) => [e.stake_account, e.type])).toEqual([[S1, 'BALANCE_DECREASED']]);

    const rows = await h.readAccounts();
    expect(rows.map((r) => r.stake_account).sort()).toEqual([S1, S2].sort());
    const s2 = rows.find((r) => r.stake_account === S2);
    expect(s2).toMatchObject({
      withdrawer: MAIN,
      custodian: SECOND,
      lock_until: LOCK_UNTIL.toString(),
      lamports: '3000000000',
      state: 'delegated',
      slot: h.chain.slot,
      checked_at: h.clock.ms,
      last_reminder_days: null,
    });
    expect(s2?.fingerprint).toHaveLength(232);

    h.at('2026-10-05T01:04:00Z');
    expect(await h.pass()).toMatchObject({ rows: 2, fastPath: 2, events: 0, rescans: 0 });
  });

  it('a live row is never overwritten by what a search finds', async () => {
    const h = await watched();
    h.chain.putStake(S2, SPEC);
    await h.seedWatched([S2]);
    // S2's row claims a later read than the chain has: the chunk skips it as stale, the search must not rewrite it.
    await env.DB.prepare('UPDATE accounts SET slot = slot + 1000000 WHERE stake_account = ?1').bind(S2).run();
    const before = (await h.readAccounts()).find((r) => r.stake_account === S2);
    h.chain.putStake(S2, { ...SPEC, deactivationEpoch: 951n });
    h.chain.putStake(S1, { ...SPEC, deactivationEpoch: 951n });
    h.at('2026-10-05T01:02:00Z');
    expect(await h.pass()).toMatchObject({ stale: 1, events: 1, rescans: 1, autoWatched: 0 });
    expect(h.db.journal.map((e) => e.name)).not.toContain('INSERT_WATCHED');
    expect((await h.readAccounts()).find((r) => r.stake_account === S2)).toEqual(before);
  });

  it('a closed row revives from a fresher read', async () => {
    const h = await watched();
    h.chain.putStake(S2, SPEC);
    await h.seedWatched([S2]);
    await env.DB.prepare("UPDATE accounts SET state = 'closed' WHERE stake_account = ?1").bind(S2).run();
    h.chain.putStake(S1, { ...SPEC, deactivationEpoch: 951n });
    h.at('2026-10-05T01:02:00Z');
    expect(await h.pass()).toMatchObject({ rows: 1, events: 1, autoWatched: 1 });
    expect((await h.readAccounts()).find((r) => r.stake_account === S2)).toMatchObject({ state: 'delegated', slot: h.chain.slot });
    expect((await h.readEvents()).map((e) => e.stake_account)).toEqual([S1]);
  });

  it('an answer over the plan limit (100 000 characters on Free) is skipped with a rescan-dropped alert', async () => {
    const h = await watched();
    const big = key(30);
    for (let i = 0; i < 300; i++) h.chain.putStake(addr(i), { ...SPEC, staker: big, withdrawer: big });
    await h.setMeta({ rescan_queue: JSON.stringify([[big, SECOND], [MAIN, SECOND]]) });
    h.at('2026-10-05T01:02:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'ok', rescans: 2, rescansDropped: 1, autoWatched: 0, rescanQueue: 0 });
    expect(searchedPairs(h)).toEqual([
      [big, SECOND],
      [MAIN, SECOND],
    ]);
    expect(h.adminMessages()).toEqual(['Stakeward devnet monitor: a rescan answer over 100 KB was skipped.']);
    expect((await h.readMeta()).rescan_queue).toBe('[]');
  });
});

describe('the queue survives every stop', () => {
  it('past the soft deadline: no search, the urgent pair waits in meta for the next pass', async () => {
    const h = await watched();
    h.chain.putStake(S1, { ...SPEC, deactivationEpoch: 951n });
    let shifted = false;
    h.chain.onCall((call) => {
      if (shifted || call.method !== 'getMultipleAccounts') return;
      shifted = true;
      h.advance(70_000);
    });
    h.at('2026-10-05T01:02:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'ok', events: 1, rescans: 0, rescanQueue: 1 });
    expect(JSON.parse((await h.readMeta()).rescan_queue ?? '')).toEqual([[MAIN, SECOND]]);

    h.at('2026-10-05T01:04:00Z');
    expect(await h.pass()).toMatchObject({ rescans: 1, rescanQueue: 0 });
    expect(searchedPairs(h)).toEqual([[MAIN, SECOND]]);
    expect((await h.readMeta()).rescan_queue).toBe('[]');
  });

  it('a failed search keeps its pair at the head and stops the search', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = await watched();
    const queue = [
      [key(20), SECOND],
      [key(21), SECOND],
    ];
    await h.setMeta({ rescan_queue: JSON.stringify(queue) });
    h.chain.failNext('getProgramAccounts', [503, 'network-error', { rpcError: -32005 }]);
    h.at('2026-10-05T01:02:00Z');
    // A JSON-RPC error answers with HTTP 200: callUpstream returns it and the parse fails, like a refusal.
    expect(await h.pass()).toMatchObject({ outcome: 'ok', rescans: 1, rescanQueue: 2 });
    expect(JSON.parse((await h.readMeta()).rescan_queue ?? '')).toEqual(queue);

    h.at('2026-10-05T01:04:00Z');
    expect(await h.pass()).toMatchObject({ rescans: 2, rescanQueue: 0 });
  });

  it('at most maxRescans searches a pass (3 on Free); the rest wait in order', async () => {
    const h = await watched();
    const queue = [20, 21, 22, 23, 24].map((n) => [key(n), SECOND]);
    await h.setMeta({ rescan_queue: JSON.stringify(queue) });
    h.at('2026-10-05T01:02:00Z');
    expect(await h.pass()).toMatchObject({ rescans: 3, rescanQueue: 2 });
    expect(JSON.parse((await h.readMeta()).rescan_queue ?? '')).toEqual(queue.slice(3));
    h.at('2026-10-05T01:04:00Z');
    expect(await h.pass()).toMatchObject({ rescans: 2, rescanQueue: 0 });
  });

  it('the decode cap (20 on Free): the pair goes to the back and the next search takes the rest', async () => {
    const h = await watched();
    for (let i = 0; i < 25; i++) h.chain.putStake(addr(i), SPEC, 1_000_000_000n);
    await h.setMeta({ rescan_queue: JSON.stringify([[MAIN, SECOND]]) });
    h.at('2026-10-05T01:02:00Z');
    expect(await h.pass()).toMatchObject({ rescans: 1, decoded: 20, autoWatched: 20, rescanQueue: 1 });
    h.at('2026-10-05T01:04:00Z');
    expect(await h.pass()).toMatchObject({ rows: 21, fastPath: 21, rescans: 1, decoded: 5, autoWatched: 5, rescanQueue: 0 });
    expect(await h.readAccounts()).toHaveLength(26);
    expect(await h.readEvents()).toEqual([]);
  });

  it('accounts a search rejects do not hold the pair at the cap: the next search goes on after them', async () => {
    const h = await watched();
    // 25 accounts of the pair whose lock ended (a Split after the lock ran out, or planted by anyone: Initialize needs
    // no signature of the keys), then one locked split that comes last in address order.
    const ended = BigInt(Date.parse('2026-10-04T01:00:00Z') / 1000);
    const addresses = Array.from({ length: 26 }, (_, i) => addr(i)).sort();
    const late = addresses.at(-1) ?? S1;
    for (const at of addresses.slice(0, -1)) h.chain.putStake(at, { ...SPEC, unixTimestamp: ended }, 1_000_000_000n);
    h.chain.putStake(late, SPEC, 1_000_000_000n);
    // A pair queued behind it, with one locked split of its own.
    const otherMain = key(6);
    h.chain.putStake(addr(0, 0x78), { ...SPEC, staker: otherMain, withdrawer: otherMain }, 1_000_000_000n);
    await h.setMeta({ rescan_queue: JSON.stringify([[MAIN, SECOND], [otherMain, SECOND]]) });

    h.at('2026-10-05T01:02:00Z');
    expect(await h.pass()).toMatchObject({ rescans: 2, decoded: 20, autoWatched: 0, rescanQueue: 2 });
    // The pair waits with the last account that search got through: the one before the 21st unknown, by address.
    const answer = [S1, ...addresses].sort();
    const stop = answer.filter((at) => at !== S1)[20];
    const reached = stop === undefined ? undefined : answer[answer.indexOf(stop) - 1];
    expect(JSON.parse((await h.readMeta()).rescan_queue ?? '')).toEqual([
      [MAIN, SECOND, reached],
      [otherMain, SECOND],
    ]);
    h.at('2026-10-05T01:04:00Z');
    expect(await h.pass()).toMatchObject({ rescans: 2, decoded: 7, autoWatched: 2, rescanQueue: 0 });
    expect((await h.readAccounts()).map((r) => r.stake_account).sort()).toEqual([S1, late, addr(0, 0x78)].sort());
    expect((await h.readMeta()).rescan_queue).toBe('[]');
    expect(searchedPairs(h)).toHaveLength(4);
  });
});

describe('the daily pass', () => {
  it('queues every (main key, second key) pair once a day', async () => {
    const h = createHarness();
    h.at('2026-10-05T05:50:00Z');
    h.chain.putStake(S1, SPEC);
    h.chain.putStake(S2, SPEC);
    h.chain.putStake(S3, { ...SPEC, custodian: key(5) });
    await h.seedWatched([S1, S2, S3]);

    h.at('2026-10-05T05:58:00Z');
    expect(await h.pass()).toMatchObject({ daily: false, rescans: 0 });
    h.at('2026-10-05T06:02:00Z');
    expect(await h.pass()).toMatchObject({ daily: true, rescans: 2, rescanQueue: 0 });
    const pairs = [
      [MAIN, SECOND],
      [MAIN, key(5)],
    ].sort((a, b) => (`${a[0] ?? ''}/${a[1] ?? ''}` < `${b[0] ?? ''}/${b[1] ?? ''}` ? -1 : 1));
    expect(searchedPairs(h)).toEqual(pairs);
    h.at('2026-10-05T06:04:00Z');
    expect(await h.pass()).toMatchObject({ daily: false, rescans: 0 });
    h.at('2026-10-06T06:01:00Z');
    expect(await h.pass()).toMatchObject({ daily: true, rescans: 2 });
    expect(searchedPairs(h)).toEqual([...pairs, ...pairs]);
  });
});
