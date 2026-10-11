import { cn } from 'cn';
import { ShieldCheckIcon, ShieldHalfIcon, ShieldIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

type SummaryBarProps = {
  /** The region's accessible name. */
  label: string;
  state: 'ready' | 'loading' | 'error';
  /** The answer, e.g. "1,293.25 of 1,490.45 SOL protected". None when the address owns no stake account. */
  headline?: string | undefined;
  /** One muted line under it: "2 of 6 stake accounts", a new-device note. */
  detail?: ReactNode;
  /** MonitoringStatus: "Last checked N min ago", red after 10 minutes (UX rule 12). */
  monitoring: ReactNode;
  /** Telegram (outline sm) and Refresh (ghost icon-sm, named "Refresh"): one group that wraps as a whole. */
  tools?: ReactNode;
  /** At most one outline button, e.g. "Connect second key". */
  action?: ReactNode;
  /** One line at the bottom, e.g. "Main key stolen or seen by someone else? Rescue your stake". */
  footer?: ReactNode;
  className?: string | undefined;
};

type Shield = 'all' | 'some' | 'none' | 'idle';

/** Reads "X of Y SOL protected" for the picture only; the words stay the source of truth for every reader. */
function shieldOf(headline: string | undefined): { shield: Shield; percent: number } {
  if (headline === undefined) return { shield: 'idle', percent: 0 };
  const match = /^([\d,.]+) of ([\d,.]+)/.exec(headline);
  if (match === null) return { shield: 'idle', percent: 0 };
  const part = Number((match[1] ?? '0').replaceAll(',', ''));
  const whole = Number((match[2] ?? '0').replaceAll(',', ''));
  if (!(whole > 0)) return { shield: 'idle', percent: 0 };
  const percent = Math.round((part / whole) * 100);
  return { shield: part >= whole ? 'all' : part > 0 ? 'some' : 'none', percent };
}

const TILE: Record<Shield, string> = {
  all: 'bg-mint text-mint-ink',
  some: 'bg-warning-soft text-warning',
  none: 'bg-peach text-peach-ink',
  idle: 'bg-lilac text-lilac-ink',
};
const ICON = { all: ShieldCheckIcon, some: ShieldHalfIcon, none: ShieldIcon, idle: ShieldIcon } as const;

/** The big shield medallion: a ring that fills with the protected share. Decorative; the headline says it in words. */
function ShieldMedallion({ shield, percent, loading }: { shield: Shield; percent: number; loading: boolean }) {
  const Icon = ICON[shield];
  return (
    <div aria-hidden="true" className="relative flex size-28 shrink-0 items-center justify-center sm:size-36">
      <span className={cn('absolute inset-0 rounded-full', TILE[shield], !loading && 'animate-breathe')} />
      <svg viewBox="0 0 120 120" className="absolute inset-0 size-full -rotate-90">
        <circle cx="60" cy="60" r="52" fill="none" strokeWidth="8" className="stroke-surface" />
        {percent > 0 ? (
          <circle
            cx="60"
            cy="60"
            r="52"
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${String(percent)} 100`}
            className="stroke-current"
          />
        ) : null}
      </svg>
      <span className={cn('relative flex size-16 items-center justify-center rounded-full bg-surface shadow-md sm:size-20', TILE[shield].split(' ')[1])}>
        <Icon className="size-8 sm:size-10" strokeWidth={2.2} />
      </span>
    </div>
  );
}

/**
 * The answer at the top of /app (DECISIONS.md D112): how much is protected, then how fresh that is. In this variant a
 * big shield medallion leads, its ring filled with the protected share. Monitoring and the tools show in every state.
 */
export function SummaryBar({ label, state, headline, detail, monitoring, tools, action, footer, className }: SummaryBarProps) {
  const { shield, percent } = shieldOf(state === 'ready' ? headline : undefined);
  const answer =
    state === 'loading' ? (
      <div aria-hidden="true" className="flex flex-col gap-2">
        <Skeleton className="h-9 w-64 max-w-full rounded-full" />
        <Skeleton className="h-4 w-40 rounded-full" />
      </div>
    ) : state === 'ready' && (headline !== undefined || detail !== undefined) ? (
      <div className="flex min-w-0 flex-col gap-1.5">
        {headline === undefined ? null : <p className="text-2xl text-balance tabular-nums sm:text-3xl">{headline}</p>}
        {detail === undefined ? null : <div className="text-sm font-medium text-muted tabular-nums">{detail}</div>}
      </div>
    ) : null;
  return (
    <section
      aria-label={label}
      data-slot="summary-bar"
      data-state={state}
      className={cn('relative flex animate-rise flex-col gap-5 overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-lg sm:p-8', className)}
    >
      <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:items-center sm:gap-8 sm:text-left">
        {state === 'error' ? null : <ShieldMedallion shield={shield} percent={percent} loading={state === 'loading'} />}
        <div className="flex min-w-0 flex-1 flex-col items-center gap-4 sm:items-start">
          {answer}
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 sm:justify-start">
            {monitoring}
            {tools === undefined ? null : (
              <div data-slot="summary-tools" className="flex items-center gap-2">
                {tools}
              </div>
            )}
          </div>
        </div>
      </div>
      {action === undefined && footer === undefined ? null : (
        <div className="flex flex-col gap-3 rounded-lg bg-subtle px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          {footer === undefined ? <span /> : <div>{footer}</div>}
          {action === undefined ? null : <div className="flex flex-wrap items-center gap-2 [&>p]:pt-0">{action}</div>}
        </div>
      )}
    </section>
  );
}
