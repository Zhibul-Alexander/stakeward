import type { Address } from '@solana/kit';
import { formatSol, shortAddress } from '@stakeward/core';
import { CalendarPlusIcon, FileTextIcon, LoaderCircleIcon, RefreshCwIcon, SendIcon, ShieldCheckIcon, ShieldXIcon } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { AccountList, AccountListItem, AccountListSkeleton, AccountRow } from '@/components/product/account-row';
import { AddressText } from '@/components/product/address-text';
import { NoStakeAccounts } from '@/components/product/empty-state';
import { ErrorState } from '@/components/product/error-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { Health } from '@/api/health';
import { telegramLinkPath } from '@/api/telegram';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { useKnownSecondKeys, usePorts, useProtectedAccounts, useWalletSlots } from '@/ports';
import { useHealth, useNow, useStakeAccounts } from './hooks.ts';
import { KeySlot } from './KeySlot.tsx';
import { MonitoringStatus } from './MonitoringStatus.tsx';
import { appLinks, buildAccountsView, type AccountView, type AccountsView } from './view.ts';

/** "Last checked N min ago" moves on while the page is open. */
const CLOCK_TICK_MS = 30_000;

/**
 * The stake of one main key: its accounts with their statuses, the accounts whose lock it holds as second key,
 * monitoring freshness and a way to read everything again. Everything comes from the chain on each read
 * (CLAUDE.md section 5: reload-safe); the device adds only the known second keys and the accounts it saw protected.
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
    <div data-slot="accounts-results" className="flex flex-col gap-6">
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col">
          <span className="text-xs text-muted">{t('app.results.mainKey')}</span>
          <AddressText address={address} />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <MonitoringStatus state={health} now={now} />
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
          <Button variant="outline" size="sm" onClick={reload}>
            <RefreshCwIcon aria-hidden="true" />
            {t('app.results.refresh')}
          </Button>
        </div>
      </div>
      {state.status === 'loading' ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            {t('app.results.loading')}
          </p>
          <AccountListSkeleton />
        </div>
      ) : state.status === 'error' ? (
        <ErrorState
          title={t('app.results.errorTitle')}
          message={errorMessage(state.error)}
          detail={state.error.detail}
          onRetry={reload}
        />
      ) : view === null ? null : (
        <Loaded address={address} view={view} />
      )}
    </div>
  );
}

function Loaded({ address, view }: { address: Address; view: AccountsView }) {
  const mainId = useId();
  const secondId = useId();
  const confirmId = useId();
  return (
    <>
      {view.noLongerProtected.length === 0 ? null : <NoLongerProtectedBanner accounts={view.noLongerProtected} />}
      <section aria-labelledby={mainId} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id={mainId} className="text-lg font-semibold">
            {t('app.lists.main')}
          </h2>
          {view.owned.length === 0 ? null : <p className="text-sm text-muted">{t('app.lists.mainNote')}</p>}
        </div>
        {view.owned.length === 0 ? null : <Totals totals={view.totals} />}
        {view.owned.length > 0 ? (
          <Rows label={t('app.lists.main')} rows={view.owned} actions={(row) => ownedActions(row)} />
        ) : view.secondKeyFor.length === 0 ? (
          <NoStakeAccounts address={address} headingLevel={3} />
        ) : (
          <p className="text-sm text-muted">{t('app.lists.noneOwned')}</p>
        )}
        {/* For any stake of this main key, locked or not (D70 moves both): a victim is sent to another computer, which
            knows no second key and so calls none of the locks Protected (D35). */}
        {view.owned.length > 0 ? (
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
            {t('app.results.rescueNote')}
            <Link
              href={appLinks.rescue(address)}
              className="rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
            >
              {t('app.results.rescue')}
            </Link>
          </p>
        ) : null}
      </section>
      {view.unconfirmedLock ? (
        <section aria-labelledby={confirmId} className="flex flex-col gap-3">
          <h2 id={confirmId} className="text-lg font-semibold">
            {t('app.connect.secondTitle')}
          </h2>
          <KeySlot role="second" mainKey={address} description={t('app.connect.secondDescription')} />
        </section>
      ) : null}
      {view.secondKeyFor.length === 0 ? null : (
        <section aria-labelledby={secondId} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 id={secondId} className="text-lg font-semibold">
              {t('app.lists.secondKeyFor')}
            </h2>
            <p className="text-sm text-muted">{t('app.lists.secondKeyForNote')}</p>
          </div>
          <Rows label={t('app.lists.secondKeyFor')} rows={view.secondKeyFor} actions={(row) => secondKeyActions(row)} />
        </section>
      )}
    </>
  );
}

function Totals({ totals }: { totals: AccountsView['totals'] }) {
  return (
    <ul data-slot="totals" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      <li className="font-medium">
        {totals.count === 1 ? t('app.results.countOne') : t('app.results.countOther', { count: totals.count })}
      </li>
      <li className="text-muted tabular-nums">{t('app.results.total', { amount: formatSol(totals.lamports) })}</li>
      <li className="text-muted tabular-nums">{t('app.results.protected', { amount: formatSol(totals.protectedLamports) })}</li>
    </ul>
  );
}

/** A row's visible action and the ones behind its More. */
type RowActions = { action?: ReactNode; more?: ReactNode };

function Rows({ label, rows, actions }: { label: string; rows: readonly AccountView[]; actions: (row: AccountView) => RowActions }) {
  // Rescue for the account's own main key (its withdrawer): the address itself in the main list, the owner in the
  // second-key list. The row links it only under its warning that another key can stop or move the stake.
  return (
    <AccountList label={label}>
      {rows.map((row) => {
        const { action, more } = actions(row);
        return (
          <AccountListItem key={row.account.address}>
            <AccountRow
              account={row.account}
              activation={row.activation}
              protection={row.protection}
              managedByService={row.managedByService}
              secondKeyKnown={row.secondKeyKnown}
              wasProtected={row.wasProtected}
              rescueHref={appLinks.rescue(row.account.withdrawer)}
              action={action}
              moreActions={more}
              serviceDetail
            />
          </AccountListItem>
        );
      })}
    </AccountList>
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

/**
 * Main list: protect what is open, extend or withdraw what is locked, nothing on someone else's lock (view only). The
 * first action is the row's visible one; the others are behind its More.
 */
function ownedActions(row: AccountView): RowActions {
  const account = row.account.address;
  switch (row.protection) {
    case 'unprotected':
      return {
        action: (
          <ActionLink
            href={appLinks.protect([account])}
            label={row.wasProtected ? t('app.actions.protectAgain') : t('app.actions.protect')}
            icon={<ShieldCheckIcon aria-hidden="true" />}
            variant="primary"
            account={account}
          />
        ),
      };
    case 'protected':
    case 'expiring':
      return {
        action: (
          <ActionLink
            href={appLinks.extend(account)}
            label={t('app.actions.extend')}
            icon={<CalendarPlusIcon aria-hidden="true" />}
            variant={row.protection === 'expiring' ? 'primary' : 'outline'}
            account={account}
          />
        ),
        more: (
          <>
            <ActionLink href={appLinks.withdraw(account)} label={t('app.actions.withdraw')} variant="outline" account={account} />
            <RecoveryCardLink account={account} />
          </>
        ),
      };
    case 'locked-by-other':
      // Whose key holds this lock is not known here, so no card speaks for it (D35).
      return {};
  }
}

/** Second-key list: the second key can extend (or remove) the lock it holds, and keep the card of that lock. */
function secondKeyActions(row: AccountView): RowActions {
  return {
    action: (
      <ActionLink
        href={appLinks.extend(row.account.address)}
        label={t('app.actions.extend')}
        icon={<CalendarPlusIcon aria-hidden="true" />}
        variant={row.protection === 'expiring' ? 'primary' : 'outline'}
        account={row.account.address}
      />
    ),
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

/** F6: accounts this device saw protected now stand without a lock (red until they are protected again). */
function NoLongerProtectedBanner({ accounts }: { accounts: readonly Address[] }) {
  return (
    <Alert tone="danger" data-slot="no-longer-protected">
      <ShieldXIcon aria-hidden="true" />
      <AlertTitle>
        {accounts.length === 1
          ? t('app.noLongerProtected.titleOne')
          : t('app.noLongerProtected.titleOther', { count: accounts.length })}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-3 text-foreground">
        <p>{accounts.length === 1 ? t('app.noLongerProtected.bodyOne') : t('app.noLongerProtected.body')}</p>
        <div>
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
