import { AccountList, AccountListItem, AccountRow, AddressText, Button, Collapsible, CollapsibleContent, CollapsibleTrigger } from '@stakeward/design-system';
import { ArrowDownToLineIcon, CalendarPlusIcon, ChevronDownIcon, FileTextIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { SAMPLE, sampleRows, type SampleRow } from '../../apps/web/src/pages/dev-ui/samples';

// A fixed cluster clock (9 October 2026, epoch 850) so the dates in the rows never drift.
const clock = { unixTimestamp: 1_791_504_000n, epoch: 850n };
const rows = sampleRows(clock);
const sample = (key: SampleRow['key']) => rows.find((row) => row.key === key) as SampleRow;

const extend = (
  <Button size="sm" variant="outline">
    <CalendarPlusIcon aria-hidden="true" />
    Extend
  </Button>
);
const withdrawAndCard = (
  <>
    <Button size="sm" variant="outline">
      <ArrowDownToLineIcon aria-hidden="true" />
      Withdraw
    </Button>
    <Button size="sm" variant="outline">
      <FileTextIcon aria-hidden="true" />
      Recovery card
    </Button>
  </>
);

function Row({ row, action, more, defaultMoreOpen = false }: { row: SampleRow; action?: ReactNode; more: ReactNode; defaultMoreOpen?: boolean }) {
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
          wasProtected={row.wasProtected}
          action={action}
          moreActions={more}
          defaultMoreOpen={defaultMoreOpen}
          hint={false}
        />
      </AccountListItem>
    </AccountList>
  );
}

/** AccountRow is a Collapsible: More (the chevron) is its trigger. A Protected row has nothing to do, so all its actions sit behind More; open, they show on a subtle panel under the row. */
export const RowMoreOpen = () => (
  <Row
    row={sample('protected')}
    more={
      <>
        {extend}
        {withdrawAndCard}
      </>
    }
    defaultMoreOpen
  />
);

/** A lock that ends soon keeps Extend on the row; Withdraw and Recovery card stay folded behind More. */
export const RowMoreClosed = () => <Row row={sample('expiring')} action={extend} more={withdrawAndCard} />;

/** Rescue's "Not in this run", open: the accounts another second key locks, that key in full, and their rows. */
export const NotInRunOpen = () => {
  const [open, setOpen] = useState(true);
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

/** Protect step 1's "Already protected" group: folded by default behind a heading button, since only an extend can change these. */
export const AlreadyProtectedClosed = () => {
  const [open, setOpen] = useState(false);
  return (
    <section className="flex flex-col gap-3">
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
    </section>
  );
};
