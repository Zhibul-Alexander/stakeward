import { AlertExplanation } from '@stakeward/design-system';
import { SAMPLE, SAMPLE_ERROR_DETAIL, sampleExpiringEnd } from '../../apps/web/src/pages/dev-ui/samples';

// Above /app, /extend or /rescue when a Telegram alert's button opened the page. Fixed clock: 9 October 2026.
const clock = { unixTimestamp: 1_791_504_000n, epoch: 850n };
const NOW_MS = 1_791_504_000_000;
const noop = () => undefined;

/** A deactivation seen 25 minutes ago on a 1,250.5 SOL stake locked until 10 April 2027; one earlier change. */
export const Deactivated = () => (
  <AlertExplanation
    state="ready"
    event="DEACTIVATED"
    stake={SAMPLE.stakeA}
    detectedAt={new Date(NOW_MS - 25 * 60_000)}
    current={{
      address: SAMPLE.stakeA,
      roles: ['main'],
      lockUntil: 1_807_315_200n,
      lock: 'in-force',
      daysLeft: 183,
      lamports: 1_250_500_000_000n,
      state: 'delegated',
    }}
    recent={[{ stakeAccount: SAMPLE.stakeA, type: 'DELEGATION_CHANGED', detectedAt: new Date(NOW_MS - 2 * 86_400_000) }]}
  />
);

/** A 7-day reminder: the worker keeps no event for it, so Seen is not known and no other change is recorded. */
export const Reminder = () => (
  <AlertExplanation
    state="ready"
    event="REMINDER_7"
    stake={SAMPLE.stakeB}
    detectedAt={null}
    current={{
      address: SAMPLE.stakeB,
      roles: ['main'],
      lockUntil: sampleExpiringEnd(clock),
      lock: 'ending-soon',
      daysLeft: 19,
      lamports: 42_750_000_000n,
      state: 'delegated',
    }}
    recent={[]}
  />
);

/** While GET /api/accounts answers: the event and the account from the link show at once. */
export const Loading = () => <AlertExplanation state="loading" event="STAKER_CHANGED" stake={SAMPLE.stakeA} />;

/** The worker did not answer: the alert still stands, the raw error under Details, and Try again. */
export const CouldNotRead = () => (
  <AlertExplanation state="error" event="LOCKUP_CHANGED" stake={SAMPLE.stakeA} detail={SAMPLE_ERROR_DETAIL.rpc} onRetry={noop} />
);
