import { AccountList, AccountRow, Checkbox, Label } from '@stakeward/design-system';
import { CircleAlertIcon } from 'lucide-react';
import { sampleRows, type SampleRow } from '../../apps/web/src/pages/dev-ui/samples';

// A fixed cluster clock (9 October 2026, epoch 850) so the rows never drift.
const clock = { unixTimestamp: 1_791_504_000n, epoch: 850n };
const rows = sampleRows(clock);
const sample = (key: SampleRow['key']) => rows.find((row) => row.key === key) as SampleRow;

/** Protect step 2: the seed-phrase check, unticked, with its hint read alongside the box. */
export const SeedPhraseCheck = () => (
  <div className="flex max-w-md items-start gap-3">
    <Checkbox id="seed-check" aria-describedby="seed-check-hint" className="mt-0.5" />
    <div className="flex flex-col gap-1">
      <Label htmlFor="seed-check">My second key comes from a different seed phrase</Label>
      <p id="seed-check-hint" className="text-sm text-muted">
        With one seed phrase, whoever steals it gets both keys and the lock stops nothing.
      </p>
    </div>
  </div>
);

/** Ticked: the box fills with the primary colour and shows a check mark (rescue step 2, the new wallet's seed check). */
export const Checked = () => (
  <div className="flex max-w-md items-start gap-3">
    <Checkbox id="seed-new" defaultChecked className="mt-0.5" />
    <Label htmlFor="seed-new">My new wallet comes from a new seed phrase that no one else has seen</Label>
  </div>
);

/** A required confirmation left unticked when Sign is pressed (co-signing a rescue): the box turns red and the reason sits under it. */
export const Invalid = () => (
  <div className="flex max-w-md flex-col gap-2">
    <div className="flex items-start gap-3">
      <Checkbox id="confirm-rescue" required aria-invalid aria-describedby="confirm-rescue-error" className="mt-0.5" />
      <Label htmlFor="confirm-rescue">I checked this New wallet address with the owner by voice or in person, or it is mine</Label>
    </div>
    <p id="confirm-rescue-error" className="flex items-start gap-2 text-sm font-medium text-danger">
      <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>Tick the box above to continue.</span>
    </p>
  </div>
);

/** Protect step 1: each stake account row starts with a checkbox named after the account (no visible label); a chosen row turns primary-soft. */
export const RowSelect = () => {
  const chosen = [sample('unprotected'), sample('was-protected')];
  return (
    <AccountList label="Not protected (2)">
      {chosen.map((row, index) => {
        const checked = index === 0;
        return (
          <li
            key={row.account.address}
            data-selected={checked ? 'true' : 'false'}
            className={
              checked
                ? 'cursor-pointer bg-primary-soft px-4 py-3 transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-primary-soft'
                : 'cursor-pointer px-4 py-3 transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-subtle'
            }
          >
            <AccountRow
              account={row.account}
              activation={row.activation}
              clock={row.clock}
              protection={row.protection}
              managedByService={row.managedByService}
              secondKeyKnown={row.secondKeyKnown}
              hint={false}
              serviceDetail
              select={{
                checked,
                label: `Protect stake account ${row.account.address.slice(0, 3)}...${row.account.address.slice(-3)}`,
                onCheckedChange: () => {},
              }}
            />
          </li>
        );
      })}
    </AccountList>
  );
};
