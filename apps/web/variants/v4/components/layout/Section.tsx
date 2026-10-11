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
      {/* v4: one wrapping row. Below 640 px the action follows the description (read, then act); from 640 px it stands
          right of the title and the description takes the next line. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <Heading id={headingId} className={headingLevel === 2 ? 'text-2xl' : 'text-lg font-extrabold'}>
            {title}
          </Heading>
          {count === undefined ? null : <span className="rounded-full bg-surface px-2.5 py-0.5 text-sm font-semibold text-muted tabular-nums shadow-sm">{count}</span>}
        </div>
        {action === undefined ? null : <div className="order-last flex flex-wrap items-center gap-2 sm:order-none">{action}</div>}
        {description === undefined ? null : <p className="order-2 max-w-prose basis-full text-base text-pretty text-muted sm:order-last">{description}</p>}
      </div>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}
