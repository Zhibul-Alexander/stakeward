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
    <Button asChild variant="ghost" size="sm" className="aria-[current=page]:bg-subtle">
      <Link href={href} aria-current={current ? 'page' : undefined}>
        {Icon === undefined ? null : <Icon aria-hidden="true" />}
        {children}
      </Link>
    </Button>
  );
}

/**
 * The site header (DECISIONS.md D112): the mark and name, the network on devnet (a badge and, from 768 px, what it
 * means), and links: Rescue, for someone whose main key was just stolen, the demo and the accounts page; on devnet also
 * the public "Try to steal it" challenge (D133); on mainnet the outlined "Try on testnet" instead, to the devnet copy
 * of the site (D136). Below 640 px the
 * links take a second row rather than hiding their words. Their boxes (the current page's pill, the focus ring) stay
 * inside the content column, clear of the 16 px gutter.
 */
export function SiteHeader() {
  return (
    <header className="border-b border-border-strong bg-background print:hidden">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/" className="flex items-center gap-2 rounded-sm text-lg font-bold tracking-tight" aria-label={t('nav.home')}>
            <img src="/favicon.svg" alt="" className="size-6" />
            {t('common.appName')}
          </Link>
          {IS_DEVNET ? (
            <>
              <Badge tone="outline">
                <FlaskConicalIcon aria-hidden="true" />
                {t('common.devnet')}
              </Badge>
              <span className="hidden text-xs text-muted md:inline">{t('common.devnetNote')}</span>
              {/* The way back to the real site. Icon only below 640 px, where the nav has its own row; hidden from 640 to 768 px,
                  where one row has no room for it (the landing hero still links there); named from 768 px. */}
              <Button asChild variant="outline" size="sm" className="sm:max-md:hidden">
                <a href={MAINNET_SITE_URL}>
                  <GlobeIcon aria-hidden="true" />
                  <span className="sr-only md:not-sr-only">{t('nav.tryMainnet')}</span>
                </a>
              </Button>
            </>
          ) : null}
        </div>
        <nav aria-label={t('nav.label')} className="flex w-full items-center gap-2 sm:w-auto">
          <NavLink href="/rescue" icon={LifeBuoyIcon}>
            {t('nav.rescue')}
          </NavLink>
          <NavLink href="/demo" icon={PlayIcon}>
            {/* The 360 px row also holds the challenge or testnet link: the demo is then an icon, named for screen readers. */}
            <span className="sr-only sm:not-sr-only">{t('nav.demo')}</span>
          </NavLink>
          {IS_DEVNET ? (
            <NavLink href="/challenge" icon={SwordsIcon}>
              {/* Icon only below 768 px, where the four links share one row; the name stays for screen readers. */}
              <span className="sr-only md:not-sr-only">{t('nav.challenge')}</span>
            </NavLink>
          ) : (
            <Button asChild variant="outline" size="sm">
              <a href={TESTNET_SITE_URL}>
                <FlaskConicalIcon aria-hidden="true" />
                {/* Icon only below 768 px, like the challenge link; there the landing page says it in words. */}
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
