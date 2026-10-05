import { cn } from 'cn';
import { CircleAlertIcon, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/i18n';

type StatTileBase = {
  /** What is counted, in a few words: the tile's name. */
  label: string;
  /** What exactly is counted, in one sentence. Shown in every state. */
  note?: string | undefined;
  /** Decorative icon before the name. */
  icon?: LucideIcon | undefined;
  className?: string | undefined;
};

export type StatTileProps = StatTileBase &
  (
    | {
        status: 'ready';
        /** The number, already formatted (a SolAmount, a count). Zero is shown like any other number. */
        value: ReactNode;
      }
    | { status: 'loading' }
    | {
        status: 'error';
        /** Stands in for the number, in a few words; the page says what happened and how to try again. */
        message: string;
      }
  );

/**
 * One public number with its name and what it counts (the /stats page). A description list of its own (dt the name,
 * dd the value, dd the note), so assistive technology reads the name with the number. Loading: a skeleton as tall as
 * the value (nothing moves when it arrives), announced as "Loading". Error: a short message with an icon in place of
 * the value. A long value wraps instead of pushing a 360 px screen sideways.
 */
export function StatTile(props: StatTileProps) {
  const { label, note, icon: Icon, className } = props;
  return (
    <dl
      data-slot="stat-tile"
      data-state={props.status}
      className={cn('flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-surface p-4', className)}
    >
      <dt className="flex items-center gap-1.5 text-sm font-medium text-muted">
        {Icon === undefined ? null : <Icon aria-hidden="true" className="size-4 shrink-0" />}
        {label}
      </dt>
      {props.status === 'ready' ? (
        // text-2xl keeps a 16-digit SOL amount on one line in a 360 px column or a third of the page.
        <dd data-slot="stat-value" className="min-h-8 text-2xl font-semibold tabular-nums wrap-anywhere">
          {props.value}
        </dd>
      ) : props.status === 'loading' ? (
        <dd data-slot="stat-value" className="flex min-h-8 items-center">
          <Skeleton className="h-7 w-28" />
          <span className="sr-only">{t('common.loading')}</span>
        </dd>
      ) : (
        <dd data-slot="stat-value" className="flex min-h-8 items-center gap-1.5 font-medium text-muted">
          <CircleAlertIcon aria-hidden="true" className="size-4 shrink-0" />
          {props.message}
        </dd>
      )}
      {note === undefined ? null : <dd className="text-sm text-muted">{note}</dd>}
    </dl>
  );
}
