import { cn } from 'cn';
import { ChevronLeftIcon } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Avatar } from './Page.tsx';

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
 * v9: every page opens with Stakeward's first message. The avatar, then one bubble that holds the h1 (the subject of
 * the conversation) and its lead; the meta line sits under the bubble like a message's small print. A div, not
 * <header>: the site header is the page's only banner landmark.
 */
export function PageHeader({ title, lead, meta, back, progress, action, headingRef, className }: PageHeaderProps) {
  return (
    <div data-slot="page-header" className={cn('flex flex-col gap-3', className)}>
      {back === undefined ? null : (
        <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit text-muted">
          <Link href={back.href}>
            <ChevronLeftIcon aria-hidden="true" />
            {back.label}
          </Link>
        </Button>
      )}
      <div className="flex items-start gap-2 sm:gap-3">
        <Avatar className="mt-1 max-sm:size-7 max-sm:[&_svg]:size-3.5" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
            <div className="bubble-in flex w-fit max-w-full min-w-0 flex-col gap-2 px-5 py-4 sm:px-6 sm:py-5">
              <h1
                ref={headingRef}
                tabIndex={headingRef === undefined ? undefined : -1}
                className="text-2xl font-bold tracking-tight text-balance sm:text-3xl sm:font-bold"
              >
                {title}
              </h1>
              {lead === undefined ? null : <p className="max-w-prose text-base text-pretty text-muted">{lead}</p>}
            </div>
            {action === undefined ? null : <div className="flex shrink-0 flex-wrap items-center gap-2 sm:pt-2">{action}</div>}
          </div>
          {meta === undefined ? null : (
            <div data-slot="page-header-meta" className="flex flex-col gap-1 px-1 text-xs text-muted sm:text-sm">
              {meta}
            </div>
          )}
        </div>
      </div>
      {progress}
    </div>
  );
}
