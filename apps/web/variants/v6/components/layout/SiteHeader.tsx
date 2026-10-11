import { LifeBuoyIcon } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { IS_DEVNET } from '@/config';
import { t } from '@/i18n';

/**
 * v6 "Verdict first": the header carries only the wordmark, the network on devnet, and one link: Rescue, for the one
 * visitor who cannot wait (a stolen main key). Every other way around the site lives in the footer.
 */
export function SiteHeader() {
  const [location] = useLocation();
  return (
    <header className="print:hidden">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 pt-4 sm:px-6 sm:pt-6">
        <div className="flex min-w-0 items-baseline gap-3">
          <Link
            href="/"
            aria-label={t('nav.home')}
            className="font-condensed rounded-sm text-2xl leading-none font-extrabold tracking-tight"
          >
            {t('common.appName')}
          </Link>
          {IS_DEVNET ? (
            <span className="text-xs text-muted">
              <span className="font-medium text-foreground">{t('common.devnet')}</span>
              <span className="hidden sm:inline">{`: ${t('common.devnetNote')}`}</span>
            </span>
          ) : null}
        </div>
        <nav aria-label={t('nav.label')}>
          <Link
            href="/rescue"
            aria-current={location === '/rescue' ? 'page' : undefined}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-sm px-1 text-sm font-medium underline-offset-4 hover:underline aria-[current=page]:underline"
          >
            <LifeBuoyIcon aria-hidden="true" className="size-4" />
            {t('nav.rescue')}
          </Link>
        </nav>
      </div>
    </header>
  );
}
