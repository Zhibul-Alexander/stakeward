import { FlaskConicalIcon, GlobeIcon, LifeBuoyIcon, PlayIcon, SwordsIcon, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IS_DEVNET, MAINNET_SITE_URL, TESTNET_SITE_URL } from '@/config';
import { t } from '@/i18n';

/** A ghost link of the header's nav; the page it opens is marked as the current one (`aria-current`). */
function NavLink({ href, icon: Icon, children }: { href: string; icon?: LucideIcon | undefined; children: ReactNode }) {
  const [location] = useLocation();
  const current = location === href;
  return (
    <Button asChild variant="ghost" size="sm" className="aria-[current=page]:bg-subtle aria-[current=page]:text-primary">
      <Link href={href} aria-current={current ? 'page' : undefined}>
        {Icon === undefined ? null : <Icon aria-hidden="true" />}
        {children}
      </Link>
    </Button>
  );
}

/**
 * v7 header: a night strip (the left future) over every page, so the bright app below reads as the future you chose.
 * Same links and behaviour as the base header.
 */
export function SiteHeader() {
  return (
    <header className="scope-night border-b border-border print:hidden">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-sm font-display text-lg font-bold tracking-tight"
            aria-label={t('nav.home')}
          >
            <img src="/favicon.svg" alt="" className="size-6" />
            {t('common.appName')}
          </Link>
          {IS_DEVNET ? (
            <>
              <Badge tone="outline">
                <FlaskConicalIcon aria-hidden="true" />
                {t('common.devnet')}
              </Badge>
              <span className="hidden text-xs text-muted lg:inline">{t('common.devnetNote')}</span>
              <Button asChild variant="outline" size="sm" className="sm:max-md:hidden">
                <a href={MAINNET_SITE_URL}>
                  <GlobeIcon aria-hidden="true" />
                  <span className="sr-only md:not-sr-only">{t('nav.tryMainnet')}</span>
                </a>
              </Button>
            </>
          ) : null}
        </div>
        <nav aria-label={t('nav.label')} className="flex w-full items-center gap-1 sm:w-auto sm:gap-2">
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
            <Button asChild variant="outline" size="sm">
              <a href={TESTNET_SITE_URL}>
                <FlaskConicalIcon aria-hidden="true" />
                <span className="sr-only md:not-sr-only">{t('nav.tryTestnet')}</span>
              </a>
            </Button>
          )}
          <NavLink href="/app">{t('nav.app')}</NavLink>
        </nav>
      </div>
    </header>
  );
}
