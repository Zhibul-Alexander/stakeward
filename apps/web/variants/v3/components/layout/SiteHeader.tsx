import { FlaskConicalIcon, GlobeIcon, LifeBuoyIcon, PlayIcon, SwordsIcon, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { IS_DEVNET, MAINNET_SITE_URL, TESTNET_SITE_URL } from '@/config';
import { t } from '@/i18n';

const NAV_CLASS =
  'inline-flex h-9 items-center gap-1.5 rounded-sm px-1 text-sm font-medium text-foreground underline-offset-[6px] decoration-2 hover:underline aria-[current=page]:underline aria-[current=page]:decoration-accent [&_svg]:size-4 [&_svg]:shrink-0';

/** A link of the masthead's nav; the page it opens is marked as the current one (`aria-current`). */
function NavLink({ href, icon: Icon, children }: { href: string; icon?: LucideIcon | undefined; children: ReactNode }) {
  const [location] = useLocation();
  const current = location === href;
  return (
    <Link href={href} aria-current={current ? 'page' : undefined} className={NAV_CLASS}>
      {Icon === undefined ? null : <Icon aria-hidden="true" />}
      {children}
    </Link>
  );
}

/**
 * Variant v3: a masthead. A thin top line says which network this edition is printed on; under it the name in the
 * display serif and the nav as plain underlined words, closed by a heavy rule.
 */
export function SiteHeader() {
  return (
    <header className="bg-background print:hidden">
      <div className="border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-1.5 text-xs text-muted">
          <p className="flex min-w-0 flex-wrap items-center gap-x-2">
            {IS_DEVNET ? (
              <>
                <FlaskConicalIcon aria-hidden="true" className="size-3.5 text-accent-ink" />
                <span className="font-semibold text-foreground">{t('common.devnet')}</span>
                <span className="hidden sm:inline">{t('common.devnetNote')}</span>
              </>
            ) : (
              <>
                <GlobeIcon aria-hidden="true" className="size-3.5" />
                <span className="font-semibold text-foreground">{t('landing.network.mainnet')}</span>
              </>
            )}
          </p>
          {IS_DEVNET ? (
            <a href={MAINNET_SITE_URL} className="inline-flex items-center gap-1 rounded-sm text-foreground underline underline-offset-4">
              <GlobeIcon aria-hidden="true" className="size-3.5" />
              {t('nav.tryMainnet')}
            </a>
          ) : (
            <a href={TESTNET_SITE_URL} className="inline-flex items-center gap-1 rounded-sm text-foreground underline underline-offset-4">
              <FlaskConicalIcon aria-hidden="true" className="size-3.5" />
              {t('nav.tryTestnet')}
            </a>
          )}
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-end justify-between gap-x-6 gap-y-1 px-4 pt-3 pb-2 sm:pt-5">
        <Link
          href="/"
          aria-label={t('nav.home')}
          className="flex items-baseline gap-1 rounded-sm font-display text-[2.25rem] leading-none tracking-tight sm:text-[3rem]"
        >
          {t('common.appName')}
          <span aria-hidden="true" className="text-accent">.</span>
        </Link>
        <nav aria-label={t('nav.label')} className="-mx-1 flex w-full items-center gap-x-4 sm:w-auto sm:gap-x-5">
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
          ) : null}
          <span className="flex-1 sm:hidden" aria-hidden="true" />
          <NavLink href="/app">{t('nav.app')}</NavLink>
        </nav>
      </div>
      <div className="mx-auto w-full max-w-6xl px-4">
        <div className="border-t-[3px] border-b border-rule pb-0.5" />
      </div>
    </header>
  );
}
