// Done-when of step 5: a pass stays within its limits (step 5 spec sections 6 and 12.2). Counted independently of the
// pass's own budget: fetches by the network router, D1 statements by the counting proxy, sendMessage calls by the
// fake Telegram, decodes by the rows the pass wrote through its full path (vi.mock of @stakeward/core does not reach
// src/ in the workers pool; in these scenarios every decoded account is written, and nothing takes the rewards-only
// path).
import { getAddressDecoder, type Address } from '@solana/kit';
import { formatAlert } from '@stakeward/core';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MONITOR_LIMITS, MONITOR_PLANS } from '../../src/monitor/config.ts';
import type { PassReport } from '../../src/monitor/pass.ts';
import type { StakeAccountSpec } from '../transactions.ts';
import { key, LOCK_UNTIL } from '../transactions.ts';
import { ADMIN_CHAT, createHarness, type Harness } from './harness.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

const SECOND = key(2);
const WALLETS = Array.from({ length: 10 }, (_, i) => key(100 + i));
const QUEUED = Array.from({ length: 10 }, (_, i) => [key(200 + i), SECOND] as const);
const ROWS_PER_WALLET = 60;

/**
 * Deliveries waiting when the worst case starts: 80 pending events (a BALANCE_DECREASED each, a distinct text each)
 * on closed rows of 20 main keys; 60 chats, 3 per main key, the first 20 following a second main key as well.
 */
const ALERT_EVENTS = 80;
const CHATS = Array.from({ length: 60 }, (_, i) => String(800_000_000 + i));
const alertWallet = (n: number): Address => key(120 + (n % 20));
/** The main keys chat `c` follows. */
const followed = (c: number): Address[] => (c < 20 ? [alertWallet(c), alertWallet(c + 1)] : [alertWallet(c)]);
const alertDetails = (i: number) => ({
  fromLamports: String((i + 2) * 1_000_000_000),
  toLamports: String((i + 1) * 1_000_000_000),
});

function alertStake(i: number): Address {
  const bytes = new Uint8Array(32).fill(0x66);
  bytes[0] = i;
  return getAddressDecoder().decode(bytes);
}

/** Seeds the pending deliveries (not counted); returns the event index of each alert text. */
async function seedDeliveries(nowMs: number): Promise<Map<string, number>> {
  const statements: D1PreparedStatement[] = [];
  const indexOf = new Map<string, number>();
  for (let i = 0; i < ALERT_EVENTS; i++) {
    const stake = alertStake(i);
    // Closed and without a lock: never paged, searched again or reminded; PENDING still joins it.
    statements.push(
      env.DB.prepare(
        `INSERT INTO accounts (stake_account, withdrawer, staker, custodian, lock_until, lamports, state, slot, checked_at, created_at)
         VALUES (?1, ?2, ?2, ?3, 0, ?4, 'closed', 1, ?5, ?5)`,
      ).bind(stake, alertWallet(i), key(3), alertDetails(i).toLamports, nowMs),
      env.DB.prepare(
        `INSERT INTO events (stake_account, type, details_json, slot, detected_at) VALUES (?1, 'BALANCE_DECREASED', ?2, 1, ?3)`,
      ).bind(stake, JSON.stringify(alertDetails(i)), nowMs),
    );
    const alert = formatAlert(
      { type: 'BALANCE_DECREASED', details: alertDetails(i), stakeAccount: stake },
      { withdrawer: alertWallet(i), lockUntil: 0n, now: 0n },
    );
    indexOf.set(alert.text, i);
  }
  CHATS.forEach((chat, c) => {
    for (const wallet of followed(c)) {
      statements.push(
        env.DB.prepare('INSERT INTO alert_links (wallet, chat_id, created_at, last_event_id) VALUES (?1, ?2, ?3, 0)').bind(
          wallet,
          chat,
          nowMs,
        ),
      );
    }
  });
  await env.DB.batch(statements);
  expect(indexOf.size).toBe(ALERT_EVENTS);
  return indexOf;
}

/** Every chat got every event of the main keys it follows exactly once (the alert texts Telegram took). */
function expectEachOnce(h: Harness, indexOf: Map<string, number>): void {
  CHATS.forEach((chat, c) => {
    const received = h.telegram
      .delivered(chat)
      .flatMap((m) => m.text.replace(/^Devnet: /, '').split('\n\n'))
      .map((text) => indexOf.get(text) ?? -1);
    const wallets = followed(c);
    const expected = Array.from({ length: ALERT_EVENTS }, (_, i) => i).filter((i) => wallets.includes(alertWallet(i)));
    expect(received.sort((a, b) => a - b)).toEqual(expected);
  });
}

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
async function worstCase(
  plan: 'free' | 'paid',
): Promise<{ h: Harness; addresses: Address[]; indexOf: Map<string, number> }> {
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
  const indexOf = await seedDeliveries(h.clock.ms);
  h.chain.flaky(2);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  return { h, addresses, indexOf };
}

/** Runs one pass and checks every limit on what it did, counted outside the pass. */
async function limitedPass(h: Harness, plan: 'free' | 'paid'): Promise<PassReport> {
  const preset = MONITOR_PLANS[plan];
  const fetchesBefore = h.net.calls.length;
  const statementsBefore = h.db.stats.statements;
  const chainCallsBefore = h.chain.calls.length;
  const journalBefore = h.db.journal.length;
  const telegramBefore = h.telegram.requests.length;

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
  const sends = h.telegram.requests.slice(telegramBefore);
  expect(sends.every((r) => r.method === 'sendMessage' && r.chatId !== ADMIN_CHAT)).toBe(true);
  expect(sends.length).toBeLessThanOrEqual(MONITOR_LIMITS.maxSends);
  expect(sends.length).toBe(report.messages);
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
    it(`${plan}: every pass within the limits; passes until drained read each row once, empty the queue and give each chat each event once`, { timeout: 120_000 }, async () => {
      const { h, addresses, indexOf } = await worstCase(plan);
      const preset = MONITOR_PLANS[plan];
      const watched = new Set<string>(addresses);
      let passes = 0;
      let daily = 0;
      let sendsSeen = 0;
      for (;;) {
        h.at(new Date(Date.parse('2026-10-05T12:00:00Z') + passes * 120_000).toISOString());
        const report = await limitedPass(h, plan);
        passes += 1;
        if (report.daily) daily += 1;
        sendsSeen = Math.max(sendsSeen, report.messages);
        if (passes === 1) {
          // Free: the decode cap (20) stops the first chunk; paid: five full chunks, 495 decodes.
          const decoded = Math.min(preset.decodeCap, preset.maxChunks * 99);
          expect(report).toMatchObject({ daily: true, chunks: plan === 'free' ? 1 : 5, decoded });
        }
        const rows = (await h.readAccounts()).filter((r) => watched.has(r.stake_account));
        const done = rows.every((r) => r.deactivation_epoch === '951');
        const queue = JSON.parse((await h.readMeta()).rescan_queue ?? '[]') as unknown[];
        const pending = (await h.readEvents()).filter((e) => e.notified_at === null);
        if (done && queue.length === 0 && pending.length === 0) break;
        expect(passes).toBeLessThan(60);
      }
      expect(daily).toBe(1);
      // The sends were held back by the budget only as far as the plan says (step 5 spec section 6.2).
      expect(sendsSeen).toBeGreaterThanOrEqual(plan === 'free' ? 19 : MONITOR_LIMITS.maxSends);
      expectEachOnce(h, indexOf);

      const events = (await h.readEvents()).filter((e) => watched.has(e.stake_account));
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

  it('past the soft deadline (the clock jumps 70 s in the first read): no new chunk, search or send, the finish is written', async () => {
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
    expect(report).toMatchObject({ chunks: 1, deferred: true, rescans: 0, messages: 0 });
    expect(h.chain.callsOf('getMultipleAccounts')).toHaveLength(1);
    expect(h.chain.callsOf('getProgramAccounts')).toHaveLength(0);
    expect(h.telegram.requests).toEqual([]);
    const meta = await h.readMeta();
    expect(meta.last_pass_at).toBe(String(t0));
    expect(JSON.parse(meta.pass_lease ?? '')).toMatchObject({ until: 0 });
  });

  it('a quiet pass: one getMultipleAccounts, the load batch, the pending read and the finish', async () => {
    const h = createHarness();
    h.at('2026-10-05T01:00:00Z');
    h.chain.putStake(key(10), spec(key(1)));
    await h.seedWatched([key(10)]);
    h.at('2026-10-05T01:02:00Z');
    const report = await h.pass();
    expect(report).toMatchObject({ outcome: 'ok', fastPath: 1, decoded: 0, fetches: 1 });
    // Load 3 + PENDING 1 + finish 1, and the one fetch: 6 in all (step 5 spec section 6.2).
    expect(report.statements).toBe(5);
    expect(h.db.journal.map((e) => e.name)).toEqual(['LOAD_META', 'LEASE_ACQUIRE', 'PAGE', 'PENDING', 'PUT_META']);
  });
});
