import { AccountList, AccountListItem, AccountRow, AddressText, Button, Collapsible, CollapsibleContent, CollapsibleTrigger } from '@stakeward/design-system';
import { ArrowDownToLineIcon, CalendarPlusIcon, ChevronDownIcon, FileTextIcon } from 'lucide-react';
import { SAMPLE, sampleRows, type SampleRow } from '../../apps/web/src/pages/dev-ui/samples';

// A fixed cluster clock (9 October 2026, epoch 850) so the dates in the rows never drift.
const clock = { unixTimestamp: 1_791_504_000n, epoch: 850n };
const rows = sampleRows(clock);
const sample = (key: SampleRow['key']) => rows.find((row) => row.key === key) as SampleRow;

/** Open under a stake account row: AccountRow puts its More actions in a CollapsibleContent, a subtle panel the width of the row. A Protected row keeps Extend, Withdraw and Recovery card there. */
export const RowActions = () => {
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
          defaultMoreOpen
          hint={false}
        />
      </AccountListItem>
    </AccountList>
  );
};

/** Open: a folded group's contents, laid out by the className the page gives the content (rescue's "Not in this run"). */
export const GroupList = () => {
  const locked = sample('locked-by-other');
  return (
    <Collapsible defaultOpen className="border-y border-border">
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-sm py-3 text-left font-medium">
        Not in this run (1)
        <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0 rotate-180 text-muted transition-transform" />
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
