import {
  address,
  blockhash,
  type Address,
  type Nonce,
} from '@solana/kit';
import {
  buildTransaction,
  deriveNonceAccountAddress,
  inspectTransaction,
  scannerStatus,
  stakeActivationStatus,
  U64_MAX,
  ZERO_ADDRESS,
  type ActivationStatus,
  type BlockhashLifetime,
  type ClockView,
  type InspectError,
  type Lockup,
  type ProtectionStatus,
  type StakeAccount,
  type TransactionAction,
  type TransactionSummary,
} from '@stakeward/core';
import type { StatusBadgeStatus } from '@/components/product/status-badge';
import walletSampleA from './wallet-sample-a.svg';
import walletSampleB from './wallet-sample-b.svg';

/**
 * Realistic sample data for /dev/ui: core types, real statuses from core, real inspector output from bytes that
 * `buildTransaction` produced. Addresses only (random public keys); no key material anywhere.
 */
export const SAMPLE = {
  stakeA: address('AYA9kYsn7XVDTPARBfAuASypyyDGFJw1Xds2vHgW9DfW'),
  stakeB: address('2Xtq6iZ2mXjxTNsv5FrYCzayG5qYRJwZ6837A1X3TjF6'),
  stakeC: address('8EoRwu9o1xqJ68N1ECPGoGN3DG8hrFwZPN3pxpdEGNpe'),
  stakeD: address('5RA1fUbNMm4rdu5EuQhiBMGsCFfspRzCscfojXZFWAXU'),
  stakeE: address('ERPac8FPHDCFd6Nr8z9FFYJVzj1XptzQ6uxN1praU9wz'),
  stakeF: address('CQDtFDsjfViMT8Sgfe3TbeiAFaDgZfzGsiLsQCqa4tpE'),
  stakeG: address('9g4dYJmEszBwLq4itZhnatz9BPWCkcFT4ni5CkNMDHAy'),
  mainKey: address('B1agBSrGRgub2jXMJEozYkRLRzFc9HLd5hHjSrCtuXu8'),
  secondKey: address('9DpLwZiYboWcwYFVtSjSksfaP9EqVoSuZw7Jofet96fi'),
  otherKey: address('57M4tyxx6Rk1gz3uYVvfoB3KdQGQkyveqqmZzJUdw3Sz'),
  newWallet: address('21KaHQkRg8ntwcEF3Q1Y5wooZ1GC372Eu4yFQc5LRRFH'),
  serviceStaker: address('B4LfFcz7EuD8wWFM9qxMswgryP36jbGvKWhzLGXBR5t9'),
  stranger: address('ndzhVeZpY8BRWqkFtY4BUWHRb32nD3J9NrVq6Bz5vCD'),
  voteAccount: address('2YH4Dt2o14vVVS9wW8q1UkfodZLpE2Fj6cjTqCLFi4Tv'),
  blockhash: blockhash('BZFufDqppShyDDC1njm4fMpRbfnLwrpzzwG6WGgcmsxb'),
  nonceValue: '6xL7jWSuZg4oBfsLyVNjEJ6EK7qJQAX2HswMTw3GF6ki' as Nonce,
} as const;

/** A transaction signature for AddressText kind="tx" (random bytes, base58). */
export const SAMPLE_SIGNATURE = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';

/** Raw error texts as they would appear under "Details" (sample data, not UI strings). */
export const SAMPLE_ERROR_DETAIL = {
  rpc: 'HTTP 503 Service Unavailable',
  wallet: 'WalletConnectionError: timed out after 60000 ms',
  fetch: 'TypeError: Failed to fetch',
} as const;

/** 12 April 2027 00:00 UTC, the date in CLAUDE.md's examples. */
export const SAMPLE_LOCK_END = 1_807_488_000n;
/** 1 January 2027 00:00 UTC: earlier than SAMPLE_LOCK_END, for the "shortens the lock" warning. */
export const SAMPLE_EARLIER_END = 1_798_761_600n;
export const SAMPLE_EPOCH = 850n;
/** Rent-exempt reserve of a stake account at 5080 lamports per byte (DECISIONS.md D22). */
const STAKE_RESERVE = 1_666_240n;
const LAMPORTS_PER_SOL = 1_000_000_000n;
const DAY = 86_400n;

/** Fake wallets for WalletSlot (Wallet Standard gives a name and a data: URI icon). Not real wallet brands. */
export const SAMPLE_WALLETS = [
  { id: 'sample-wallet', name: 'Sample Wallet', icon: walletSampleA },
  { id: 'demo-wallet', name: 'Demo Wallet', icon: walletSampleB },
] as const;

export function sampleClock(): ClockView {
  return { unixTimestamp: BigInt(Math.floor(Date.now() / 1000)), epoch: SAMPLE_EPOCH };
}

/** The first 00:00 UTC at least `days` days after now. */
function midnightAfter(clock: ClockView, days: bigint): bigint {
  const t = clock.unixTimestamp + days * DAY;
  return t - (t % DAY) + DAY;
}

/** Lock end of the "Expiring soon" sample: less than 30 days away. */
export function sampleExpiringEnd(clock: ClockView): bigint {
  return midnightAfter(clock, 18n);
}

const NO_LOCK: Lockup = { unixTimestamp: 0n, epoch: 0n, custodian: ZERO_ADDRESS };

type SampleStake = {
  address: Address;
  sol: bigint;
  lamportsExtra?: bigint;
  lockup?: Lockup;
  staker?: Address;
  activation: ActivationStatus;
};

function stakeAccount(sample: SampleStake): StakeAccount {
  const lamports = sample.sol * LAMPORTS_PER_SOL + (sample.lamportsExtra ?? 0n);
  const delegated = lamports - STAKE_RESERVE;
  const epochs: Record<ActivationStatus, [bigint, bigint] | null> = {
    active: [700n, U64_MAX],
    activating: [SAMPLE_EPOCH, U64_MAX],
    deactivating: [700n, SAMPLE_EPOCH],
    inactive: null,
  };
  const range = epochs[sample.activation];
  return {
    address: sample.address,
    lamports,
    kind: range === null ? 'initialized' : 'delegated',
    rentExemptReserve: STAKE_RESERVE,
    staker: sample.staker ?? SAMPLE.mainKey,
    withdrawer: SAMPLE.mainKey,
    lockup: sample.lockup ?? NO_LOCK,
    delegation:
      range === null
        ? null
        : { voter: SAMPLE.voteAccount, stake: delegated, activationEpoch: range[0], deactivationEpoch: range[1] },
  };
}

export type SampleRow = {
  key: StatusBadgeStatus | 'managed-by-service';
  account: StakeAccount;
  activation: ActivationStatus;
  protection: ProtectionStatus;
  managedByService: boolean;
  secondKeyConfirmed: boolean;
  wasProtected: boolean;
};

/**
 * One account per status. Statuses come from core: `scannerStatus` with the second keys this viewer is known to
 * hold, and `stakeActivationStatus` from the epochs. The "second key not connected" row stands for a lock in force
 * while the viewer has no known second key (D14 refinement: Protected with that note); until core's scannerStatus
 * reports it, the row sets `secondKeyConfirmed: false` itself.
 */
export function sampleRows(clock: ClockView): SampleRow[] {
  const known = [SAMPLE.secondKey];
  const lock = (unixTimestamp: bigint, custodian: Address): Lockup => ({ unixTimestamp, epoch: 0n, custodian });
  const rows: { key: SampleRow['key']; stake: SampleStake; secondKeys?: readonly Address[]; secondKeyConfirmed?: boolean; wasProtected?: boolean }[] =
    [
      {
        key: 'protected',
        stake: { address: SAMPLE.stakeA, sol: 1_250n, lamportsExtra: 500_000_000n, activation: 'active', lockup: lock(SAMPLE_LOCK_END, SAMPLE.secondKey) },
      },
      {
        key: 'expiring',
        stake: { address: SAMPLE.stakeB, sol: 42n, lamportsExtra: 750_000_000n, activation: 'deactivating', lockup: lock(sampleExpiringEnd(clock), SAMPLE.secondKey) },
      },
      { key: 'unprotected', stake: { address: SAMPLE.stakeC, sol: 3n, lamportsExtra: 200_000_000n, activation: 'activating' } },
      {
        key: 'locked-by-other',
        stake: { address: SAMPLE.stakeD, sol: 10n, activation: 'inactive', lockup: lock(SAMPLE_LOCK_END, SAMPLE.otherKey) },
      },
      {
        key: 'second-key-not-connected',
        stake: { address: SAMPLE.stakeE, sol: 7n, lamportsExtra: 1n, activation: 'active', lockup: lock(SAMPLE_LOCK_END, SAMPLE.secondKey) },
        secondKeys: [SAMPLE.secondKey],
        secondKeyConfirmed: false,
      },
      {
        key: 'was-protected',
        stake: { address: SAMPLE.stakeF, sol: 120n, activation: 'active', lockup: lock(clock.unixTimestamp - 2n * DAY, SAMPLE.secondKey) },
        wasProtected: true,
      },
      {
        key: 'managed-by-service',
        stake: { address: SAMPLE.stakeG, sol: 64n, activation: 'active', staker: SAMPLE.serviceStaker },
      },
    ];
  return rows.map((row) => {
    const account = stakeAccount(row.stake);
    const view = scannerStatus(account, row.secondKeys ?? known, clock);
    return {
      key: row.key,
      account,
      activation: stakeActivationStatus(account.delegation, clock.epoch),
      protection: view.status,
      managedByService: view.managedByService,
      secondKeyConfirmed: row.secondKeyConfirmed ?? true,
      wasProtected: row.wasProtected ?? false,
    };
  });
}

export type SampleSummary =
  | { key: string; ok: true; summary: TransactionSummary; current?: { lockup: Lockup; clock: ClockView } }
  | { key: string; ok: false; error: InspectError };

/**
 * Builds unsigned transactions with core `buildTransaction` and reads them back with `inspectTransaction`, exactly
 * as a signing screen does, so the summaries on /dev/ui are real inspector output.
 */
export async function sampleSummaries(clock: ClockView): Promise<SampleSummary[]> {
  const live: BlockhashLifetime = { kind: 'blockhash', blockhash: SAMPLE.blockhash, lastValidBlockHeight: 300_000_000n };
  const nonceAccount = await deriveNonceAccountAddress(SAMPLE.newWallet);
  const locked = (unixTimestamp: bigint, custodian: Address) => ({ lockup: { unixTimestamp, epoch: 0n, custodian }, clock });
  const inspect = async (
    key: string,
    action: TransactionAction,
    feePayer: Address,
    current?: { lockup: Lockup; clock: ClockView },
    lifetime: Parameters<typeof buildTransaction>[1]['lifetime'] = live,
  ): Promise<SampleSummary> => {
    const { bytes } = buildTransaction(action, { feePayer, lifetime });
    const result = await inspectTransaction(bytes);
    if (!result.ok) return { key, ok: false, error: result.error };
    return current === undefined ? { key, ok: true, summary: result.summary } : { key, ok: true, summary: result.summary, current };
  };
  const balance = 42n * LAMPORTS_PER_SOL + 750_000_000n;
  const results = await Promise.all([
    inspect(
      'protect',
      { kind: 'protect', stakeAccount: SAMPLE.stakeC, mainKey: SAMPLE.mainKey, secondKey: SAMPLE.secondKey, lockUntil: SAMPLE_LOCK_END },
      SAMPLE.mainKey,
      { lockup: NO_LOCK, clock },
    ),
    inspect(
      'extend',
      { kind: 'extend', stakeAccount: SAMPLE.stakeA, secondKey: SAMPLE.secondKey, lockUntil: SAMPLE_EARLIER_END },
      SAMPLE.secondKey,
      locked(SAMPLE_LOCK_END, SAMPLE.secondKey),
    ),
    inspect(
      'withdraw',
      { kind: 'withdraw', stakeAccount: SAMPLE.stakeB, mainKey: SAMPLE.mainKey, secondKey: SAMPLE.secondKey, recipient: SAMPLE.mainKey, lamports: balance },
      SAMPLE.mainKey,
    ),
    inspect(
      'rescue',
      { kind: 'rescue', stakeAccount: SAMPLE.stakeA, mainKey: SAMPLE.mainKey, secondKey: SAMPLE.secondKey, newWallet: SAMPLE.newWallet },
      SAMPLE.newWallet,
      locked(SAMPLE_LOCK_END, SAMPLE.secondKey),
      { kind: 'nonce', nonceAccount, nonceAuthority: SAMPLE.newWallet, nonceValue: SAMPLE.nonceValue },
    ),
    inspect(
      'unlock',
      { kind: 'unlock', stakeAccount: SAMPLE.stakeA, secondKey: SAMPLE.secondKey },
      SAMPLE.secondKey,
      locked(SAMPLE_LOCK_END, SAMPLE.secondKey),
    ),
  ]);
  // Not a transaction at all: what /cosign shows for a broken link.
  const garbage = await inspectTransaction(new Uint8Array([1, 2, 3]));
  if (!garbage.ok) results.push({ key: 'rejected', ok: false, error: garbage.error });
  return results;
}
