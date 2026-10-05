import { cn } from 'cn';
import { ExternalLinkIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { t } from '@/i18n';

const LINK_CLASS = 'rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover';

type SectionProps = { id: string; title: string; children: ReactNode; className?: string | undefined };

/**
 * One section of the landing page: the anchor the table of contents, the footer and the FAQ link to (`#<id>`), named
 * by its h2 (`<id>-title`; `cannot-do-title` predates this page and stays).
 */
export function Section({ id, title, children, className }: SectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn('flex scroll-mt-4 flex-col gap-6', className)}>
      <h2 id={`${id}-title`} className="text-2xl font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * A link to a part of this page (`#faq-ledger`): a plain anchor, so the browser changes the hash and useHashTarget
 * opens the FAQ question it names.
 */
export function HashLink({ href, children }: { href: `#${string}`; children: ReactNode }) {
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
