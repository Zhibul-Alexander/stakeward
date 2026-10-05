// CPU measurement inside workerd (DECISIONS.md D23: the free plan allows 10 ms of CPU per request).
// Prints the numbers; run `pnpm --filter @stakeward/worker exec vitest run test/cpu.test.ts --reporter=verbose`.
// Local workerd advances performance.now() during computation, so averages over many runs are meaningful here
// (production Workers freeze timers during execution and would read 0).
import {
  inspectAndVerifyTransaction,
  inspectTransaction,
  MAX_WATCH_ACCOUNTS,
  STAKE_PROGRAM_ADDRESS,
  SYSVAR_CLOCK_ADDRESS,
  SYSVAR_PROGRAM_ADDRESS,
  verifyAllSignatures,
} from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { parseMultipleAccounts } from '../src/monitor/read.ts';
import { parseProgramAccounts } from '../src/stake-accounts.ts';
import { judgeAccounts } from '../src/watch.ts';
import { fakeUpstream, multipleAccountsAnswer, multipleAccountsText, rpcResponse, testApp, type AccountJson } from './fakes.ts';
import { b64, clockData, key, signedNonceRescue, stakeAccountData } from './transactions.ts';

const WARMUP_RUNS = 200;
const BATCHES = 7;
const BATCH_RUNS = 40;

type Measurement = { firstMs: number; minMs: number; medianMs: number };

/**
 * `firstMs`: the first call (in the first test of this file, the first in a fresh isolate: cold). Then WARMUP_RUNS
 * untimed calls, then BATCHES batches of BATCH_RUNS calls: `minMs` and `medianMs` are the lowest and the median batch
 * average (warm). The clock is wall time in whole milliseconds and the machine may be busy, so the lowest batch is
 * the closest to the CPU cost.
 */
async function measure(run: () => Promise<unknown>): Promise<Measurement> {
  const start = performance.now();
  await run();
  const firstMs = performance.now() - start;
  for (let i = 0; i < WARMUP_RUNS; i++) await run();
  const averages: number[] = [];
  for (let batch = 0; batch < BATCHES; batch++) {
    const batchStart = performance.now();
    for (let i = 0; i < BATCH_RUNS; i++) await run();
    averages.push((performance.now() - batchStart) / BATCH_RUNS);
  }
  averages.sort((a, b) => a - b);
  return { firstMs, minMs: averages[0] ?? NaN, medianMs: averages[Math.floor(BATCHES / 2)] ?? NaN };
}

function report(label: string, result: Measurement) {
  console.log(
    `[cpu] ${label}: first ${result.firstMs.toFixed(1)} ms, warm min ${result.minMs.toFixed(2)} ms, median ${result.medianMs.toFixed(2)} ms`,
  );
}

describe('CPU budget (measurement)', () => {
  it('inspectAndVerifyTransaction on a signed durable-nonce rescue (what the proxy runs before sending)', { timeout: 120_000 }, async () => {
    const bytes = await signedNonceRescue();
    // First: the first inspection in this isolate (cold: nothing compiled or warmed up yet).
    const result = await measure(async () => {
      const checked = await inspectAndVerifyTransaction(bytes);
      expect(checked.ok && checked.signatures.ok).toBe(true);
    });
    report('inspectAndVerifyTransaction, nonce rescue (3 signatures)', result);
    report(
      'inspectTransaction + verifyAllSignatures separately',
      await measure(async () => {
        const inspected = await inspectTransaction(bytes);
        const signatures = await verifyAllSignatures(bytes);
        expect(inspected.ok && signatures.ok).toBe(true);
      }),
    );
    report('inspect only', await measure(() => inspectTransaction(bytes)));
    report('verify only', await measure(() => verifyAllSignatures(bytes)));
  });

  it('the whole sendTransaction request (validation, inspector, signatures, forwarding)', { timeout: 120_000 }, async () => {
    const bytes = await signedNonceRescue();
    const upstream = fakeUpstream((c) => rpcResponse(c.json.id, 'sig'));
    // A fresh client per run keeps the rate limiter out of the way.
    const result = await measure(async () => {
      const res = await testApp(upstream).rpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendTransaction',
        params: [b64(bytes), { encoding: 'base64' }],
      });
      expect(res.status).toBe(200);
    });
    report('POST /api/rpc sendTransaction (rescue), includes the fake upstream and rate limiter round trips', result);
  });

  it('decoding a getProgramAccounts answer with 100 stake accounts', { timeout: 120_000 }, async () => {
    const withdrawer = key(1);
    const items = Array.from({ length: 100 }, (_, i) => ({
      pubkey: key((i % 200) + 20),
      account: {
        data: [b64(stakeAccountData({ state: 'delegated', staker: withdrawer, withdrawer })), 'base64'],
        executable: false,
        lamports: 5_002_282_880,
        owner: STAKE_PROGRAM_ADDRESS,
        rentEpoch: 0,
        space: 200,
      },
    }));
    const text = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: items } });
    const result = await measure(() => Promise.resolve(parseProgramAccounts(text, 'withdrawer', withdrawer)));
    expect(parseProgramAccounts(text, 'withdrawer', withdrawer)?.accounts).toHaveLength(100);
    report('parse + decode 100 stake accounts (gPA answer)', result);
  });
});

describe('CPU budget of POST /api/watch (measurement)', () => {
  const clockUnix = 1_791_201_600n; // 2026-10-05T12:00:00Z
  const clock: AccountJson = { data: clockData(5000n, 950n, clockUnix), lamports: 1n, owner: SYSVAR_PROGRAM_ADDRESS };
  const accounts = Array.from({ length: MAX_WATCH_ACCOUNTS }, (_, i) => key(100 + i));
  const locked: AccountJson = {
    data: stakeAccountData({ state: 'delegated', staker: key(1), withdrawer: key(1), custodian: key(2), unixTimestamp: clockUnix + 180n * 86_400n }),
    lamports: 5_002_282_880n,
    owner: STAKE_PROGRAM_ADDRESS,
  };
  const items = [clock, ...accounts.map(() => locked)];

  it(`parse + judge ${String(MAX_WATCH_ACCOUNTS)} locked accounts (the handler's own work)`, { timeout: 120_000 }, async () => {
    const text = multipleAccountsText(1, 5000, items);
    const run = () => {
      const read = parseMultipleAccounts(text, accounts.length + 1);
      if (read === null) throw new Error('unexpected parse failure');
      return judgeAccounts(accounts, read);
    };
    expect(run().every((j) => j.row !== null)).toBe(true);
    report(`parseMultipleAccounts + judgeAccounts, ${String(MAX_WATCH_ACCOUNTS)} accounts`, await measure(() => Promise.resolve(run())));
  });

  it(`the whole request with ${String(MAX_WATCH_ACCOUNTS)} accounts, warm (already watched after the first run)`, { timeout: 120_000 }, async () => {
    const upstream = fakeUpstream((call) => {
      expect(call.json.params[0]).toEqual([SYSVAR_CLOCK_ADDRESS, ...accounts]);
      return multipleAccountsAnswer(call.json.id, 5000, items);
    });
    // A fresh client per run keeps the rate limiter (10 per minute) out of the way.
    const result = await measure(async () => {
      const res = await testApp(upstream).watch({ accounts });
      expect(res.status).toBe(200);
    });
    report(`POST /api/watch, ${String(MAX_WATCH_ACCOUNTS)} accounts, includes the fake upstream, rate limiter and D1 round trips`, result);
  });
});
