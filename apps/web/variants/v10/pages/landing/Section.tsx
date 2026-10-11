import { cn } from 'cn';
import { ExternalLinkIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { t } from '@/i18n';

const LINK_CLASS = 'rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover';

type SectionProps = {
  id: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
};

/**
 * v10 landing section: a drafting rule across the top with the title hung under it, like a sheet heading. Same anchors
 * and ids as src (`#<id>`, `<id>-title`).
 */
export function Section({ id, title, intro, children, className }: SectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn('flex scroll-mt-4 flex-col gap-5 border-t-2 border-primary pt-5 sm:gap-6', className)}>
      <div className="flex flex-col gap-1 sm:gap-2">
        <h2 id={`${id}-title`} className="font-display text-2xl text-balance">
          {title}
        </h2>
        {intro === undefined ? null : <p className="max-w-prose text-sm text-pretty text-muted sm:text-base">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

export function SubSection({ id, title, children, className }: Omit<SectionProps, 'intro'>) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn('flex scroll-mt-4 flex-col gap-3', className)}>
      <h3 id={`${id}-title`} className="font-display text-base font-semibold text-balance">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function HashLink({ href, children }: { href: `#${string}` | `/${string}#${string}`; children: ReactNode }) {
  return (
    <a href={href} className={LINK_CLASS}>
      {children}
    </a>
  );
}

export function PageLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={LINK_CLASS}>
      {children}
    </Link>
  );
}

export function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" aria-label={`${label} ${t('common.opensInNewTab')}`} className={LINK_CLASS}>
      {label}
      <ExternalLinkIcon aria-hidden="true" className="ml-1 inline size-4 align-text-bottom" />
    </a>
  );
}
