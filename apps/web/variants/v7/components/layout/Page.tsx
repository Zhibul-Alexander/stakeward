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
  app: 'mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:gap-12 sm:py-12',
  flow: 'mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8 sm:gap-10 sm:py-12',
};

/** The frame of every page inside <main>: its width, its padding and the space between its blocks. */
export function Page({ width = 'app', children, className }: PageProps) {
  return (
    <div data-slot="page" data-width={width} className={cn(WIDTH[width], className)}>
      {children}
    </div>
  );
}
