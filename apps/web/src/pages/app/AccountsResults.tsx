import type { Address } from '@solana/kit';
import { formatSol, shortAddress, type ClockView } from '@stakeward/core';
import {
  ArrowDownToLineIcon,
  CalendarPlusIcon,
  FileTextIcon,
  LifeBuoyIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SendIcon,
  Share2Icon,
  ShieldCheckIcon,
  ShieldXIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { Section } from '@/components/layout/Section';
import { AccountList, AccountListItem, AccountListSkeleton, AccountRow } from '@/components/product/account-row';
import { AddressText } from '@/components/product/address-text';
import { NoStakeAccounts } from '@/components/product/empty-state';
import { ErrorState } from '@/components/product/error-state';
import { SummaryBar } from '@/components/product/summary-bar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { Health } from '@/api/health';
import { telegramLinkPath } from '@/api/telegram';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { useKnownSecondKeys, usePorts, useProtectedAccounts, useSlot, useWalletSlots } from '@/ports';
import { useHealth, useNow, useStakeAccounts } from './hooks.ts';
import { KeySlot } from './KeySlot.tsx';
import { MonitoringStatus } from './MonitoringStatus.tsx';
import {
  appLinks,
  attentionNote,
  buildAccountsView,
  protectableInGroup,
  stakeKeyChanged,
  type AccountView,
  type AccountsView,
  type PrimaryAction,
} from './view.ts';

/** "Last checked N min ago" moves on while the page is open. */
const CLOCK_TICK_MS = 30_000;

/** A SOL amount without its unit, for sentences that say "SOL" once: "1,293.25 of 1,490.45 SOL protected". */
const solNumber = (lamports: bigint) => formatSol(lamports).replace(/ SOL$/, '');

const sumOf = (rows: readonly AccountView[]) => rows.reduce((total, row) => total + row.account.lamports, 0n);

/**
 * The stake of one main key: first the answer (how much is protected, how fresh that is), then the accounts grouped by
 * what they ask of the viewer, then the accounts whose lock it holds as second key (DECISIONS.md D112). Everything
 * comes from the chain on each read (CLAUDE.md section 5: reload-safe); the device adds only the known second keys and
 * the accounts it saw protected.
 */
export function AccountsResults({ address, loadHealth }: { address: Address; loadHealth: () => Promise<Health> }) {
  const { chain, protectedAccounts, api } = usePorts();
  const knownSecondKeys = useKnownSecondKeys();
  const rememberedProtected = useProtectedAccounts();
  const mainSlot = useWalletSlots().main;
  const [attempt, setAttempt] = useState(0);
  const state = useStakeAccounts(chain, address, attempt);
  const health = useHealth(loadHealth, attempt);
  const now = useNow(CLOCK_TICK_MS);
  const reload = () => {
    setAttempt((value) => value + 1);
  };

  const view = useMemo(
    () =>
      state.status === 'ready'
        ? buildAccountsView({
            address,
            accounts: state.data.accounts,
            clock: state.data.clock,
            knownSecondKeys,
            rememberedProtected,
          })
        : null,
    [address, state, knownSecondKeys, rememberedProtected],
  );

  // F6: remember what this device saw protected, so a lock that ends later shows the red banner. Only for the main
  // key connected here: anyone can lock their own accounts to a second key (it is public), so viewing a stranger's
  // address must not write the memory, or a link with enough such accounts would push the viewer's own out of it.
  const confirmed = mainSlot?.address === address ? view?.confirmedProtected : undefined;
  useEffect(() => {
    if (confirmed !== undefined && confirmed.length > 0) protectedAccounts.remember(confirmed);
  }, [confirmed, protectedAccounts]);

  // The same locks go under monitoring, each once per page (DECISIONS D50): a lock made elsewhere, or one whose
  // POST /api/watch failed on the Done screen, is watched from here on. The worker reads the chain itself and accepts
  // only a lock in force, so this sends nothing but public addresses; a failure is silent (the page works without it).
  // Never for a view by address.
  const postedRef = useRef(new Set<Address>());
  useEffect(() => {
    if (confirmed === undefined) return;
    const posted = postedRef.current;
    const newOnes = confirmed.filter((account) => !posted.has(account));
    if (newOnes.length === 0) return;
    for (const account of newOnes) posted.add(account);
    void api.watch(newOnes).catch(() => undefined);
  }, [confirmed, api]);

  // What a check found, for screen readers (UX rule 11): the loading line that announced the read is gone by then. The
  // region stays in the page so that the change of its text is what gets announced.
  const found = view === null ? 0 : view.owned.length + view.secondKeyFor.length;
  const announcement =
    view === null
      ? ''
      : found === 0
        ? t('app.results.announceNone')
        : found === 1
          ? t('app.results.announceOne')
          : t('app.results.announceOther', { count: found });

  return (
    <div data-slot="accounts-results" className="flex flex-col gap-6 sm:gap-8">
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {/* "Last checked" and Refresh in every state, the read error included: they matter most when the worker or the
          RPC may be down (UX rule 12). Alerts reach a second-key holder too; only an address with nothing to watch
          has no Telegram, and nothing to sum up: there the line stands without a card above the empty state. */}
      {view !== null && found === 0 ? (
        <section
          aria-label={t('app.summary.label')}
          data-slot="summary-line"
          className="flex flex-wrap items-center gap-x-4 gap-y-2"
        >
          <MonitoringStatus state={health} now={now} />
          <RefreshButton onRefresh={reload} />
        </section>
      ) : (
        <Summary
          address={address}
          view={view}
          state={state.status}
          monitoring={<MonitoringStatus state={health} now={now} />}
          onRefresh={reload}
        />
      )}
      {state.status === 'loading' ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            {t('app.results.loading')}
          </p>
          <AccountListSkeleton rows={3} />
        </div>
      ) : state.status === 'error' ? (
        <ErrorState
          title={t('app.results.errorTitle')}
          message={errorMessage(state.error)}
          detail={state.error.detail}
          onRetry={reload}
        />
      ) : view === null ? null : (
        <Loaded address={address} view={view} clock={state.data.clock} />
      )}
    </div>
  );
}

function Summary({
  address,
  view,
  state,
  monitoring,
  onRefresh,
}: {
  address: Address;
  view: AccountsView | null;
  state: 'loading' | 'error' | 'ready';
  monitoring: ReactNode;
  onRefresh: () => void;
}) {
  const owned = view === null ? 0 : view.owned.length;
  const secondKeyFor = view === null ? 0 : view.secondKeyFor.length;
  const protectedCount = view === null ? 0 : view.confirmedProtected.length;
  const headline =
    view === null || owned === 0
      ? undefined
      : t('app.summary.headline', { protected: solNumber(view.totals.protectedLamports), total: solNumber(view.totals.lamports) });
  const detail =
    view === null ? undefined : owned > 0 ? (
      <>
        <p>
          {owned === 1
            ? t('app.summary.accountsOne', { protected: protectedCount })
            : t('app.summary.accounts', { protected: protectedCount, count: owned })}
        </p>
        {/* A new device: these may well be the viewer's own locks, but they are not counted until the key is here. */}
        {view.lockedUnconfirmedLamports === 0n ? null : (
          <p>{t('app.summary.unconfirmed', { amount: solNumber(view.lockedUnconfirmedLamports) })}</p>
        )}
      </>
    ) : secondKeyFor > 0 ? (
      secondKeyFor === 1 ? (
        t('app.summary.secondKeyForOne')
      ) : (
        t('app.summary.secondKeyForOther', { count: secondKeyFor })
      )
    ) : undefined;
  return (
    <SummaryBar
      label={t('app.summary.label')}
      state={state}
      headline={headline}
      detail={detail}
      monitoring={monitoring}
      tools={
        <>
          <Button asChild variant="outline" size="sm">
            <a
              href={telegramLinkPath(address)}
              target="_blank"
              rel="noreferrer"
              aria-label={`${t('app.results.telegram')} ${t('common.opensInNewTab')}`}
            >
              <SendIcon aria-hidden="true" />
              {t('app.results.telegram')}
            </a>
          </Button>
          <RefreshButton onRefresh={onRefresh} />
        </>
      }
      // The public proof page of this stake (D124): small and secondary, for a fund or a validator to share. A footer
      // line, not a tool: the tools row keeps Telegram and Refresh together on one line at 360 px.
      footer={
        owned === 0 ? undefined : (
          <Link
            href={appLinks.proof(address)}
            className="inline-flex items-center gap-1 rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
          >
            <Share2Icon aria-hidden="true" className="size-4" />
            {t('app.results.shareProof')}
          </Link>
        )
      }
      // For any stake of this main key, locked or not (D70 moves both): a victim is sent to another computer, which
      // knows no second key and so calls none of the locks Protected (D35). Beside the answer from 640 px, so it takes
      // no line of its own there; one line at 360.
      action={
        owned === 0 ? undefined : (
          <p className="text-sm sm:pt-1.5">
            {t('app.results.rescueNote')}{' '}
            <Link
              href={appLinks.rescue(address)}
              className="rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
            >
              {t('app.results.rescue')}
            </Link>
          </p>
        )
      }
    />
  );
}

function RefreshButton({ onRefresh }: { onRefresh: () => void }) {
  return (
    <Button variant="ghost" size="icon-sm" aria-label={t('app.results.refresh')} onClick={onRefresh}>
      <RefreshCwIcon aria-hidden="true" />
    </Button>
  );
}

function Loaded({ address, view, clock }: { address: Address; view: AccountsView; clock: ClockView }) {
  const { attention, protected: protectedRows, locked, secondKeyFor } = view.groups;
  const primary = view.primaryAction;
  // The second key as this browser can use it now: a slot remembered from before whose wallet does not offer it (not
  // reconnected yet, or gone) would draw an empty slot, that is a Connect button.
  const secondReady = useSlot('second')?.ready === true;
  if (view.owned.length === 0 && secondKeyFor.length === 0) return <NoStakeAccounts address={address} />;

  const secondKeyForSection =
    secondKeyFor.length === 0 ? null : (
      <Section
        title={t('app.groups.secondKeyFor')}
        count={groupCount(secondKeyFor)}
        description={t('app.groups.secondKeyForNote')}
      >
        <Rows
          label={t('app.groups.secondKeyFor')}
          rows={secondKeyFor}
          clock={clock}
          actions={(row) => secondKeyActions(row, primary)}
          meta={(row) => <MainKeyMeta mainKey={row.account.withdrawer} />}
        />
      </Section>
    );

  // An address that is only someone's second key: their list first, and one line for the empty main list.
  if (view.owned.length === 0) {
    return (
      <>
        {secondKeyForSection}
        <p className="text-sm text-muted">{t('app.lists.noneOwned')}</p>
      </>
    );
  }

  const protectable = protectableInGroup(attention);
  // The groups' kind follows what this browser knows (D102): all locks of unknown keys are of one kind.
  const lockedKnown = locked.some((row) => row.secondKeyKnown);
  return (
    <>
      {view.noLongerProtected.length === 0 ? null : <NoLongerProtectedBanner accounts={view.noLongerProtected} />}
      {attention.length === 0 ? null : (
        <Section
          title={t('app.groups.attention')}
          count={groupCount(attention)}
          // Said once for the group (D112), true of every row it covers.
          description={attentionDescription(attention)}
          action={
            protectable.length === 0 ? undefined : (
              <Button asChild size="sm" variant={primary?.kind === 'protect-group' ? 'primary' : 'outline'}>
                <Link href={appLinks.protect(protectable)}>
                  <ShieldCheckIcon aria-hidden="true" />
                  {protectable.length === 1
                    ? t('app.actions.protectGroupOne')
                    : t('app.actions.protectGroupOther', { count: protectable.length })}
                </Link>
              </Button>
            )
          }
        >
          <Rows label={t('app.groups.attention')} rows={attention} clock={clock} actions={(row) => attentionActions(row, primary)} />
        </Section>
      )}
      {protectedRows.length === 0 ? null : (
        <Section title={t('app.groups.protected')} count={groupCount(protectedRows)} description={t('app.groups.protectedNote')}>
          <Rows label={t('app.groups.protected')} rows={protectedRows} clock={clock} actions={(row) => lockedActions(row, primary)} />
        </Section>
      )}
      {locked.length === 0 ? null : (
        <Section
          title={lockedKnown ? t('app.groups.locked') : t('app.groups.lockedUnknown')}
          count={groupCount(locked)}
          description={lockedKnown ? t('status.lockedByAnotherHint') : t('status.lockedByOtherHint')}
          // With no second key known, "Connect second key": on a new device these are usually the viewer's own locks.
          // With one known, a lock none of them holds may be a fake site's (D35): no "connect it", only a second key
          // connected and ready here, to compare with the holder.
          action={
            lockedKnown && !secondReady ? undefined : (
              <KeySlot role="second" mainKey={address} layout="inline" connectLabel={t('app.connect.secondButton')} />
            )
          }
        >
          {/* Each row names the key that holds its lock (D35); none has an action (D102). */}
          <Rows label={lockedKnown ? t('app.groups.locked') : t('app.groups.lockedUnknown')} rows={locked} clock={clock} actions={() => ({})} />
        </Section>
      )}
      {secondKeyForSection}
    </>
  );
}

/** The consequence Needs attention says once: now for rows without a lock, once it ends for locks that end soon. */
function attentionDescription(rows: readonly AccountView[]): string | undefined {
  switch (attentionNote(rows)) {
    case 'open':
      return t('status.unprotectedHint');
    case 'ending':
      return t('app.groups.attentionEnding');
    case 'open-or-ending':
      return t('app.groups.attentionOpenOrEnding');
    case null:
      return undefined;
  }
}

/** "4 · 229.95 SOL": how many accounts a group holds and their SOL. */
function groupCount(rows: readonly AccountView[]): string {
  return t('app.groups.count', { count: rows.length, amount: formatSol(sumOf(rows)) });
}

/** A row's visible action and the ones behind its More. */
type RowActions = { action?: ReactNode; more?: ReactNode };

function Rows({
  label,
  rows,
  clock,
  actions,
  meta,
}: {
  label: string;
  rows: readonly AccountView[];
  /** The clock the statuses were computed with: a lock that ends within 30 days shows its date in warning. */
  clock: ClockView;
  actions: (row: AccountView) => RowActions;
  meta?: ((row: AccountView) => ReactNode) | undefined;
}) {
  // Rescue for the account's own main key (its withdrawer): the address itself in the main lists, the owner in the
  // second-key list. The row links it only under its warning that another key can stop or move the stake. Every list
  // keeps room for an action and More, so the SOL of all groups stands in one column.
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

/** For "You are the second key for": whose stake it is (copy, explorer: UX rule 9). */
function MainKeyMeta({ mainKey }: { mainKey: Address }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1">
      <span>{t('common.roles.main')}</span>
      <AddressText address={mainKey} />
    </span>
  );
}

function ActionLink({
  href,
  label,
  icon,
  variant,
  account,
}: {
  href: string;
  label: string;
  icon?: ReactNode;
  variant: 'primary' | 'outline';
  account: Address;
}) {
  return (
    <Button asChild size="sm" variant={variant}>
      <Link href={href} aria-label={t('app.actions.label', { action: label, address: shortAddress(account) })}>
        {icon}
        {label}
      </Link>
    </Button>
  );
}

const isPrimaryExtend = (primary: PrimaryAction, account: Address) => primary?.kind === 'extend' && primary.account === account;

function ExtendLink({ account, primary }: { account: Address; primary: PrimaryAction }) {
  return (
    <ActionLink
      href={appLinks.extend(account)}
      label={t('app.actions.extend')}
      icon={<CalendarPlusIcon aria-hidden="true" />}
      variant={isPrimaryExtend(primary, account) ? 'primary' : 'outline'}
      account={account}
    />
  );
}

/**
 * Needs attention. A changed stake key under the viewer's own lock: Rescue, the sign of a stolen main key (SECURITY-CHECK
 * П6), with the lock's own actions behind More. Without a lock: Protect behind More, as the group's "Protect N
 * accounts" covers it; a stake a service may manage is left out of that and keeps its own Protect. Expiring: Extend.
 */
function attentionActions(row: AccountView, primary: PrimaryAction): RowActions {
  const account = row.account.address;
  if (stakeKeyChanged(row)) {
    return {
      action: (
        <ActionLink
          href={appLinks.rescue(row.account.withdrawer)}
          label={t('app.actions.rescue')}
          icon={<LifeBuoyIcon aria-hidden="true" />}
          variant={primary?.kind === 'rescue' && primary.account === account ? 'primary' : 'outline'}
          account={account}
        />
      ),
      more: (
        <>
          <ExtendLink account={account} primary={primary} />
          <LockedRest account={account} />
        </>
      ),
    };
  }
  if (row.protection !== 'unprotected') return lockedActions(row, primary);
  const protect = (
    <ActionLink
      href={appLinks.protect([account])}
      label={row.wasProtected ? t('app.actions.protectAgain') : t('app.actions.protect')}
      icon={<ShieldCheckIcon aria-hidden="true" />}
      variant="outline"
      account={account}
    />
  );
  return row.managedByService ? { action: protect } : { more: protect };
}

/**
 * Locked by the viewer's own second key: nothing to do, so Extend is behind More with Withdraw and the recovery card;
 * a lock that ends soon shows Extend.
 */
function lockedActions(row: AccountView, primary: PrimaryAction): RowActions {
  const account = row.account.address;
  const extend = <ExtendLink account={account} primary={primary} />;
  const rest = <LockedRest account={account} />;
  if (row.protection === 'expiring') return { action: extend, more: rest };
  return {
    more: (
      <>
        {extend}
        {rest}
      </>
    ),
  };
}

/** Behind More on a lock the viewer holds: withdrawing with both keys, and the recovery card of the lock. */
function LockedRest({ account }: { account: Address }) {
  return (
    <>
      <ActionLink
        href={appLinks.withdraw(account)}
        label={t('app.actions.withdraw')}
        icon={<ArrowDownToLineIcon aria-hidden="true" />}
        variant="outline"
        account={account}
      />
      <RecoveryCardLink account={account} />
    </>
  );
}

/** Second-key list: the second key can extend (or remove) the lock it holds, and keep the card of that lock. */
function secondKeyActions(row: AccountView, primary: PrimaryAction): RowActions {
  return {
    action: <ExtendLink account={row.account.address} primary={primary} />,
    more: <RecoveryCardLink account={row.account.address} />,
  };
}

/** The printable recovery card of the keys that lock this account (DECISIONS.md D74). */
function RecoveryCardLink({ account }: { account: Address }) {
  return (
    <ActionLink
      href={appLinks.recovery(account)}
      label={t('app.actions.recovery')}
      icon={<FileTextIcon aria-hidden="true" />}
      variant="outline"
      account={account}
    />
  );
}

/**
 * F6: accounts this device saw protected now stand without a lock. The page's only red block and, while it shows, the
 * page's one filled button (D112).
 */
function NoLongerProtectedBanner({ accounts }: { accounts: readonly Address[] }) {
  return (
    <Alert tone="danger" data-slot="no-longer-protected">
      <ShieldXIcon aria-hidden="true" />
      <AlertTitle>
        {accounts.length === 1
          ? t('app.noLongerProtected.titleOne')
          : t('app.noLongerProtected.titleOther', { count: accounts.length })}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-3 text-foreground sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <p>{accounts.length === 1 ? t('app.noLongerProtected.bodyOne') : t('app.noLongerProtected.body')}</p>
        <div className="shrink-0">
          <Button asChild variant="danger" size="sm">
            <Link href={appLinks.protect(accounts)}>
              <ShieldCheckIcon aria-hidden="true" />
              {t('app.noLongerProtected.action')}
            </Link>
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
