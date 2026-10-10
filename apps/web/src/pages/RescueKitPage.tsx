import type { Address, Signature } from '@solana/kit';
import { useState } from 'react';
import { Link, useParams } from 'wouter';
import type { RescueKitStatus } from '@/api/rescue-kits';
import { Page } from '@/components/layout/Page';
import { PageHeader } from '@/components/layout/PageHeader';
import { AddressText } from '@/components/product/address-text';
import { ErrorState } from '@/components/product/error-state';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { explorerUrl } from '@/config';
import { useLoad } from '@/hooks/use-load';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { InvalidAccountParam } from '@/pages/account/AccountView';
import { parseAccountParam } from '@/pages/account/load';
import { useRescueKits } from '@/ports';
import type { SigningTestOptions } from '@/signing/create';
import { RescueWizard } from './rescue/RescueWizard.tsx';

/**
 * /rescue-kit: prepare one-tap rescue kits (D118), the rescue wizard in kit mode: every key signs here and the worker
 * keeps each signed rescue instead of sending it.
 */
export function RescueKitPage({ signing }: { signing?: SigningTestOptions | undefined }) {
  return (
    <Page width="flow">
      <RescueWizard signing={signing} mode="kit" />
    </Page>
  );
}

/**
 * /rescue-kit/:account (D118): where the account's kit stands, read with no wallet. Sending is not here: only the
 * Telegram chat linked by the kit's one-time link can send it (the alert's Rescue now), and the monitor sends it by
 * itself when the staker changes.
 */
export function RescueNowPage() {
  const params = useParams<{ account: string }>();
  const account = parseAccountParam(params.account);
  const kits = useRescueKits();
  const [attempt, setAttempt] = useState(0);
  const status = useLoad(account === null ? null : `rescue-kit#${account}#${String(attempt)}`, () => kits.status(account as Address));

  return (
    <Page width="flow">
      <PageHeader title={t('common.pages.rescueNow')} lead={t('rescueKit.now.lead')} meta={<p>{t('common.neverSeedPhrase')}</p>} />
      {account === null ? (
        <InvalidAccountParam />
      ) : status.status === 'error' ? (
        <ErrorState
          title={t('rescueKit.now.loadError')}
          message={errorMessage(status.error)}
          detail={status.error.detail}
          onRetry={() => {
            setAttempt((value) => value + 1);
          }}
        />
      ) : status.status !== 'ready' ? (
        <p role="status" className="flex items-center gap-3 text-sm">
          <Spinner className="size-5 shrink-0 text-muted" />
          <span>{t('rescueKit.now.loading')}</span>
        </p>
      ) : (
        <KitState kit={status.value} />
      )}
    </Page>
  );
}

function KitState({ kit }: { kit: RescueKitStatus }) {
  const account = (
    <div className="flex flex-col gap-1">
      <p className="text-sm font-medium">{t('rescueKit.now.stakeAccount')}</p>
      <AddressText address={kit.stakeAccount} explorer />
    </div>
  );
  const rescue = (
    <Button asChild variant="outline">
      <Link href="/rescue">{t('rescueKit.now.openRescue')}</Link>
    </Button>
  );
  switch (kit.status) {
    case 'none':
      return (
        <div className="flex flex-col items-start gap-4">
          {account}
          <p className="max-w-prose">{t('rescueKit.now.none')}</p>
          {rescue}
        </div>
      );
    case 'stale':
      return (
        <div className="flex flex-col items-start gap-4">
          {account}
          <p className="max-w-prose">{t('rescueKit.now.stale')}</p>
          {rescue}
        </div>
      );
    case 'sent':
      return (
        <div className="flex flex-col items-start gap-4">
          {account}
          <p className="max-w-prose font-medium">{t('rescueKit.now.sent')}</p>
          {kit.newWallet === null ? null : <AddressText address={kit.newWallet} variant="full" explorer />}
          {kit.signature === null ? null : <TransactionLink signature={kit.signature} />}
        </div>
      );
    case 'ready':
      return (
        <div className="flex flex-col items-start gap-4">
          {account}
          {kit.newWallet === null ? null : (
            <div className="flex w-full flex-col gap-1 rounded-lg bg-subtle px-4 py-3">
              <p className="text-sm font-medium">{t('rescue.move.newOwner')}</p>
              <AddressText address={kit.newWallet} variant="full" explorer />
            </div>
          )}
          <p className="max-w-prose">{kit.telegramLinked ? t('rescueKit.now.ready') : t('rescueKit.now.readyNoTelegram')}</p>
        </div>
      );
  }
}

function TransactionLink({ signature }: { signature: Signature }) {
  return (
    <a href={explorerUrl('tx', signature)} target="_blank" rel="noreferrer" className="text-sm underline underline-offset-4">
      {t('rescueKit.now.viewTransaction')}
    </a>
  );
}
