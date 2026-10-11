import { cn } from 'cn';
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

/**
 * The answer at the top of /app (DECISIONS.md D112): how much is protected, then how fresh that is. Monitoring and the
 * tools show in every state, loading and error included: "Last checked" matters most when the worker or the RPC may
 * be down (UX rule 12). Loading draws the headline and detail as skeletons; an error draws neither, and the page puts
 * its ErrorState with Try again right under the bar. The F6 banner is not part of it.
 */
export function SummaryBar({ label, state, headline, detail, monitoring, tools, action, footer, className }: SummaryBarProps) {
  const answer =
    state === 'loading' ? (
      <div aria-hidden="true" className="flex flex-col gap-2">
        <Skeleton className="h-14 w-96 max-w-full" />
        <Skeleton className="h-4 w-40" />
      </div>
    ) : state === 'ready' && (headline !== undefined || detail !== undefined) ? (
      <div className="flex min-w-0 flex-col gap-1">
        {headline === undefined ? null : (
          <p className="font-display text-[2.4rem] leading-[0.95] tracking-tight text-balance break-words uppercase tabular-nums sm:text-4xl">{headline}</p>
        )}
        {detail === undefined ? null : <div className="mt-2 text-sm font-medium tabular-nums">{detail}</div>}
      </div>
    ) : null;
  return (
    <section
      aria-label={label}
      data-slot="summary-bar"
      data-state={state}
      className={cn('flex flex-col gap-4 border-t-[6px] border-foreground pt-5 sm:pt-7', className)}
    >
      {answer === null && action === undefined ? null : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          {answer ?? <span />}
          {action === undefined ? null : <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t-2 border-foreground pt-3">
        {monitoring}
        {tools === undefined ? null : (
          <div data-slot="summary-tools" className="flex items-center gap-2">
            {tools}
          </div>
        )}
      </div>
      {footer === undefined ? null : <div className="text-sm">{footer}</div>}
    </section>
  );
}
