import { FlaskConicalIcon, GlobeIcon, LayoutDashboardIcon, LifeBuoyIcon, PlayIcon, SwordsIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { IS_DEVNET, MAINNET_SITE_URL, TESTNET_SITE_URL } from '@/config';
import { t } from '@/i18n';

const LINK = 'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-rail-muted hover:bg-rail-raised hover:text-rail-fg focus-visible:outline-rail-accent';

function RailLink({ href, children, external = false }: { href: string; children: ReactNode; external?: boolean }) {
  return external ? (
    <a href={href} className={LINK}>
      {children}
    </a>
  ) : (
    <Link href={href} className={LINK}>
      {children}
    </Link>
  );
}

/**
 * The landing page's header in the v5 console look: the same dark rail as the app's sidebar, the mark, the network,
 * Rescue and the demo, and "Your accounts" as the way into the console (outlined: the hero's
 * "Check my stake" is the page's one filled action). Below 640 px the links take a second row and
 * the less used ones keep only their icon (named for screen readers).
 */
export function SiteHeader() {
  return (
    <header className="border-b border-rail-border bg-rail text-rail-fg print:hidden">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="flex items-center gap-2.5 rounded-sm text-base font-semibold focus-visible:outline-rail-accent" aria-label={t('nav.home')}>
            <span className="grid size-7 place-items-center rounded-md bg-rail-raised ring-1 ring-rail-border">
              <img src="/favicon.svg" alt="" className="size-4.5" />
            </span>
            <span className="font-display tracking-tight">{t('common.appName')}</span>
          </Link>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-rail-border px-2 py-0.5 text-xs font-medium">
            {IS_DEVNET ? <FlaskConicalIcon aria-hidden="true" className="size-3.5 text-rail-accent" /> : <GlobeIcon aria-hidden="true" className="size-3.5 text-rail-accent" />}
            {IS_DEVNET ? t('common.devnet') : 'Mainnet'}
          </span>
        </div>
        <nav aria-label={t('nav.label')} className="flex w-full items-center gap-1 sm:w-auto">
          <RailLink href="/rescue">
            <LifeBuoyIcon aria-hidden="true" className="size-4" />
            {t('nav.rescue')}
          </RailLink>
          <RailLink href="/demo">
            <PlayIcon aria-hidden="true" className="size-4" />
            <span className="sr-only sm:not-sr-only">{t('nav.demo')}</span>
          </RailLink>
          {IS_DEVNET ? (
            <RailLink href="/challenge">
              <SwordsIcon aria-hidden="true" className="size-4" />
              <span className="sr-only md:not-sr-only">{t('nav.challenge')}</span>
            </RailLink>
          ) : (
            <RailLink href={TESTNET_SITE_URL} external>
              <FlaskConicalIcon aria-hidden="true" className="size-4" />
              <span className="sr-only md:not-sr-only">{t('nav.tryTestnet')}</span>
            </RailLink>
          )}
          {IS_DEVNET ? (
            <span className="hidden sm:contents">
            <RailLink href={MAINNET_SITE_URL} external>
              <GlobeIcon aria-hidden="true" className="size-4" />
              <span className="sr-only lg:not-sr-only">{t('nav.tryMainnet')}</span>
            </RailLink>
            </span>
          ) : null}
          <Link
            href="/app"
            className="ml-auto inline-flex h-8 items-center whitespace-nowrap gap-1.5 rounded-md border border-rail-border bg-rail-raised px-3 text-sm font-medium text-rail-fg hover:border-rail-muted sm:ml-2 focus-visible:outline-rail-accent"
          >
            <LayoutDashboardIcon aria-hidden="true" className="size-4 text-rail-accent" />
            {t('nav.app')}
          </Link>
        </nav>
      </div>
    </header>
  );
}
