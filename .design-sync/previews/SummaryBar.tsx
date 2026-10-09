import { Button, ErrorState, SummaryBar } from '@stakeward/design-system';
import type { Address } from '@solana/kit';
import { formatSol } from '@stakeward/core';
import { RefreshCwIcon, SendIcon } from 'lucide-react';
import { MonitoringStatus } from '../../apps/web/src/pages/app/MonitoringStatus';
import { buildAccountsView, type AccountsView } from '../../apps/web/src/pages/app/view';
import { SAMPLE, SAMPLE_ERROR_DETAIL, sampleRows, type SampleRow } from '../../apps/web/src/pages/dev-ui/samples';

// A fixed cluster clock and "now" (9 October 2026) so the numbers and "Last checked N min ago" never drift.
const clock = { unixTimestamp: 1_791_504_000n, epoch: 850n };
const NOW = 1_791_504_000_000;
const samples = sampleRows(clock);
const accountsOf = (...keys: SampleRow['key'][]) =>
  keys.flatMap((key) => samples.filter((row) => row.key === key).map((row) => row.account));
const noop = () => undefined;

/** Six stake accounts of one main key: two locked by its second key, one by another key, three without a lock. */
const OWNED: SampleRow['key'][] = ['protected', 'expiring', 'unprotected', 'locked-by-other', 'was-protected', 'managed-by-service'];

/** /app's own view of the accounts, for the viewer `address` with these second keys known on this device. */
const viewOf = (keys: SampleRow['key'][], knownSecondKeys: readonly Address[], address: Address = SAMPLE.mainKey) =>
  buildAccountsView({ address, accounts: accountsOf(...keys), clock, knownSecondKeys, rememberedProtected: [] });

/** A SOL amount without its unit, for sentences that say "SOL" once. */
const solNumber = (lamports: bigint) => formatSol(lamports).replace(/ SOL$/, '');

const checked = (minutesAgo: number) => (
  <MonitoringStatus
    state={{ status: 'ready', health: { lastMonitorRunAt: new Date(NOW - minutesAgo * 60_000) }, receivedAt: NOW }}
    now={NOW}
  />
);

/** Telegram (outline sm) and Refresh (ghost icon), as /app puts them next to "Last checked". */
function Tools() {
  return (
    <>
      <Button variant="outline" size="sm">
        <SendIcon aria-hidden="true" />
        Get alerts in Telegram
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Refresh">
        <RefreshCwIcon aria-hidden="true" />
      </Button>
    </>
  );
}

/** /app's `action`: for any stake of this main key, Rescue beside the answer. */
function RescueNote() {
  return (
    <p className="text-sm sm:pt-1.5">
      Main key stolen?{' '}
      <a
        href={`/rescue?address=${SAMPLE.mainKey}`}
        onClick={(event) => {
          event.preventDefault();
        }}
        className="rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
      >
        Rescue your stake
      </a>
    </p>
  );
}

/** /app's Summary for a loaded view: the headline, the accounts line, and the new-device line when it applies. */
function Summary({ view, minutesAgo }: { view: AccountsView; minutesAgo: number }) {
  const owned = view.owned.length;
  const protectedCount = view.confirmedProtected.length;
  const secondKeyFor = view.secondKeyFor.length;
  return (
    <SummaryBar
      label="Summary"
      state="ready"
      headline={owned === 0 ? undefined : `${solNumber(view.totals.protectedLamports)} of ${solNumber(view.totals.lamports)} SOL protected`}
      detail={
        owned > 0 ? (
          <>
            <p>{owned === 1 ? `${protectedCount} of 1 stake account` : `${protectedCount} of ${owned} stake accounts`}</p>
            {view.lockedUnconfirmedLamports === 0n ? null : (
              <p>{solNumber(view.lockedUnconfirmedLamports)} SOL locked by a second key not connected here</p>
            )}
          </>
        ) : secondKeyFor === 1 ? (
          'Second key for 1 stake account'
        ) : (
          `Second key for ${secondKeyFor} stake accounts`
        )
      }
      monitoring={checked(minutesAgo)}
      tools={<Tools />}
      action={owned === 0 ? undefined : <RescueNote />}
    />
  );
}

/** The answer at the top of /app: how much is protected, how many accounts, how fresh monitoring is, and Rescue. */
export const Ready = () => <Summary view={viewOf(OWNED, [SAMPLE.secondKey])} minutesAgo={2} />;

/** Reading the accounts: the answer as skeletons; monitoring and the tools already there. */
export const Loading = () => (
  <SummaryBar label="Summary" state="loading" monitoring={<MonitoringStatus state={{ status: 'loading' }} now={NOW} />} tools={<Tools />} />
);

/** The accounts could not be read: no answer, and the page puts its ErrorState with Try again right under the bar. */
export const LoadError = () => (
  <div className="flex flex-col gap-6 sm:gap-8">
    <SummaryBar label="Summary" state="error" monitoring={checked(2)} tools={<Tools />} />
    <ErrorState
      title="Could not load the stake accounts"
      message="The Solana network did not respond. Check your connection and try again."
      detail={SAMPLE_ERROR_DETAIL.rpc}
      onRetry={noop}
    />
  </div>
);

/** The monitor has not run for 25 minutes: "Last checked" turns red and says alerts may be late. */
export const MonitoringLate = () => <Summary view={viewOf(OWNED, [SAMPLE.secondKey])} minutesAgo={25} />;

/**
 * The same stake on a new device that knows no second key: no lock counts as protected until the key is connected
 * here, so the bar says how much SOL such locks hold (connecting the key is offered in the locked group below).
 */
export const NewDevice = () => <Summary view={viewOf(OWNED, [])} minutesAgo={2} />;

/** A wallet that is only a second key: no headline of its own and no Rescue, just whose locks it holds. */
export const SecondKeyOnly = () => <Summary view={viewOf(['protected', 'expiring'], [], SAMPLE.secondKey)} minutesAgo={2} />;
