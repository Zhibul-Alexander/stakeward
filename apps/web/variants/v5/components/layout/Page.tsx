import { cn } from 'cn';
import type { ReactNode } from 'react';

type PageProps = {
  /** `app`: the full content width (landing, /app, /recovery). `flow`: a narrower column for flows (/protect, ...). */
  width?: 'app' | 'flow';
  children: ReactNode;
  className?: string | undefined;
};

/** The classes written out in full: Tailwind only generates utilities it finds in the source. */
const WIDTH: Record<NonNullable<PageProps['width']>, string> = {
  app: 'flex w-full max-w-6xl flex-col gap-8 sm:gap-10',
  flow: 'flex w-full max-w-3xl flex-col gap-8 sm:gap-10',
};

/**
 * The frame of every page inside <main>: its width and the space between its blocks. In the v5 console the content
 * column starts at the rail and keeps a reading width, as a dashboard does.
 */
export function Page({ width = 'app', children, className }: PageProps) {
  return (
    <div data-slot="page" data-width={width} className={cn(WIDTH[width], className)}>
      {children}
    </div>
  );
}
