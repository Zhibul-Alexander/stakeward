import { cn } from 'cn';
import type { ReactNode } from 'react';
import { Avatar } from '@/components/layout/Page';
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

/**
 * v9: the answer is Stakeward's reply. One bubble with the headline and its detail; under it, where a messaging app
 * prints the time, "Last checked N min ago" (UX rule 12) with Refresh. Loading draws the bubble as skeletons; an error
 * draws only the time line, and the page puts its ErrorState with Try again right under it.
 */
export function SummaryBar({ label, state, headline, detail, monitoring, tools, action, footer, className }: SummaryBarProps) {
  const answer =
    state === 'loading' ? (
      <div aria-hidden="true" className="bubble-in flex w-72 max-w-full flex-col gap-2 px-5 py-4">
        <Skeleton className="h-7 w-56 max-w-full" />
        <Skeleton className="h-4 w-36" />
      </div>
    ) : state === 'ready' && (headline !== undefined || detail !== undefined) ? (
      <div className="bubble-in flex max-w-full min-w-0 flex-col gap-1 px-5 py-4 sm:px-6">
        {headline === undefined ? null : (
          <p className="text-2xl font-bold tracking-tight text-balance tabular-nums sm:text-3xl">{headline}</p>
        )}
        {detail === undefined ? null : <div className="text-sm text-muted tabular-nums">{detail}</div>}
      </div>
    ) : null;
  return (
    <section aria-label={label} data-slot="summary-bar" data-state={state} className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-start gap-2.5 sm:gap-3">
        <Avatar className={answer === null ? undefined : 'mt-1'} />
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
          {answer}
          {action === undefined ? null : <div className="flex flex-wrap items-center gap-2 px-1">{action}</div>}
          <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 px-1 [&_[data-slot=monitoring]]:text-xs">
            {monitoring}
            {tools === undefined ? null : (
              <div data-slot="summary-tools" className="flex items-center gap-2">
                {tools}
              </div>
            )}
          </div>
          {footer === undefined ? null : <div className="px-1 text-sm">{footer}</div>}
        </div>
      </div>
    </section>
  );
}
