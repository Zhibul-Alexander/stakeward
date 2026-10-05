import type { Address } from '@solana/kit';
import {
  cliUrl,
  fillPlaceholders,
  isLockupInForce,
  lockupEndForPeriod,
  RECOVERY_PLACEHOLDERS,
  recoveryCommands,
  rfc3339Utc,
  type ClockView,
  type Cluster,
  type RecoveryCommandId,
  type StakeAccount,
} from '@stakeward/core';

/** What the recovery card of a locked stake account shows (CLAUDE.md section 9), read from the chain alone. */
export type RecoveryCard = {
  account: StakeAccount;
  mainKey: Address;
  secondKey: Address;
  /** The key that manages staking when it is not the main key (a staking service, a thief's key); null otherwise. */
  staker: Address | null;
  /** The lock end, unix seconds; null when only the lockup epoch holds the lock. */
  lockUntil: bigint | null;
  /** The epoch that must begin before the lock ends; null when the epoch does not hold it (Stakeward sets 0). */
  lockEpoch: bigint | null;
  /** A `<NEW_END_DATE>` for the extend text: six months after the lock end, 00:00 UTC, RFC 3339. */
  exampleEndDate: string;
  /** Every card command with this stake account and the main key's address filled in; keys stay placeholders. */
  commands: Readonly<Record<RecoveryCommandId, readonly string[]>>;
};

/** Why a stake account gets no card: there is no second key whose help the card could describe. */
export type NoCardReason = 'no-lock' | 'lock-ended' | 'main-key-holds';

export type RecoveryCardResult =
  | { kind: 'card'; card: RecoveryCard }
  /** `endedAt`: when an ended lock ended (unix seconds); null when the lockup holds no time. */
  | { kind: 'none'; reason: NoCardReason; endedAt: bigint | null };

/**
 * The card for `account` as the chain shows it at `clock`. A lock not in force has no card (`no-lock` when the lockup
 * is empty, `lock-ended` otherwise), and neither has a lock whose custodian is the main key itself: whoever holds the
 * main key opens it (scannerStatus reads it as Not protected too).
 */
export function recoveryCard(account: StakeAccount, clock: ClockView, cluster: Cluster): RecoveryCardResult {
  const { lockup } = account;
  if (!isLockupInForce(lockup, clock)) {
    const empty = lockup.unixTimestamp === 0n && lockup.epoch === 0n;
    return {
      kind: 'none',
      reason: empty ? 'no-lock' : 'lock-ended',
      endedAt: lockup.unixTimestamp > 0n ? lockup.unixTimestamp : null,
    };
  }
  if (lockup.custodian === account.withdrawer) return { kind: 'none', reason: 'main-key-holds', endedAt: null };

  const lockUntil = lockup.unixTimestamp > clock.unixTimestamp ? lockup.unixTimestamp : null;
  const lockEpoch = lockup.epoch > clock.epoch ? lockup.epoch : null;
  const templates = recoveryCommands({ mainKeyAddress: account.withdrawer, url: cliUrl(cluster) });
  const fill = (argv: readonly string[]) => fillPlaceholders(argv, { [RECOVERY_PLACEHOLDERS.stakeAccount]: account.address });
  const commands: Record<RecoveryCommandId, readonly string[]> = {
    find: fill(templates.find),
    show: fill(templates.show),
    epoch: fill(templates.epoch),
    rescue: fill(templates.rescue),
    deactivate: fill(templates.deactivate),
    withdraw: fill(templates.withdraw),
    'withdraw-alone': fill(templates['withdraw-alone']),
    extend: fill(templates.extend),
    'remove-lock': fill(templates['remove-lock']),
    'change-second-key': fill(templates['change-second-key']),
  };
  return {
    kind: 'card',
    card: {
      account,
      mainKey: account.withdrawer,
      secondKey: lockup.custodian,
      staker: account.staker === account.withdrawer ? null : account.staker,
      lockUntil,
      lockEpoch,
      exampleEndDate: exampleEndDate(lockUntil, clock.unixTimestamp),
      commands,
    },
  };
}

/**
 * Six months after the lock end (or after now, for a lock its epoch holds), as `--lockup-date` takes it. A lock end too
 * far out for a calendar date falls back to now; never a past date, which would remove the lock instead.
 */
function exampleEndDate(lockUntil: bigint | null, now: bigint): string {
  const sixMonthsAfter = (from: bigint) => (rfc3339Utc(from) === null ? null : rfc3339Utc(lockupEndForPeriod(from, 6)));
  return (lockUntil === null ? null : sixMonthsAfter(lockUntil)) ?? sixMonthsAfter(now) ?? RECOVERY_PLACEHOLDERS.newEndDate;
}
