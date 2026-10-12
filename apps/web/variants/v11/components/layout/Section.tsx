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

/** A titled block of a page (DECISIONS.md D112): its heading, count, one shared description and an action. */
export function Section({ title, headingLevel = 2, id, count, description, action, children, className }: SectionProps) {
  const generatedId = useId();
  const headingId = id === undefined ? generatedId : `${id}-title`;
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section id={id} aria-labelledby={headingId} data-slot="section" className={cn('flex flex-col', className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2 border-b border-foreground/80 pb-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <Heading id={headingId} className={headingLevel === 2 ? 'font-serif text-2xl font-medium' : 'text-base font-semibold'}>
            {title}
          </Heading>
          {count === undefined ? null : <span className="text-sm text-muted tabular-nums">{count}</span>}
        </div>
        {action === undefined ? null : <div className="flex flex-wrap items-center gap-2">{action}</div>}
      </div>
      {description === undefined ? null : <p className="mt-2 max-w-prose text-sm text-pretty text-muted sm:text-base">{description}</p>}
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}
