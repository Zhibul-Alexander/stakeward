// CPU measurement inside workerd (DECISIONS.md D23: the free plan allows 10 ms of CPU per request).
// Prints the numbers; run `pnpm --filter @stakeward/worker exec vitest run test/cpu.test.ts --reporter=verbose`.
// Local workerd advances performance.now() during computation, so averages over many runs are meaningful here
// (production Workers freeze timers during execution and would read 0).
import { inspectTransaction, STAKE_PROGRAM_ADDRESS, verifyAllSignatures } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { parseProgramAccounts } from '../src/stake-accounts.ts';
import { fakeUpstream, rpcResponse, testApp } from './fakes.ts';
import { b64, key, signedNonceRescue, stakeAccountData } from './transactions.ts';

const RUNS = 50;

async function measure(run: () => Promise<unknown>): Promise<{ firstMs: number; averageMs: number }> {
  const start = performance.now();
  await run();
  const firstMs = performance.now() - start;
  const warmStart = performance.now();
  for (let i = 0; i < RUNS; i++) await run();
  return { firstMs, averageMs: (performance.now() - warmStart) / RUNS };
}

function report(label: string, result: { firstMs: number; averageMs: number }) {
  console.log(`[cpu] ${label}: first ${result.firstMs.toFixed(2)} ms, warm average ${result.averageMs.toFixed(2)} ms (${String(RUNS)} runs)`);
}

describe('CPU budget (measurement)', () => {
  it('inspectTransaction + verifyAllSignatures on a signed durable-nonce rescue', async () => {
    const bytes = await signedNonceRescue();
    const result = await measure(async () => {
      const inspected = await inspectTransaction(bytes);
      const signatures = await verifyAllSignatures(bytes);
      expect(inspected.ok && signatures.ok).toBe(true);
    });
    report('inspect + verify, nonce rescue (3 signatures)', result);
    report('inspect only', await measure(() => inspectTransaction(bytes)));
    report('verify only', await measure(() => verifyAllSignatures(bytes)));
  });

  it('the whole sendTransaction request (validation, inspector, signatures, forwarding)', async () => {
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

  it('decoding a getProgramAccounts answer with 100 stake accounts', async () => {
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
