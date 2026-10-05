// CPU of the monitor pass inside workerd (step 5 spec section 6.3; the numbers go to DECISIONS.md D56). Prints the
// numbers; run `pnpm --filter @stakeward/worker exec vitest run test/monitor-cpu.test.ts --reporter=verbose`.
// `first` is the first call in this isolate after the warm-up the entry module runs at load (src/warm-up.ts), as in
// production; the rows are built without decoding.
import { getAddressDecoder, type Address } from '@solana/kit';
import {
  STAKE_PROGRAM_ADDRESS,
  stakeDataFingerprint,
  SYSVAR_PROGRAM_ADDRESS,
  U64_MAX,
} from '@stakeward/core';
import { describe, expect, it, vi } from 'vitest';
import { encodeBase64 } from '../src/base64.ts';
import { classifyChunk } from '../src/monitor/classify.ts';
import { MONITOR_PLANS } from '../src/monitor/config.ts';
import { planDeliveries, settleDeliveries, type Link, type PendingEvent } from '../src/monitor/deliver.ts';
import { parseMultipleAccounts, type ChunkRead, type RawItem } from '../src/monitor/read.ts';
import type { AccountRow } from '../src/monitor/store.ts';
import { parseProgramAccountItems } from '../src/stake-accounts.ts';
import { multipleAccountsText, type AccountJson } from './fakes.ts';
import { measure, report } from './measure.ts';
import { createHarness } from './monitor/harness.ts';
import { clockData, key, LOCK_UNTIL, stakeAccountData, type StakeAccountSpec } from './transactions.ts';

const MAIN = key(1);
const SECOND = key(2);
const ROW_SLOT = 5_000;
const ROW_MS = Date.UTC(2026, 9, 5, 12);
const CLOCK_S = BigInt(ROW_MS / 1000) + 120n;
const SPEC: StakeAccountSpec = { state: 'delegated', staker: MAIN, withdrawer: MAIN, custodian: SECOND, unixTimestamp: LOCK_UNTIL };

function address(i: number): Address {
  const bytes = new Uint8Array(32).fill(0x33);
  bytes[0] = i;
  return getAddressDecoder().decode(bytes);
}

/** The stored row of `SPEC` at `address`, built by hand (no decode) with the fingerprint of its data. */
function rowOf(at: Address): AccountRow {
  return {
    stake_account: at,
    withdrawer: MAIN,
    staker: MAIN,
    custodian: SECOND,
    lock_until: LOCK_UNTIL.toString(),
    lamports: '10000000000',
    state: 'delegated',
    voter: key(42),
    activation_epoch: '800',
    deactivation_epoch: U64_MAX.toString(),
    slot: ROW_SLOT,
    checked_at: ROW_MS,
    last_reminder_days: null,
    fingerprint: stakeDataFingerprint(encodeBase64(stakeAccountData(SPEC))),
  };
}

function itemOf(spec: StakeAccountSpec, lamports = 10_000_000_000n): RawItem {
  return { owner: STAKE_PROGRAM_ADDRESS, dataBase64: encodeBase64(stakeAccountData(spec)), lamports };
}

function readOf(items: RawItem[]): ChunkRead {
  return { slot: ROW_SLOT + 300, clock: { slot: 1n, epoch: 950n, unixTimestamp: CLOCK_S }, clockMs: Number(CLOCK_S) * 1000, items };
}

const rows = (n: number) => Array.from({ length: n }, (_, i) => rowOf(address(i)));

/** A getProgramAccounts answer (withContext) of `count` stake accounts, written the way an RPC node writes it. */
function programAccountsText(count: number): string {
  const data = encodeBase64(stakeAccountData(SPEC));
  const value = Array.from({ length: count }, (_, i) => ({
    pubkey: address(i),
    account: {
      data: [data, 'base64'],
      executable: false,
      lamports: '10000000000',
      owner: STAKE_PROGRAM_ADDRESS,
      rentEpoch: '18446744073709551615',
      space: 200,
    },
  }));
  const text = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { context: { apiVersion: '3.0.6', slot: 5300 }, value } });
  return text.replace(/"(lamports|rentEpoch)":"([0-9]+)"/g, '"$1":$2');
}

describe('CPU of the monitor pass (measurement)', () => {
  it('classifyChunk, 20 accounts that changed (20 decodes; first = the first call of the measurement after the warm-up)', { timeout: 120_000 }, async () => {
    const changed = readOf(Array.from({ length: 20 }, () => itemOf({ ...SPEC, deactivationEpoch: 951n })));
    const twenty = rows(20);
    const result = await measure(() => Promise.resolve(classifyChunk(twenty, changed, 20)));
    expect(classifyChunk(twenty, changed, 20).counts.decoded).toBe(20);
    report('classifyChunk, 20 decodes', result);
  });

  it('classifyChunk, 99 unchanged accounts (the fast path, no decode)', { timeout: 120_000 }, async () => {
    const quiet = readOf(Array.from({ length: 99 }, () => itemOf(SPEC)));
    const all = rows(99);
    expect(classifyChunk(all, quiet, 20).counts).toMatchObject({ fastPath: 99, decoded: 0 });
    report('classifyChunk, 99 unchanged', await measure(() => Promise.resolve(classifyChunk(all, quiet, 20))));
  });

  it('classifyChunk, 99 accounts after epoch rewards (balance only, no decode)', { timeout: 120_000 }, async () => {
    const rewarded = readOf(
      Array.from({ length: 99 }, () => itemOf({ ...SPEC, stake: 5_000_123_456n, credits: 4_000n }, 10_000_123_456n)),
    );
    const all = rows(99);
    expect(classifyChunk(all, rewarded, 20).counts).toMatchObject({ lamportsOnly: 99, decoded: 0 });
    report('classifyChunk, 99 with rewards', await measure(() => Promise.resolve(classifyChunk(all, rewarded, 20))));
  });

  it('parseMultipleAccounts, the Clock and 99 stake accounts (100 keys)', { timeout: 120_000 }, async () => {
    const clock: AccountJson = { data: clockData(5300n, 950n, CLOCK_S), lamports: 1_169_280n, owner: SYSVAR_PROGRAM_ADDRESS };
    const stake: AccountJson = { data: stakeAccountData(SPEC), lamports: 10_000_000_000n, owner: STAKE_PROGRAM_ADDRESS };
    const text = multipleAccountsText(1, 5300, [clock, ...Array.from({ length: 99 }, () => stake)]);
    expect(parseMultipleAccounts(text, 100)?.items).toHaveLength(99);
    report('parseMultipleAccounts, 100 keys', await measure(() => Promise.resolve(parseMultipleAccounts(text, 100))));
  });

  it('parseProgramAccountItems, the most rescan answers a Free pass parses (rescanParseChars)', { timeout: 120_000 }, async () => {
    const limit = MONITOR_PLANS.free.rescanParseChars;
    let count = 1;
    while (count < 256 && programAccountsText(count + 1).length <= limit) count += 1;
    const text = programAccountsText(count);
    expect(text.length).toBeLessThanOrEqual(limit);
    expect(parseProgramAccountItems(text)?.items).toHaveLength(count);
    const label = `parseProgramAccountItems, ${String(count)} accounts in ${String(text.length)} characters`;
    report(label, await measure(() => Promise.resolve(parseProgramAccountItems(text))));
  });

  it('planDeliveries and settleDeliveries, 25 chats with 5 events each (125 alerts formatted)', { timeout: 120_000 }, async () => {
    const pending: PendingEvent[] = Array.from({ length: 125 }, (_, i) => ({
      id: i + 1,
      stakeAccount: address(i),
      type: 'DEACTIVATED',
      details: { deactivationEpoch: '951' },
      detectedAt: ROW_MS,
      withdrawer: address(200 + (i % 25)),
      custodian: SECOND,
      lockUntil: LOCK_UNTIL,
    }));
    const links: Link[] = Array.from({ length: 25 }, (_, c) => ({ wallet: address(200 + c), chatId: String(1_000_000 + c), lastEventId: 0 }));
    const opts = {
      maxMessages: 25,
      nowMs: ROW_MS + 120_000,
      siteOrigin: 'https://stakeward.test',
      cluster: 'devnet',
      fullWindow: true,
    } as const;
    const run = () => {
      const plan = planDeliveries(pending, links, opts);
      return settleDeliveries(pending, links, plan.messages, plan.messages.map(() => 'sent'), plan.doneWithoutSend);
    };
    expect(planDeliveries(pending, links, opts).messages.map((m) => m.eventIds.length)).toEqual(Array<number>(25).fill(5));
    expect(run().doneIds).toHaveLength(125);
    report('planDeliveries + settleDeliveries, 25 chats x 5 events', await measure(() => Promise.resolve(run())));
  });

  it('a whole quiet pass of 98 rows (wall time, includes the local D1 and the fake RPC)', { timeout: 300_000 }, async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = createHarness();
    h.at('2026-10-05T07:00:00Z');
    // 98: a short page, read whole every pass (with exactly 99 every other pass finds the cursor at the end).
    const addresses = Array.from({ length: 98 }, (_, i) => address(i));
    for (const at of addresses) h.chain.putStake(at, SPEC);
    await h.seedWatched(addresses);
    await h.setMeta({ daily_day: '2026-10-05' });
    const result = await measure(async () => {
      h.advance(120_000);
      const pass = await h.pass();
      if (pass.fastPath !== 98) throw new Error(`not a quiet pass: ${JSON.stringify(pass)}`);
    });
    report('runMonitorPass, 98 unchanged rows (wall, with D1 and fetch round trips)', result);
  });
});
