import { AccountList, AccountListItem, AccountRow, AddressText, Button, Section } from '@stakeward/design-system';
import type { Address } from '@solana/kit';
import { formatSol, isLockupInForce, scannerStatus, stakeActivationStatus, type StakeAccount } from '@stakeward/core';
import {
  ArrowDownToLineIcon,
  ArrowUpIcon,
  CalendarPlusIcon,
  FileTextIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import {
  appLinks,
  attentionNote,
  buildAccountsView,
  protectableInGroup,
  type AccountView,
  type AccountsView,
  type PrimaryAction,
} from '../../apps/web/src/pages/app/view';
import { SAMPLE, sampleRows, type SampleRow } from '../../apps/web/src/pages/dev-ui/samples';

// A fixed cluster clock (9 October 2026, epoch 850) so the dates in the cards never drift.
const clock = { unixTimestamp: 1_791_504_000n, epoch: 850n };
const samples = sampleRows(clock);
const accountsOf = (...keys: SampleRow['key'][]) =>
  keys.flatMap((key) => samples.filter((row) => row.key === key).map((row) => row.account));

/** /app's own view of these accounts: groups, statuses and the screen's one filled button. */
const viewOf = (
  keys: SampleRow['key'][],
  { address = SAMPLE.mainKey, known = [SAMPLE.secondKey], remembered = [] }: { address?: Address; known?: readonly Address[]; remembered?: readonly Address[] } = {},
) => buildAccountsView({ address, accounts: accountsOf(...keys), clock, knownSecondKeys: known, rememberedProtected: remembered });

/** "2 · 45.95 SOL": how many accounts a group holds and their SOL (app.groups.count). */
const groupCount = (rows: readonly AccountView[]) =>
  `${rows.length} · ${formatSol(rows.reduce((total, row) => total + row.account.lamports, 0n))}`;

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
const recoveryCard = <ActionButton icon={<FileTextIcon aria-hidden="true" />} label="Recovery card" />;
const lockedRest = (
  <>
    <ActionButton icon={<ArrowDownToLineIcon aria-hidden="true" />} label="Withdraw" />
    {recoveryCard}
  </>
);

/** /app: Extend behind More on a lock the viewer holds, visible only when the lock ends soon. */
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

/** /app's Needs attention: without a lock, Protect (again) sits behind More, since the group's button covers it. */
function attentionActions(row: AccountView, primary: PrimaryAction): RowActions {
  if (row.protection !== 'unprotected') return lockedActions(row, primary);
  const protect = <ActionButton icon={<ShieldCheckIcon aria-hidden="true" />} label={row.wasProtected ? 'Protect again' : 'Protect'} />;
  return row.managedByService ? { action: protect } : { more: protect };
}

/** /app's Rows: every list keeps the action and More columns, so the SOL of all groups stands in one column. */
function Rows({ label, rows, actions, meta }: { label: string; rows: readonly AccountView[]; actions: (row: AccountView) => RowActions; meta?: (row: AccountView) => ReactNode }) {
  return (
    <AccountList label={label} actionColumns>
      {rows.map((row) => {
        const { action, more } = actions(row);
        return (
          <AccountListItem key={row.account.address}>
            <AccountRow
              account={row.account}
              activation={row.activation}
              clock={clock}
              protection={row.protection}
              managedByService={row.managedByService}
              secondKeyKnown={row.secondKeyKnown}
              wasProtected={row.wasProtected}
              rescueHref={appLinks.rescue(row.account.withdrawer)}
              action={action}
              moreActions={more}
              meta={meta?.(row)}
              hint={false}
              serviceDetail
            />
          </AccountListItem>
        );
      })}
    </AccountList>
  );
}

/** en.json's sentence for what Needs attention says once (AccountsResults attentionDescription). */
const ATTENTION_NOTE = {
  open: 'Anyone with your main key can withdraw this stake.',
  ending: 'Once a lock ends, anyone with your main key can withdraw the stake.',
  'open-or-ending': 'Without a lock, or once it ends, anyone with your main key can withdraw the stake.',
} as const;

/** /app's Needs attention: count, the one sentence, and "Protect N accounts" (filled when it is the page's one). */
function AttentionSection({ view }: { view: AccountsView }) {
  const rows = view.groups.attention;
  const note = attentionNote(rows);
  const protectable = protectableInGroup(rows);
  return (
    <Section
      title="Needs attention"
      count={groupCount(rows)}
      description={note === null ? undefined : ATTENTION_NOTE[note]}
      action={
        protectable.length === 0 ? undefined : (
          <Button size="sm" variant={view.primaryAction?.kind === 'protect-group' ? 'primary' : 'outline'}>
            <ShieldCheckIcon aria-hidden="true" />
            {protectable.length === 1 ? 'Protect 1 account' : `Protect ${protectable.length} accounts`}
          </Button>
        )
      }
    >
      <Rows label="Needs attention" rows={rows} actions={(row) => attentionActions(row, view.primaryAction)} />
    </Section>
  );
}

/**
 * /app with a lock that ends soon, an account without a lock and a protected one: Needs attention says once what is at
 * stake and holds the page's one filled button, "Protect 1 account"; Protected has nothing to do, so its Extend is
 * behind More.
 */
export const AccountsOnApp = () => {
  const view = viewOf(['protected', 'expiring', 'unprotected']);
  const protectedRows = view.groups.protected;
  return (
    <div className="flex flex-col gap-8">
      <AttentionSection view={view} />
      <Section title="Protected" count={groupCount(protectedRows)} description="Withdrawing or changing the owner needs your second key until the date shown.">
        <Rows label="Protected" rows={protectedRows} actions={(row) => lockedActions(row, view.primaryAction)} />
      </Section>
    </div>
  );
};

/**
 * Two groups whose rows have no visible action: Protect (again) is behind More, and a lock of another key has none.
 * With `actionColumns` their SOL still stands in one column. The F6 banner above the page holds the filled button.
 */
export const GroupsAlignedOnApp = () => {
  const view = viewOf(['was-protected', 'unprotected', 'locked-by-other'], { remembered: [SAMPLE.stakeF] });
  const { locked } = view.groups;
  return (
    <div className="flex flex-col gap-8">
      <AttentionSection view={view} />
      <Section
        title="Locked by another key"
        count={groupCount(locked)}
        description="This is not the second key you connected here. If you did not set this lock, someone else holds it."
      >
        <Rows label="Locked by another key" rows={locked} actions={() => ({})} />
      </Section>
    </div>
  );
};

/** /rescue's muted row fact with its icon. */
function RowFact({ icon, tone, children }: { icon: 'up' | 'warning'; tone: 'danger' | 'warning'; children: ReactNode }) {
  const Icon = icon === 'up' ? ArrowUpIcon : TriangleAlertIcon;
  return (
    <span data-tone={tone} className={`inline-flex items-center gap-1 font-medium ${tone === 'danger' ? 'text-danger' : 'text-foreground'}`}>
      <Icon aria-hidden="true" className={`size-3.5 shrink-0 ${tone === 'warning' ? 'text-warning' : ''}`} />
      {children}
    </span>
  );
}

/**
 * /rescue: an ordered list of what this run moves, unlocked first, then by lock end, then the larger balance. No
 * actions; the row's facts say it in the rescue's words (Moves first, Staking key changed).
 */
export const RescueOrder = () => {
  const known = [SAMPLE.secondKey];
  // rescueGroups' order for these four: the account without a lock, then the lock that ends first, then the larger.
  const movable: StakeAccount[] = accountsOf('unprotected', 'expiring', 'protected', 'stake-key-changed');
  return (
    <AccountList label="Stake accounts" ordered>
      {movable.map((account) => {
        const view = scannerStatus(account, known, clock);
        const inForce = isLockupInForce(account.lockup, clock);
        return (
          <AccountListItem key={account.address}>
            <AccountRow
              account={account}
              activation={stakeActivationStatus(account.delegation, clock.epoch)}
              clock={clock}
              protection={view.status}
              managedByService={false}
              secondKeyKnown
              hint={false}
              meta={
                <>
                  {inForce ? null : (
                    <RowFact icon="up" tone="danger">
                      Moves first
                    </RowFact>
                  )}
                  {inForce && account.staker !== account.withdrawer ? (
                    <RowFact icon="warning" tone="warning">
                      Staking key changed — rescue fixes this
                    </RowFact>
                  ) : null}
                </>
              }
            />
          </AccountListItem>
        );
      })}
    </AccountList>
  );
};

/**
 * "You are the second key for" on /app: each row names whose stake it is; Extend is visible (filled on the lock that
 * ends first, the page's one filled button) and the recovery card is behind More.
 */
export const SecondKeyFor = () => {
  const view = viewOf(['protected', 'expiring'], { address: SAMPLE.secondKey, known: [] });
  const rows = view.groups.secondKeyFor;
  return (
    <Section
      title="You are the second key for"
      count={groupCount(rows)}
      description="This wallet holds their lock. It can extend or remove it. It cannot move their SOL."
    >
      <Rows
        label="You are the second key for"
        rows={rows}
        actions={(row) => ({ action: extendButton(row, view.primaryAction), more: recoveryCard })}
        meta={(row) => (
          <span className="inline-flex flex-wrap items-center gap-x-1">
            <span>Main key</span>
            <AddressText address={row.account.withdrawer} />
          </span>
        )}
      />
    </Section>
  );
};
