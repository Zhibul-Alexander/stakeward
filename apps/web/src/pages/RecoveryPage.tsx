import type { Address } from '@solana/kit';
import { shortAddress } from '@stakeward/core';
import { CircleAlertIcon, LoaderCircleIcon, PrinterIcon, ShieldCheckIcon, TriangleAlertIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { Page } from '@/components/layout/Page';
import { PageHeader } from '@/components/layout/PageHeader';
import { AccountRowSkeleton } from '@/components/product/account-row';
import { EmptyState } from '@/components/product/empty-state';
import { ErrorState } from '@/components/product/error-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { Load } from '@/hooks/use-load';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { parseAccountParam } from '@/pages/account/load';
import { appLinks } from '@/pages/app/view';
import { useRecovery } from '@/pages/recovery/load';
import { RecoveryCardView } from '@/pages/recovery/RecoveryCardView';
import { accountsPath, type RecoveryLoad } from '@/pages/recovery/view';
import { usePorts } from '@/ports';

/** `/app`, the way out of a page with no card. */
function BackToAccounts() {
  return (
    <Button asChild variant="outline">
      <Link href="/app">{t('common.backToAccounts')}</Link>
    </Button>
  );
}

/** Print, back to the main key's accounts, how to keep a file. On screen only. */
function Actions({ mainKey }: { mainKey: Address }) {
  return (
    <div data-slot="recovery-actions" className="flex flex-col gap-2 print:hidden">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => {
            window.print();
          }}
        >
          <PrinterIcon aria-hidden="true" />
          {t('recovery.print')}
        </Button>
        <Button asChild variant="outline">
          <Link href={accountsPath(mainKey)}>{t('common.backToAccounts')}</Link>
        </Button>
      </div>
      <p className="text-sm text-muted">{t('recovery.printHint')}</p>
    </div>
  );
}

/** The read's states: loading, error with Try again, each refusal with its way forward, the card. */
function RecoveryBody({ load, route, onRetry }: { load: Load<RecoveryLoad>; route: Address; onRetry: () => void }) {
  switch (load.status) {
    case 'idle':
      return null;
    case 'loading':
      return (
        <div aria-busy="true" className="flex flex-col gap-3">
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            {t('recovery.loading')}
          </p>
          <AccountRowSkeleton />
          <AccountRowSkeleton />
        </div>
      );
    case 'error':
      return <ErrorState title={t('recovery.loadError')} message={errorMessage(load.error)} detail={load.error.detail} onRetry={onRetry} />;
    case 'ready': {
      const result = load.value;
      if (result.kind === 'card') return <RecoveryCardView card={result.card} />;
      switch (result.reason) {
        case 'not-found':
          return (
            <EmptyState
              title={t('recovery.notFound.title')}
              action={
                <Button asChild variant="outline">
                  <Link href="/app">{t('recovery.notFound.action')}</Link>
                </Button>
              }
            >
              <p>{t('recovery.notFound.body')}</p>
            </EmptyState>
          );
        case 'not-stake-account':
          return (
            <Alert tone="warning">
              <CircleAlertIcon aria-hidden="true" />
              <AlertDescription className="flex flex-col gap-3 text-foreground">
                <p className="font-medium">{t('recovery.notStake')}</p>
                <div>
                  <BackToAccounts />
                </div>
              </AlertDescription>
            </Alert>
          );
        case 'not-protected':
          return (
            <Alert tone="warning">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertTitle className="text-foreground">{t('recovery.notProtected.title')}</AlertTitle>
              <AlertDescription className="flex flex-col gap-3 text-foreground">
                <p>{t('recovery.notProtected.body')}</p>
                <div>
                  <Button asChild>
                    <Link href={appLinks.protect([route])}>
                      <ShieldCheckIcon aria-hidden="true" />
                      {t('recovery.notProtected.action')}
                    </Link>
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          );
        case 'unsupported-lock':
          return (
            <Alert tone="warning">
              <CircleAlertIcon aria-hidden="true" />
              <AlertTitle className="text-foreground">{t('recovery.unsupported.title')}</AlertTitle>
              <AlertDescription className="flex flex-col gap-3 text-foreground">
                <p>{t('recovery.unsupported.body')}</p>
                <div>
                  <BackToAccounts />
                </div>
              </AlertDescription>
            </Alert>
          );
      }
    }
  }
}

/**
 * /recovery/:account (CLAUDE.md section 9, DECISIONS.md D74): the printable recovery card of the pair of keys that
 * holds this stake account's lock. Read from the network only, with no wallet, and nothing is written; a reload reads
 * it again. The card holds public addresses and commands, never a secret.
 */
export function RecoveryPage() {
  const params = useParams<{ account: string }>();
  const route = parseAccountParam(params.account);
  const { chain } = usePorts();
  const [attempt, setAttempt] = useState(0);
  const load = useRecovery(chain, route, attempt);
  const card = load.status === 'ready' && load.value.kind === 'card' ? load.value.card : null;

  // The tab title, and so the file name a browser suggests for Save as PDF: one per stake account, not "Stakeward".
  useEffect(() => {
    if (route === null) return undefined;
    const previous = document.title;
    document.title = t('recovery.documentTitle', { account: shortAddress(route) });
    return () => {
      document.title = previous;
    };
  }, [route]);

  // Full width, with the card's own max-w-3xl column inside (its print layout, DECISIONS.md D77).
  return (
    <Page width="app">
      <div className="flex max-w-3xl flex-col gap-6">
        <PageHeader title={t('recovery.title')} lead={t('recovery.intro')} />
        {card === null ? null : <Actions mainKey={card.mainKey} />}
        {route === null ? (
          <Alert tone="danger">
            <CircleAlertIcon aria-hidden="true" />
            <AlertDescription className="flex flex-col gap-3 text-foreground">
              <p className="font-medium">{t('recovery.invalid')}</p>
              <div>
                <BackToAccounts />
              </div>
            </AlertDescription>
          </Alert>
        ) : (
          <RecoveryBody
            load={load}
            route={route}
            onRetry={() => {
              setAttempt((value) => value + 1);
            }}
          />
        )}
      </div>
    </Page>
  );
}
