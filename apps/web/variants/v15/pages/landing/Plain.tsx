import { cn } from 'cn';
import type { ReactNode } from 'react';
import { Link } from 'wouter';

/** Prose link: underlined at rest, a thicker line on hover, yellow when focused (index.css). */
export const PROSE_LINK = 'text-primary underline hover:text-primary-hover hover:decoration-3';

/** A page-level h2 of the start page with its anchor. A rule above separates it from the block before. */
export function PlainSection({
  id,
  title,
  children,
  className,
}: {
  id: string;
  title: string;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn('flex scroll-mt-4 flex-col gap-4 border-t border-border pt-8', className)}>
      <h2 id={`${id}-title`} className="text-2xl text-balance">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A bulleted list at reading size, spaced like a printed form. */
export function Bullets({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return <ul className={cn('measure flex list-disc flex-col gap-2 pl-6 marker:text-foreground', className)}>{children}</ul>;
}

/**
 * Warning text: a black circle with "!" and bold words. The one way the start page says "read this before you act".
 * The circle is drawn, not an icon font, and hidden from screen readers, which hear "Warning" instead.
 */
export function WarningText({ children }: { children: ReactNode }) {
  return (
    <div className="measure flex items-start gap-4">
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-lg leading-none font-bold text-background"
      >
        !
      </span>
      <p className="font-bold text-pretty">
        <span className="sr-only">Warning: </span>
        {children}
      </p>
    </div>
  );
}

/** An internal link that looks like prose. */
export function PlainLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={PROSE_LINK}>
      {children}
    </Link>
  );
}
