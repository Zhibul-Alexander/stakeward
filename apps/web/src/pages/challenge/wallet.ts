// The public "Try to steal it" wallets (DECISIONS.md D133, D154): one on devnet (scripts/challenge-wallet.ts, D130),
// one on mainnet. Each MAIN key is published on purpose: the point is that the main key alone cannot take the stake.
// The keys themselves are not in this repository: the page reads its cluster's key from GET /api/challenge, which the
// Worker serves from its CHALLENGE_MAIN_KEY secret (apps/worker/src/challenge.ts names the same main keys). The second
// keys that hold the locks are never in either. A build keeps only its own cluster's wallet: CHALLENGE picks it with
// the literal comparison that Vite folds (as routes.tsx), so the other one is dropped (test/build-output.test.ts).
import type { Address } from '@solana/kit';

export type ChallengeWallet = {
  /** Staker and withdrawer of the stake account. */
  readonly mainKey: Address;
  readonly stakeAccount: Address;
  /** The custodian of the lock. Only its address is public. */
  readonly secondKey: Address;
  /** End of the lock, unix seconds. */
  readonly lockUntil: bigint;
  /** Lamports the stake account held once it was set up: what "Taken" counts down from (rewards only add to it). */
  readonly startLamports: bigint;
};

export const DEVNET_CHALLENGE: ChallengeWallet = {
  mainKey: '9QeBtMG3LbdUz7sHHjmJMQ243Pn8Tb1A4WmwM3SJjRKf' as Address,
  stakeAccount: 'FuXxGyzezXKrmHa784Uio8qfo4D9dzov639wPC6RTVA5' as Address,
  secondKey: 'GhVdLekCV7KySTbDrdeFWyryPRxQsfbwBn6UUGS7FpK' as Address,
  /** 2027-10-12 00:00:00 UTC, as set on 11 October 2026. */
  lockUntil: 1_823_299_200n,
  startLamports: 101_666_240n,
};

export const MAINNET_CHALLENGE: ChallengeWallet = {
  mainKey: 'k58pveSMKrZzpmuhSxjVssPWpZLUoKgESwdWP4mJkrw' as Address,
  stakeAccount: '3zFC5aZTNg1VfH7WoAtmeS94NVyLxYQmEw6jxWM6o3Dw' as Address,
  secondKey: '52HsrUZCJxr9Bh9ZWw8XL3jPLqnZ5DWvJqMAqerAJFLy' as Address,
  /** 2027-04-14 00:00:00 UTC, as set on 13 October 2026. */
  lockUntil: 1_807_660_800n,
  startLamports: 1_010_278_760n,
};

/** The wallet of this build's cluster. */
export const CHALLENGE: ChallengeWallet = import.meta.env.VITE_CLUSTER === 'devnet' ? DEVNET_CHALLENGE : MAINNET_CHALLENGE;
