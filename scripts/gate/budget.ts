// How much SOL a gate run needs, computed from rent, the minimum delegation and the fee of every transaction.
import { NONCE_ACCOUNT_SIZE, STAKE_ACCOUNT_SIZE } from '@stakeward/core';
import type { GateChain, GateCluster } from './chain.ts';
import { LAMPORTS_PER_SOL, transactionFee } from './tx.ts';

/** Who signs and pays in the gate. A main key, B second key (custodian), X the thief's staker, D the new wallet. */
export type Role = 'funder' | 'A' | 'B' | 'X' | 'D';

/** Minimum stake delegation on mainnet, devnet and LiteSVM (DECISIONS.md D7). S1 holds exactly this much stake. */
export const MIN_DELEGATION_LAMPORTS = LAMPORTS_PER_SOL;
/** Check 8: lamports split from S1 into S2. */
export const SPLIT_LAMPORTS = 500_000_000n;
/** Check 10: lamports withdrawn from the locked S2 with both keys. */
export const PARTIAL_WITHDRAW_LAMPORTS = 250_000_000n;

/**
 * Signature counts of every transaction each role pays for (order does not matter). gate.test.ts runs the LiteSVM
 * gate with exactly the budget below and checks this plan against what was really sent; change both together.
 * On mainnet the one-time key is both the funder and A.
 */
const SHARED_PLAN = {
  // fund A, B, D; create S1, S2 (split target), Sm (merge source), S3 (nonce rescue);
  // sweep: withdraw S1 and S3 (funder, D, B), withdraw Sm (funder, A), one transfer of A, B and D (4 signatures)
  funder: [1, 1, 1, 1, 1, 3, 3, 2, 4],
  // 1b delegate, 2 protect, 3, 4, 5, 7a, 7b, 8a split, 8b, 9 merge, 10, 11b, 11c, 13b
  A: [1, 2, 1, 2, 1, 1, 2, 2, 1, 2, 2, 2, 2, 1],
  // 6 extend, 13a unlock
  B: [1, 1],
  // 11a rescue, 12a nonce setup, 12b rescue on the nonce, 12c nonce close
  D: [3, 1, 3, 1],
} as const;

export const FEE_PLAN: Readonly<Record<GateCluster, Readonly<Partial<Record<Role, readonly number[]>>>>> = {
  devnet: SHARED_PLAN,
  // plus S4 for check 14 (funder) and 14a, 14b, 14c (A)
  litesvm: { ...SHARED_PLAN, funder: [...SHARED_PLAN.funder, 1], A: [...SHARED_PLAN.A, 1, 1, 1] },
  // create S1, 2, 3, 4, 5, 6 (A pays, B signs), 13a (A pays, B signs), 13b
  mainnet: { A: [1, 2, 1, 2, 1, 2, 2, 1] },
};

/** Rent-exempt minimums read from the chain: a plain wallet (0 bytes), a stake account (200), a nonce account (80). */
export type Rents = { wallet: bigint; stake: bigint; nonce: bigint };

export async function readRents(chain: Pick<GateChain, 'rentExempt'>): Promise<Rents> {
  return {
    wallet: await chain.rentExempt(0),
    stake: await chain.rentExempt(STAKE_ACCOUNT_SIZE),
    nonce: await chain.rentExempt(NONCE_ACCOUNT_SIZE),
  };
}

export type Budget = {
  /** Lamports each role key gets from the funder before the checks (not on mainnet). */
  floats: Partial<Record<Role, bigint>>;
  /** What the funder must hold before the run. */
  required: bigint;
  /** The parts of `required`, for the printout. */
  items: { label: string; lamports: bigint }[];
  /** Network fees of the whole run: the only lamports that do not come back. */
  fees: bigint;
};

export function planFees(cluster: GateCluster, role: Role): bigint {
  return (FEE_PLAN[cluster][role] ?? []).reduce((sum, signatures) => sum + transactionFee(signatures), 0n);
}

/**
 * Exact funding for one run. Every account keeps the rent-exempt minimum after each fee (the runtime rejects a fee
 * payer that would drop below it), so each paying key gets rent + its fees, and the funder keeps its own rent.
 */
export function gateBudget(cluster: GateCluster, rents: Rents): Budget {
  const fees = (['funder', 'A', 'B', 'X', 'D'] as const).reduce((sum, role) => sum + planFees(cluster, role), 0n);
  if (cluster === 'mainnet') {
    const items = [
      { label: 'S1, неделегированный стейк-аккаунт (залог за аренду, вернётся)', lamports: rents.stake },
      { label: `комиссии ${String(FEE_PLAN.mainnet.A?.length ?? 0)} транзакций`, lamports: fees },
      { label: 'остаток, без которого ключ не может платить комиссии (вернётся)', lamports: rents.wallet },
    ];
    return { floats: {}, required: sum(items), items, fees };
  }
  const floats = {
    A: rents.wallet + planFees(cluster, 'A'),
    B: rents.wallet + planFees(cluster, 'B'),
    D: rents.wallet + rents.nonce + planFees(cluster, 'D'),
  };
  const items = [
    { label: 'S1: залог за аренду + 1 SOL, минимум делегации', lamports: rents.stake + MIN_DELEGATION_LAMPORTS },
    { label: 'S2 (цель Split), Sm (для Merge), S3 (спасение на nonce): залоги за аренду', lamports: 3n * rents.stake },
    ...(cluster === 'litesvm' ? [{ label: 'S4 (проверка 14): залог за аренду', lamports: rents.stake }] : []),
    { label: 'ключ A: остаток + комиссии', lamports: floats.A },
    { label: 'ключ B: остаток + комиссии', lamports: floats.B },
    { label: 'ключ D: остаток + залог nonce-аккаунта + комиссии', lamports: floats.D },
    { label: 'комиссии спонсора: подготовка и возврат средств', lamports: planFees(cluster, 'funder') },
    { label: 'остаток спонсора', lamports: rents.wallet },
  ];
  return { floats, required: sum(items), items, fees };
}

function sum(items: readonly { lamports: bigint }[]): bigint {
  return items.reduce((total, item) => total + item.lamports, 0n);
}
