import { cn } from 'cn';
import { ChevronLeftIcon } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';

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
    <div data-slot="page-header" className={cn('flex flex-col gap-3', className)}>
      {back === undefined ? null : (
        <Button asChild variant="ghost" size="sm" className="-ml-3 w-fit">
          <Link href={back.href}>
            <ChevronLeftIcon aria-hidden="true" />
            {back.label}
          </Link>
        </Button>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="flex min-w-0 flex-col gap-3">
          <h1 ref={headingRef} tabIndex={headingRef === undefined ? undefined : -1} className="text-2xl text-balance sm:text-3xl">
            {title}
          </h1>
          {lead === undefined ? null : <p className="max-w-prose text-base text-pretty text-muted">{lead}</p>}
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
