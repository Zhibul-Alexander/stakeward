import { LockIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { fetchStats, type Stats } from '@/api/stats';
import { Page } from '@/components/layout/Page';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/product/empty-state';
import { ErrorState } from '@/components/product/error-state';
import { SolAmount } from '@/components/product/sol-amount';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useLoad, type Load } from '@/hooks/use-load';
import { t } from '@/i18n';

const LAMPORTS_PER_SOL = 1_000_000_000n;

/** A count with a thousands separator, the same grouping as core `formatSol`: 1234567 -> `1,234,567`. */
function formatCount(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * One number: read first on screen, its label under it. The DOM keeps the label (`dt`) before the number (`dd`), as a
 * description list must; `flex-col-reverse` only flips what the eye sees. Tiles in a row share their height, and their
 * numbers start on one line.
 */
function Stat({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col-reverse justify-end gap-1 rounded-lg border border-border bg-surface p-4 sm:p-5">
      <dt className="text-sm text-muted">{term}</dt>
      <dd className="text-2xl tabular-nums wrap-anywhere">{children}</dd>
    </div>
  );
}

function StatsBody({ stats, onRetry }: { stats: Load<Stats>; onRetry: () => void }) {
  switch (stats.status) {
    case 'idle':
    case 'loading':
      return (
        <div aria-busy="true" className="flex flex-col gap-4">
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <Spinner aria-hidden="true" className="text-muted" />
            {t('stats.loading')}
          </p>
          <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
            <Skeleton className="h-24 rounded-lg sm:h-28" />
            <Skeleton className="h-24 rounded-lg sm:h-28" />
            <Skeleton className="h-24 rounded-lg sm:h-28" />
          </div>
        </div>
      );
    case 'error':
      return <ErrorState title={t('stats.errorTitle')} message={t('stats.errorBody')} detail={stats.error.detail} onRetry={onRetry} />;
    case 'ready': {
      const { accountsLocked, lamportsLocked, alertsSent } = stats.value;
      if (accountsLocked === 0 && alertsSent === 0) {
        return (
          <EmptyState
            icon={LockIcon}
            title={t('stats.emptyTitle')}
            action={
              <Button asChild>
                <Link href="/app">{t('stats.emptyAction')}</Link>
              </Button>
            }
          >
            <p>{t('stats.emptyBody')}</p>
          </EmptyState>
        );
      }
      return (
        <div className="flex flex-col gap-4">
          <dl className="grid gap-3 sm:grid-cols-3 sm:gap-4">
            <Stat term={t('stats.accountsLocked')}>{formatCount(accountsLocked)}</Stat>
            <Stat term={t('stats.solLocked')}>
              {/* Whole SOL, rounded down; wraps rather than overflows a narrow tile. */}
              <SolAmount lamports={(lamportsLocked / LAMPORTS_PER_SOL) * LAMPORTS_PER_SOL} className="whitespace-normal" />
            </Stat>
            <Stat term={t('stats.alertsSent')}>{formatCount(alertsSent)}</Stat>
          </dl>
          <p className="max-w-prose text-sm text-pretty text-muted">{t('stats.note')}</p>
        </div>
      );
    }
  }
}

/**
 * /stats (CLAUDE.md section 9, DECISIONS.md D82): three numbers from the Stakeward monitor, read once per visit from
 * GET /api/stats. The page does not poll or cache. The server counts the locked accounts and their SOL at most every
 * 10 minutes (STATS_TTL_MS in apps/worker/src/public-api.ts), so a reload within that time shows the same two numbers;
 * the alerts sent are read on every request.
 */
export function StatsPage({ load = () => fetchStats() }: { load?: () => Promise<Stats> }) {
  const [attempt, setAttempt] = useState(0);
  const stats = useLoad(`stats#${String(attempt)}`, load);
  return (
    <Page width="flow">
      <PageHeader title={t('stats.title')} lead={t('stats.intro')} />
      <StatsBody
        stats={stats}
        onRetry={() => {
          setAttempt((value) => value + 1);
        }}
      />
    </Page>
  );
}
