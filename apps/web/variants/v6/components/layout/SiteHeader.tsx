import { FlaskConicalIcon, GlobeIcon, LifeBuoyIcon, PlayIcon, SwordsIcon, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { IS_DEVNET, MAINNET_SITE_URL, TESTNET_SITE_URL } from '@/config';
import { t } from '@/i18n';

const NAV_ITEM =
  'inline-flex h-9 items-center gap-1.5 border-2 border-transparent px-2 text-xs font-bold tracking-wider uppercase hover:border-foreground [&_svg]:size-4 [&_svg]:shrink-0';

/** A nav link; the current page is filled ink (`aria-current`). */
function NavLink({ href, icon: Icon, children }: { href: string; icon?: LucideIcon | undefined; children: ReactNode }) {
  const [location] = useLocation();
  const current = location === href;
  return (
    <Link
      href={href}
      aria-current={current ? 'page' : undefined}
      className={`${NAV_ITEM} aria-[current=page]:border-foreground aria-[current=page]:bg-foreground aria-[current=page]:text-background`}
    >
      {Icon === undefined ? null : <Icon aria-hidden="true" />}
      {children}
    </Link>
  );
}

/**
 * The site header: a poster masthead. The wordmark in Archivo Black on the left, a thick ink rule under the whole bar,
 * links as uppercase micro-labels. Same links and the same responsive rules as the original header.
 */
export function SiteHeader() {
  return (
    <header className="rule-b bg-background print:hidden">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-2 font-display text-xl leading-none tracking-tight uppercase"
            aria-label={t('nav.home')}
          >
            <span aria-hidden="true" className="block size-5 bg-signal ring-2 ring-foreground" />
            {t('common.appName')}
          </Link>
          {IS_DEVNET ? (
            <>
              <span className="inline-flex items-center gap-1 border-2 border-foreground px-1.5 py-0.5 text-[0.6875rem] leading-4 font-bold tracking-wider uppercase">
                <FlaskConicalIcon aria-hidden="true" className="size-3.5" />
                {t('common.devnet')}
              </span>
              <span className="hidden text-xs text-muted lg:inline">{t('common.devnetNote')}</span>
              <a href={MAINNET_SITE_URL} className={`${NAV_ITEM} border-foreground sm:max-md:hidden`}>
                <GlobeIcon aria-hidden="true" />
                <span className="sr-only md:not-sr-only">{t('nav.tryMainnet')}</span>
              </a>
            </>
          ) : null}
        </div>
        <nav aria-label={t('nav.label')} className="flex w-full items-center gap-1 sm:w-auto">
          <NavLink href="/rescue" icon={LifeBuoyIcon}>
            {t('nav.rescue')}
          </NavLink>
          <NavLink href="/demo" icon={PlayIcon}>
            <span className="sr-only sm:not-sr-only">{t('nav.demo')}</span>
          </NavLink>
          {IS_DEVNET ? (
            <NavLink href="/challenge" icon={SwordsIcon}>
              <span className="sr-only md:not-sr-only">{t('nav.challenge')}</span>
            </NavLink>
          ) : (
            <a href={TESTNET_SITE_URL} className={`${NAV_ITEM} border-foreground`}>
              <FlaskConicalIcon aria-hidden="true" />
              <span className="sr-only md:not-sr-only">{t('nav.tryTestnet')}</span>
            </a>
          )}
          <NavLink href="/app">{t('nav.app')}</NavLink>
        </nav>
      </div>
    </header>
  );
}
