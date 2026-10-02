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
