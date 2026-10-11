import { cn } from 'cn';
import { ExternalLinkIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { t } from '@/i18n';

const LINK_CLASS = 'rounded-sm font-medium text-foreground underline decoration-accent underline-offset-4 hover:decoration-2';

type SectionProps = {
  id: string;
  title: string;
  /** One sentence under the title, said once for the whole section. */
  intro?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
  /** Variant v3: the chapter number set in the margin. */
  chapter?: number | undefined;
};

/**
 * Variant v3: one chapter of the long read. A heavy rule opens it; on wide screens the chapter number hangs in a left
 * margin column and the heading and text run in the column beside it; on a phone the number stands above the heading.
 */
export function Section({ id, title, intro, children, className, chapter }: SectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn(
        'grid scroll-mt-4 gap-x-10 gap-y-4 border-t-[3px] border-rule pt-5 sm:pt-8',
        chapter === undefined ? null : 'lg:grid-cols-[11rem_minmax(0,1fr)]',
        className,
      )}
    >
      {chapter === undefined ? null : (
        <div aria-hidden="true" className="flex items-baseline gap-3 lg:flex-col lg:gap-1">
          <span className="font-display text-[1.125rem] text-muted italic">Chapter</span>
          <span className="font-display text-[3.5rem] leading-[0.85] text-accent tabular-nums lg:text-[7rem]">{chapter}</span>
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-6 sm:gap-8">
        <div className="flex max-w-[44rem] flex-col gap-3">
          <h2
            id={`${id}-title`}
            className={cn(
              'leading-[1.02] tracking-[-0.015em] text-balance',
              chapter === undefined ? 'text-[2rem] sm:text-[2.75rem]' : 'text-[2.25rem] sm:text-display',
            )}
          >
            {title}
          </h2>
          {intro === undefined ? null : <p className="text-lg text-pretty text-muted sm:text-lede">{intro}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

/** A titled block inside a section (`#second-key`, `#recover`): its own anchor, named by its h3. */
export function SubSection({ id, title, children, className }: Omit<SectionProps, 'intro' | 'chapter'>) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn('flex scroll-mt-4 flex-col gap-3', className)}>
      <h3 id={`${id}-title`} className="font-display text-[1.75rem] leading-[1.1] font-normal text-balance">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** A link to a part of a page (`#faq-ledger`, `/learn/faq#faq-ledger`). */
export function HashLink({ href, children }: { href: `#${string}` | `/${string}#${string}`; children: ReactNode }) {
  return (
    <a href={href} className={LINK_CLASS}>
      {children}
    </a>
  );
}

/** A link to another page of this site; it opens here. */
export function PageLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={LINK_CLASS}>
      {children}
    </Link>
  );
}

/** A link to another site (the repository): it opens in a new tab and says so in its accessible name. */
export function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" aria-label={`${label} ${t('common.opensInNewTab')}`} className={LINK_CLASS}>
      {label}
      <ExternalLinkIcon aria-hidden="true" className="ml-1 inline size-4 align-text-bottom" />
    </a>
  );
}
