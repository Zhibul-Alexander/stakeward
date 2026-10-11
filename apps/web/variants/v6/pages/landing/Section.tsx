import { cn } from 'cn';
import { ExternalLinkIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { t } from '@/i18n';

const LINK_CLASS = 'font-semibold text-primary underline decoration-2 underline-offset-4 hover:decoration-signal';

type SectionProps = {
  id: string;
  title: string;
  /** One sentence under the title, said once for the whole section. */
  intro?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
};

/**
 * One section of the landing page: the anchor the footer and the FAQ link to (`#<id>`), named by its h2
 * (`<id>-title`; `cannot-do-title` predates this page and stays). From 640 px the landing's h2 is `text-2xl`
 * (DECISIONS.md D112, type roles); below, where the hero's h1 is `text-2xl` too, it is the app's `text-lg`, so the h1
 * still leads.
 */
export function Section({ id, title, intro, children, className }: SectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn('grid scroll-mt-4 gap-4 border-t-[6px] border-foreground pt-4 md:grid-cols-12 md:gap-x-6 md:pt-5', className)}
    >
      <div className="flex flex-col gap-2 md:col-span-4">
        <h2 id={`${id}-title`} className="text-2xl text-balance break-words uppercase sm:text-3xl md:text-2xl lg:text-[2.5rem] lg:leading-[1]">
          {title}
        </h2>
        {intro === undefined ? null : <p className="max-w-prose text-base text-pretty text-muted">{intro}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-4 md:col-span-8">{children}</div>
    </section>
  );
}

/**
 * A titled block inside a section (`#second-key`, `#recover`): its own anchor, named by its h3. `text-base` at every
 * width, like the landing's other h3s, so it never outsizes an h2 (the co-sign callout and the closing call are
 * `text-lg`).
 */
export function SubSection({ id, title, children, className }: Omit<SectionProps, 'intro'>) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn('flex scroll-mt-4 flex-col gap-3', className)}>
      <h3 id={`${id}-title`} className="text-base font-bold tracking-wide text-balance uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * A link to a part of a page (`#faq-ledger`, `/learn/faq#faq-ledger`): a plain anchor, so the browser changes the hash
 * (or loads that page) and useHashTarget opens the FAQ question it names.
 */
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

/**
 * A link to another site (the repository): it opens in a new tab and says so in its accessible name, as the recovery
 * card's PrintedLink does (spec L14). The icon shows it to the eye.
 */
export function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" aria-label={`${label} ${t('common.opensInNewTab')}`} className={LINK_CLASS}>
      {label}
      <ExternalLinkIcon aria-hidden="true" className="ml-1 inline size-4 align-text-bottom" />
    </a>
  );
}
