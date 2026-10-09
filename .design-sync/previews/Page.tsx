import {
  AccountList,
  AccountListItem,
  AccountListSkeleton,
  AccountRow,
  ActionBar,
  Button,
  NoStakeAccounts,
  Page,
  PageHeader,
  Section,
  StepProgress,
  SummaryBar,
  WalletSlot,
} from '@stakeward/design-system';
import type { Address } from '@solana/kit';
import { formatSol } from '@stakeward/core';
import {
  ArrowDownToLineIcon,
  CalendarPlusIcon,
  FileTextIcon,
  InfoIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SendIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { AddressForm } from '../../apps/web/src/pages/app/AddressForm';
import { MonitoringStatus } from '../../apps/web/src/pages/app/MonitoringStatus';
import { buildAccountsView, protectableInGroup, type AccountView } from '../../apps/web/src/pages/app/view';
import { SAMPLE, SAMPLE_WALLETS, sampleRows, type SampleRow } from '../../apps/web/src/pages/dev-ui/samples';

// A fixed cluster clock (9 October 2026, epoch 850) and "now" so the dates in the cards never drift.
const clock = { unixTimestamp: 1_791_504_000n, epoch: 850n };
const NOW = 1_791_504_000_000;
const samples = sampleRows(clock);
const accountsOf = (...keys: SampleRow['key'][]) =>
  keys.flatMap((key) => samples.filter((row) => row.key === key).map((row) => row.account));
const protectSteps = ['Accounts', 'Second key', 'Lock period', 'Review and sign'];
const noop = () => undefined;
const linkClass = 'rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover';

/** /app's own view of two stake accounts of the main key, with its second key known on this device. */
const view = buildAccountsView({
  address: SAMPLE.mainKey,
  accounts: accountsOf('expiring', 'unprotected'),
  clock,
  knownSecondKeys: [SAMPLE.secondKey],
  rememberedProtected: [],
});
const attention = view.groups.attention;
const protectable = protectableInGroup(attention);
/** A SOL amount without its unit, for sentences that say "SOL" once. */
const solNumber = (lamports: bigint) => formatSol(lamports).replace(/ SOL$/, '');
const sumOf = (list: readonly AccountView[]) => list.reduce((total, row) => total + row.account.lamports, 0n);

const checked = (
  <MonitoringStatus
    state={{ status: 'ready', health: { lastMonitorRunAt: new Date(NOW - 2 * 60_000) }, receivedAt: NOW }}
    now={NOW}
  />
);

const refresh = (
  <Button variant="ghost" size="icon-sm" aria-label="Refresh">
    <RefreshCwIcon aria-hidden="true" />
  </Button>
);

/**
 * /app's address form as the page renders it once an address is checked: the address in the field, Check outline
 * (the filled button belongs to the results), and Connect main key beside it.
 */
function CheckedForm({ address }: { address: Address }) {
  return (
    <AddressForm
      value={address}
      resultsFor={address}
      onSubmit={noop}
      emphasis="outline"
      aside={<WalletSlot role="main" status="empty" wallets={SAMPLE_WALLETS} onConnect={noop} layout="inline" connectLabel="Connect main key" />}
    />
  );
}

/** The row actions /app gives in Needs attention: Protect behind More (the group's button covers it), Extend on a lock that ends soon. */
function actionsOf(row: AccountView): { action?: ReactNode; more?: ReactNode } {
  if (row.protection === 'unprotected') {
    return {
      more: (
        <Button size="sm" variant="outline">
          <ShieldCheckIcon aria-hidden="true" />
          Protect
        </Button>
      ),
    };
  }
  return {
    action: (
      <Button size="sm" variant="outline">
        <CalendarPlusIcon aria-hidden="true" />
        Extend
      </Button>
    ),
    more: (
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
    ),
  };
}

/**
 * `app`: the full content width of /app, the landing and /recovery. /app with an address checked: the h1 and lead,
 * the address form with Connect main key, the summary (protected SOL, monitoring, Telegram, Refresh, Rescue), then
 * the groups.
 */
export const AppWidth = () => (
  <Page width="app">
    <PageHeader title="Your stake accounts" lead="Paste any wallet address to see its stake. Looking and connecting sign nothing." />
    <div className="flex flex-col gap-6 sm:gap-8">
      <CheckedForm address={SAMPLE.mainKey} />
      <div className="flex flex-col gap-6 sm:gap-8">
        <SummaryBar
          label="Summary"
          state="ready"
          headline={`${solNumber(view.totals.protectedLamports)} of ${solNumber(view.totals.lamports)} SOL protected`}
          detail={<p>{`${String(view.confirmedProtected.length)} of ${String(view.owned.length)} stake accounts`}</p>}
          monitoring={checked}
          tools={
            <>
              <Button variant="outline" size="sm">
                <SendIcon aria-hidden="true" />
                Get alerts in Telegram
              </Button>
              {refresh}
            </>
          }
          action={
            <p className="text-sm sm:pt-1.5">
              Main key stolen?{' '}
              <a href={`/rescue?address=${SAMPLE.mainKey}`} onClick={(event) => event.preventDefault()} className={linkClass}>
                Rescue your stake
              </a>
            </p>
          }
        />
        <Section
          title="Needs attention"
          count={`${String(attention.length)} · ${formatSol(sumOf(attention))}`}
          description="Without a lock, or once it ends, anyone with your main key can withdraw the stake."
          action={
            <Button variant="primary" size="sm">
              <ShieldCheckIcon aria-hidden="true" />
              {protectable.length === 1 ? 'Protect 1 account' : `Protect ${String(protectable.length)} accounts`}
            </Button>
          }
        >
          <AccountList label="Needs attention" actionColumns>
            {attention.map((row) => {
              const { action, more } = actionsOf(row);
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
                    rescueHref={`/rescue?address=${row.account.withdrawer}`}
                    action={action}
                    moreActions={more}
                    hint={false}
                    serviceDetail
                  />
                </AccountListItem>
              );
            })}
          </AccountList>
        </Section>
      </div>
    </div>
  </Page>
);

/**
 * `flow`: the centred column of a wizard (/protect, /withdraw, /rescue): the header with its steps, then the step under
 * its own h2: the main key connected, its stake accounts still loading, Continue waiting for a choice.
 */
export const FlowWidth = () => (
  <Page width="flow">
    <PageHeader
      title="Protect your stake"
      lead="Lock your stake with a second key you control. While it is locked, your main key alone cannot withdraw the SOL or give the stake away."
      progress={<StepProgress steps={protectSteps} current={0} />}
    />
    <section aria-labelledby="flow-step-title" className="flex flex-col gap-6 text-pretty">
      <h2 id="flow-step-title" className="text-lg font-semibold text-balance">
        Choose the stake accounts to protect
      </h2>
      <WalletSlot role="main" status="connected" wallet={SAMPLE_WALLETS[0]} address={SAMPLE.mainKey} onDisconnect={noop} layout="inline" />
      <div aria-busy="true" className="flex flex-col gap-3">
        <p role="status" className="flex items-center gap-2 text-sm text-muted">
          <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
          Reading your stake accounts from the network
        </p>
        <AccountListSkeleton />
      </div>
      <ActionBar
        primary={
          <Button variant="outline" aria-disabled="true" aria-describedby="flow-step-reason" className="aria-disabled:pointer-events-auto aria-disabled:opacity-100">
            Continue with 0 accounts
          </Button>
        }
        reason={
          <div id="flow-step-reason" className="flex items-start gap-2 rounded-md text-sm text-muted">
            <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <p>Choose at least one stake account.</p>
          </div>
        }
      />
    </section>
  </Page>
);

/**
 * /app for an address with no native stake: the form keeps the checked address (Check again or connect the main key),
 * the line says when monitoring ran with Refresh beside it, and NoStakeAccounts explains what Stakeward protects.
 */
export const EmptyResult = () => (
  <Page width="app">
    <PageHeader title="Your stake accounts" lead="Paste any wallet address to see its stake. Looking and connecting sign nothing." />
    <div className="flex flex-col gap-6 sm:gap-8">
      <CheckedForm address={SAMPLE.stranger} />
      <div className="flex flex-col gap-6 sm:gap-8">
        <section aria-label="Summary" className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {checked}
          {refresh}
        </section>
        <NoStakeAccounts address={SAMPLE.stranger} />
      </div>
    </div>
  </Page>
);
