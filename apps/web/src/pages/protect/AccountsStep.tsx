import type { Address } from '@solana/kit';
import { formatUtcDate, scannerStatus, shortAddress, stakeActivationStatus, type ClockView } from '@stakeward/core';
import { LoaderCircleIcon } from 'lucide-react';
import { useId, type ReactNode, type Ref } from 'react';
import { Link } from 'wouter';
import { AccountList, AccountListItem, AccountListSkeleton, AccountRow } from '@/components/product/account-row';
import { AddressText } from '@/components/product/address-text';
import { NoStakeAccounts } from '@/components/product/empty-state';
import { ErrorState } from '@/components/product/error-state';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { KeySlot } from '@/pages/app/KeySlot';
import type { MainKeyAccountsState } from './load.ts';
import { StepButtons } from './StepButtons.tsx';
import { effectiveSelection, leftOut, type Blocker, type Candidate } from './wizard.ts';

type AccountsStepProps = {
  headingRef: Ref<HTMLHeadingElement>;
  mainKey: Address | null;
  mainReady: boolean;
  /** The selection from the URL. */
  selected: readonly Address[];
  loaded: MainKeyAccountsState;
  cands: readonly Candidate[];
  knownSecondKeys: readonly Address[];
  blockers: readonly Blocker[];
  onSelect: (account: Address, checked: boolean) => void;
  onRetry: () => void;
  onContinue: () => void;
};

/**
 * Step 1 (F1 steps 1-2): connect the main key, then choose which of its stake accounts to lock. Accounts from a link
 * are only named until the main key is connected; then the chain decides which of them it can protect.
 */
export function AccountsStep(props: AccountsStepProps) {
  const { headingRef, mainKey, mainReady, selected, loaded } = props;
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-6">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-2xl font-semibold">
        {t('protect.accounts.heading')}
      </h2>
      <KeySlot role="main" description={t('protect.accounts.connectMain')} />
      {!mainReady || mainKey === null ? (
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
      <StepButtons blockers={props.blockers} onContinue={props.onContinue} />
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

function Choices({
  mainKey,
  clock,
  selected,
  cands,
  knownSecondKeys,
  onSelect,
}: AccountsStepProps & { mainKey: Address; clock: ClockView }) {
  const chosen = effectiveSelection(selected, cands);
  const outside = leftOut(selected, cands);
  return (
    <div className="flex flex-col gap-4">
      {cands.length === 0 ? (
        <NoStakeAccounts
          address={mainKey}
          headingLevel={3}
          action={
            <Button asChild variant="outline" size="sm">
              <Link href={`/app?${new URLSearchParams({ address: mainKey }).toString()}`}>{t('common.backToAccounts')}</Link>
            </Button>
          }
        />
      ) : (
        <>
          <AccountList label={t('protect.accounts.heading')}>
            {cands.map(({ account, block }) => {
              const view = scannerStatus(account, knownSecondKeys, clock);
              return (
                <AccountListItem key={account.address}>
                  <AccountRow
                    account={account}
                    activation={stakeActivationStatus(account.delegation, clock.epoch)}
                    protection={view.status}
                    managedByService={view.managedByService}
                    secondKeyKnown={knownSecondKeys.length > 0}
                    serviceDetail
                    select={{
                      checked: block === null && selected.includes(account.address),
                      disabled: block !== null,
                      label: t('protect.accounts.select', { address: shortAddress(account.address) }),
                      onCheckedChange: (checked) => {
                        onSelect(account.address, checked);
                      },
                    }}
                    meta={blockNote(account.address, block, account.lockup.unixTimestamp)}
                  />
                </AccountListItem>
              );
            })}
          </AccountList>
          {cands.every((candidate) => candidate.block !== null) ? (
            <p className="text-sm font-medium">{t('protect.accounts.noneProtectable')}</p>
          ) : (
            <p role="status" className="text-sm font-medium">
              {chosen.length === 1
                ? t('protect.accounts.selectedOne')
                : t('protect.accounts.selectedOther', { count: chosen.length })}
            </p>
          )}
        </>
      )}
      {outside.length === 0 ? null : (
        <div data-slot="left-out" className="flex flex-col gap-2">
          <p className="text-sm">{t('protect.accounts.leftOut')}</p>
          <ul className="flex flex-col gap-1">
            {outside.map((account) => (
              <li key={account}>
                <AddressText address={account} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Why an account cannot be chosen, on its row's second line. */
function blockNote(address: Address, block: Candidate['block'], lockEnd: bigint): ReactNode {
  if (block === 'already-protected') {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2">
        {t('protect.accounts.alreadyProtected', { date: formatUtcDate(lockEnd) ?? '' })}
        <Link href={`/extend/${address}`} className="rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover">
          {t('protect.accounts.extend')}
        </Link>
      </span>
    );
  }
  if (block === 'locked-by-other') return <span>{t('protect.accounts.lockedByOther')}</span>;
  return undefined;
}
