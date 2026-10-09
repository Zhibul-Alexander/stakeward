import type { Address } from '@solana/kit';
import { scannerStatus, shortAddress, stakeActivationStatus, type ChainClock, type StakeAccount } from '@stakeward/core';
import { cn } from 'cn';
import { RefreshCwIcon } from 'lucide-react';
import { AccountListSkeleton, AccountRow, SINGLE_ROW_FRAME } from '@/components/product/account-row';
import { EmptyState } from '@/components/product/empty-state';
import { ErrorState } from '@/components/product/error-state';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { Load } from '@/hooks/use-load';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';

export type AccountsData = { accounts: readonly StakeAccount[]; clock: ChainClock };

type AccountSectionProps = {
  mainKey: Address | null;
  secondKey: Address | null;
  data: Load<AccountsData>;
  selected: Address | null;
  onSelect: (address: Address) => void;
  onRefresh: () => void;
};

/** Step 2: the main key's stake accounts (ChainPort.findStakeAccounts by withdrawer) and their lock state. */
export function AccountSection({ mainKey, secondKey, data, selected, onSelect, onRefresh }: AccountSectionProps) {
  if (mainKey === null) return <p className="text-sm text-muted">{t('devCosign.account.connectMainFirst')}</p>;
  const refresh = (
    <Button variant="outline" size="sm" onClick={onRefresh}>
      <RefreshCwIcon aria-hidden="true" />
      {t('devCosign.account.refresh')}
    </Button>
  );
  switch (data.status) {
    case 'idle':
    case 'loading':
      return (
        <div aria-busy="true" className="flex flex-col gap-3">
          <p className="sr-only">{t('devCosign.account.loading')}</p>
          <AccountListSkeleton />
        </div>
      );
    case 'error':
      return (
        <ErrorState
          title={t('devCosign.account.loadFailed')}
          message={errorMessage(data.error)}
          detail={data.error.detail}
          onRetry={onRefresh}
        />
      );
    case 'ready':
      break;
  }
  const { accounts, clock } = data.value;
  if (accounts.length === 0) {
    return (
      <EmptyState title={t('devCosign.account.emptyTitle')} action={refresh}>
        <p>{t('devCosign.account.emptyBody', { address: shortAddress(mainKey) })}</p>
        <code className="rounded-sm bg-subtle px-2 py-1 font-mono text-xs break-all text-foreground">
          {t('devCosign.account.command', { address: mainKey })}
        </code>
        <p>{t('devCosign.account.emptyAfter')}</p>
      </EmptyState>
    );
  }
  const secondKeys = secondKey === null ? [] : [secondKey];
  return (
    <div className="flex flex-col gap-3">
      <RadioGroup
        aria-label={t('devCosign.account.choose')}
        value={selected ?? ''}
        onValueChange={(value) => {
          const account = accounts.find((candidate) => candidate.address === value);
          if (account !== undefined) onSelect(account.address);
        }}
        className="flex flex-col gap-3"
      >
        {accounts.map((account) => {
          const view = scannerStatus(account, secondKeys, clock);
          const id = `dev-cosign-account-${account.address}`;
          return (
            <AccountRow
              key={account.address}
              account={account}
              activation={stakeActivationStatus(account.delegation, clock.epoch)}
              clock={clock}
              protection={view.status}
              managedByService={view.managedByService}
              secondKeyKnown={secondKeys.length > 0}
              serviceDetail
              className={cn(SINGLE_ROW_FRAME, selected === account.address && 'border-primary bg-primary-soft')}
              meta={
                <span className="flex w-full items-center gap-2 text-foreground">
                  <RadioGroupItem value={account.address} id={id} />
                  <Label htmlFor={id}>{t('devCosign.account.use', { address: shortAddress(account.address) })}</Label>
                </span>
              }
            />
          );
        })}
      </RadioGroup>
      <div className="flex flex-wrap items-center gap-2">
        {refresh}
        <p className="text-sm text-muted">{t('devCosign.account.moreHint')}</p>
      </div>
    </div>
  );
}
