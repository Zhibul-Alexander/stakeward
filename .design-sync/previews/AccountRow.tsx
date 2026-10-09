import { AccountList, AccountListItem, AccountRow, Button } from '@stakeward/design-system';
import type { Address } from '@solana/kit';
import { ArrowDownToLineIcon, CalendarPlusIcon, FileTextIcon, LifeBuoyIcon, ShieldCheckIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { appLinks, buildAccountsView, stakeKeyChanged, type AccountView, type PrimaryAction } from '../../apps/web/src/pages/app/view';
import { SAMPLE, sampleRows, type SampleRow } from '../../apps/web/src/pages/dev-ui/samples';

// A fixed cluster clock (9 October 2026, epoch 850) so the dates in the cards never drift.
const clock = { unixTimestamp: 1_791_504_000n, epoch: 850n };
const samples = sampleRows(clock);
const accountsOf = (...keys: SampleRow['key'][]) =>
  keys.flatMap((key) => samples.filter((row) => row.key === key).map((row) => row.account));

/** The rows of /app as its own view builds them: groups, statuses and the screen's one filled button. */
const viewOf = (keys: SampleRow['key'][], knownSecondKeys: readonly Address[], rememberedProtected: readonly Address[] = []) =>
  buildAccountsView({ address: SAMPLE.mainKey, accounts: accountsOf(...keys), clock, knownSecondKeys, rememberedProtected });

type RowActions = { action?: ReactNode; more?: ReactNode };

function ActionButton({ icon, label, primary = false }: { icon: ReactNode; label: string; primary?: boolean }) {
  return (
    <Button size="sm" variant={primary ? 'primary' : 'outline'}>
      {icon}
      {label}
    </Button>
  );
}

const extendButton = (row: AccountView, primary: PrimaryAction) => (
  <ActionButton
    icon={<CalendarPlusIcon aria-hidden="true" />}
    label="Extend"
    primary={primary?.kind === 'extend' && primary.account === row.account.address}
  />
);
const lockedRest = (
  <>
    <ActionButton icon={<ArrowDownToLineIcon aria-hidden="true" />} label="Withdraw" />
    <ActionButton icon={<FileTextIcon aria-hidden="true" />} label="Recovery card" />
  </>
);

/** /app's lockedActions: Extend behind More with Withdraw and the recovery card; a lock that ends soon shows Extend. */
function lockedActions(row: AccountView, primary: PrimaryAction): RowActions {
  if (row.protection === 'expiring') return { action: extendButton(row, primary), more: lockedRest };
  return {
    more: (
      <>
        {extendButton(row, primary)}
        {lockedRest}
      </>
    ),
  };
}

/**
 * /app's attentionActions: a changed stake key gets Rescue; without a lock Protect is behind More (the group's "Protect N
 * accounts" covers it) unless a staking service may manage the stake; a lock that ends soon shows Extend.
 */
function attentionActions(row: AccountView, primary: PrimaryAction): RowActions {
  if (stakeKeyChanged(row)) {
    return {
      action: (
        <ActionButton
          icon={<LifeBuoyIcon aria-hidden="true" />}
          label="Rescue"
          primary={primary?.kind === 'rescue' && primary.account === row.account.address}
        />
      ),
      more: (
        <>
          {extendButton(row, primary)}
          {lockedRest}
        </>
      ),
    };
  }
  if (row.protection !== 'unprotected') return lockedActions(row, primary);
  const protect = <ActionButton icon={<ShieldCheckIcon aria-hidden="true" />} label={row.wasProtected ? 'Protect again' : 'Protect'} />;
  return row.managedByService ? { action: protect } : { more: protect };
}

function AppRow({ row, actions, defaultMoreOpen }: { row: AccountView; actions: RowActions; defaultMoreOpen?: boolean }) {
  return (
    <AccountRow
      account={row.account}
      activation={row.activation}
      clock={clock}
      protection={row.protection}
      managedByService={row.managedByService}
      secondKeyKnown={row.secondKeyKnown}
      wasProtected={row.wasProtected}
      rescueHref={appLinks.rescue(row.account.withdrawer)}
      action={actions.action}
      moreActions={actions.more}
      defaultMoreOpen={defaultMoreOpen}
      hint={false}
      serviceDetail
    />
  );
}

/**
 * Needs attention on /app: a lock that ended (Protect again behind More), a lock that ends soon (Extend), no lock
 * (Protect behind More). The F6 banner above the page holds the one filled button, so every row button is outline.
 */
export const NeedsAttention = () => {
  const view = viewOf(['was-protected', 'expiring', 'unprotected'], [SAMPLE.secondKey], [SAMPLE.stakeF]);
  return (
    <AccountList label="Needs attention" actionColumns>
      {view.groups.attention.map((row) => (
        <AccountListItem key={row.account.address}>
          <AppRow row={row} actions={attentionActions(row, view.primaryAction)} />
        </AccountListItem>
      ))}
    </AccountList>
  );
};

/**
 * The row warnings: a staking service may manage the stake (its own Protect), and another stake key under the
 * viewer's own lock (Rescue, the page's one filled button, and Open Rescue in the warning).
 */
export const Warnings = () => {
  const view = viewOf(['managed-by-service', 'stake-key-changed'], [SAMPLE.secondKey]);
  return (
    <AccountList label="Needs attention" actionColumns>
      {view.groups.attention.map((row) => (
        <AccountListItem key={row.account.address}>
          <AppRow row={row} actions={attentionActions(row, view.primaryAction)} />
        </AccountListItem>
      ))}
    </AccountList>
  );
};

/**
 * Locks this browser cannot use: with a second key known, a lock it does not hold reads Locked by another key; on a
 * new device that knows none, Locked by a second key. Each names the key that holds it; neither has an action.
 */
export const LockedByOtherKeys = () => {
  const known = viewOf(['locked-by-other'], [SAMPLE.secondKey]);
  const newDevice = viewOf(['locked-new-device'], []);
  return (
    <div className="flex flex-col gap-6">
      <AccountList label="Locked by another key" actionColumns>
        {known.groups.locked.map((row) => (
          <AccountListItem key={row.account.address}>
            <AppRow row={row} actions={{}} />
          </AccountListItem>
        ))}
      </AccountList>
      <AccountList label="Locked by a second key" actionColumns>
        {newDevice.groups.locked.map((row) => (
          <AccountListItem key={row.account.address}>
            <AppRow row={row} actions={{}} />
          </AccountListItem>
        ))}
      </AccountList>
    </div>
  );
};

/** A Protected row with More open: Extend, Withdraw and Recovery card under it. */
export const MoreOpen = () => {
  const view = viewOf(['protected'], [SAMPLE.secondKey]);
  return (
    <AccountList label="Protected" actionColumns>
      {view.groups.protected.map((row) => (
        <AccountListItem key={row.account.address}>
          <AppRow row={row} actions={lockedActions(row, view.primaryAction)} defaultMoreOpen />
        </AccountListItem>
      ))}
    </AccountList>
  );
};

/** Protect, step 1: "Not protected" rows start with a checkbox, and the whole row toggles it; a chosen row is tinted. */
export const Selectable = () => {
  const view = viewOf(['managed-by-service', 'unprotected'], [SAMPLE.secondKey]);
  const [chosen, setChosen] = useState<readonly string[]>([SAMPLE.stakeC]);
  return (
    <AccountList label="Not protected (2)">
      {view.owned.map((row) => {
        const address = row.account.address;
        const checked = chosen.includes(address);
        const select = (value: boolean) => {
          setChosen((now) => (value ? [...now, address] : now.filter((item) => item !== address)));
        };
        return (
          <li
            key={address}
            onClick={(event) => {
              // As on /protect: a click on the checkbox or a link does its own thing; anywhere else toggles the row.
              if (event.target instanceof Element && event.target.closest('button, a, input, label, [role="checkbox"]') !== null) return;
              select(!checked);
            }}
            className={`cursor-pointer px-4 py-3 transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-subtle ${checked ? 'bg-primary-soft hover:bg-primary-soft' : ''}`}
          >
            <AccountRow
              account={row.account}
              activation={row.activation}
              clock={clock}
              protection={row.protection}
              managedByService={row.managedByService}
              secondKeyKnown={row.secondKeyKnown}
              hint={false}
              serviceDetail
              select={{ checked, label: `Protect stake account ${address.slice(0, 3)}...${address.slice(-3)}`, onCheckedChange: select }}
            />
          </li>
        );
      })}
    </AccountList>
  );
};

/** /withdraw and /extend: the account as one row in the list's frame, under the page's title, with no actions. */
export const OnAnAccountPage = () => {
  const view = viewOf(['expiring'], [SAMPLE.secondKey]);
  return (
    <div className="flex flex-col gap-3">
      {view.owned.map((row) => (
        <AccountRow
          key={row.account.address}
          account={row.account}
          activation={row.activation}
          clock={clock}
          protection={row.protection}
          managedByService={row.managedByService}
          secondKeyKnown={row.secondKeyKnown}
          rescueHref={appLinks.rescue(row.account.withdrawer)}
          hint={false}
          serviceDetail
          className="rounded-lg border border-border bg-surface px-4 py-3"
        />
      ))}
    </div>
  );
};
