import { FlaskConicalIcon, GlobeIcon, LifeBuoyIcon, PlayIcon, SwordsIcon, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from 'cn';
import { Link, useLocation } from 'wouter';
import { IS_DEVNET, MAINNET_SITE_URL, TESTNET_SITE_URL } from '@/config';
import { t } from '@/i18n';

/** Text links with a 40 px hit area; the current page is underlined and bold, not filled (the record look). */
const LINK =
  'inline-flex h-10 items-center gap-1.5 rounded-sm px-2 text-sm text-muted underline-offset-[6px] decoration-2 hover:text-foreground hover:underline [&_svg]:size-4 [&_svg]:shrink-0';
const CURRENT = 'aria-[current=page]:font-semibold aria-[current=page]:text-foreground aria-[current=page]:underline';

function NavLink({ href, icon: Icon, children }: { href: string; icon?: LucideIcon | undefined; children: ReactNode }) {
  const [location] = useLocation();
  const current = location === href;
  return (
    <Link href={href} aria-current={current ? 'page' : undefined} className={`${LINK} ${CURRENT}`}>
      {Icon === undefined ? null : <Icon aria-hidden="true" />}
      {children}
    </Link>
  );
}

/**
 * v11 header: the wordmark set in the record serif, the network said in words on devnet, and the same links as the
 * base header (Rescue, Demo, the challenge or testnet, Your accounts). Below 640 px the links take a second row.
 */
export function SiteHeader() {
  const [location] = useLocation();
  return (
    <header className="border-b border-border bg-surface print:hidden">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <Link href="/" className="flex h-10 items-center gap-2 rounded-sm" aria-label={t('nav.home')}>
            <img src="/favicon.svg" alt="" className="size-5" />
            <span className="font-serif text-lg font-semibold tracking-tight">{t('common.appName')}</span>
          </Link>
          {IS_DEVNET ? (
            <>
              <span className="inline-flex items-center gap-1 rounded-sm border border-warning-border bg-warning-soft px-1.5 py-px text-xs font-semibold text-warning">
                <FlaskConicalIcon aria-hidden="true" className="size-3.5" />
                {t('common.devnet')}
              </span>
              <span className="hidden text-xs text-muted lg:inline">{t('common.devnetNote')}</span>
              <a href={MAINNET_SITE_URL} className={cn(LINK, 'hidden md:inline-flex')}>
                <GlobeIcon aria-hidden="true" />
                {t('nav.tryMainnet')}
              </a>
            </>
          ) : null}
        </div>
        <nav aria-label={t('nav.label')} className="-mx-2 flex w-full flex-wrap items-center gap-x-1 sm:mx-0 sm:w-auto">
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
            <a href={TESTNET_SITE_URL} className={LINK}>
              <FlaskConicalIcon aria-hidden="true" />
              <span className="sr-only md:not-sr-only">{t('nav.tryTestnet')}</span>
            </a>
          )}
          <Link
            href="/app"
            aria-current={location === '/app' ? 'page' : undefined}
            className="ml-auto inline-flex h-10 items-center rounded-md border border-foreground px-3 text-sm font-semibold hover:bg-foreground hover:text-background sm:ml-2 aria-[current=page]:bg-foreground aria-[current=page]:text-background"
          >
            {t('nav.app')}
          </Link>
        </nav>
      </div>
    </header>
  );
}
