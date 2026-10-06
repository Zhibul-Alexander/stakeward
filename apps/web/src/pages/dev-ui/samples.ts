import {
  address,
  blockhash,
  signature,
  type Address,
  type Nonce,
  type Signature,
} from '@solana/kit';
import {
  buildTransaction,
  deriveNonceAccountAddress,
  inspectTransaction,
  scannerStatus,
  stakeActivationStatus,
  summariesMatchExceptStakeAccount,
  U64_MAX,
  ZERO_ADDRESS,
  type ActivationStatus,
  type BlockhashLifetime,
  type ClockView,
  type InspectError,
  type Lockup,
  type NonceLifetime,
  type ProtectionStatus,
  type StakeAccount,
  type TransactionAction,
  type TransactionSummary,
} from '@stakeward/core';
import type { JobStatusItem } from '@/components/product/job-status-list';
import type { SignerListItem } from '@/components/product/signer-list';
import type { StatusBadgeStatus } from '@/components/product/status-badge';
import type { SummaryBatch } from '@/components/product/transaction-summary';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import type { PairSupport } from '@/pages/landing/wallet-support';
import { buildRecoveryCard, type RecoveryCard } from '@/pages/recovery/view';
import { cosignUrl } from '@/signing/link';
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
  stakeH: address('GY6YBjCbJnAmNUzG99w9kfGms6PiSEdzHdr8NqfTX6Bh'),
  stakeI: address('7pHLy34Aw8xKKbhpaexKaT4Ruc3wLiYGgj1smirdFLxk'),
  stakeJ: address('HchUMm8CfoKw5Gz1PD8TUexMfXPXK8ALkb2tKH7Q75Kx'),
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
/** The same signature, typed (LinkCard, JobStatusList). */
export const SAMPLE_TX: Signature = signature(SAMPLE_SIGNATURE);

/** Raw error texts as they would appear under "Details" (sample data, not UI strings). */
export const SAMPLE_ERROR_DETAIL = {
  rpc: 'HTTP 503 Service Unavailable',
  wallet: 'WalletConnectionError: timed out after 60000 ms',
  fetch: 'TypeError: Failed to fetch',
  rateLimited: 'HTTP error (429): Too Many Requests',
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
  key: StatusBadgeStatus | 'managed-by-service' | 'stake-key-changed';
  account: StakeAccount;
  activation: ActivationStatus;
  protection: ProtectionStatus;
  managedByService: boolean;
  wasProtected: boolean;
};

/**
 * One account per status. Statuses come from core: `scannerStatus` with the second keys this viewer is known to
 * hold, and `stakeActivationStatus` from the epochs.
 */
export function sampleRows(clock: ClockView): SampleRow[] {
  const known = [SAMPLE.secondKey];
  const lock = (unixTimestamp: bigint, custodian: Address): Lockup => ({ unixTimestamp, epoch: 0n, custodian });
  const rows: { key: SampleRow['key']; stake: SampleStake; wasProtected?: boolean }[] =
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
        key: 'was-protected',
        stake: { address: SAMPLE.stakeF, sol: 120n, activation: 'active', lockup: lock(clock.unixTimestamp - 2n * DAY, SAMPLE.secondKey) },
        wasProtected: true,
      },
      {
        key: 'managed-by-service',
        stake: { address: SAMPLE.stakeG, sol: 64n, activation: 'active', staker: SAMPLE.serviceStaker },
      },
      {
        // Under the viewer's own lock another key took over staking: what a thief with the main key does first.
        key: 'stake-key-changed',
        stake: {
          address: SAMPLE.stakeE,
          sol: 300n,
          activation: 'deactivating',
          staker: SAMPLE.stranger,
          lockup: lock(SAMPLE_LOCK_END, SAMPLE.secondKey),
        },
      },
    ];
  return rows.map((row) => {
    const account = stakeAccount(row.stake);
    const view = scannerStatus(account, known, clock);
    return {
      key: row.key,
      account,
      activation: stakeActivationStatus(account.delegation, clock.epoch),
      protection: view.status,
      managedByService: view.managedByService,
      wasProtected: row.wasProtected ?? false,
    };
  });
}

/**
 * The recovery card of the sample keys (spec 4.7), built by the page's own rules: the route's lock ends in 20 days at
 * 14:30 UTC, so the time shows and the "lock ends" note appears; a second account has another stake authority; one
 * more account of the main key has no lock (`others: 1`).
 */
export function sampleRecoveryCard(clock: ClockView): RecoveryCard {
  const lock = (unixTimestamp: bigint): Lockup => ({ unixTimestamp, epoch: 0n, custodian: SAMPLE.secondKey });
  const soon = clock.unixTimestamp - (clock.unixTimestamp % DAY) + 20n * DAY + 14n * 3_600n + 30n * 60n;
  const route = stakeAccount({ address: SAMPLE.stakeA, sol: 1_250n, lamportsExtra: 500_000_000n, activation: 'active', lockup: lock(soon) });
  const managed = stakeAccount({
    address: SAMPLE.stakeG,
    sol: 64n,
    activation: 'active',
    staker: SAMPLE.serviceStaker,
    lockup: lock(midnightAfter(clock, 200n)),
  });
  const open = stakeAccount({ address: SAMPLE.stakeC, sol: 3n, lamportsExtra: 200_000_000n, activation: 'activating' });
  return buildRecoveryCard(route, [managed, open], clock);
}

export type SampleSummary =
  | { key: string; ok: true; summary: TransactionSummary; current?: { lockup: Lockup; clock: ClockView }; batch?: SummaryBatch }
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
  // A protect round over two accounts, as the signing panel shows it: one summary when the transactions differ only
  // in the stake account (core summariesMatchExceptStakeAccount), each account with its balance and lock now.
  const protectBatch = async (): Promise<SampleSummary> => {
    const protectOf = (stakeAccount: Address): TransactionAction => ({
      kind: 'protect',
      stakeAccount,
      mainKey: SAMPLE.mainKey,
      secondKey: SAMPLE.secondKey,
      lockUntil: SAMPLE_LOCK_END,
    });
    const read = await Promise.all(
      [SAMPLE.stakeC, SAMPLE.stakeF].map((stake) =>
        inspectTransaction(buildTransaction(protectOf(stake), { feePayer: SAMPLE.mainKey, lifetime: live }).bytes),
      ),
    );
    const summaries: TransactionSummary[] = [];
    for (const result of read) {
      if (!result.ok) return { key: 'protect-batch', ok: false, error: result.error };
      summaries.push(result.summary);
    }
    const [first] = summaries;
    if (first === undefined || !summariesMatchExceptStakeAccount(summaries)) {
      throw new Error('the batch sample transactions differ in more than the stake account');
    }
    return {
      key: 'protect-batch',
      ok: true,
      summary: first,
      batch: {
        accounts: [
          { address: SAMPLE.stakeC, lamports: 3n * LAMPORTS_PER_SOL + 200_000_000n, current: { lockup: NO_LOCK, clock } },
          {
            address: SAMPLE.stakeF,
            lamports: 120n * LAMPORTS_PER_SOL,
            current: { lockup: { unixTimestamp: clock.unixTimestamp - 2n * DAY, epoch: 0n, custodian: SAMPLE.secondKey }, clock },
          },
        ],
        totalFeeLamports: summaries.reduce((total, summary) => total + summary.networkFeeLamports, 0n),
      },
    };
  };
  const results = await Promise.all([
    inspect(
      'protect',
      { kind: 'protect', stakeAccount: SAMPLE.stakeC, mainKey: SAMPLE.mainKey, secondKey: SAMPLE.secondKey, lockUntil: SAMPLE_LOCK_END },
      SAMPLE.mainKey,
      { lockup: NO_LOCK, clock },
    ),
    protectBatch(),
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

/** SignerList as a protect round shows it after the main key signed: the second key's turn. */
export function sampleSigners(): SignerListItem[] {
  const [walletA, walletB] = SAMPLE_WALLETS;
  return [
    { role: 'main', walletName: walletA.name, address: SAMPLE.mainKey, count: 2, status: 'signed' },
    { role: 'second', walletName: walletB.name, address: SAMPLE.secondKey, count: 2, status: 'current' },
  ];
}

/** One signer in each status; the last has no wallet connected in this browser. */
export function sampleSignersEveryStatus(): SignerListItem[] {
  const [walletA, walletB] = SAMPLE_WALLETS;
  return [
    { role: 'main', walletName: walletA.name, address: SAMPLE.mainKey, count: 1, status: 'signed' },
    { role: 'second', walletName: walletB.name, address: SAMPLE.secondKey, count: 1, status: 'current' },
    { role: 'new', walletName: walletA.name, address: SAMPLE.newWallet, count: 1, status: 'waiting' },
    { role: 'second', walletName: walletA.name, address: SAMPLE.otherKey, count: 3, status: 'switch' },
    { role: 'main', walletName: walletB.name, address: SAMPLE.stranger, count: 3, status: 'stopped' },
    { role: 'new', walletName: null, address: SAMPLE.serviceStaker, count: 1, status: 'missing' },
    { role: 'second', walletName: null, address: SAMPLE.secondKey, count: 1, status: 'link' },
  ];
}

/** A rescue of stake A to the new wallet on its durable nonce: the longest link Stakeward makes (a real core build). */
export async function sampleRescueOnNonce(): Promise<{ bytes: Uint8Array; lifetime: NonceLifetime }> {
  const lifetime: NonceLifetime = {
    kind: 'nonce',
    nonceAccount: await deriveNonceAccountAddress(SAMPLE.newWallet),
    nonceAuthority: SAMPLE.newWallet,
    nonceValue: SAMPLE.nonceValue,
  };
  const action: TransactionAction = {
    kind: 'rescue',
    stakeAccount: SAMPLE.stakeA,
    mainKey: SAMPLE.mainKey,
    secondKey: SAMPLE.secondKey,
    newWallet: SAMPLE.newWallet,
  };
  return { bytes: buildTransaction(action, { feePayer: SAMPLE.newWallet, lifetime }).bytes, lifetime };
}

/** The signing link of that rescue on this site, as the first device shows it (LinkCard, QrCode). */
export async function sampleLinkUrl(origin: string): Promise<string> {
  return cosignUrl((await sampleRescueOnNonce()).bytes, origin);
}

/** One stake account in each status of a signing run, with the reason texts the pages give them. */
export function sampleJobs(): JobStatusItem[] {
  return [
    { address: SAMPLE.stakeA, status: 'waiting' },
    { address: SAMPLE.stakeB, status: 'sending', signature: SAMPLE_TX },
    { address: SAMPLE.stakeC, status: 'confirming', signature: SAMPLE_TX },
    { address: SAMPLE.stakeD, status: 'checking', signature: SAMPLE_TX },
    { address: SAMPLE.stakeE, status: 'done', signature: SAMPLE_TX },
    {
      address: SAMPLE.stakeF,
      status: 'failed',
      reason: errorMessage({ code: 'rate-limited' }),
      detail: SAMPLE_ERROR_DETAIL.rateLimited,
      signature: SAMPLE_TX,
    },
    { address: SAMPLE.stakeG, status: 'expired', reason: t('components.jobs.expired'), signature: SAMPLE_TX },
    {
      address: SAMPLE.stakeH,
      status: 'unknown',
      reason: t('components.jobs.unknown.timeout'),
      signature: SAMPLE_TX,
    },
    { address: SAMPLE.stakeI, status: 'not-sent' },
    { address: SAMPLE.stakeJ, status: 'left-out' },
  ];
}

/**
 * The landing's wallet table as a matrix run might fill it (wallet-support.ts filling rules): every verdict and every
 * note at least once, so the /dev/ui 360 px check covers the longest of them. Made up; the landing shows the real data.
 */
export const SAMPLE_WALLET_PAIRS: readonly PairSupport[] = [
  { id: 'phantom+solflare', main: 'phantom', second: 'solflare', here: 'works', link: 'works-with-warning', note: 'new-site-warning' },
  { id: 'phantom+backpack', main: 'phantom', second: 'backpack', here: 'works-with-warning', link: 'works', note: 'phantom-first' },
  { id: 'solflare+backpack', main: 'solflare', second: 'backpack', here: 'works', link: 'not-verified', note: 'link-same-browser' },
  {
    id: 'phantom+phantom-imported',
    main: 'phantom',
    second: 'phantom-imported',
    here: 'works',
    link: 'works',
    note: 'switch-account',
  },
  { id: 'ledger-phantom+any', main: 'ledger-phantom', second: 'any', here: 'blind-signing', link: 'blind-signing', note: 'ledger-blind' },
  { id: 'ledger-solflare+any', main: 'ledger-solflare', second: 'any', here: 'does-not-work', link: 'not-verified', note: null },
];

/** The matrix date of the sample wallet table. */
export const SAMPLE_MATRIX_DATE = '2026-10-06';
