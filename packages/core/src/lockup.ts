import type { Address } from '@solana/kit';
import type { ChangeSecondKeyAction } from './actions.ts';
import { ZERO_ADDRESS, type Cluster } from './constants.ts';
import type { Lockup, StakeAccount } from './decode.ts';

/** The parts of the cluster clock the lockup rules need. `unixTimestamp` is in seconds. */
export type ClockView = { unixTimestamp: bigint; epoch: bigint };

/**
 * The stake program rule (CLAUDE.md section 4): a lockup is in force while its unix timestamp is later than the
 * clock's or its epoch is later than the current epoch. At `clock.unixTimestamp === lockup.unixTimestamp` it is
 * already over. A custodian signature lifts it for one instruction; that is not modelled here.
 */
export function isLockupInForce(lockup: Pick<Lockup, 'unixTimestamp' | 'epoch'>, clock: ClockView): boolean {
  return lockup.unixTimestamp > clock.unixTimestamp || lockup.epoch > clock.epoch;
}

/** Lock periods offered by the protect wizard. The minute/hour ones exist only on devnet (CLAUDE.md section 3). */
export type LockPeriod = '1-month' | '3-months' | '6-months' | '12-months' | '10-minutes' | '1-hour';

export const DEFAULT_LOCK_PERIOD: LockPeriod = '6-months';

const MONTH_PERIODS = { '1-month': 1, '3-months': 3, '6-months': 6, '12-months': 12 } as const;
const DEV_PERIODS_SECONDS = { '10-minutes': 600n, '1-hour': 3_600n } as const;

/** Periods the wizard may offer on `cluster`: the month periods everywhere, the short ones only on devnet. */
export function lockPeriodsFor(cluster: Cluster): readonly LockPeriod[] {
  const months: LockPeriod[] = ['1-month', '3-months', '6-months', '12-months'];
  return cluster === 'devnet' ? [...months, '10-minutes', '1-hour'] : months;
}

/**
 * The lockup unix timestamp T for a period starting `now`.
 * - Month periods: see {@link lockupEndForPeriod}.
 * - `10-minutes` / `1-hour`: now (whole seconds) plus the period. Throws unless `cluster` is devnet, so production
 *   can never build such a lock even if the UI offered it by mistake.
 */
export function lockupEnd(now: Date | bigint, period: LockPeriod, cluster: Cluster): bigint {
  if (period === '10-minutes' || period === '1-hour') {
    if (cluster !== 'devnet') throw new Error(`Lock period ${period} is only available on devnet`);
    return toUnixSeconds(now) + DEV_PERIODS_SECONDS[period];
  }
  return lockupEndForPeriod(now, MONTH_PERIODS[period]);
}

/**
 * T = 00:00 UTC after the end of the period (CLAUDE.md section 5). Precisely:
 * 1. Take `now` as a UTC calendar date and time.
 * 2. Add `months` calendar months. If that day does not exist in the target month, use the target month's last day
 *    (31 January + 1 month = 28 or 29 February, 31 August + 6 months = 28 February); the time of day is kept.
 * 3. T is the first 00:00 UTC strictly after that instant, i.e. the start of the following UTC day. A `now` of exactly
 *    00:00:00 also moves to the next midnight, so the lock is always longer than the nominal period.
 * Returns T in unix seconds. `now` is a Date or unix seconds.
 */
export function lockupEndForPeriod(now: Date | bigint, months: 1 | 3 | 6 | 12): bigint {
  const start = new Date(Number(toUnixSeconds(now)) * 1000);
  const monthIndex = start.getUTCMonth() + months;
  const year = start.getUTCFullYear() + Math.floor(monthIndex / 12);
  const month = monthIndex % 12;
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(start.getUTCDate(), lastDayOfMonth);
  return BigInt(Date.UTC(year, month, day + 1) / 1000);
}

function toUnixSeconds(now: Date | bigint): bigint {
  if (typeof now === 'bigint') return now;
  const ms = now.getTime();
  if (!Number.isFinite(ms)) throw new Error('Invalid date');
  return BigInt(Math.floor(ms / 1000));
}

/** Why an address cannot be the second key (CLAUDE.md section 5). */
export type SecondKeyViolation = 'zero-key' | 'main-key' | 'staker' | 'stake-account';

/**
 * Checks a proposed second key K. Returns every rule it breaks, in a fixed order; an empty list means K is allowed.
 * `mainKey` is the withdrawer A.
 */
export function validateSecondKey(input: {
  second: Address;
  mainKey: Address;
  staker: Address;
  stakeAccount: Address;
}): SecondKeyViolation[] {
  const violations: SecondKeyViolation[] = [];
  if (input.second === ZERO_ADDRESS) violations.push('zero-key');
  if (input.second === input.mainKey) violations.push('main-key');
  if (input.second === input.staker) violations.push('staker');
  if (input.second === input.stakeAccount) violations.push('stake-account');
  return violations;
}

/** Why an address cannot become the new second key of a lock (F7): a rule of `validateSecondKey`, or the key now. */
export type NewSecondKeyViolation = SecondKeyViolation | 'current-second-key';

/**
 * Checks a proposed new second key K2 for a lock that `current` holds now: every rule of {@link validateSecondKey}, in
 * its order, then `current-second-key` when K2 is that same key. An empty list means K2 is allowed.
 */
export function validateNewSecondKey(input: {
  second: Address;
  mainKey: Address;
  staker: Address;
  stakeAccount: Address;
  /** The second key that holds the lock now. */
  current: Address;
}): NewSecondKeyViolation[] {
  const violations: NewSecondKeyViolation[] = validateSecondKey(input);
  if (input.second === input.current) violations.push('current-second-key');
  return violations;
}

/**
 * Why a change of second key (F7) does not fit the stake account as the chain shows it.
 * - `other-account`: the change is for another stake account;
 * - `not-locked`: no lock is in force, or the main key itself or the zero key holds it. A lock not in force is set by
 *   the withdrawer alone (that is a protect, F1), so the program refuses the second key's signature
 *   (MissingRequiredSignature); a lock the main key holds protects nothing (D14);
 * - `not-current-second-key`: another key holds the lock, and the program takes only its signature
 *   (MissingRequiredSignature);
 * - a rule the new second key breaks (`validateNewSecondKey`).
 */
export type SecondKeyChangeProblem = 'other-account' | 'not-locked' | 'not-current-second-key' | NewSecondKeyViolation;

/**
 * The inspector reads a change of second key from the bytes alone; the screens check it against the chain with this
 * (CLAUDE.md section 3). Its signer must be the second key of a lock in force on `account` at `clock`, and the new
 * second key must be allowed. Returns the first problem in the order of {@link SecondKeyChangeProblem}; null = it fits.
 * A lock its epoch holds counts as in force (the program's rule); a page may still decline it.
 */
export function secondKeyChangeProblem(
  change: Pick<ChangeSecondKeyAction, 'stakeAccount' | 'secondKey' | 'newSecondKey'>,
  account: StakeAccount,
  clock: ClockView,
): SecondKeyChangeProblem | null {
  if (change.stakeAccount !== account.address) return 'other-account';
  const { lockup } = account;
  if (!isLockupInForce(lockup, clock) || lockup.custodian === account.withdrawer || lockup.custodian === ZERO_ADDRESS) {
    return 'not-locked';
  }
  if (lockup.custodian !== change.secondKey) return 'not-current-second-key';
  const [violation] = validateNewSecondKey({
    second: change.newSecondKey,
    mainKey: account.withdrawer,
    staker: account.staker,
    stakeAccount: account.address,
    current: lockup.custodian,
  });
  return violation ?? null;
}
