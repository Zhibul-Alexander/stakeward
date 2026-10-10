import type { Address } from '@solana/kit';
import type { StakeAccount } from './decode.ts';
import type { ClockView } from './lockup.ts';
import { groupForViewer, scannerStatus, stakeActivationStatus, type ActivationStatus, type ProtectionStatus } from './status.ts';

/** One stake account on the public proof page (/proof/:wallet, DECISIONS.md D124). */
export type ProofRow = {
  account: StakeAccount;
  activation: ActivationStatus;
  /**
   * Core `scannerStatus` with no second key known: the page cannot say whose key holds a lock (D14), so a lock in force
   * of a key other than the main key is `locked-by-other`, anything else `unprotected`.
   */
  protection: ProtectionStatus;
  managedByService: boolean;
  /** The lock is in force and held by a key other than the main key: the main key alone cannot withdraw. */
  locked: boolean;
  /**
   * When the lock ends (unix seconds), for a lock its timestamp alone holds (epoch 0, as Stakeward sets it); null for
   * no lock, or a lock with an epoch, whose end the timestamp does not tell (the account row shows no date for it).
   */
  lockEnd: bigint | null;
};

export type ProofView = {
  wallet: Address;
  /** Stake accounts whose main key (withdrawer) is the wallet: those without a lock first, then by lock end. */
  rows: ProofRow[];
  totals: {
    /** Stake accounts of the wallet. */
    count: number;
    /** Of them, locked. */
    lockedCount: number;
    /** SOL in all of them, in lamports. */
    lamports: bigint;
    /** SOL in the locked ones. */
    lockedLamports: bigint;
  };
  /** The first dated lock end of the locked accounts; null when none has a date. */
  earliestLockEnd: bigint | null;
};

/**
 * What the proof page shows for `wallet`, from chain data only: the stake accounts it is the main key of, which are
 * locked, until when and by which second key, and the totals. Pure, the same input gives the same page. Accounts the
 * wallet only holds a lock for, or only stakes, are left out: the page proves the wallet's own stake.
 */
export function buildProof(wallet: Address, accounts: readonly StakeAccount[], clock: ClockView): ProofView {
  const unique = new Map<Address, StakeAccount>();
  for (const account of accounts) unique.set(account.address, account);
  const { owned } = groupForViewer([...unique.values()], wallet);
  const rows = owned.map((account): ProofRow => {
    const view = scannerStatus(account, [], clock);
    const locked = view.status === 'locked-by-other';
    return {
      account,
      activation: stakeActivationStatus(account.delegation, clock.epoch),
      protection: view.status,
      managedByService: view.managedByService,
      locked,
      lockEnd: locked && account.lockup.epoch === 0n ? account.lockup.unixTimestamp : null,
    };
  });
  rows.sort(byProofOrder);
  const lockedRows = rows.filter((row) => row.locked);
  let earliestLockEnd: bigint | null = null;
  for (const row of lockedRows) {
    if (row.lockEnd !== null && (earliestLockEnd === null || row.lockEnd < earliestLockEnd)) earliestLockEnd = row.lockEnd;
  }
  return {
    wallet,
    rows,
    totals: {
      count: rows.length,
      lockedCount: lockedRows.length,
      lamports: sum(rows),
      lockedLamports: sum(lockedRows),
    },
    earliestLockEnd,
  };
}

/** Without a lock first (what the page must not hide), then the lock that ends first, then the larger account. */
function byProofOrder(a: ProofRow, b: ProofRow): number {
  if (a.locked !== b.locked) return a.locked ? 1 : -1;
  if (a.lockEnd !== b.lockEnd) {
    if (a.lockEnd === null) return 1;
    if (b.lockEnd === null) return -1;
    return a.lockEnd < b.lockEnd ? -1 : 1;
  }
  if (a.account.lamports !== b.account.lamports) return a.account.lamports > b.account.lamports ? -1 : 1;
  return a.account.address < b.account.address ? -1 : a.account.address > b.account.address ? 1 : 0;
}

function sum(rows: readonly ProofRow[]): bigint {
  return rows.reduce((total, row) => total + row.account.lamports, 0n);
}
