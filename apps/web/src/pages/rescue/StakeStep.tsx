import type { Address } from '@solana/kit';
import {
  formatUtcDate,
  isLockupInForce,
  scannerStatus,
  shortAddress,
  stakeActivationStatus,
  type ClockView,
  type StakeAccount,
} from '@stakeward/core';
import { LoaderCircleIcon, ShieldCheckIcon, TriangleAlertIcon } from 'lucide-react';
import { useId, useState, type ReactNode, type Ref, type SyntheticEvent } from 'react';
import { AccountList, AccountListItem, AccountListSkeleton, AccountRow } from '@/components/product/account-row';
import { AddressText } from '@/components/product/address-text';
import { EmptyState } from '@/components/product/empty-state';
import { ErrorState } from '@/components/product/error-state';
import { roleLabel } from '@/components/product/wallet-slot';
import { Button } from '@/components/ui/button';
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
  /** The main key came from the page address or the main key slot: no field to type it. */
  mainKeyGiven: boolean;
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
 * Step 1 (F4 steps 1-2), no wallet needed: which main key may be stolen, and its stake as the chain shows it now. The
 * reassurance first (the lock holds until a date), then what is urgent (unlocked, or a lock that ends soon), then the
 * accounts in the order the run moves them, and the ones this run cannot move with the reason.
 */
export function StakeStep(props: StakeStepProps) {
  const { headingRef, mainKey, mainKeyGiven, loaded } = props;
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-6">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-2xl font-semibold">
        {t('rescue.stake.heading')}
      </h2>
      {mainKeyGiven && mainKey !== null ? (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">{roleLabel('main')}</span>
          <AddressText address={mainKey} variant="full" />
        </div>
      ) : (
        <MainKeyField typed={props.typed} onTyped={props.onTyped} onFind={props.onFind} />
      )}
      <KeySlot role="main" description={t('rescue.stake.addressHint')} />
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
      <ContinueButtons label={t('common.continue')} problems={props.problems} onContinue={props.onContinue} />
    </section>
  );
}

/** The main key typed or pasted, read only when the user asks (Find its stake). */
function MainKeyField({ typed, onTyped, onFind }: Pick<StakeStepProps, 'typed' | 'onTyped' | 'onFind'>) {
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
    <form onSubmit={find} className="flex flex-col gap-3">
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
      <div>
        <Button type="submit" variant="outline">
          {t('rescue.stake.check')}
        </Button>
      </div>
    </form>
  );
}

function Accounts({ groups, clock, knownSecondKeys }: { groups: RescueGroups; clock: ClockView; knownSecondKeys: readonly Address[] }) {
  const { movable, otherKey, unsupported } = groups;
  // Only locks that end on a date have one to state (a lock an epoch holds has none: lockEndDate).
  const dated = movable.flatMap((account) => {
    const end = lockEndDate(account, clock);
    return end === null ? [] : [{ account, end }];
  });
  const earliest = dated.reduce<bigint | null>((lowest, { end }) => (lowest === null || end < lowest ? end : lowest), null);
  const endsSoon = dated.filter(({ end }) => end - clock.unixTimestamp <= ENDS_SOON_SECONDS);
  const row = (account: StakeAccount, meta?: ReactNode) => {
    const view = scannerStatus(account, knownSecondKeys, clock);
    return (
      <AccountRow
        account={account}
        activation={stakeActivationStatus(account.delegation, clock.epoch)}
        clock={clock}
        protection={view.status}
        managedByService={view.managedByService}
        secondKeyKnown={knownSecondKeys.length > 0}
        serviceDetail
        meta={meta}
      />
    );
  };
  return (
    <div className="flex flex-col gap-6">
      {earliest === null ? null : (
        <p role="status" className="flex items-start gap-2 text-lg font-semibold">
          <ShieldCheckIcon aria-hidden="true" className="mt-1 size-5 shrink-0 text-success" />
          {t('rescue.stake.safeUntil', { date: formatUtcDate(earliest) ?? '' })}
        </p>
      )}
      {endsSoon.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {endsSoon.map(({ account, end }) => (
            <li key={account.address} className="flex items-start gap-2 text-sm font-medium text-danger">
              <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {t('rescue.stake.endsSoon', {
                address: shortAddress(account.address),
                date: formatUtcDate(end) ?? '',
              })}
            </li>
          ))}
        </ul>
      )}
      {movable.length > MAX_RESCUE_ACCOUNTS ? (
        <p className="text-sm font-medium">{t('rescue.stake.tooMany', { count: movable.length, max: MAX_RESCUE_ACCOUNTS })}</p>
      ) : null}
      {movable.length === 0 ? null : (
        <div data-slot="rescue-movable">
          <AccountList label={t('components.accountRow.list')} ordered>
            {movable.map((account) => (
              <AccountListItem key={account.address}>
                {row(
                  account,
                  isLockupInForce(account.lockup, clock) ? undefined : (
                    <p className="flex w-full items-start gap-2 text-sm font-medium text-danger">
                      <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                      {t('rescue.stake.unlocked')}
                    </p>
                  ),
                )}
              </AccountListItem>
            ))}
          </AccountList>
        </div>
      )}
      {otherKey.length === 0 ? null : (
        <Group slot="rescue-other-key" text={t('rescue.stake.otherKey')}>
          {otherKey.map((account) => (
            <AccountListItem key={account.address}>
              {row(
                account,
                <span className="flex w-full flex-col gap-1 text-sm text-foreground">
                  <span className="font-medium">{roleLabel('second')}</span>
                  <AddressText address={account.lockup.custodian} variant="full" />
                </span>,
              )}
            </AccountListItem>
          ))}
        </Group>
      )}
      {unsupported.length === 0 ? null : (
        <Group slot="rescue-unsupported" text={t('rescue.stake.unsupported')}>
          {unsupported.map((account) => (
            <AccountListItem key={account.address}>{row(account)}</AccountListItem>
          ))}
        </Group>
      )}
      <p className="max-w-prose text-sm text-muted">{t('rescue.stake.splitsNote')}</p>
    </div>
  );
}

function Group({ slot, text, children }: { slot: string; text: string; children: ReactNode }) {
  return (
    <div data-slot={slot} className="flex flex-col gap-3">
      <p className="text-sm font-medium">{text}</p>
      <AccountList label={t('components.accountRow.list')}>{children}</AccountList>
    </div>
  );
}
