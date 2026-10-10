import type { Address } from '@solana/kit';
import { ZERO_ADDRESS, type Cluster } from './constants.ts';
import type { Lockup } from './decode.ts';

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

/** The furthest custom lock end, in years from today (DECISIONS.md D118): a typo in the year cannot freeze a stake for decades. */
export const CUSTOM_LOCK_MAX_YEARS = 5;

export type CustomLockProblem = 'invalid' | 'too-soon' | 'too-late';

/**
 * The dates a custom lock end may take, as `YYYY-MM-DD` in UTC: from tomorrow to the same day CUSTOM_LOCK_MAX_YEARS
 * later (29 February becomes 28 February). `now` is a Date or unix seconds.
 */
export function customLockBounds(now: Date | bigint): { min: string; max: string } {
  const start = new Date(Number(toUnixSeconds(now)) * 1000);
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const day = start.getUTCDate();
  const min = new Date(Date.UTC(year, month, day + 1));
  const lastDay = new Date(Date.UTC(year + CUSTOM_LOCK_MAX_YEARS, month + 1, 0)).getUTCDate();
  const max = new Date(Date.UTC(year + CUSTOM_LOCK_MAX_YEARS, month, Math.min(day, lastDay)));
  return { min: isoDate(min), max: isoDate(max) };
}

/**
 * A custom lock end (D118): the lock holds until 00:00 UTC of `date` (`YYYY-MM-DD`), as the cards of the month periods
 * say "until <date>". The date must be a real calendar date within `customLockBounds(now)`.
 */
export function customLockEnd(
  date: string,
  now: Date | bigint,
): { ok: true; lockUntil: bigint } | { ok: false; problem: CustomLockProblem } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (match === null) return { ok: false, problem: 'invalid' };
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(year, month - 1, day);
  const parsed = new Date(ms);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return { ok: false, problem: 'invalid' };
  }
  const { min, max } = customLockBounds(now);
  const iso = isoDate(parsed);
  if (iso < min) return { ok: false, problem: 'too-soon' };
  if (iso > max) return { ok: false, problem: 'too-late' };
  return { ok: true, lockUntil: BigInt(ms / 1000) };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
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
