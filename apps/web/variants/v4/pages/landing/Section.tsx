import { cn } from 'cn';
import { ExternalLinkIcon, SparklesIcon, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { t } from '@/i18n';

const LINK_CLASS = 'rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover';

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
    <section id={id} aria-labelledby={`${id}-title`} className={cn('flex scroll-mt-4 flex-col gap-4 sm:gap-6', className)}>
      <div className="flex max-w-prose flex-col gap-1 sm:gap-2">
        <h2 id={`${id}-title`} className="text-2xl text-balance">
          {title}
        </h2>
        {intro === undefined ? null : <p className="text-base text-pretty text-muted">{intro}</p>}
      </div>
      {children}
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
      <h3 id={`${id}-title`} className="text-lg font-extrabold text-balance">
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

/**
 * v4: the companion's voice. A round avatar and a speech card, used for the plain-language notes that guide a nervous
 * reader ("Checking needs no wallet and signs nothing"). Decorative avatar; the words carry the meaning.
 */
export function Helper({
  icon: Icon = SparklesIcon,
  tone = 'lilac',
  children,
  className,
}: {
  icon?: LucideIcon;
  tone?: 'lilac' | 'mint' | 'sky' | 'peach';
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div data-slot="helper" className={cn('flex items-start gap-3', className)}>
      <span aria-hidden="true" className={cn('flex size-10 shrink-0 items-center justify-center rounded-full shadow-sm', HELPER_TONE[tone])}>
        <Icon className="size-5" />
      </span>
      <div className="relative min-w-0 flex-1 rounded-lg rounded-tl-sm bg-surface px-4 py-3 text-sm text-pretty shadow-sm sm:text-base">{children}</div>
    </div>
  );
}

const HELPER_TONE = {
  lilac: 'bg-lilac text-lilac-ink',
  mint: 'bg-mint text-mint-ink',
  sky: 'bg-sky text-sky-ink',
  peach: 'bg-peach text-peach-ink',
} as const;
