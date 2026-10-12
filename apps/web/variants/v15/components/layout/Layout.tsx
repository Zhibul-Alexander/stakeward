import type { ReactNode } from 'react';
import { t } from '@/i18n';
import { SiteFooter } from './SiteFooter.tsx';
import { SiteHeader } from './SiteHeader.tsx';

/** Page frame: skip link (yellow when focused, like every link), masthead, the page in <main>, footer. */
export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only bg-ring px-4 py-3 text-sm font-bold text-focus-text underline focus:not-sr-only focus:block"
      >
        {t('common.skipToContent')}
      </a>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 pt-6 pb-4 sm:pt-10">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
