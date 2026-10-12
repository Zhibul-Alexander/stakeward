import { cn } from 'cn';
import { ChevronLeftIcon } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { Link } from 'wouter';

type PageHeaderProps = {
  /** The page's only h1. */
  title: string;
  /** One sentence under the title. */
  lead?: ReactNode;
  /** One muted line: the seed-phrase line, "Read from the network on ...". */
  meta?: ReactNode;
  /** A ghost link back, above the h1. */
  back?: { href: string; label: string } | undefined;
  /** The wizard's StepProgress. */
  progress?: ReactNode;
  /** At most one control: right of the title from 640 px, under the lead below. */
  action?: ReactNode;
  /** For pages that move focus to the h1 (it then takes focus without entering the tab order). */
  headingRef?: Ref<HTMLHeadingElement> | undefined;
  className?: string | undefined;
};

/**
 * The top of every page (DECISIONS.md D112): the h1 and what belongs to it, in one place, so pages do not pick heading
 * sizes. A div, not <header>: the site header is the page's only banner landmark.
 */
export function PageHeader({ title, lead, meta, back, progress, action, headingRef, className }: PageHeaderProps) {
  return (
    <div data-slot="page-header" className={cn('flex flex-col gap-4', className)}>
      {back === undefined ? null : (
        <Link href={back.href} className="inline-flex min-h-11 w-fit items-center gap-1 text-sm text-foreground underline hover:decoration-3">
          <ChevronLeftIcon aria-hidden="true" className="size-4" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="flex min-w-0 flex-col gap-3">
          <h1 ref={headingRef} tabIndex={headingRef === undefined ? undefined : -1} className="text-3xl text-balance">
            {title}
          </h1>
          {lead === undefined ? null : <p className="measure text-lg text-pretty">{lead}</p>}
          {meta === undefined ? null : (
            <div data-slot="page-header-meta" className="flex flex-col gap-1 text-sm text-muted">
              {meta}
            </div>
          )}
        </div>
        {action === undefined ? null : <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
      </div>
      {progress}
    </div>
  );
}
