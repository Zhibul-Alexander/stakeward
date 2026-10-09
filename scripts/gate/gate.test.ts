// CI re-proves the lockup mechanism on every push: the full gate on LiteSVM with the mainnet stake program v5.1.0.
// The devnet and mainnet plans run on LiteSVM too, each funded with exactly its computed budget, so the amounts
// printed for the user are proven before anyone sends real SOL.
import { generateKeyPairSigner } from '@solana/kit';
import type { Lifetime } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { FEE_PLAN, gateBudget, readRents, type Role } from './budget.ts';
import type { GateCluster } from './chain.ts';
import { CHECKS } from './checks.ts';
import { createLiteSvmChain } from './litesvm.ts';
import { hasResults, renderResults, upsertSection } from './report.ts';
import { runGate, type GateKeys } from './run.ts';

async function keys(cluster: GateCluster): Promise<GateKeys> {
  const [funder, A, B, X, D] = await Promise.all([1, 2, 3, 4, 5].map(() => generateKeyPairSigner()));
  if (funder === undefined || A === undefined || B === undefined || X === undefined || D === undefined) {
    throw new Error('key generation failed');
  }
  return { funder: cluster === 'mainnet' ? A : funder, A, B, X, D };
}

async function runOnLiteSvm(cluster: GateCluster) {
  const chain = await createLiteSvmChain();
  const gateKeys = await keys(cluster);
  const budget = gateBudget(cluster, await readRents(chain));
  chain.fund(gateKeys.funder.address, budget.required);
  const report = await runGate(chain, { cluster, keys: gateKeys });
  return { chain, keys: gateKeys, budget, report };
}

/** Signature counts per paying role, sorted, from the run's fee ledger. */
function ledgerByRole(fees: readonly { payer: string; signatures: number }[]) {
  const byRole: Partial<Record<string, number[]>> = {};
  for (const { payer, signatures } of fees) (byRole[payer] ??= []).push(signatures);
  return Object.fromEntries(Object.entries(byRole).map(([role, list]) => [role, [...(list ?? [])].sort()]));
}

function sortedPlan(cluster: GateCluster) {
  return Object.fromEntries(
    Object.entries(FEE_PLAN[cluster]).map(([role, list]) => [role as Role, [...list].sort()]),
  );
}

describe.each(['litesvm', 'devnet', 'mainnet'] as const)('gate plan %s on LiteSVM', (cluster) => {
  it('matches every expectation with exactly the computed budget and returns everything but the fees', async () => {
    const { chain, keys: gateKeys, budget, report } = await runOnLiteSvm(cluster);

    const mismatches = report.results.filter((result) => !result.matched);
    expect(report.aborted).toBeNull();
    expect(mismatches.map((r) => ({ id: r.id, outcome: r.outcome?.status, failure: r.failure, note: r.note }))).toEqual([]);
    expect(report.results.map((r) => r.id)).toEqual(
      CHECKS.filter((check) => check.clusters.includes(cluster)).map((check) => check.id),
    );
    expect(report.programMatchesRelease).toBe(true);

    // The fee ledger is the plan the budget was computed from...
    expect(ledgerByRole(report.fees)).toEqual(sortedPlan(cluster));
    // ...and nothing else was spent or left behind.
    expect(report.sweep?.clean).toBe(true);
    expect(chain.testChain.balance(gateKeys.funder.address)).toBe(budget.required - budget.fees);
    for (const role of ['A', 'B', 'X', 'D'] as const) {
      if (gateKeys[role].address !== gateKeys.funder.address) {
        expect(chain.testChain.balance(gateKeys[role].address)).toBe(0n);
      }
    }
  });
});

describe.each([
  // devnet plan: the 15th transaction is check 9, after S1 was locked, deactivated, moved to staker X and split
  { cluster: 'devnet', crashAt: 15, stoppedAt: '9' },
  // mainnet plan: the 4th transaction is check 4, while S1 is locked by B
  { cluster: 'mainnet', crashAt: 4, stoppedAt: '4' },
] as const)('a $cluster run that breaks midway', ({ cluster, crashAt, stoppedAt }) => {
  it('still returns everything but the fees to the payer', async () => {
    const chain = await createLiteSvmChain();
    const gateKeys = await keys(cluster);
    const budget = gateBudget(cluster, await readRents(chain));
    chain.fund(gateKeys.funder.address, budget.required);
    let sent = 0;
    const flaky = {
      ...chain,
      send: (bytes: Uint8Array, lifetime: Lifetime) =>
        ++sent === crashAt ? Promise.reject(new Error('connection reset')) : chain.send(bytes, lifetime),
    };
    const report = await runGate(flaky, { cluster, keys: gateKeys });

    expect(report.aborted).toBe('connection reset');
    expect(report.results.find((r) => r.id === stoppedAt)?.outcome).toBeNull();
    expect(report.results.filter((r) => r.outcome !== null).every((r) => r.matched)).toBe(true);
    expect(report.sweep?.clean).toBe(true);
    const fees = report.fees.reduce((sum, entry) => sum + entry.fee, 0n);
    expect(chain.testChain.balance(gateKeys.funder.address)).toBe(budget.required - fees);
  });
});

/** Rent-exempt minimums on mainnet and devnet, read 2026-10-02; the LiteSVM harness uses the same rent. */
const LIVE_RENTS = { wallet: 650_240n, stake: 1_666_240n, nonce: 1_056_640n };

describe('gate budget', () => {
  it('runs on LiteSVM with the rent mainnet and devnet charge, so the runs above prove the printed amounts', async () => {
    expect(await readRents(await createLiteSvmChain())).toEqual(LIVE_RENTS);
  });

  it('asks mainnet for the stake account rent + 8 fees + the rent reserve of the one-time key', () => {
    const budget = gateBudget('mainnet', LIVE_RENTS);
    expect(budget.fees).toBe(64_800n);
    expect(budget.required).toBe(2_381_280n);
  });

  it('asks devnet for 1 SOL of minimum delegation on top of rents and fees', () => {
    const budget = gateBudget('devnet', LIVE_RENTS);
    expect(budget.fees).toBe(262_400n);
    expect(budget.required).toBe(1_010_584_960n);
  });
});

describe('docs/gate.md sections', () => {
  it('rewrites only the section of the cluster that ran', async () => {
    const { report } = await runOnLiteSvm('mainnet');
    const first = upsertSection(null, 'devnet', '## Devnet\n\nfunded run');
    expect(first).toContain('# Проверка механизма');
    expect(hasResults(first, 'mainnet')).toBe(false);

    const second = upsertSection(first, 'mainnet', renderResults(report));
    expect(hasResults(second, 'mainnet')).toBe(true);
    expect(hasResults(second, 'devnet')).toBe(false);
    expect(second).toContain('funded run');
    expect(second.indexOf('gate:litesvm:begin')).toBeLessThan(second.indexOf('gate:devnet:begin'));
    expect(second.indexOf('gate:devnet:begin')).toBeLessThan(second.indexOf('gate:mainnet:begin'));
    expect(upsertSection(second, 'mainnet', renderResults(report))).toBe(second);
  });
});
