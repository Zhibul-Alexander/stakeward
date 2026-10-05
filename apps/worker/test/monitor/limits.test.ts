// Done-when of step 5: a pass stays within its limits (step 5 spec sections 6 and 12.2). Counted independently of the
// pass's own budget: fetches by the network router, D1 statements by the counting proxy, decodes by the rows the pass
// wrote through its full path (vi.mock of @stakeward/core does not reach src/ in the workers pool; in these scenarios
// every decoded account is written, and nothing takes the rewards-only path). Delivery (sendMessage, pending events
// and chats) is counted from the delivery commit on.
import { getAddressDecoder, type Address } from '@solana/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MONITOR_PLANS } from '../../src/monitor/config.ts';
import type { PassReport } from '../../src/monitor/pass.ts';
import type { StakeAccountSpec } from '../transactions.ts';
import { key, LOCK_UNTIL } from '../transactions.ts';
import { createHarness, type Harness } from './harness.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

const SECOND = key(2);
const WALLETS = Array.from({ length: 10 }, (_, i) => key(100 + i));
const QUEUED = Array.from({ length: 10 }, (_, i) => [key(200 + i), SECOND] as const);
const ROWS_PER_WALLET = 60;

/** The n-th stake account of the w-th main key. */
function stakeAddress(w: number, n: number): Address {
  const bytes = new Uint8Array(32).fill(0x55);
  bytes[0] = w;
  bytes[1] = n;
  return getAddressDecoder().decode(bytes);
}

const spec = (wallet: Address): StakeAccountSpec => ({
  state: 'delegated',
  staker: wallet,
  withdrawer: wallet,
  custodian: SECOND,
  unixTimestamp: LOCK_UNTIL,
});

/**
 * The worst case: 600 watched rows of 10 main keys that all changed (each needs a decode and gives an event and an
 * urgent rescan), 10 more pairs queued, the daily pass due, and every RPC call failing twice before it is answered.
 */
async function worstCase(plan: 'free' | 'paid'): Promise<{ h: Harness; addresses: Address[] }> {
  const h = createHarness({ env: { MONITOR_PLAN: plan } });
  h.at('2026-10-05T11:00:00Z');
  const addresses: Address[] = [];
  WALLETS.forEach((wallet, w) => {
    for (let n = 0; n < ROWS_PER_WALLET; n++) {
      const address = stakeAddress(w, n);
      addresses.push(address);
      h.chain.putStake(address, spec(wallet));
    }
  });
  await h.seedWatched(addresses);
  WALLETS.forEach((wallet, w) => {
    for (let n = 0; n < ROWS_PER_WALLET; n++) h.chain.putStake(stakeAddress(w, n), { ...spec(wallet), deactivationEpoch: 951n });
  });
  await h.setMeta({ rescan_queue: JSON.stringify(QUEUED) });
  h.chain.flaky(2);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  return { h, addresses };
}

/** Runs one pass and checks every limit on what it did, counted outside the pass. */
async function limitedPass(h: Harness, plan: 'free' | 'paid'): Promise<PassReport> {
  const preset = MONITOR_PLANS[plan];
  const fetchesBefore = h.net.calls.length;
  const statementsBefore = h.db.stats.statements;
  const chainCallsBefore = h.chain.calls.length;
  const journalBefore = h.db.journal.length;

  const report = await h.pass();

  const fetches = h.net.calls.length - fetchesBefore;
  const statements = h.db.stats.statements - statementsBefore;
  const chainCalls = h.chain.calls.slice(chainCallsBefore);
  const reads = chainCalls.filter((c) => c.method === 'getMultipleAccounts');
  expect(report.outcome).toBe('ok');
  expect(fetches + statements).toBeLessThanOrEqual(preset.subrequestCap);
  expect(statements).toBeLessThanOrEqual(48);
  expect(reads.filter((c) => c.outcome === 'answer').length).toBeLessThanOrEqual(preset.maxChunks);
  expect(reads.length).toBeLessThanOrEqual(3 * preset.maxChunks);
  for (const read of reads) expect(read.keys.length).toBeLessThanOrEqual(100);
  const written = (name: string) =>
    h.db.journal
      .slice(journalBefore)
      .filter((e) => e.name === name)
      .reduce((sum, e) => sum + (JSON.parse(String(e.args[0])) as unknown[]).length, 0);
  // Rows written through the full path (each decoded once) and rows a rescan watched (each decoded once).
  const decodes = written('CHUNK_UPDATE') + written('INSERT_WATCHED');
  expect(report).toMatchObject({ lamportsOnly: 0, autoWatched: 0 });
  expect(decodes).toBeLessThanOrEqual(preset.decodeCap);
  expect(decodes).toBe(report.decoded);
  // The pass's own budget agrees with the outside count.
  expect([report.fetches, report.statements]).toEqual([fetches, statements]);
  return report;
}

describe('limits of a pass', () => {
  for (const plan of ['free', 'paid'] as const) {
    it(`${plan}: every pass within the limits; passes until drained read each row once and empty the queue`, { timeout: 120_000 }, async () => {
      const { h, addresses } = await worstCase(plan);
      const preset = MONITOR_PLANS[plan];
      let passes = 0;
      let daily = 0;
      for (;;) {
        h.at(new Date(Date.parse('2026-10-05T12:00:00Z') + passes * 120_000).toISOString());
        const report = await limitedPass(h, plan);
        passes += 1;
        if (report.daily) daily += 1;
        if (passes === 1) {
          // Free: the decode cap (20) stops the first chunk; paid: five full chunks, 495 decodes.
          const decoded = Math.min(preset.decodeCap, preset.maxChunks * 99);
          expect(report).toMatchObject({ daily: true, chunks: plan === 'free' ? 1 : 5, decoded });
        }
        const rows = await h.readAccounts();
        const done = rows.every((r) => r.deactivation_epoch === '951');
        const queue = JSON.parse((await h.readMeta()).rescan_queue ?? '[]') as unknown[];
        if (done && queue.length === 0) break;
        expect(passes).toBeLessThan(60);
      }
      expect(daily).toBe(1);

      const events = await h.readEvents();
      expect(events.every((e) => e.type === 'DEACTIVATED')).toBe(true);
      expect(events.map((e) => e.stake_account).sort()).toEqual([...addresses].sort());
      // Every pair was searched: the 10 queued ones and the 10 of the changed rows (urgent and daily, deduplicated).
      const searched = new Set(
        h.chain
          .callsOf('getProgramAccounts')
          .filter((c) => c.outcome === 'answer')
          .map((c) => JSON.stringify((c.params[1] as { filters: { memcmp?: { bytes: string } }[] }).filters.map((f) => f.memcmp?.bytes ?? ''))),
      );
      expect(searched.size).toBe(20);
      expect((await h.readMeta()).rescan_queue).toBe('[]');
    });
  }

  it('past the soft deadline (the clock jumps 70 s in the first read): no new chunk or search, the finish is written', async () => {
    const { h } = await worstCase('paid');
    h.chain.flaky(0);
    let jumped = false;
    h.chain.onCall((call) => {
      if (jumped || call.method !== 'getMultipleAccounts') return;
      jumped = true;
      h.advance(70_000);
    });
    h.at('2026-10-05T12:00:00Z');
    const t0 = h.clock.ms;
    const report = await limitedPass(h, 'paid');
    expect(report).toMatchObject({ chunks: 1, deferred: true, rescans: 0 });
    expect(h.chain.callsOf('getMultipleAccounts')).toHaveLength(1);
    expect(h.chain.callsOf('getProgramAccounts')).toHaveLength(0);
    const meta = await h.readMeta();
    expect(meta.last_pass_at).toBe(String(t0));
    expect(JSON.parse(meta.pass_lease ?? '')).toMatchObject({ until: 0 });
  });

  it('a quiet pass: one getMultipleAccounts, the load batch and the finish', async () => {
    const h = createHarness();
    h.at('2026-10-05T01:00:00Z');
    h.chain.putStake(key(10), spec(key(1)));
    await h.seedWatched([key(10)]);
    h.at('2026-10-05T01:02:00Z');
    const report = await h.pass();
    expect(report).toMatchObject({ outcome: 'ok', fastPath: 1, decoded: 0, fetches: 1 });
    // Load 3 + finish 1; delivery adds its PENDING read (step 5 spec section 6.2: 6 in all).
    expect(report.statements).toBeLessThanOrEqual(5);
    expect(h.db.journal.map((e) => e.name)).toEqual(['LOAD_META', 'LEASE_ACQUIRE', 'PAGE', 'PUT_META']);
  });
});
