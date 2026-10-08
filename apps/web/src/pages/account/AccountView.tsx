import { scannerStatus, stakeActivationStatus, type StakeAccount } from '@stakeward/core';
import { CircleAlertIcon, LoaderCircleIcon } from 'lucide-react';
import { Link } from 'wouter';
import { AccountListSkeleton, AccountRow, SINGLE_ROW_FRAME } from '@/components/product/account-row';
import { EmptyState } from '@/components/product/empty-state';
import { ErrorState } from '@/components/product/error-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { Load } from '@/hooks/use-load';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { appLinks } from '@/pages/app/view';
import { useKnownSecondKeys } from '@/ports';
import type { AccountState } from './load.ts';

/** The read, once it holds a stake account. */
export type LoadedAccount = AccountState & { account: StakeAccount };

/** The stake account of a ready read; null while loading, on an error, or when there is no stake account. */
export function loadedAccount(load: Load<AccountState>): LoadedAccount | null {
  if (load.status !== 'ready') return null;
  const { account } = load.value;
  return account === null ? null : { ...load.value, account };
}

/** `/app`, the way out of a stake account page with nothing to act on. */
function BackToAccounts() {
  return (
    <Button asChild variant="outline">
      <Link href="/app">{t('common.backToAccounts')}</Link>
    </Button>
  );
}

/** The `:account` of the address is not a stake account address. */
export function InvalidAccountParam() {
  return (
    <Alert tone="danger">
      <CircleAlertIcon aria-hidden="true" />
      <AlertDescription className="flex flex-col gap-3 text-foreground">
        <p className="font-medium">{t('stakePage.invalid')}</p>
        <div>
          <BackToAccounts />
        </div>
      </AlertDescription>
    </Alert>
  );
}

type AccountViewProps = {
  load: Load<AccountState>;
  /** Try again after a failed read. */
  onRetry: () => void;
  /** Say nothing about a missing account (a page whose Done screen already says the account is gone). */
  hideNotFound?: boolean | undefined;
};

/**
 * The account part of /withdraw/:account and /extend/:account (step 6 spec 4.3), the same on both pages: the read's
 * states (loading, error with Try again, no account, not a stake account), then the account's row with its staking
 * state and its protection as this device knows it.
 */
export function AccountView({ load, onRetry, hideNotFound = false }: AccountViewProps) {
  const knownSecondKeys = useKnownSecondKeys();
  switch (load.status) {
    case 'idle':
      return null;
    case 'loading':
      return (
        <div className="flex flex-col gap-3">
          <AccountListSkeleton rows={1} />
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            {t('stakePage.loading')}
          </p>
        </div>
      );
    case 'error':
      return (
        <ErrorState
          title={t('stakePage.loadError')}
          message={errorMessage(load.error)}
          detail={load.error.detail}
          onRetry={onRetry}
        />
      );
    case 'ready': {
      const { raw, account, clock } = load.value;
      if (raw === null) {
        return hideNotFound ? null : <EmptyState title={t('stakePage.notFound')} action={<BackToAccounts />} />;
      }
      if (account === null) {
        return (
          <Alert tone="warning">
            <CircleAlertIcon aria-hidden="true" />
            <AlertDescription className="flex flex-col gap-3 text-foreground">
              <p className="font-medium">{t('stakePage.notStake')}</p>
              <div>
                <BackToAccounts />
              </div>
            </AlertDescription>
          </Alert>
        );
      }
      const view = scannerStatus(account, knownSecondKeys, clock);
      return (
        <AccountRow
          account={account}
          activation={stakeActivationStatus(account.delegation, clock.epoch)}
          protection={view.status}
          managedByService={view.managedByService}
          secondKeyKnown={knownSecondKeys.length > 0}
          rescueHref={appLinks.rescue(account.withdrawer)}
          serviceDetail
          className={SINGLE_ROW_FRAME}
        />
      );
    }
  }
}
