import { cn } from 'cn';
import { useId, type ReactNode } from 'react';

type SectionProps = {
  title: string;
  /** h2 (text-lg) by default; h3 (text-base) for a section inside another. */
  headingLevel?: 2 | 3;
  /** Anchor; the heading's id is `${id}-title`. */
  id?: string | undefined;
  /** Muted and tabular, next to the title: "4 · 229.95 SOL". */
  count?: ReactNode;
  /** One line said once for the whole group, not on every row. */
  description?: ReactNode;
  /**
   * Outline or ghost, right of the title (under it when it does not fit); primary only when it is the screen's one
   * filled button.
   */
  action?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
};

/**
 * v9: a titled block is the next message in the thread. Its heading and the one shared description stand in a small
 * bubble; what the block holds (rows, fields, checks) follows as the message's attachment, and the block's action sits
 * at the visitor's side, as a reply. An h3 inside another block drops the bubble and keeps only its heading.
 */
export function Section({ title, headingLevel = 2, id, count, description, action, children, className }: SectionProps) {
  const generatedId = useId();
  const headingId = id === undefined ? generatedId : `${id}-title`;
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const nested = headingLevel === 3;
  return (
    <section id={id} aria-labelledby={headingId} data-slot="section" className={cn('flex scroll-mt-20 flex-col', className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className={cn('flex min-w-0 flex-col gap-1', nested ? '' : 'bubble-in w-fit max-w-full px-4 py-3')}>
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <Heading id={headingId} className={nested ? 'text-base font-bold' : 'text-lg font-bold tracking-tight'}>
              {title}
            </Heading>
            {count === undefined ? null : <span className="text-sm text-muted tabular-nums">{count}</span>}
          </div>
          {description === undefined ? null : <p className="max-w-prose text-sm text-pretty text-muted sm:text-base">{description}</p>}
        </div>
        {action === undefined ? null : <div className="flex flex-wrap items-center justify-end gap-2">{action}</div>}
      </div>
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </section>
  );
}
