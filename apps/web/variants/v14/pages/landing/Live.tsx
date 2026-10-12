import { formatSol } from '@stakeward/core';
import { RotateCcwIcon } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'wouter';
import { fetchHealth } from '@/api/health';
import { fetchStats, type Stats } from '@/api/stats';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useLoad, type Load } from '@/hooks/use-load';
import { t } from '@/i18n';
import { useHealth, useNow } from '@/pages/app/hooks';
import { MonitoringStatus } from '@/pages/app/MonitoringStatus';

const LAMPORTS_PER_SOL = 1_000_000_000n;
const loadHealth = () => fetchHealth();
const loadStats = () => fetchStats();

function formatCount(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** The three numbers of GET /api/stats as a sentence, exactly as the server returned them (SOL rounded down, as /stats). */
function StatsLine({ stats, onRetry }: { stats: Load<Stats>; onRetry: () => void }) {
  switch (stats.status) {
    case 'idle':
    case 'loading':
      return (
        <div aria-busy="true" className="flex flex-col gap-2">
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <Spinner aria-hidden="true" />
            {t('stats.loading')}
          </p>
          <Skeleton aria-hidden="true" className="h-8 w-full max-w-md" />
        </div>
      );
    case 'error':
      return (
        <div className="flex flex-col items-start gap-2">
          <p className="text-base text-pretty">{t('stats.errorBody')}</p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCcwIcon aria-hidden="true" />
            {t('common.tryAgain')}
          </Button>
        </div>
      );
    case 'ready': {
      const { accountsLocked, lamportsLocked, alertsSent } = stats.value;
      if (accountsLocked === 0 && alertsSent === 0) {
        return <p className="text-base text-pretty">{t('stats.emptyBody')}</p>;
      }
      const sol = formatSol((lamportsLocked / LAMPORTS_PER_SOL) * LAMPORTS_PER_SOL);
      return (
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-3">
          <div className="flex flex-col-reverse justify-end gap-0.5">
            <dt className="text-sm text-muted">{t('stats.accountsLocked')}</dt>
            <dd className="font-serif text-3xl tabular-nums">{formatCount(accountsLocked)}</dd>
          </div>
          <div className="flex flex-col-reverse justify-end gap-0.5">
            <dt className="text-sm text-muted">{t('stats.solLocked')}</dt>
            <dd className="font-serif text-3xl tabular-nums wrap-anywhere">{sol}</dd>
          </div>
          <div className="flex flex-col-reverse justify-end gap-0.5">
            <dt className="text-sm text-muted">{t('stats.alertsSent')}</dt>
            <dd className="font-serif text-3xl tabular-nums">{formatCount(alertsSent)}</dd>
          </div>
        </dl>
      );
    }
  }
}

/**
 * What the Stakeward server says right now (GET /api/health and GET /api/stats, the same calls as /app and /stats):
 * when the monitor last ran, and the numbers it counts. Whatever the API returns is shown, nothing else.
 */
export function Live() {
  const [attempt, setAttempt] = useState(0);
  const stats = useLoad(`landing-stats#${String(attempt)}`, loadStats);
  const health = useHealth(loadHealth, attempt);
  const now = useNow(30_000);
  return (
    <section aria-labelledby="live-title" className="flex flex-col gap-4 border-y border-border py-6 sm:py-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
        <h2 id="live-title" className="text-2xl text-balance">
          Live from the Stakeward monitor
        </h2>
        <MonitoringStatus state={health} now={now} />
      </div>
      <StatsLine
        stats={stats}
        onRetry={() => {
          setAttempt((value) => value + 1);
        }}
      />
      <p className="max-w-prose text-sm text-pretty text-muted">
        {t('stats.note')}{' '}
        <Link href="/stats" className="rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover">
          {t('stats.title')}
        </Link>
      </p>
    </section>
  );
}
