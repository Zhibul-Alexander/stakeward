import { cn } from 'cn';
import { KeyRoundIcon, ShieldAlertIcon, ShieldCheckIcon, ShieldOffIcon, ShieldXIcon, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

/** v15: the answer to "is my stake safe?", in the tone of the most urgent row (AccountsResults works it out). */
export type Verdict = { tone: 'success' | 'warning' | 'neutral' | 'info' | 'danger'; text: string };

type SummaryBarProps = {
  label: string;
  state: 'ready' | 'loading' | 'error';
  headline?: string | undefined;
  detail?: ReactNode;
  monitoring: ReactNode;
  tools?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  /** v15 only: tone of the headline. Without it the headline reads as plain text. */
  verdict?: Verdict | undefined;
  className?: string | undefined;
};

/** Classes written out in full: the frame and icon colour repeat the word, never replace it. */
const LOOK: Record<Verdict['tone'], { frame: string; icon: string; Icon: LucideIcon }> = {
  success: { frame: 'border-success-border', icon: 'text-success', Icon: ShieldCheckIcon },
  warning: { frame: 'border-warning-border', icon: 'text-warning', Icon: ShieldAlertIcon },
  neutral: { frame: 'border-foreground', icon: 'text-foreground', Icon: ShieldOffIcon },
  info: { frame: 'border-info-border', icon: 'text-info', Icon: KeyRoundIcon },
  danger: { frame: 'border-danger', icon: 'text-danger', Icon: ShieldXIcon },
};

/**
 * v15 /app answer block: a thick frame in the answer's tone, the answer as a large sentence with its icon, then the
 * numbers, then monitoring and tools. Loading and error states keep monitoring visible, as in the original.
 */
export function SummaryBar({ label, state, headline, detail, monitoring, tools, action, footer, verdict, className }: SummaryBarProps) {
  const look = verdict === undefined ? undefined : LOOK[verdict.tone];
  const answer =
    state === 'loading' ? (
      <div aria-hidden="true" className="flex flex-col gap-2">
        <Skeleton className="h-10 w-80 max-w-full" />
        <Skeleton className="h-5 w-48" />
      </div>
    ) : state === 'ready' && (headline !== undefined || detail !== undefined) ? (
      <div className="flex min-w-0 flex-col gap-3">
        {headline === undefined ? null : (
          <p className="flex items-start gap-3 text-2xl text-balance tabular-nums">
            {look === undefined ? null : <look.Icon aria-hidden="true" className={cn('mt-1 size-8 shrink-0', look.icon)} />}
            <span>{headline}</span>
          </p>
        )}
        {detail === undefined ? null : <div className="flex flex-col gap-0.5 text-sm text-muted tabular-nums">{detail}</div>}
      </div>
    ) : null;
  return (
    <section
      aria-label={label}
      data-slot="summary-bar"
      data-state={state}
      className={cn('flex flex-col gap-4 border-4 bg-surface p-4 sm:p-6', look?.frame ?? 'border-border', className)}
    >
      {answer === null && action === undefined ? null : (
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-8">
          {answer ?? <span />}
          {action === undefined ? null : <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4">
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
