import { RiskNote } from '@stakeward/design-system';

// Dates under the fixed clock { unixTimestamp: 1_791_504_000n, epoch: 850n } (9 October 2026): 10 April 2027 00:00 UTC
// is the end core's lockupEndForPeriod gives a 6-month lock (the protect wizard's default); 28 October 2026 is an
// expiring lock, 19 days ahead.
const LOCK_END = 1_807_315_200n;
const EXPIRING_END = 1_793_145_600n;

/** Protect, lock period step: the date the stake waits until if the Second key is lost, and the line under it. */
export const LoseSecondKey = () => (
  <div className="flex flex-col gap-2">
    <RiskNote risk="lose-second-key" date={LOCK_END} />
    <p className="text-sm text-muted">Your second key can extend it before then.</p>
  </div>
);

/** Protect, second key step: the honest limit, with the one rule for using the second key. */
export const SecondKeyCanFreeze = () => (
  <RiskNote risk="second-key-can-freeze">
    <p>Use it only to co-sign on Stakeward, never on other sites.</p>
  </RiskNote>
);

/** Withdraw: the inline risk right above Review withdrawal, carrying its way out. */
export const WithdrawCompromised = () => (
  <RiskNote risk="withdraw-compromised" variant="inline">
    <p>
      <a href="#rescue" className="rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover">
        Rescue your stake instead
      </a>
    </p>
  </RiskNote>
);

/** A summary that removes the lock: the danger tone. */
export const UnlockOpensWindow = () => <RiskNote risk="unlock-opens-window" tone="danger" />;

/** The recovery card: the earliest lock end, with the time in UTC for a reader in any time zone. */
export const LockEndsDateTime = () => <RiskNote risk="lock-ends" date={EXPIRING_END} dateStyle="date-time" />;

/** Extend, a later end chosen: the inline note ActionBar puts right above Review new end date. */
export const InlineLaterEnd = () => <RiskNote risk="lose-second-key" date={LOCK_END} variant="inline" />;

/** Extend, Remove the lock now chosen: the inline danger ActionBar puts right above Review lock removal instead. */
export const InlineRemoving = () => <RiskNote risk="unlock-opens-window" tone="danger" variant="inline" />;
