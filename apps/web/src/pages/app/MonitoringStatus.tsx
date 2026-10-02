import { cn } from 'cn';
import { ActivityIcon, CircleQuestionMarkIcon, TriangleAlertIcon, type LucideIcon } from 'lucide-react';
import { ErrorDetails } from '@/components/product/error-state';
import { Spinner } from '@/components/ui/spinner';
import { monitorFreshness } from '@/api/health';
import { t } from '@/i18n';
import type { HealthState } from './hooks.ts';

const MINUTE_MS = 60_000;

/** "Last checked N min ago", coarser as the age grows. */
function lastChecked(ageMs: number): string {
  const minutes = Math.floor(ageMs / MINUTE_MS);
  if (minutes < 1) return t('app.monitoring.justNow');
  if (minutes < 60) return t('app.monitoring.minutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return t('app.monitoring.hours', { count: hours });
  return t('app.monitoring.days', { count: Math.floor(hours / 24) });
}

function Line({ state, icon: Icon, tone, children }: { state: string; icon: LucideIcon; tone: 'muted' | 'danger'; children: string }) {
  return (
    <p
      data-slot="monitoring"
      data-state={state}
      className={cn('flex items-center gap-1.5 text-sm', tone === 'danger' ? 'font-medium text-danger' : 'text-muted')}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      {children}
    </p>
  );
}

/**
 * When the worker's monitor last checked the watched accounts (UX rule 12, GET /api/health): muted while it is
 * fresh, red once it is older than 10 minutes, neutral before the first pass.
 */
export function MonitoringStatus({ state, now }: { state: HealthState; now: number }) {
  switch (state.status) {
    case 'loading':
      return (
        <p data-slot="monitoring" data-state="loading" className="flex items-center gap-1.5 text-sm text-muted">
          <Spinner aria-hidden="true" className="size-4" />
          {t('app.monitoring.checking')}
        </p>
      );
    case 'error':
      // What happened and what to do (Refresh sits next to it), the raw error under Details (UX rule 8).
      return (
        <div className="flex flex-col gap-1">
          <Line state="unavailable" icon={CircleQuestionMarkIcon} tone="muted">
            {t('app.monitoring.unavailable')}
          </Line>
          <ErrorDetails detail={state.detail} className="text-muted" />
        </div>
      );
    case 'ready': {
      const freshness = monitorFreshness(state.health, Math.max(now, state.receivedAt), state.receivedAt);
      if (freshness.kind === 'not-yet') {
        return (
          <Line state="not-yet" icon={ActivityIcon} tone="muted">
            {t('app.monitoring.notYet')}
          </Line>
        );
      }
      const text = lastChecked(freshness.ageMs);
      return freshness.stale ? (
        <Line state="stale" icon={TriangleAlertIcon} tone="danger">
          {`${text}. ${t('app.monitoring.stale')}`}
        </Line>
      ) : (
        <Line state="fresh" icon={ActivityIcon} tone="muted">
          {text}
        </Line>
      );
    }
  }
}
