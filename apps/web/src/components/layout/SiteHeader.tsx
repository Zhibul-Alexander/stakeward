import { cn } from 'cn';
import { ChevronDownIcon, FlaskConicalIcon, GlobeIcon, LifeBuoyIcon, type LucideIcon } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IS_DEVNET, MAINNET_SITE_URL, TESTNET_SITE_URL } from '@/config';
import { t } from '@/i18n';
import { LanguageMenu } from './LanguageMenu.tsx';

/** A ghost link of the header's nav; the page it opens is marked as the current one (`aria-current`). */
function NavLink({ href, icon: Icon, className, children }: { href: string; icon?: LucideIcon | undefined; className?: string | undefined; children: ReactNode }) {
  const [location] = useLocation();
  const current = location === href;
  return (
    <Button asChild variant="ghost" size="sm" className={cn('aria-[current=page]:bg-primary-soft aria-[current=page]:text-primary', className)}>
      <Link href={href} aria-current={current ? 'page' : undefined}>
        {Icon === undefined ? null : <Icon aria-hidden="true" />}
        {children}
      </Link>
    </Button>
  );
}

/**
 * The link to the other network's copy of the site (D136): mainnet from devnet, devnet from mainnet. It leaves this
 * site, so it is a button with an outline, not a ghost link like the pages of this one; and it stands last, at the
 * right end of the header on both sites, so switching networks does not move it (D143).
 */
function NetworkLink({ className }: { className?: string | undefined }) {
  const Icon = IS_DEVNET ? GlobeIcon : FlaskConicalIcon;
  return (
    <Button asChild variant="outline" size="sm" className={className}>
      <a href={IS_DEVNET ? MAINNET_SITE_URL : TESTNET_SITE_URL}>
        <Icon aria-hidden="true" />
        {IS_DEVNET ? t('nav.tryMainnet') : t('nav.tryTestnet')}
      </a>
    </Button>
  );
}

/** The links that are not for an emergency or the stake itself: the demo, the devnet challenge (D133), the other network. */
function SecondaryLinks({ className }: { className?: string | undefined }) {
  return (
    <>
      <NavLink href="/demo" className={className}>
        {t('nav.demo')}
      </NavLink>
      {IS_DEVNET ? (
        <NavLink href="/challenge" className={className}>
          {t('nav.challenge')}
        </NavLink>
      ) : null}
      <NetworkLink className={className} />
    </>
  );
}

/**
 * The site header (DECISIONS.md D112, D141, D143): the mark and name, the Devnet badge on devnet, the interface
 * language (D140), and the nav. Your accounts and Rescue, for someone whose main key was just stolen, are links in words at
 * every width. The rest (the demo, the devnet challenge, the other network's site) stands in the row from 1024 px;
 * below that a More button opens it as a list under the header, so a phone sees no icon-only links and one row of nav.
 * Below 640 px the nav takes the second row. Boxes (the current page's pill, the focus ring) stay inside the content
 * column, clear of the 16 px gutter.
 */
export function SiteHeader() {
  const moreId = useId();
  const [location] = useLocation();
  // The page the list was opened on: a page change (a link in the list, Back) closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const moreOpen = openOn === location;
  return (
    <header
      className="border-b-2 border-primary bg-surface print:hidden"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && moreOpen) {
          setOpenOn(null);
          document.getElementById(`${moreId}-button`)?.focus();
        }
      }}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/" className="flex items-center gap-2 rounded-sm font-display text-lg font-semibold tracking-tight text-primary" aria-label={t('nav.home')}>
            <img src="/favicon.svg" alt="" className="size-6" />
            {t('common.appName')}
          </Link>
          {IS_DEVNET ? (
            <Badge tone="outline">
              <FlaskConicalIcon aria-hidden="true" />
              {t('common.devnet')}
            </Badge>
          ) : null}
        </div>
        {/* Right of the mark on the first row below 640 px; from 640 px left of the nav, so the order you see is the
            order you tab through and the other network's button stays the last item. */}
        <LanguageMenu className="ml-auto" />
        <nav aria-label={t('nav.label')} className="flex w-full items-center gap-1 sm:w-auto">
          {/* Below 1024 px the three items of the nav sit closer (8 px padding, not 12): longer words of a translation
              (D140) still fit the 328 px of a 360 px screen, and the one row from 640 px with the language (D143). */}
          <NavLink href="/app" className="max-lg:px-2">
            {t('nav.app')}
          </NavLink>
          <NavLink href="/rescue" icon={LifeBuoyIcon} className="max-lg:px-2">
            {t('nav.rescue')}
          </NavLink>
          <SecondaryLinks className="hidden lg:inline-flex" />
          <Button
            id={`${moreId}-button`}
            variant="ghost"
            size="sm"
            aria-expanded={moreOpen}
            aria-controls={moreOpen ? moreId : undefined}
            className="ml-auto max-lg:px-2 sm:ml-0 lg:hidden"
            onClick={() => {
              setOpenOn(moreOpen ? null : location);
            }}
          >
            {t('nav.more')}
            <ChevronDownIcon aria-hidden="true" className={moreOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
          </Button>
        </nav>
      </div>
      {moreOpen ? (
        <div id={moreId} className="animate-reveal border-t border-border lg:hidden">
          <div className="mx-auto flex w-full max-w-5xl flex-col items-start gap-1 px-4 py-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <SecondaryLinks />
          </div>
        </div>
      ) : null}
    </header>
  );
}
