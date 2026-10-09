import { Countdown } from '@stakeward/design-system';

// The product's one countdown: Withdraw, while the stake cools down, to the estimated end of the epoch it stops in
// (withdraw.deactivating.label). A fixed clock (9 October 2026, 00:00 UTC) so the time left never drifts between captures.
const NOW = 1_791_504_000n;
const clock = () => Number(NOW) * 1000;
const LABEL = 'Withdraw opens in about';

/** Hours and minutes to the estimated end of the epoch. */
export const EpochEnds = () => <Countdown to={NOW + 2n * 3_600n + 14n * 60n} label={LABEL} clock={clock} />;

/** The last hour shows seconds. */
export const LastMinutes = () => <Countdown to={NOW + 4n * 60n + 30n} label={LABEL} clock={clock} />;

/** Stopped early in a two-day epoch: days and hours. */
export const DaysLeft = () => <Countdown to={NOW + 86_400n + 23n * 3_600n} label={LABEL} clock={clock} />;

/** The estimate has passed: Ended, while the page reads the stake account again. */
export const Ended = () => <Countdown to={NOW - 60n} label={LABEL} clock={clock} />;
