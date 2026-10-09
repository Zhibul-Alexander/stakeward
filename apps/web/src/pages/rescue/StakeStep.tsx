import type { Address } from '@solana/kit';
import {
  formatSol,
  formatUtcDate,
  isLockupInForce,
  scannerStatus,
  shortAddress,
  stakeActivationStatus,
  type ClockView,
  type StakeAccount,
} from '@stakeward/core';
import { cn } from 'cn';
import {
  ArrowUpIcon,
  ChevronDownIcon,
  ClockIcon,
  InfoIcon,
  LoaderCircleIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from 'lucide-react';
import { useId, useState, type ReactNode, type Ref, type SyntheticEvent } from 'react';
import { AccountList, AccountListItem, AccountListSkeleton, AccountRow } from '@/components/product/account-row';
import { AddressText } from '@/components/product/address-text';
import { Disclosure } from '@/components/product/disclosure';
import { EmptyState } from '@/components/product/empty-state';
import { ErrorState } from '@/components/product/error-state';
import { roleLabel } from '@/components/product/wallet-slot';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { KeySlot } from '@/pages/app/KeySlot';
import type { MainKeyAccountsState } from '@/pages/protect/load';
import { ContinueButtons } from '@/pages/protect/StepButtons';
import { AddressField, addressInputError, parseAddressInput } from '@/signing/AddressField';
import { ENDS_SOON_SECONDS, lockEndDate, MAX_RESCUE_ACCOUNTS, type RescueGroups } from './wizard.ts';

type StakeStepProps = {
  headingRef: Ref<HTMLHeadingElement>;
  /** The main key in use now (null: none yet). */
  mainKey: Address | null;
  /**
   * Where the main key came from: the page address (`?address=`, e.g. a Telegram alert), the main key slot, or neither
   * (the field). With an address the step shows it and asks for no wallet: the main key may be stolen.
   */
  mainKeyFrom: 'address' | 'slot' | null;
  typed: string;
  loaded: MainKeyAccountsState;
  groups: RescueGroups;
  /** Second keys this device knows, plus the one this run uses: their locks read as the user's own. */
  knownSecondKeys: readonly Address[];
  problems: readonly string[];
  onTyped: (text: string) => void;
  onFind: (address: Address) => void;
  onRetry: () => void;
  onContinue: () => void;
};

/**
 * Step 1 (F4 steps 1-2), no wallet needed: which main key may be stolen, and its stake as the chain shows it now. First
 * the answer (DECISIONS.md D109): what is locked and safe until when, and what is not locked and moves first; then the
 * accounts in the order the run moves them; the ones this run cannot move fold away under "Not in this run".
 */
export function StakeStep(props: StakeStepProps) {
  const { headingRef, mainKey, mainKeyFrom, loaded } = props;
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-5">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold">
        {t('rescue.stake.heading')}
      </h2>
      {mainKeyFrom === 'address' && mainKey !== null ? (
        // From the page address (a Telegram alert): one line, the role and the whole address with copy, no slot.
        <div data-slot="rescue-main-key" className="flex items-start gap-3">
          <span className="shrink-0 pt-1.5 text-sm font-semibold">{roleLabel('main')}</span>
          <AddressText address={mainKey} variant="full" className="min-w-0 flex-1" />
        </div>
      ) : mainKeyFrom === 'slot' ? (
        // Connected here: one line with the wallet and Disconnect, so a wrong wallet can be swapped.
        <KeySlot role="main" layout="inline" />
      ) : (
        <MainKeyField typed={props.typed} onTyped={props.onTyped} onFind={props.onFind} found={mainKey !== null} />
      )}
      {mainKey === null ? null : loaded.status === 'idle' || loaded.status === 'loading' ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            {t('rescue.stake.loading')}
          </p>
          <AccountListSkeleton />
        </div>
      ) : loaded.status === 'error' ? (
        <ErrorState
          title={t('rescue.stake.loadError')}
          message={errorMessage(loaded.error)}
          detail={loaded.error.detail}
          onRetry={props.onRetry}
        />
      ) : loaded.accounts.length === 0 ? (
        <EmptyState title={t('components.empty.noAccountsTitle')} headingLevel={3}>
          <p>{t('rescue.stake.none')}</p>
        </EmptyState>
      ) : (
        <Accounts groups={props.groups} clock={loaded.clock} knownSecondKeys={props.knownSecondKeys} />
      )}
      {/* Until a main key is found, Find its stake (or connecting) is the step's action and its hint says what to do:
          no step button that would only repeat the hint. */}
      {mainKey === null ? null : (
        <ContinueButtons label={t('rescue.next.newWallet')} problems={props.problems} onContinue={props.onContinue} />
      )}
    </section>
  );
}

/**
 * The main key typed or pasted, read only when the user asks (Find its stake), or connected instead. "Find its stake"
 * is the step's one filled button until a key is found; then the step button takes over.
 */
function MainKeyField({
  typed,
  onTyped,
  onFind,
  found,
}: Pick<StakeStepProps, 'typed' | 'onTyped' | 'onFind'> & { found: boolean }) {
  const formId = useId();
  const [error, setError] = useState<string | null>(null);
  const find = (event: SyntheticEvent) => {
    event.preventDefault();
    const parsed = parseAddressInput(typed);
    if (!parsed.ok) {
      setError(addressInputError(parsed.reason));
      return;
    }
    setError(null);
    onFind(parsed.address);
  };
  return (
    <div className="flex flex-col gap-3">
      <form id={formId} onSubmit={find}>
        <AddressField
          label={t('rescue.stake.address')}
          hint={t('rescue.stake.addressHint')}
          value={typed}
          onChange={(text) => {
            setError(null);
            onTyped(text);
          }}
          error={error}
        />
      </form>
      {/* The submit button sits outside the form, next to Connect, whose wallet buttons must not submit it. */}
      <div className="flex flex-col items-start gap-2 sm:flex-row">
        <Button type="submit" form={formId} variant={found ? 'outline' : 'primary'}>
          {t('rescue.stake.check')}
        </Button>
        <KeySlot role="main" layout="inline" connectLabel={t('rescue.stake.connect')} />
      </div>
    </div>
  );
}

function sumLamports(accounts: readonly StakeAccount[]): bigint {
  return accounts.reduce((total, account) => total + account.lamports, 0n);
}

/** One line of the answer above the list: the tone's icon, then the words. */
const LINE_ICON = { success: 'text-success', warning: 'text-warning', danger: 'text-danger' } as const;

function StatusLine({ icon: Icon, tone, children }: { icon: LucideIcon; tone: keyof typeof LINE_ICON; children: ReactNode }) {
  return (
    <p data-tone={tone} className="flex items-start gap-2 text-base font-medium text-pretty">
      <Icon aria-hidden="true" className={cn('mt-0.5 size-5 shrink-0', LINE_ICON[tone])} />
      <span>{children}</span>
    </p>
  );
}

/** A muted fact on a row, with its icon (the row says it once; the list does not repeat a hint per row). */
function RowFact({ icon: Icon, tone, children }: { icon: LucideIcon; tone: 'danger' | 'warning' | 'muted'; children: ReactNode }) {
  return (
    <span
      data-tone={tone}
      className={cn(
        'inline-flex items-center gap-1',
        tone === 'danger' ? 'font-medium text-danger' : tone === 'warning' ? 'font-medium text-foreground' : 'text-muted',
      )}
    >
      <Icon aria-hidden="true" className={cn('size-3.5 shrink-0', tone === 'warning' && 'text-warning')} />
      {children}
    </span>
  );
}

/**
 * "Not in this run (n)": the accounts this run leaves, behind one full-width toggle (a Collapsible: a native details
 * would turn the chevron of the Details inside it). Closed, its rows are not in the page.
 */
function NotInRun({ count, defaultOpen, children }: { count: number; defaultOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} data-slot="rescue-not-in-run" className="border-y border-border">
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-sm py-3 text-left font-medium">
        {t('rescue.stake.notInRun', { count })}
        <ChevronDownIcon aria-hidden="true" className={cn('size-4 shrink-0 text-muted transition-transform', open && 'rotate-180')} />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-5 pb-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function Accounts({ groups, clock, knownSecondKeys }: { groups: RescueGroups; clock: ClockView; knownSecondKeys: readonly Address[] }) {
  const { movable, otherKey, unsupported } = groups;
  const locked = movable.filter((account) => isLockupInForce(account.lockup, clock));
  const unlocked = movable.filter((account) => !isLockupInForce(account.lockup, clock));
  // Only locks that end on a date have one to state (a lock an epoch holds has none: lockEndDate).
  const dated = locked.flatMap((account) => {
    const end = lockEndDate(account, clock);
    return end === null ? [] : [{ account, end }];
  });
  const earliest = dated.reduce<bigint | null>((lowest, { end }) => (lowest === null || end < lowest ? end : lowest), null);
  const endsSoon = dated.filter(({ end }) => end - clock.unixTimestamp <= ENDS_SOON_SECONDS);
  const outside = otherKey.length + unsupported.length;
  const otherKeys = [...new Set(otherKey.map((account) => account.lockup.custodian))];

  const row = (account: StakeAccount, meta?: ReactNode, managed = true) => {
    const view = scannerStatus(account, knownSecondKeys, clock);
    return (
      <AccountRow
        account={account}
        activation={stakeActivationStatus(account.delegation, clock.epoch)}
        clock={clock}
        protection={view.status}
        managedByService={managed && view.managedByService}
        secondKeyKnown={knownSecondKeys.length > 0}
        hint={false}
        meta={meta}
      />
    );
  };
  // On the run's own rows the staking key is said in the rescue's words: under the lock a changed staking key is what
  // the move fixes; without one a staking service may manage it (one muted fact, not a warning block).
  const movableMeta = (account: StakeAccount) => {
    const inForce = isLockupInForce(account.lockup, clock);
    const serviceOrThief = account.staker !== account.withdrawer;
    return (
      <>
        {inForce ? null : (
          <RowFact icon={ArrowUpIcon} tone="danger">
            {t('rescue.stake.movesFirst')}
          </RowFact>
        )}
        {serviceOrThief && inForce ? (
          <RowFact icon={TriangleAlertIcon} tone="warning">
            {t('rescue.stake.stakeKeyChanged')}
          </RowFact>
        ) : null}
        {serviceOrThief && !inForce ? (
          <RowFact icon={InfoIcon} tone="muted">
            {t('status.managedByService')}
          </RowFact>
        ) : null}
      </>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      {movable.length === 0 ? null : (
        <div role="status" data-slot="rescue-answer" className="flex flex-col gap-2">
          {locked.length === 0 ? null : (
            <StatusLine icon={ShieldCheckIcon} tone="success">
              {earliest === null
                ? t('rescue.stake.safe', { count: locked.length, amount: formatSol(sumLamports(locked)) })
                : t('rescue.stake.safeUntil', {
                    count: locked.length,
                    amount: formatSol(sumLamports(locked)),
                    date: formatUtcDate(earliest) ?? '',
                  })}
            </StatusLine>
          )}
          {unlocked.length === 0 ? null : (
            <StatusLine icon={ShieldAlertIcon} tone="danger">
              {unlocked.length === 1
                ? t('rescue.stake.notLockedOne', { amount: formatSol(sumLamports(unlocked)) })
                : t('rescue.stake.notLockedOther', { count: unlocked.length, amount: formatSol(sumLamports(unlocked)) })}
            </StatusLine>
          )}
          {endsSoon.map(({ account, end }) => (
            <StatusLine key={account.address} icon={ClockIcon} tone="warning">
              {t('rescue.stake.endsSoon', { address: shortAddress(account.address), date: formatUtcDate(end) ?? '' })}
            </StatusLine>
          ))}
        </div>
      )}
      {movable.length > MAX_RESCUE_ACCOUNTS ? (
        <p className="text-sm font-medium">{t('rescue.stake.tooMany', { count: movable.length, max: MAX_RESCUE_ACCOUNTS })}</p>
      ) : null}
      {movable.length === 0 ? null : (
        <div data-slot="rescue-movable">
          <AccountList label={t('components.accountRow.list')} ordered>
            {movable.map((account) => (
              <AccountListItem key={account.address}>{row(account, movableMeta(account), false)}</AccountListItem>
            ))}
          </AccountList>
        </div>
      )}
      {outside === 0 ? null : (
        // Folded while something can move (the run's list is the answer); open when nothing can.
        <NotInRun count={outside} defaultOpen={movable.length === 0}>
          {otherKey.length === 0 ? null : (
            <div data-slot="rescue-other-key" className="flex flex-col gap-2">
              <p className="text-sm font-medium">{t('rescue.stake.otherKey')}</p>
              {otherKeys.map((key) => (
                <AddressText key={key} address={key} variant="full" explorer />
              ))}
              <AccountList label={t('components.accountRow.list')}>
                {otherKey.map((account) => (
                  <AccountListItem key={account.address}>{row(account)}</AccountListItem>
                ))}
              </AccountList>
            </div>
          )}
          {unsupported.length === 0 ? null : (
            <div data-slot="rescue-unsupported" className="flex flex-col gap-2">
              <p className="text-sm font-medium">{t('rescue.stake.unsupportedTitle')}</p>
              <Disclosure summary={t('common.details')} className="text-sm">
                <p className="max-w-prose">{t('rescue.stake.unsupported')}</p>
              </Disclosure>
              <AccountList label={t('components.accountRow.list')}>
                {unsupported.map((account) => (
                  <AccountListItem key={account.address}>{row(account)}</AccountListItem>
                ))}
              </AccountList>
            </div>
          )}
        </NotInRun>
      )}
      <p className="max-w-prose text-sm text-muted">{t('rescue.stake.splitsNote')}</p>
    </div>
  );
}
