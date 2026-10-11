// The public "Try to steal it" wallet on devnet (DECISIONS.md D132, created by scripts/challenge-wallet.ts, D130).
// Its MAIN key is published on purpose: the SOL is devnet SOL, and the point is that the main key alone cannot take
// it. The key itself is not in this repository: the page reads it from GET /api/challenge, which the dev Worker serves
// from its CHALLENGE_MAIN_KEY secret. The second key that holds the lock is never in either. This module is imported
// only by the devnet-only /challenge page, so none of it reaches the mainnet build (test/build-output.test.ts).
import type { Address } from '@solana/kit';

export const CHALLENGE = {
  /** Staker and withdrawer of the stake account. */
  mainKey: '9QeBtMG3LbdUz7sHHjmJMQ243Pn8Tb1A4WmwM3SJjRKf' as Address,
  stakeAccount: 'FuXxGyzezXKrmHa784Uio8qfo4D9dzov639wPC6RTVA5' as Address,
  /** The custodian of the lock. Only its address is public. */
  secondKey: 'GhVdLekCV7KySTbDrdeFWyryPRxQsfbwBn6UUGS7FpK' as Address,
  /** 2027-10-12 00:00:00 UTC, as set on devnet on 11 October 2026. */
  lockUntil: 1_823_299_200n,
} as const;
