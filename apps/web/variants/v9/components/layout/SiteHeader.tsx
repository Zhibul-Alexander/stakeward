import { FlaskConicalIcon, GlobeIcon, LifeBuoyIcon, PlayIcon, SwordsIcon, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { IS_DEVNET, MAINNET_SITE_URL, TESTNET_SITE_URL } from '@/config';
import { t } from '@/i18n';
import { Avatar } from './Page.tsx';

/** A ghost link of the header's nav; the page it opens is marked as the current one (`aria-current`). */
function NavLink({ href, icon: Icon, children }: { href: string; icon?: LucideIcon | undefined; children: ReactNode }) {
  const [location] = useLocation();
  const current = location === href;
  return (
    <Button asChild variant="ghost" size="sm" className="aria-[current=page]:bg-primary-soft aria-[current=page]:text-primary">
      <Link href={href} aria-current={current ? 'page' : undefined}>
        {Icon === undefined ? null : <Icon aria-hidden="true" />}
        {children}
      </Link>
    </Button>
  );
}

/**
 * v9: the top bar of a messaging app. Who you are talking to (the avatar, the name and one line under it: the network
 * on devnet, the promise on mainnet), then the same links as the base header: Rescue, Demo, the challenge (devnet) or
 * testnet (mainnet), Your accounts.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md print:hidden">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="flex min-w-0 items-center gap-2.5 rounded-full pr-1" aria-label={t('nav.home')}>
            <Avatar />
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="text-base font-bold tracking-tight">{t('common.appName')}</span>
              <span className="flex items-center gap-1.5 truncate text-xs text-muted">
                <span aria-hidden="true" className={IS_DEVNET ? 'size-1.5 rounded-full bg-warning' : 'size-1.5 rounded-full bg-success'} />
                {IS_DEVNET ? t('common.devnetNote') : t('landing.network.mainnet')}
              </span>
            </span>
          </Link>
          {IS_DEVNET ? (
            <Button asChild variant="outline" size="sm" className="max-md:hidden">
              <a href={MAINNET_SITE_URL}>
                <GlobeIcon aria-hidden="true" />
                {t('nav.tryMainnet')}
              </a>
            </Button>
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
            <Button asChild variant="ghost" size="sm">
              <a href={TESTNET_SITE_URL}>
                <FlaskConicalIcon aria-hidden="true" />
                <span className="sr-only md:not-sr-only">{t('nav.tryTestnet')}</span>
              </a>
            </Button>
          )}
          <span className="ml-auto sm:ml-1">
            <NavLink href="/app">{t('nav.app')}</NavLink>
          </span>
        </nav>
      </div>
    </header>
  );
}
