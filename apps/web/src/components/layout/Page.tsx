import { cn } from 'cn';
import type { ReactNode } from 'react';

type PageProps = {
  /** `app`: the full content width (landing, /app, /recovery). `flow`: a centred column for flows (/protect, ...). */
  width?: 'app' | 'flow';
  children: ReactNode;
  className?: string | undefined;
};

/** The classes written out in full: Tailwind only generates utilities it finds in the source. */
const WIDTH: Record<NonNullable<PageProps['width']>, string> = {
  app: 'mx-auto flex w-full max-w-5xl flex-col gap-8 sm:gap-12',
  flow: 'mx-auto flex w-full max-w-2xl flex-col gap-8 sm:gap-12',
};

/**
 * The frame of every page inside <main> (DECISIONS.md D112): its width and the space between its blocks, so pages do
 * not pick them. A page starts with a PageHeader (its only h1), then its Sections.
 */
export function Page({ width = 'app', children, className }: PageProps) {
  return (
    <div data-slot="page" data-width={width} className={cn(WIDTH[width], className)}>
      {children}
    </div>
  );
}
