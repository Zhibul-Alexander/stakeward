import { AccountList, AccountListItem, AccountRow, AddressText, Button, Collapsible, CollapsibleContent, CollapsibleTrigger } from '@stakeward/design-system';
import { ArrowDownToLineIcon, CalendarPlusIcon, ChevronDownIcon, FileTextIcon } from 'lucide-react';
import { useState } from 'react';
import { SAMPLE, sampleRows, type SampleRow } from '../../apps/web/src/pages/dev-ui/samples';

// A fixed cluster clock (9 October 2026, epoch 850) so the dates in the rows never drift.
const clock = { unixTimestamp: 1_791_504_000n, epoch: 850n };
const rows = sampleRows(clock);
const sample = (key: SampleRow['key']) => rows.find((row) => row.key === key) as SampleRow;

/** As a ghost icon button (asChild): a row's More, closed. On a Protected row it is the only control; its accessible name says which row. */
export const IconButton = () => {
  const row = sample('protected');
  return (
    <AccountList label="Stake accounts">
      <AccountListItem>
        <AccountRow
          account={row.account}
          activation={row.activation}
          clock={row.clock}
          protection={row.protection}
          managedByService={row.managedByService}
          secondKeyKnown={row.secondKeyKnown}
          moreActions={
            <>
              <Button size="sm" variant="outline">
                <CalendarPlusIcon aria-hidden="true" />
                Extend
              </Button>
              <Button size="sm" variant="outline">
                <ArrowDownToLineIcon aria-hidden="true" />
                Withdraw
              </Button>
              <Button size="sm" variant="outline">
                <FileTextIcon aria-hidden="true" />
                Recovery card
              </Button>
            </>
          }
          hint={false}
        />
      </AccountListItem>
    </AccountList>
  );
};

/** As a full-width toggle between hairlines, with its own text and a chevron that turns when open. Rescue keeps "Not in this run" folded while other accounts can move. */
export const FullWidthToggle = () => {
  const [open, setOpen] = useState(false);
  const locked = sample('locked-by-other');
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-y border-border">
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-sm py-3 text-left font-medium">
        Not in this run (1)
        <ChevronDownIcon aria-hidden="true" className={open ? 'size-4 shrink-0 rotate-180 text-muted transition-transform' : 'size-4 shrink-0 text-muted transition-transform'} />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-5 pb-4">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Locked by another second key — rescue these in another run with that key</p>
          <AddressText address={SAMPLE.otherKey} variant="full" explorer />
          <AccountList label="Stake accounts">
            <AccountListItem>
              <AccountRow
                account={locked.account}
                activation={locked.activation}
                clock={locked.clock}
                protection={locked.protection}
                managedByService={locked.managedByService}
                secondKeyKnown={locked.secondKeyKnown}
                hint={false}
              />
            </AccountListItem>
          </AccountList>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

/** Inside a heading as a ghost button: protect step 1's "Already protected" title, which folds its list. */
export const HeadingButton = () => {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-3">
      <h3 className="text-base font-semibold">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="-ml-2 h-auto px-2 py-1 text-base font-semibold">
            Already protected (2)
            <ChevronDownIcon aria-hidden="true" className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
          </Button>
        </CollapsibleTrigger>
      </h3>
      <CollapsibleContent>
        <AccountList label="Already protected (2)">
          {[sample('protected'), sample('expiring')].map((row) => (
            <AccountListItem key={row.account.address}>
              <AccountRow
                account={row.account}
                activation={row.activation}
                clock={row.clock}
                protection={row.protection}
                managedByService={row.managedByService}
                secondKeyKnown={row.secondKeyKnown}
                hint={false}
              />
            </AccountListItem>
          ))}
        </AccountList>
      </CollapsibleContent>
    </Collapsible>
  );
};
