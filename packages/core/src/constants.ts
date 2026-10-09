import { address } from '@solana/kit';
import { COMPUTE_BUDGET_PROGRAM_ADDRESS } from '@solana-program/compute-budget';
import { STAKE_PROGRAM_ADDRESS } from '@solana-program/stake';
import { getNonceSize, SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system';

export { COMPUTE_BUDGET_PROGRAM_ADDRESS, STAKE_PROGRAM_ADDRESS, SYSTEM_PROGRAM_ADDRESS };

/**
 * Solana cluster the app runs against. A setting passed in by the caller, not a code branch (CLAUDE.md section 3);
 * core never reads the environment.
 */
export type Cluster = 'mainnet' | 'devnet';

/**
 * Genesis hash of each cluster (RPC getGenesisHash). Tells which cluster an RPC endpoint really serves: the scripts
 * check it before they send, the monitor before it believes a batch of missing accounts.
 */
export const GENESIS_HASH = {
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  mainnet: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
} as const satisfies Record<Cluster, string>;

/**
 * Phantom may append Lighthouse assertion instructions to the end of a transaction (CLAUDE.md section 6).
 * It is the only program besides stake, system (nonce) and compute budget that may appear in our transactions.
 */
export const LIGHTHOUSE_PROGRAM_ADDRESS = address('L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95');

/** Owner of every sysvar account (Clock included). */
export const SYSVAR_PROGRAM_ADDRESS = address('Sysvar1111111111111111111111111111111111111');

/** Sysvars inserted into the legacy (Ledger-parsable) stake instruction layouts (DECISIONS.md D1). */
export const SYSVAR_CLOCK_ADDRESS = address('SysvarC1ock11111111111111111111111111111111');
export const SYSVAR_STAKE_HISTORY_ADDRESS = address('SysvarStakeHistory1111111111111111111111111');
/** Unused by the program, but the legacy DelegateStake layout has a slot for it. */
export const STAKE_CONFIG_ADDRESS = address('StakeConfig11111111111111111111111111111111');
/** Sysvars of the nonce instructions (the system client fills them in by default). */
export const SYSVAR_RECENT_BLOCKHASHES_ADDRESS = address('SysvarRecentB1ockHashes11111111111111111111');
export const SYSVAR_RENT_ADDRESS = address('SysvarRent111111111111111111111111111111111');

/** The all-zero public key (base58 of 32 zero bytes). An unset custodian reads as this key. */
export const ZERO_ADDRESS = address('11111111111111111111111111111111');

/** Size in bytes of every stake account (StakeStateV2); the `dataSize` filter for getProgramAccounts. */
export const STAKE_ACCOUNT_SIZE = 200;

/**
 * Byte offsets of the authority keys inside stake account data, for getProgramAccounts `memcmp` filters
 * (CLAUDE.md section 4). Decode accounts with the generated client; these offsets are for filters only.
 */
export const STAKE_ACCOUNT_OFFSETS = {
  staker: 12,
  withdrawer: 44,
  custodian: 92,
} as const;

/** Size in bytes of a durable nonce account (80). */
export const NONCE_ACCOUNT_SIZE = getNonceSize();

/**
 * Default address-derivation seed for the nonce account (System CreateAccountWithSeed, base = the new wallet).
 * This is a plain label that makes the nonce address deterministic; it is not a key and not a seed phrase.
 */
export const NONCE_ACCOUNT_SEED = 'stakeward-nonce';

/** u64::MAX: `deactivation_epoch` of a delegation that is not being deactivated. */
export const U64_MAX = 0xffff_ffff_ffff_ffffn;
/** i64::MAX: the largest lockup unix timestamp the program can store. */
export const I64_MAX = 0x7fff_ffff_ffff_ffffn;

/**
 * The latest lockup end Stakeward builds: 2100-01-01T00:00:00Z. Real ends are at most about 13 months ahead (D13);
 * the cap keeps every lockup end a signing screen shows a readable date (a JavaScript Date ends at 8.64e12 s, the
 * program accepts any i64).
 */
export const MAX_LOCKUP_END = 4_102_444_800n;

/**
 * Fixed compute unit limit for every Stakeward transaction (CLAUDE.md section 5: fixed limit, no fee market logic).
 * Measured on LiteSVM with the mainnet stake program v5.1.0 (DECISIONS.md D16): the largest kind is the rescue pair on
 * a nonce, 25 795 CU. The limit is more than twice that, leaving room for a Lighthouse tail a wallet may append;
 * test/builders.svm.test.ts fails if any kind uses more than half of it.
 */
export const COMPUTE_UNIT_LIMIT = 60_000;

/** Fixed, small priority fee: micro-lamports per compute unit. At the limit above this adds 600 lamports. */
export const COMPUTE_UNIT_PRICE_MICRO_LAMPORTS = 10_000n;

/** Lockups ending within this many seconds are shown as "Expiring" (CLAUDE.md section 5: 30 days). */
export const EXPIRING_THRESHOLD_SECONDS = 30n * 86_400n;
