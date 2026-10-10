import type { Address } from '@solana/kit';
import { scannerStatus, shortAddress, stakeActivationStatus, type ClockView, type StakeAccount } from '@stakeward/core';
import { cn } from 'cn';
import { ChevronDownIcon, LoaderCircleIcon } from 'lucide-react';
import { useId, useState, type MouseEvent, type ReactNode, type Ref } from 'react';
import { Link } from 'wouter';
import { Section } from '@/components/layout/Section';
import { AccountList, AccountListItem, AccountListSkeleton, AccountRow } from '@/components/product/account-row';
import { AddressText } from '@/components/product/address-text';
import { NoStakeAccounts } from '@/components/product/empty-state';
import { ErrorState } from '@/components/product/error-state';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { KeySlot } from '@/pages/app/KeySlot';
import { appLinks } from '@/pages/app/view';
import type { MainKeyAccountsState } from './load.ts';
import { StepButtons } from './StepButtons.tsx';
import { leftOut, MAX_ACCOUNTS_PER_RUN, type Blocker, type Candidate } from './wizard.ts';

type AccountsStepProps = {
  headingRef: Ref<HTMLHeadingElement>;
  mainKey: Address | null;
  mainReady: boolean;
  /** The selection from the URL. */
  selected: readonly Address[];
  /** Accounts the run would protect now (the effective selection): the step button names how many. */
  selectionCount: number;
  loaded: MainKeyAccountsState;
  cands: readonly Candidate[];
  knownSecondKeys: readonly Address[];
  blockers: readonly Blocker[];
  onSelect: (account: Address, checked: boolean) => void;
  /** Replaces the whole selection (Select all, Clear selection). */
  onSelectMany: (accounts: readonly Address[]) => void;
  onRetry: () => void;
  onContinue: () => void;
};

/**
 * Step 1 (F1 steps 1-2): connect the main key, then choose which of its stake accounts to lock. Accounts from a link
 * are only named until the main key is connected; then the chain decides which of them it can protect. Until it is
 * connected, its slot's Connect is the step's one filled button; then the slot shrinks to one line and the accounts
 * follow in groups (DECISIONS.md D112): an account whose stake key changed under the viewer's own lock first (a sign of
 * theft, never folded), the ones to choose from, the ones the viewer's own second key already locks (folded), and locks
 * of a key this browser does not hold, open and never called protected (D14, D35, D102).
 */
export function AccountsStep(props: AccountsStepProps) {
  const { headingRef, mainKey, mainReady, selected, selectionCount, loaded } = props;
  const headingId = useId();
  const connected = mainReady && mainKey !== null;
  // Verb and object once the main key is connected: "Continue with 0 accounts" while nothing is chosen, with the reason.
  const label =
    selectionCount === 1 ? t('protect.continue.accountsOne') : t('protect.continue.accountsOther', { count: selectionCount });
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-6 text-pretty">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-balance">
        {t('protect.accounts.heading')}
      </h2>
      {/* One slot in both layouts, so a connect in progress keeps its state when the slot shrinks to one line. */}
      <KeySlot
        role="main"
        emphasis="primary"
        layout={connected ? 'inline' : 'card'}
        description={connected ? undefined : t('protect.accounts.connectMain')}
      />
      {!connected ? (
        selected.length === 0 ? null : <FromLink accounts={selected} />
      ) : loaded.status === 'idle' || loaded.status === 'loading' ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            {t('protect.accounts.loading')}
          </p>
          <AccountListSkeleton />
        </div>
      ) : loaded.status === 'error' ? (
        <ErrorState
          title={t('protect.accounts.loadError')}
          message={errorMessage(loaded.error)}
          detail={loaded.error.detail}
          onRetry={props.onRetry}
        />
      ) : (
        <Choices {...props} mainKey={mainKey} clock={loaded.clock} />
      )}
      {/* Until the main key is connected its slot is the step's one action: no "Continue with 0 accounts" yet. */}
      {connected ? <StepButtons label={label} blockers={props.blockers} onContinue={props.onContinue} /> : null}
    </section>
  );
}

/** A link's accounts before any chain read: named, not judged. */
function FromLink({ accounts }: { accounts: readonly Address[] }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">
        {accounts.length === 1
          ? t('protect.accounts.fromLinkOne')
          : t('protect.accounts.fromLinkOther', { count: accounts.length })}
      </p>
      <ul className="flex flex-col gap-1">
        {accounts.map((account) => (
          <li key={account}>
            <AddressText address={account} />
          </li>
        ))}
      </ul>
    </div>
  );
}

type RowProps = { account: StakeAccount; clock: ClockView; knownSecondKeys: readonly Address[] };

/** A row of a group that cannot be chosen: status, address, amount and the lock, without a checkbox. */
function ReadOnlyRow({ account, clock, knownSecondKeys, meta, rescueHref }: RowProps & { meta?: ReactNode; rescueHref?: string }) {
  const view = scannerStatus(account, knownSecondKeys, clock);
  return (
    <AccountRow
      account={account}
      activation={stakeActivationStatus(account.delegation, clock.epoch)}
      clock={clock}
      protection={view.status}
      managedByService={view.managedByService}
      secondKeyKnown={knownSecondKeys.length > 0}
      rescueHref={rescueHref}
      hint={false}
      meta={meta}
    />
  );
}

/** Clicks on these inside a row do their own thing; anywhere else the row toggles its checkbox. */
const OWN_CLICK = 'button, a, input, label, [role="checkbox"]';

function Choices({
  mainKey,
  clock,
  selected,
  cands,
  knownSecondKeys,
  onSelect,
  onSelectMany,
}: AccountsStepProps & { mainKey: Address; clock: ClockView }) {
  const open = cands.filter((candidate) => candidate.block === null);
  const own = cands.filter((candidate) => candidate.block === 'already-protected');
  const locked = cands.filter((candidate) => candidate.block === 'locked-by-other');
  // Another stake key under the viewer's own lock (SECURITY-CHECK П6): a sign of theft stays in view, never folded.
  const changed = own.filter(({ account }) => scannerStatus(account, knownSecondKeys, clock).managedByService);
  const folded = own.filter((candidate) => !changed.includes(candidate));
  const outside = leftOut(selected, cands);
  const rescueHref = appLinks.rescue(mainKey);
  // The row already says Protected and until when; the one thing to add is the way to change it.
  const ownMeta = (account: StakeAccount) => (
    <Link href={appLinks.extend(account.address)} className="rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover">
      {t('protect.accounts.extend')}
    </Link>
  );
  // A row whose stake key changed has one way forward, its warning's Open Rescue; the others can be extended.
  const ownRow = ({ account }: Candidate) => (
    <AccountListItem key={account.address}>
      <ReadOnlyRow
        account={account}
        clock={clock}
        knownSecondKeys={knownSecondKeys}
        meta={changed.some((candidate) => candidate.account.address === account.address) ? undefined : ownMeta(account)}
        rescueHref={rescueHref}
      />
    </AccountListItem>
  );

  if (cands.length === 0) {
    return (
      <>
        <NoStakeAccounts
          address={mainKey}
          headingLevel={3}
          action={
            <Button asChild variant="outline" size="sm">
              <Link href={`/app?${new URLSearchParams({ address: mainKey }).toString()}`}>{t('common.backToAccounts')}</Link>
            </Button>
          }
        />
        <LeftOut accounts={outside} />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {changed.length === 0 ? null : (
        // A sign of theft comes first, in a group of its own: never under the calm, folded "Already protected".
        <Section title={t('protect.accounts.groupChanged', { count: changed.length })} headingLevel={3}>
          <AccountList label={t('protect.accounts.groupChanged', { count: changed.length })}>{changed.map(ownRow)}</AccountList>
        </Section>
      )}
      {open.length === 0 ? (
        <p className="text-sm font-medium">{t('protect.accounts.noneProtectable')}</p>
      ) : (
        <OpenGroup open={open} clock={clock} knownSecondKeys={knownSecondKeys} selected={selected} onSelect={onSelect} onSelectMany={onSelectMany} />
      )}
      {folded.length === 0 ? null : <AlreadyProtected count={folded.length}>{folded.map(ownRow)}</AlreadyProtected>}
      {locked.length === 0 ? null : (
        <LockedByOther locked={locked} clock={clock} knownSecondKeys={knownSecondKeys} />
      )}
      <LeftOut accounts={outside} />
    </div>
  );
}

/** "Not protected (n)": the accounts to choose from, said once for the group, with Select all. */
function OpenGroup({
  open,
  clock,
  knownSecondKeys,
  selected,
  onSelect,
  onSelectMany,
}: {
  open: readonly Candidate[];
  clock: ClockView;
  knownSecondKeys: readonly Address[];
  selected: readonly Address[];
  onSelect: (account: Address, checked: boolean) => void;
  onSelectMany: (accounts: readonly Address[]) => void;
}) {
  const addresses = open.map(({ account }) => account.address);
  // One run signs at most MAX_ACCOUNTS_PER_RUN: Select all takes that many, in the list's order.
  const capped = addresses.slice(0, MAX_ACCOUNTS_PER_RUN);
  const allChosen = capped.every((address) => selected.includes(address));
  const others = selected.filter((address) => !addresses.includes(address));
  const title = t('protect.accounts.groupOpen', { count: open.length });
  const action =
    open.length < 2 ? undefined : (
      <>
        {open.length > MAX_ACCOUNTS_PER_RUN ? (
          <span className="text-sm text-muted">{t('protect.accounts.upTo', { max: MAX_ACCOUNTS_PER_RUN })}</span>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onSelectMany(allChosen ? others : [...others, ...capped]);
          }}
        >
          {allChosen ? t('protect.accounts.clearAll') : t('protect.accounts.selectAll', { count: capped.length })}
        </Button>
      </>
    );
  return (
    <Section title={title} headingLevel={3} description={t('protect.accounts.groupHint')} action={action}>
      <AccountList label={title}>
        {open.map(({ account }) => {
          const view = scannerStatus(account, knownSecondKeys, clock);
          const checked = selected.includes(account.address);
          // The whole row toggles its checkbox; the checkbox stays the control for the keyboard and screen readers.
          const toggle = (event: MouseEvent<HTMLLIElement>) => {
            if (event.target instanceof Element && event.target.closest(OWN_CLICK) !== null) return;
            onSelect(account.address, !checked);
          };
          return (
            <li
              key={account.address}
              data-selected={checked ? 'true' : 'false'}
              onClick={toggle}
              className={cn(
                'cursor-pointer px-4 py-3 transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-subtle',
                checked && 'bg-primary-soft hover:bg-primary-soft',
              )}
            >
              <AccountRow
                account={account}
                activation={stakeActivationStatus(account.delegation, clock.epoch)}
                clock={clock}
                protection={view.status}
                managedByService={view.managedByService}
                secondKeyKnown={knownSecondKeys.length > 0}
                hint={false}
                serviceDetail
                select={{
                  checked,
                  label: t('protect.accounts.select', { address: shortAddress(account.address) }),
                  onCheckedChange: (value) => {
                    onSelect(account.address, value);
                  },
                }}
              />
            </li>
          );
        })}
      </AccountList>
    </Section>
  );
}

/**
 * "Already protected (n)": accounts the viewer's own second key locks, folded (only an extend can change them); n is
 * what opening it shows. An account whose stake key changed is not here: it has its own group above.
 */
function AlreadyProtected({ count, children }: { count: number; children: ReactNode }) {
  const headingId = useId();
  const [open, setOpen] = useState(false);
  const title = t('protect.accounts.groupDone', { count });
  return (
    <section aria-labelledby={headingId} data-slot="already-protected" className="flex flex-col gap-3">
      <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-3">
        <h3 id={headingId} className="text-base font-semibold">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="-ml-2 h-auto px-2 py-1 text-base font-semibold">
              {title}
              <ChevronDownIcon aria-hidden="true" className={cn('transition-transform', open && 'rotate-180')} />
            </Button>
          </CollapsibleTrigger>
        </h3>
        <CollapsibleContent>
          <AccountList label={title}>{children}</AccountList>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

/**
 * Locks of a key this browser does not hold: open, with the holder's address on each row, and never called protected
 * (D14, D35, D102). The group's title is the words of the rows' status badge.
 */
function LockedByOther({ locked, clock, knownSecondKeys }: { locked: readonly Candidate[]; clock: ClockView; knownSecondKeys: readonly Address[] }) {
  const known = knownSecondKeys.length > 0;
  const title = known
    ? t('protect.accounts.groupLocked', { count: locked.length })
    : t('protect.accounts.groupLockedUnknown', { count: locked.length });
  return (
    <Section
      title={title}
      headingLevel={3}
      description={
        <>
          <span>{known ? t('status.lockedByAnotherHint') : t('status.lockedByOtherHint')}</span>{' '}
          <span>{t('protect.accounts.lockedByOther')}</span>
        </>
      }
    >
      <AccountList label={title}>
        {locked.map(({ account }) => (
          <AccountListItem key={account.address}>
            <ReadOnlyRow account={account} clock={clock} knownSecondKeys={knownSecondKeys} />
          </AccountListItem>
        ))}
      </AccountList>
    </Section>
  );
}

/** Accounts a link named that this main key cannot withdraw (DECISIONS.md D36). */
function LeftOut({ accounts }: { accounts: readonly Address[] }) {
  if (accounts.length === 0) return null;
  return (
    <div data-slot="left-out" className="flex flex-col gap-2">
      <p className="text-sm">{t('protect.accounts.leftOut')}</p>
      <ul className="flex flex-col gap-1">
        {accounts.map((account) => (
          <li key={account}>
            <AddressText address={account} />
          </li>
        ))}
      </ul>
    </div>
  );
}
