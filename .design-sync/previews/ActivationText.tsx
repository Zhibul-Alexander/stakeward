import { AccountRow, ActivationText, AddressText, SolAmount } from '@stakeward/design-system';
import { formatUtcDateTime, scannerStatus, stakeActivationStatus } from '@stakeward/core';
import { SAMPLE, sampleRecoveryCard, sampleRows } from '../../apps/web/src/pages/dev-ui/samples';

// A fixed cluster clock (9 October 2026, epoch 850) so the dates in the cards never drift.
const clock = { unixTimestamp: 1_791_504_000n, epoch: 850n };

/** The four staking states by epochs: a muted word with its icon, never a second badge. */
export const AllStates = () => (
  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
    <ActivationText status="active" />
    <ActivationText status="activating" />
    <ActivationText status="deactivating" />
    <ActivationText status="inactive" />
  </div>
);

/** On an account row, as /withdraw and /extend show the account: in the muted line, after the lock's end date. */
export const OnAnAccountRow = () => (
  <div className="flex flex-col gap-3">
    {sampleRows(clock)
      .filter((row) => row.key === 'expiring')
      .map((row) => {
        const view = scannerStatus(row.account, [SAMPLE.secondKey], clock);
        return (
          <AccountRow
            key={row.key}
            account={row.account}
            activation={stakeActivationStatus(row.account.delegation, clock.epoch)}
            clock={clock}
            protection={view.status}
            managedByService={view.managedByService}
            secondKeyKnown
            hint={false}
            serviceDetail
            className="rounded-lg border border-border bg-surface px-4 py-3"
          />
        );
      })}
  </div>
);

/** On the recovery card: each account's full address, then its SOL, staking state and lock end on one line. */
export const OnTheRecoveryCard = () => {
  const card = sampleRecoveryCard(clock);
  return (
    <ul role="list" className="divide-y divide-border rounded-lg border border-border bg-surface">
      {card.accounts.map((row) => (
        <li key={row.account.address} className="flex flex-col gap-1 px-4 py-3">
          <AddressText address={row.account.address} variant="full" explorer />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <SolAmount lamports={row.account.lamports} className="font-semibold" />
            <ActivationText status={row.activation} />
            <span>Locked until {formatUtcDateTime(row.lockUntil)}</span>
          </div>
          {row.staker === null ? null : (
            <div className="mt-2 flex flex-col gap-1 rounded-md bg-subtle p-3 text-sm">
              <p>Staking is managed by another key (the stake authority):</p>
              <AddressText address={row.staker} variant="full" explorer />
              <p className="font-medium">If you did not set this up, your main key may be stolen: see “Your main key is stolen” below.</p>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
};
