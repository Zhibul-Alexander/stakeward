import {
  isLockupInForce,
  lockPeriodsFor,
  lockupEnd,
  ZERO_ADDRESS,
  type ClockView,
  type Cluster,
  type LockPeriod,
  type StakeAccount,
} from '@stakeward/core';

/**
 * What /extend/:account can do with the account's lock (F5):
 * - `epoch-locked`: an epoch holds the lock; Stakeward only moves a lock's date, so it leaves this one alone;
 * - `not-locked`: no lock in force, or one held by the main key itself or by no key: nothing a second key holds;
 * - `ready`: a second key holds a lock in force by its date.
 */
export type ExtendStage = 'epoch-locked' | 'not-locked' | 'ready';

export function extendStage(account: StakeAccount, clock: ClockView): ExtendStage {
  const { lockup } = account;
  if (lockup.epoch > clock.epoch) return 'epoch-locked';
  if (!isLockupInForce(lockup, clock) || lockup.custodian === account.withdrawer || lockup.custodian === ZERO_ADDRESS) {
    return 'not-locked';
  }
  return 'ready';
}

/** A new end for the lock (a period from now), or removing it now. */
export type ExtendChoice = { kind: 'period'; period: LockPeriod; until: bigint } | { kind: 'remove' };

/**
 * The choices on /extend: every period of `cluster` whose end (from the cluster clock) is later than the lock's current
 * end, in the protect wizard's order, then removing the lock. Never a shorter lock: shortening is remove, then protect.
 */
export function extendOptions(currentEnd: bigint, clock: ClockView, cluster: Cluster): ExtendChoice[] {
  const periods = lockPeriodsFor(cluster)
    .map((period): ExtendChoice => ({ kind: 'period', period, until: lockupEnd(clock.unixTimestamp, period, cluster) }))
    .filter((choice) => choice.kind === 'period' && choice.until > currentEnd);
  return [...periods, { kind: 'remove' }];
}

/** The choice shown first: remove when the page was opened to remove the lock (`?remove`), else 6 months, else the first. */
export function defaultChoice(choices: readonly ExtendChoice[], removeParam: boolean): ExtendChoice {
  const remove: ExtendChoice = { kind: 'remove' };
  if (removeParam) return choices.find((choice) => choice.kind === 'remove') ?? remove;
  return (
    choices.find((choice) => choice.kind === 'period' && choice.period === '6-months') ??
    choices.find((choice) => choice.kind === 'period') ??
    choices.find((choice) => choice.kind === 'remove') ??
    remove
  );
}

/** The radio value of a choice: the period, or `remove`. */
export function choiceValue(choice: ExtendChoice): string {
  return choice.kind === 'remove' ? 'remove' : choice.period;
}

/** The lock end a choice signs: its date, or 0 to remove the lock. */
export function choiceLockUntil(choice: ExtendChoice): bigint {
  return choice.kind === 'remove' ? 0n : choice.until;
}
