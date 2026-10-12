import type { ReactNode } from 'react';
import { SiteFooter } from './SiteFooter.tsx';
import { SiteHeader } from './SiteHeader.tsx';

/** Page frame: header, the page in <main>, footer. Pages render their own <h1>. No skip link (D149): <main> is the landmark to jump to. */
export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-blueprint print:bg-none">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8 sm:py-12">{children}</main>
      <SiteFooter />
    </div>
  );
}
