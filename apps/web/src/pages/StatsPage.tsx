import { formatUtcDateTime } from '@stakeward/core';
import { CoinsIcon, LoaderCircleIcon, LockIcon, RefreshCwIcon, SendIcon, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { fetchHealth, type Health } from '@/api/health';
import { fetchStats, statsFailureKind, type Stats, type StatsFailureKind } from '@/api/stats';
import { ErrorState } from '@/components/product/error-state';
import { SolAmount } from '@/components/product/sol-amount';
import { StatTile } from '@/components/product/stat-tile';
import { Button } from '@/components/ui/button';
import { useLoad } from '@/hooks/use-load';
import { t, type MessageKey } from '@/i18n';
import { useHealth, useNow } from '@/pages/app/hooks';
import { MonitoringStatus } from '@/pages/app/MonitoringStatus';

const loadStatsFromWorker = () => fetchStats();
const loadHealthFromWorker = () => fetchHealth();

/** "Last checked N min ago" moves on while the page is open. */
const CLOCK_TICK_MS = 30_000;

/** Whole numbers with thousands separators, the same in every browser (as core formatSol writes SOL). */
const COUNT = new Intl.NumberFormat('en');

type Tile = { key: 'accounts' | 'sol' | 'alerts'; icon: LucideIcon; value: (stats: Stats) => ReactNode };

const TILES: readonly Tile[] = [
  { key: 'accounts', icon: LockIcon, value: (stats) => COUNT.format(stats.accountsLocked) },
  // Exact lamports through core formatSol (bigint, no float); the amount may wrap on a narrow screen.
  { key: 'sol', icon: CoinsIcon, value: (stats) => <SolAmount lamports={stats.lamportsLocked} className="whitespace-normal" /> },
  { key: 'alerts', icon: SendIcon, value: (stats) => COUNT.format(stats.alertsSent) },
];

const FAILURE_MESSAGES: Record<StatsFailureKind, MessageKey> = {
  'rate-limited': 'stats.error.rateLimited',
  network: 'stats.error.network',
  server: 'stats.error.server',
};

type StatsPageProps = {
  /** GET /api/stats; tests pass their own. */
  loadStats?: (() => Promise<Stats>) | undefined;
  /** GET /api/health; tests pass their own. */
  loadHealth?: (() => Promise<Health>) | undefined;
};

/**
 * /stats (CLAUDE.md sections 8 and 9): the worker's public numbers, which also feed the demand figures of the
 * hackathon submission. No wallet and no chain read: GET /api/stats counts what the monitor stored, and the
 * monitoring line (GET /api/health, as on /app) shows how fresh that is, red once the monitor is late. The numbers
 * are read once per visit and on Refresh, not polled; the worker counts accounts and SOL at most every 10 minutes
 * (D84), and the page says when.
 */
export function StatsPage({ loadStats = loadStatsFromWorker, loadHealth = loadHealthFromWorker }: StatsPageProps) {
  const [attempt, setAttempt] = useState(0);
  const stats = useLoad(String(attempt), loadStats);
  const health = useHealth(loadHealth, attempt);
  const now = useNow(CLOCK_TICK_MS);
  const reload = () => {
    setAttempt((value) => value + 1);
  };
  const loading = stats.status === 'loading' || stats.status === 'idle';

  return (
    <div className="flex flex-col gap-8">
      <div className="flex max-w-2xl flex-col gap-2">
        <h1 className="text-3xl font-semibold">{t('common.pages.stats')}</h1>
        <p className="text-muted">{t('stats.intro')}</p>
        <p className="text-sm text-muted">{t('stats.source')}</p>
      </div>
      <div data-slot="stats" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs text-muted">{t('stats.monitoring')}</span>
            <MonitoringStatus state={health} now={now} />
          </div>
          <Button variant="outline" size="sm" onClick={reload}>
            <RefreshCwIcon aria-hidden="true" />
            {t('stats.refresh')}
          </Button>
        </div>
        {loading ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
            {t('stats.loading')}
          </p>
        ) : null}
        {stats.status === 'error' ? (
          <ErrorState
            title={t('stats.error.title')}
            message={t(FAILURE_MESSAGES[statsFailureKind(stats.raw)])}
            detail={stats.error.detail}
            onRetry={reload}
          />
        ) : null}
        <div aria-busy={loading} className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {TILES.map(({ key, icon, value }) => {
            const tile = { label: t(`stats.tiles.${key}.label`), note: t(`stats.tiles.${key}.note`), icon };
            return stats.status === 'ready' ? (
              <StatTile key={key} {...tile} status="ready" value={value(stats.value)} />
            ) : stats.status === 'error' ? (
              <StatTile key={key} {...tile} status="error" message={t('stats.unavailable')} />
            ) : (
              <StatTile key={key} {...tile} status="loading" />
            );
          })}
        </div>
        {stats.status === 'ready' ? <Counted stats={stats.value} /> : null}
      </div>
    </div>
  );
}

/** When the worker counted (its clock, UTC), and an honest word when nothing is locked yet: zeros, never made-up numbers. */
function Counted({ stats }: { stats: Stats }) {
  const date = formatUtcDateTime(BigInt(Math.floor(stats.countedAt.getTime() / 1000)));
  return (
    <>
      {date === null ? null : <p className="text-sm text-muted">{t('stats.countedAt', { date })}</p>}
      {stats.accountsLocked === 0 ? (
        <p data-slot="stats-zero" className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
          {t('stats.zero')}
          <Link
            href="/app"
            className="rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
          >
            {t('stats.zeroAction')}
          </Link>
        </p>
      ) : null}
    </>
  );
}
