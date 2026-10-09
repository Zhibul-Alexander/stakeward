import type { Address } from '@solana/kit';
import { formatUtcDateTime, shortAddress } from '@stakeward/core';
import { CircleAlertIcon, FlaskConicalIcon, LoaderCircleIcon, PrinterIcon, ShieldCheckIcon, TriangleAlertIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { Page } from '@/components/layout/Page';
import { PageHeader } from '@/components/layout/PageHeader';
import { AccountListSkeleton } from '@/components/product/account-row';
import { EmptyState } from '@/components/product/empty-state';
import { ErrorState } from '@/components/product/error-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CLUSTER } from '@/config';
import type { Load } from '@/hooks/use-load';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { parseAccountParam } from '@/pages/account/load';
import { appLinks } from '@/pages/app/view';
import { useRecovery } from '@/pages/recovery/load';
import { RecoveryCardView } from '@/pages/recovery/RecoveryCardView';
import { accountsPath, type RecoveryCard, type RecoveryLoad } from '@/pages/recovery/view';
import { usePorts } from '@/ports';

/** `/app`, the way out of a page with no card. */
function BackToAccounts({ variant = 'outline' }: { variant?: 'outline' | 'ghost' }) {
  return (
    <Button asChild variant={variant} size={variant === 'ghost' ? 'sm' : 'md'}>
      <Link href="/app">{t('common.backToAccounts')}</Link>
    </Button>
  );
}

/**
 * Print (the page's one filled button) and how to keep a file. On screen only. From 640 px the hint wraps under the
 * button, so the column stays narrow and the title keeps one line beside it.
 */
function Actions() {
  return (
    <div data-slot="recovery-actions" className="flex w-full flex-col gap-2 print:hidden sm:w-auto sm:items-end">
      <Button
        type="button"
        onClick={() => {
          window.print();
        }}
      >
        <PrinterIcon aria-hidden="true" />
        {t('recovery.print')}
      </Button>
      <p className="text-xs text-muted sm:max-w-44 sm:text-right">{t('recovery.printHint')}</p>
    </div>
  );
}

/**
 * Under the title, and printed with it: when the card was read, and on devnet a badge and what it means (the site
 * header, which says devnet on screen, is not printed).
 */
function CardMeta({ card }: { card: RecoveryCard }) {
  return (
    <>
      {/* Non-breaking spaces keep the date and its time together: "UTC." never stands alone on a line. */}
      <p>{t('recovery.readAt', { date: (formatUtcDateTime(card.readAt) ?? String(card.readAt)).replaceAll(' ', '\u00a0') })}</p>
      {CLUSTER === 'devnet' ? (
        <p>
          <Badge tone="outline" className="mr-2 align-middle">
            <FlaskConicalIcon aria-hidden="true" />
            {t('common.devnet')}
          </Badge>
          <span>{t('recovery.devnet')}</span>
        </p>
      ) : null}
    </>
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
          <AccountListSkeleton />
        </div>
      );
    case 'error':
      return (
        <ErrorState
          title={t('recovery.loadError')}
          message={errorMessage(load.error)}
          detail={load.error.detail}
          onRetry={onRetry}
          actions={<BackToAccounts variant="ghost" />}
        />
      );
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

  // The header and the card share one max-w-3xl column (the card's print layout, DECISIONS.md D77), so Print ends where
  // the card ends. Back to the main key's accounts stands above the title and is not printed.
  return (
    <Page width="app">
      <div className="flex max-w-3xl flex-col gap-8 sm:gap-12">
        <PageHeader
          title={t('recovery.title')}
          lead={t('recovery.intro')}
          meta={card === null ? undefined : <CardMeta card={card} />}
          back={card === null ? undefined : { href: accountsPath(card.mainKey), label: t('common.backToAccounts') }}
          action={card === null ? undefined : <Actions />}
          className="print:[&>a]:hidden"
        />
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
