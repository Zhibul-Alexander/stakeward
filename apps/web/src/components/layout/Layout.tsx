import type { ReactNode } from 'react';
import { t } from '@/i18n';
import { SiteFooter } from './SiteFooter.tsx';
import { SiteHeader } from './SiteHeader.tsx';

/** Page frame: skip link, header, the page in <main>, footer. Pages render their own <h1>. */
export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only rounded-md bg-surface px-4 py-2 text-sm font-medium text-foreground shadow-md focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
      >
        {t('common.skipToContent')}
      </a>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8 sm:py-12">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
