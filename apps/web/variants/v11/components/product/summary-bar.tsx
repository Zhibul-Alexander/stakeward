import { cn } from 'cn';
import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

type SummaryBarProps = {
  label: string;
  state: 'ready' | 'loading' | 'error';
  headline?: string | undefined;
  detail?: ReactNode;
  monitoring: ReactNode;
  tools?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  className?: string | undefined;
};

/**
 * v11: the answer at the top of /app set as the title of the ledger: the protected amount large in the record serif,
 * the counts under it, then a ruled strip with "Last checked", Telegram and Refresh. Same props and states as the
 * base SummaryBar: loading draws skeletons, an error draws no answer and keeps monitoring and tools visible.
 */
export function SummaryBar({ label, state, headline, detail, monitoring, tools, action, footer, className }: SummaryBarProps) {
  const answer =
    state === 'loading' ? (
      <div aria-hidden="true" className="flex flex-col gap-2">
        <Skeleton className="h-10 w-72 max-w-full" />
        <Skeleton className="h-4 w-40" />
      </div>
    ) : state === 'ready' && (headline !== undefined || detail !== undefined) ? (
      <div className="flex min-w-0 flex-col gap-1.5">
        {headline === undefined ? null : (
          <p className="font-serif text-3xl font-medium text-balance tabular-nums sm:text-4xl">{headline}</p>
        )}
        {detail === undefined ? null : <div className="text-sm text-muted tabular-nums">{detail}</div>}
      </div>
    ) : null;
  return (
    <section
      aria-label={label}
      data-slot="summary-bar"
      data-state={state}
      className={cn('flex flex-col gap-4 rounded-record border border-border bg-surface px-4 pt-5 pb-3 sm:px-6 sm:pt-6', className)}
    >
      {answer === null && action === undefined ? null : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          {answer ?? <span />}
          {action === undefined ? null : <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
        </div>
      )}
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {monitoring}
          {tools === undefined ? null : (
            <div data-slot="summary-tools" className="flex items-center gap-2 sm:ml-auto">
              {tools}
            </div>
          )}
        </div>
        {footer === undefined ? null : <div className="text-sm">{footer}</div>}
      </div>
    </section>
  );
}
