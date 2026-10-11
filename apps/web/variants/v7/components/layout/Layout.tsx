import type { ReactNode } from 'react';
import { t } from '@/i18n';
import { SiteFooter } from './SiteFooter.tsx';
import { SiteHeader } from './SiteHeader.tsx';

/**
 * Page frame: skip link, header, the page in <main>, footer. v7: <main> is full width so the landing's split screen
 * can run edge to edge; Page sets the content column and its padding for every other page.
 */
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
      <main id="main" tabIndex={-1} className="flex w-full flex-1 flex-col">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
