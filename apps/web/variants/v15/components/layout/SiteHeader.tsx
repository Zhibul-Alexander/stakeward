import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Badge } from '@/components/ui/badge';
import { IS_DEVNET, MAINNET_SITE_URL, TESTNET_SITE_URL } from '@/config';
import { t } from '@/i18n';

const MAST_LINK =
  'inline-flex min-h-11 items-center rounded-none px-0.5 font-bold sm:px-1 text-on-masthead no-underline decoration-3 underline-offset-8 hover:underline aria-[current=page]:underline';

/** A link of the masthead's nav; the page it opens is marked as the current one (`aria-current`). */
function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const [location] = useLocation();
  return (
    <Link href={href} aria-current={location === href ? 'page' : undefined} className={MAST_LINK}>
      {children}
    </Link>
  );
}

/**
 * v15 masthead: a black band with the service name and plain text links (no icons: the words are the links), then the
 * network banner on a light row under it. The banner says which network this copy of the site works on and links to the
 * other one, in words, at every width: on a phone that is the single most important fact about the page.
 */
export function SiteHeader() {
  return (
    <header className="print:hidden">
      <div className="bg-masthead text-on-masthead">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-0 px-4 py-1 sm:gap-x-6 sm:py-3">
          <Link href="/" aria-label={t('nav.home')} className={`${MAST_LINK} text-lg hover:no-underline`}>
            {t('common.appName')}
          </Link>
          <nav aria-label={t('nav.label')} className="-mx-1 w-full text-xs sm:mx-0 sm:w-auto sm:text-base">
            <ul role="list" className="flex flex-wrap items-center gap-x-3 gap-y-0 sm:gap-x-5">
              <li>
                <NavLink href="/rescue">{t('nav.rescue')}</NavLink>
              </li>
              <li>
                <NavLink href="/demo">{t('nav.demo')}</NavLink>
              </li>
              {IS_DEVNET ? (
                <li>
                  <NavLink href="/challenge">{t('nav.challenge')}</NavLink>
                </li>
              ) : null}
              <li>
                <NavLink href="/app">{t('nav.app')}</NavLink>
              </li>
            </ul>
          </nav>
        </div>
      </div>
      <div className="border-b border-border bg-background">
        <p className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
          <Badge tone="primary">{IS_DEVNET ? t('common.devnet') : 'Mainnet'}</Badge>
          <span>{IS_DEVNET ? t('common.devnetNote') : t('landing.network.mainnetNote')}</span>
          <a href={IS_DEVNET ? MAINNET_SITE_URL : TESTNET_SITE_URL} className="text-primary underline hover:text-primary-hover">
            {IS_DEVNET ? t('nav.tryMainnet') : t('nav.tryTestnet')}
          </a>
        </p>
      </div>
    </header>
  );
}
