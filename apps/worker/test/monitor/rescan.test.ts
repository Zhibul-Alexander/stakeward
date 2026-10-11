// Rescans by (main key, second key) pair (step 5 spec section 4.5, DECISIONS.md D59): accounts split off a watched one
// are watched from then on, live rows are never touched, closed rows revive, the queue survives every stop.
import { getAddressDecoder, type Address } from '@solana/kit';
import { SYSVAR_CLOCK_ADDRESS } from '@stakeward/core';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MONITOR_PLANS } from '../../src/monitor/config.ts';
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
/** The Free plan's decode cap per pass (the harness runs the Free preset), and a quarter of it: what is left over for the next pass. */
const CAP = MONITOR_PLANS.free.decodeCap;
const OVER = Math.ceil(CAP / 4);

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

describe('the CPU of the answers (Free: 10 ms a pass)', () => {
  it('a pass parses at most rescanParseChars of answers: after a large one the next pair waits for the next pass', async () => {
    const h = await watched();
    // 150 accounts of one pair, already watched (nothing to decode): an answer of about 70 000 characters.
    const big = key(30);
    const addresses = Array.from({ length: 150 }, (_, i) => addr(i));
    for (const at of addresses) h.chain.putStake(at, { ...SPEC, staker: big, withdrawer: big });
    await h.seedWatched(addresses);
    await h.setMeta({ rescan_queue: JSON.stringify([[big, SECOND], [MAIN, SECOND]]) });
    h.at('2026-10-05T01:02:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'ok', rescans: 1, rescansDropped: 0, rescanQueue: 1 });
    expect(JSON.parse((await h.readMeta()).rescan_queue ?? '')).toEqual([[MAIN, SECOND]]);
    h.at('2026-10-05T01:04:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'ok', rescans: 1, rescanQueue: 0 });
    expect(searchedPairs(h)).toEqual([
      [big, SECOND],
      [MAIN, SECOND],
    ]);
  });

  it('an answer over the limit is not read whole: the search stops reading it and drops the pair', async () => {
    const h = await watched();
    await h.setMeta({ rescan_queue: JSON.stringify([[MAIN, SECOND]]) });
    // 4 MB in 16 KB chunks.
    let pulls = 0;
    const huge = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        pulls += 1;
        controller.enqueue(new Uint8Array(16_384).fill(0x20));
        if (pulls === 256) controller.close();
      },
    });
    const route = h.deps.fetch;
    h.deps.fetch = (input, init) =>
      typeof init?.body === 'string' && init.body.includes('getProgramAccounts')
        ? Promise.resolve(new Response(huge, { headers: { 'Content-Type': 'application/json' } }))
        : route(input, init);
    h.at('2026-10-05T01:02:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'ok', rescans: 1, rescansDropped: 1, rescanQueue: 0 });
    expect(pulls).toBeLessThan(10);
    expect(h.adminMessages()).toEqual(['Stakeward devnet monitor: a rescan answer over 100 KB was skipped.']);
  });
});

describe('the queue survives every stop', () => {
  /** S1 deactivated and split: S2 has the same keys and lock. MAIN follows in a chat, so the sends load links too. */
  async function splitOff(): Promise<Harness> {
    const h = await watched();
    await h.linkChat(MAIN, '100001');
    h.chain.putStake(S1, { ...SPEC, deactivationEpoch: 951n }, LAMPORTS - 3_000_000_000n);
    h.chain.putStake(S2, { ...SPEC, deactivationEpoch: 951n }, 3_000_000_000n);
    return h;
  }

  it('the urgent pair is stored with the chunk; a pass that searched it leaves the queue empty', async () => {
    const h = await splitOff();
    h.at('2026-10-05T01:02:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'ok', rescans: 1, autoWatched: 1, rescanQueue: 0 });
    const chunkCommit = h.db.journal.find((e) => e.name === 'CHUNK_EVENTS')?.call;
    const stored = h.db.journal.find((e) => e.call === chunkCommit && e.name === 'PUT_META');
    expect(JSON.parse(String(stored?.args[0]))).toMatchObject({ rescan_queue: JSON.stringify([[MAIN, SECOND]]) });
    expect((await h.readMeta()).rescan_queue).toBe('[]');
  });

  for (const failing of ['PENDING', 'LINKS_FOR', 'KNOWN_LIVE'] as const) {
    it(`a pass that fails after the chunk commit (at ${failing}): the next pass searches the urgent pair`, async () => {
      const h = await splitOff();
      h.db.failWhen = (entry) => entry.name === failing;
      h.at('2026-10-05T01:02:00Z');
      await expect(h.pass()).rejects.toThrow(/D1_ERROR/);
      expect(JSON.parse((await h.readMeta()).rescan_queue ?? '')).toEqual([[MAIN, SECOND]]);

      h.db.failWhen = null;
      h.at('2026-10-05T01:04:00Z');
      expect(await h.pass()).toMatchObject({ outcome: 'ok', rescans: 1, autoWatched: 1, rescanQueue: 0 });
      expect((await h.readAccounts()).map((r) => r.stake_account).sort()).toEqual([S1, S2].sort());
    });
  }

  it('no live row left to read: the Clock alone is read, the queued pair searched and the closed row revived', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = await watched();
    // A node answers null for S1 and the search in the same pass fails: S1 is closed, its pair waits.
    h.chain.remove(S1);
    h.chain.failNext('getProgramAccounts', [503, 503, 503]);
    h.at('2026-10-05T01:02:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'ok', closed: 1, rescans: 1, rescanQueue: 1 });

    h.chain.putStake(S1, SPEC);
    h.at('2026-10-05T01:04:00Z');
    const calls = h.chain.calls.length;
    expect(await h.pass()).toMatchObject({ outcome: 'ok', rows: 0, chunks: 0, rescans: 1, autoWatched: 1, rescanQueue: 0 });
    const clockRead = h.chain.calls.slice(calls).find((c) => c.method === 'getMultipleAccounts');
    expect(clockRead?.keys).toEqual([SYSVAR_CLOCK_ADDRESS]);
    expect((await h.readAccounts())[0]).toMatchObject({ stake_account: S1, state: 'delegated' });

    h.at('2026-10-05T01:06:00Z');
    expect(await h.pass()).toMatchObject({ rows: 1, fastPath: 1, rescans: 0 });
  });

  it('an empty queue and no live row: nothing is read from the chain (the webhook is still checked)', async () => {
    const h = createHarness();
    h.at('2026-10-05T01:02:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'ok', rows: 0, rescans: 0, fetches: 1 });
    expect(h.chain.calls).toEqual([]);
    expect(h.telegram.identityCalls.map((call) => call.method)).toEqual(['getWebhookInfo']);
  });

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

  it('the decode cap: the pair goes to the back and the next search takes the rest', async () => {
    const h = await watched();
    // More locked splits than one pass may decode: the cap, and a quarter of it over.
    for (let i = 0; i < CAP + OVER; i++) h.chain.putStake(addr(i), SPEC, 1_000_000_000n);
    await h.setMeta({ rescan_queue: JSON.stringify([[MAIN, SECOND]]) });
    h.at('2026-10-05T01:02:00Z');
    expect(await h.pass()).toMatchObject({ rescans: 1, decoded: CAP, autoWatched: CAP, rescanQueue: 1 });
    h.at('2026-10-05T01:04:00Z');
    expect(await h.pass()).toMatchObject({
      rows: 1 + CAP,
      fastPath: 1 + CAP,
      rescans: 1,
      decoded: OVER,
      autoWatched: OVER,
      rescanQueue: 0,
    });
    expect(await h.readAccounts()).toHaveLength(1 + CAP + OVER);
    expect(await h.readEvents()).toEqual([]);
  });

  it('the chunk and the rescans share the decode cap: half of it decoded in the chunk leaves the other half for the splits', async () => {
    const h = createHarness();
    h.at('2026-10-05T01:00:00Z');
    const inChunk = Math.floor(CAP / 2);
    const forSplits = CAP - inChunk;
    expect(inChunk).toBeGreaterThan(0);
    const rows = Array.from({ length: inChunk }, (_, i) => addr(i, 0x78));
    for (const at of rows) h.chain.putStake(at, SPEC);
    await h.seedWatched(rows);
    // Each watched row loses SOL (an urgent rescan of the pair); more locked splits than the cap wait to be found.
    const splits = CAP + OVER;
    for (const at of rows) h.chain.putStake(at, SPEC, LAMPORTS - 1n);
    for (let i = 0; i < splits; i++) h.chain.putStake(addr(i), SPEC, 1_000_000_000n);
    h.at('2026-10-05T01:02:00Z');
    expect(await h.pass()).toMatchObject({ events: inChunk, rescans: 1, decoded: CAP, autoWatched: forSplits, rescanQueue: 1 });
    h.at('2026-10-05T01:04:00Z');
    const rest = splits - forSplits;
    expect(rest).toBeLessThanOrEqual(CAP);
    expect(await h.pass()).toMatchObject({ events: 0, rescans: 1, decoded: rest, autoWatched: rest, rescanQueue: 0 });
    expect(await h.readAccounts()).toHaveLength(inChunk + splits);
  });

  it('accounts a search rejects do not hold the pair at the cap: the next search goes on after them', async () => {
    const h = await watched();
    // More accounts of the pair whose lock ended than the cap (a Split after the lock ran out, or planted by anyone:
    // Initialize needs no signature of the keys), then one locked split that comes last in address order.
    const ended = BigInt(Date.parse('2026-10-04T01:00:00Z') / 1000);
    const rejected = CAP + OVER;
    const addresses = Array.from({ length: rejected + 1 }, (_, i) => addr(i)).sort();
    const late = addresses.at(-1) ?? S1;
    for (const at of addresses.slice(0, -1)) h.chain.putStake(at, { ...SPEC, unixTimestamp: ended }, 1_000_000_000n);
    h.chain.putStake(late, SPEC, 1_000_000_000n);
    // A pair queued behind it, with one locked split of its own.
    const otherMain = key(6);
    h.chain.putStake(addr(0, 0x78), { ...SPEC, staker: otherMain, withdrawer: otherMain }, 1_000_000_000n);
    await h.setMeta({ rescan_queue: JSON.stringify([[MAIN, SECOND], [otherMain, SECOND]]) });

    h.at('2026-10-05T01:02:00Z');
    expect(await h.pass()).toMatchObject({ rescans: 2, decoded: CAP, autoWatched: 0, rescanQueue: 2 });
    // The pair waits with the last account that search got through: the one before the first unknown over the cap,
    // by address.
    const answer = [S1, ...addresses].sort();
    const stop = answer.filter((at) => at !== S1)[CAP];
    const reached = stop === undefined ? undefined : answer[answer.indexOf(stop) - 1];
    expect(reached).toBeDefined();
    expect(JSON.parse((await h.readMeta()).rescan_queue ?? '')).toEqual([
      [MAIN, SECOND, reached],
      [otherMain, SECOND],
    ]);
    h.at('2026-10-05T01:04:00Z');
    // The rejected accounts left, the late split and the other pair's split.
    const rest = rejected - CAP + 2;
    expect(rest).toBeLessThanOrEqual(CAP);
    expect(await h.pass()).toMatchObject({ rescans: 2, decoded: rest, autoWatched: 2, rescanQueue: 0 });
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

  /**
   * Locks of others, closed and gone from the chain (a search finds nothing, so they stay closed), each with its own
   * main key sorting before MAIN: anyone can have locks watched (D49) and pick such addresses.
   */
  async function seedForeignPairs(count: number): Promise<Address[]> {
    // Two leading zero bytes: base58 '11...', before MAIN ('4vJ9...').
    const mains = Array.from({ length: count }, (_, i) => {
      const bytes = new Uint8Array(32).fill(0x33);
      bytes[0] = 0;
      bytes[1] = 0;
      bytes[2] = i >> 8;
      bytes[3] = i & 0xff;
      return getAddressDecoder().decode(bytes);
    }).sort();
    expect(mains.every((m) => m < MAIN)).toBe(true);
    for (let start = 0; start < mains.length; start += 100) {
      await env.DB.batch(
        mains.slice(start, start + 100).map((main, i) =>
          env.DB.prepare(
            `INSERT INTO accounts (stake_account, withdrawer, staker, custodian, lock_until, lamports, state, slot, checked_at, created_at)
             VALUES (?1, ?2, ?2, ?3, ?4, '10000000000', 'closed', 1, 1, 1)`,
          ).bind(addr(start + i, 0x55), main, SECOND, String(LOCK_UNTIL)),
        ),
      );
    }
    return mains;
  }

  it('pairs of others cannot crowd out the daily search: the pairs join the queue a page at a time, every one in its turn', { timeout: 180_000 }, async () => {
    const PAGE = MONITOR_PLANS.free.pairsPageRows;
    const h = await watched();
    // More foreign pairs than the queue holds (1000), all before (MAIN, SECOND); then a split of S1 nobody watches yet.
    await seedForeignPairs(1001);
    h.chain.putStake(S2, SPEC, 1_000_000_000n);

    h.at('2026-10-05T06:00:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'ok', rescans: 3, rescanQueue: PAGE - 3 });
    const first = JSON.parse((await h.readMeta()).pairs_sweep ?? 'null') as { day: string; after: [string, string] | null };
    expect(first.day).toBe('2026-10-05');
    expect(first.after?.[1]).toBe(SECOND);

    let passes = 1;
    while ((await h.readAccounts()).every((row) => row.stake_account !== S2)) {
      h.advance(120_000);
      const report = await h.pass();
      expect(report.outcome).toBe('ok');
      // The queue never holds more than two pages: urgent pairs keep room in front.
      expect(report.rescanQueue).toBeLessThan(2 * PAGE);
      passes += 1;
      expect(passes).toBeLessThanOrEqual(Math.ceil(1002 / 3) + 1);
    }
    // S2 sorts last: every pair was searched once, in address order.
    const searched = searchedPairs(h);
    expect(searched).toHaveLength(1002);
    expect(new Set(searched.map(([main, second]) => `${main}/${second}`)).size).toBe(1002);
    expect(searched.at(-1)).toEqual([MAIN, SECOND]);
    expect(JSON.parse((await h.readMeta()).pairs_sweep ?? 'null')).toEqual({ day: '2026-10-05', after: null });
    expect(h.db.journal.filter((e) => e.name === 'DAILY_PAIRS')).toHaveLength(Math.ceil(1002 / PAGE));
    // Within the day nothing more is queued.
    h.advance(120_000);
    expect(await h.pass()).toMatchObject({ rescans: 0, rescanQueue: 0 });
  });

  it('a round not done by the next morning goes on where it stopped; the day\'s own round starts once it ended', async () => {
    const PAGE = MONITOR_PLANS.free.pairsPageRows;
    const h = await watched();
    const mains = await seedForeignPairs(PAGE + 5);
    const pagesRead = () => h.db.journal.filter((e) => e.name === 'DAILY_PAIRS').map((e) => e.args.slice(1));
    const round = async () => JSON.parse((await h.readMeta()).pairs_sweep ?? 'null') as unknown;
    // Yesterday's round stopped after its first page.
    const stoppedAt = mains[PAGE - 1] ?? '';
    await h.setMeta({ pairs_sweep: JSON.stringify({ day: '2026-10-04', after: [stoppedAt, SECOND] }) });

    // Before 06:00 too: an open round goes on whatever the hour.
    h.at('2026-10-05T05:00:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'ok', pairsQueued: 6, rescans: 3, rescanQueue: 3 });
    expect(pagesRead()).toEqual([[stoppedAt, SECOND, PAGE]]);
    expect(await round()).toEqual({ day: '2026-10-04', after: null });
    h.at('2026-10-05T05:58:00Z');
    expect(await h.pass()).toMatchObject({ pairsQueued: 0, rescans: 3, rescanQueue: 0 });

    // 06:00: today's round starts from the first pair.
    h.at('2026-10-05T06:00:00Z');
    expect(await h.pass()).toMatchObject({ pairsQueued: PAGE, rescans: 3, rescanQueue: PAGE - 3 });
    expect(pagesRead().at(-1)).toEqual(['', '', PAGE]);
    expect(await round()).toEqual({ day: '2026-10-05', after: [mains[PAGE - 1], SECOND] });

    // Not done by the next morning: no new round, the open one goes on after its cursor and ends.
    h.at('2026-10-06T06:00:00Z');
    expect(await h.pass()).toMatchObject({ pairsQueued: 6, rescans: 3, rescanQueue: PAGE - 3 + 6 - 3 });
    expect(pagesRead().at(-1)).toEqual([stoppedAt, SECOND, PAGE]);
    expect(await round()).toEqual({ day: '2026-10-05', after: null });
    // The next pass starts the day's own round; its first page waits until the queue is shorter than a page.
    h.at('2026-10-06T06:02:00Z');
    expect(await h.pass()).toMatchObject({ pairsQueued: 0, rescans: 3, rescanQueue: PAGE - 3 });
    expect(await round()).toEqual({ day: '2026-10-06', after: ['', ''] });
    h.at('2026-10-06T06:04:00Z');
    expect(await h.pass()).toMatchObject({ rescans: 3 });
    expect(pagesRead()).toHaveLength(4);
    expect(pagesRead().at(-1)).toEqual(['', '', PAGE]);
    expect(await round()).toEqual({ day: '2026-10-06', after: [mains[PAGE - 1], SECOND] });
  });

  /**
   * The queue at its cap (rescanQueueMax, 1000) when urgent pairs come in front: 994 pairs nobody watches, then the
   * pair of S1 (an urgent pair of an earlier pass) and the pairs of 5 closed locks the day's round already queued
   * (its cursor is past all of them). In the pass at 07:00, 6 watched locks of others are gone from the chain: 6
   * ACCOUNT_CLOSED events, 6 urgent pairs in front, and the cap cuts the last 6 pairs off the back.
   */
  async function overflowing(round: { after: unknown } | null = { after: [MAIN, SECOND] }) {
    const h = await watched();
    const daily = await seedForeignPairs(5);
    const crowd = Array.from({ length: 6 }, (_, i) => addr(i, 0x99));
    crowd.forEach((at, i) => {
      const main = addr(i, 0xaa);
      h.chain.putStake(at, { ...SPEC, staker: main, withdrawer: main, custodian: key(7) });
    });
    await h.seedWatched(crowd);
    for (const at of crowd) h.chain.remove(at);
    const fillers = Array.from({ length: 994 }, (_, i) => [addr(i, 0x66), key(8)]);
    const cut = [[MAIN, SECOND], ...daily.map((main) => [main, SECOND])];
    expect(fillers.length + cut.length).toBe(1000);
    await h.setMeta({
      rescan_queue: JSON.stringify([...fillers, ...cut]),
      ...(round === null ? {} : { pairs_sweep: JSON.stringify({ day: '2026-10-05', ...round }) }),
      daily_day: '2026-10-05',
      bot_check_day: '2026-10-05',
    });
    h.at('2026-10-05T07:00:00Z');
    const firstDaily = daily[0] ?? '';
    return { h, cut, firstDaily };
  }

  it('urgent pairs that push the queue past its cap: the round goes back for the pairs cut off, none is lost', { timeout: 180_000 }, async () => {
    const { h, cut, firstDaily } = await overflowing();
    expect(await h.pass()).toMatchObject({ outcome: 'ok', closed: 6, rescans: 3, rescanQueue: 997 });
    const queue = JSON.parse((await h.readMeta()).rescan_queue ?? '[]') as string[][];
    expect(queue).toHaveLength(997);
    for (const [main, second] of cut) expect(queue.some((p) => p[0] === main && p[1] === second)).toBe(false);
    // The round's cursor goes back to before the first pair cut off (every pair of its main key).
    expect(JSON.parse((await h.readMeta()).pairs_sweep ?? 'null')).toEqual({ day: '2026-10-05', after: [firstDaily, ''] });

    const searchedBefore = searchedPairs(h).length;
    let passes = 0;
    for (;;) {
      h.advance(120_000);
      const report = await h.pass();
      expect(report.outcome).toBe('ok');
      passes += 1;
      const round = JSON.parse((await h.readMeta()).pairs_sweep ?? 'null') as { after: unknown };
      if (report.rescanQueue === 0 && round.after === null) break;
      expect(passes).toBeLessThanOrEqual(400);
    }
    const searchedAfter = new Set(searchedPairs(h).slice(searchedBefore).map(([main, second]) => `${main}/${second}`));
    for (const [main, second] of cut) expect(searchedAfter.has(`${main ?? ''}/${second ?? ''}`)).toBe(true);
  });

  it('the round goes back only as far as the first pair cut off, opens again when it ended, and starts as usual when there is none', async () => {
    const cases: [{ after: unknown } | null, unknown][] = [
      [{ after: null }, 'first-cut'],
      [{ after: ['', ''] }, ['', '']],
      // No round yet: today's starts in this pass from the first pair.
      [null, ['', '']],
    ];
    for (const [round, expected] of cases) {
      const { h, firstDaily } = await overflowing(round);
      expect(await h.pass()).toMatchObject({ outcome: 'ok', rescanQueue: 997 });
      const after = expected === 'first-cut' ? [firstDaily, ''] : expected;
      expect(JSON.parse((await h.readMeta()).pairs_sweep ?? 'null'), JSON.stringify(round)).toEqual({ day: '2026-10-05', after });
      await env.DB.batch(['accounts', 'events', 'meta'].map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
    }
  });

  it('a pass that dies after the chunk commit: the cut queue and the round\'s cursor moved back are stored together', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { h, cut, firstDaily } = await overflowing();
    h.db.failWhen = (e) => e.name === 'PENDING';
    await expect(h.pass()).rejects.toThrow(/D1_ERROR/);
    const meta = await h.readMeta();
    const queue = JSON.parse(meta.rescan_queue ?? '[]') as string[][];
    expect(queue).toHaveLength(1000);
    expect(queue.slice(0, 6).every((p) => p[1] === key(7))).toBe(true);
    for (const [main, second] of cut) expect(queue.some((p) => p[0] === main && p[1] === second)).toBe(false);
    expect(JSON.parse(meta.pairs_sweep ?? 'null')).toEqual({ day: '2026-10-05', after: [firstDaily, ''] });
  });

  it('a pass that dies after reading a page: the next one reads it again, no pair is lost', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const h = await watched();
    h.chain.putStake(S2, SPEC, 1_000_000_000n);
    h.db.failWhen = (e) => e.name === 'KNOWN_LIVE';
    h.at('2026-10-05T06:00:00Z');
    await expect(h.pass()).rejects.toThrow(/D1_ERROR/);
    expect((await h.readMeta()).pairs_sweep).toBeUndefined();

    h.db.failWhen = null;
    h.at('2026-10-05T06:02:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'ok', rescans: 1, autoWatched: 1 });
    expect(JSON.parse((await h.readMeta()).pairs_sweep ?? 'null')).toEqual({ day: '2026-10-05', after: null });
  });
});
