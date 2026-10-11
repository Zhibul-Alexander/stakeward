import { cn } from 'cn';
import {
  BarChart3Icon,
  BookOpenIcon,
  FlaskConicalIcon,
  GlobeIcon,
  LayoutDashboardIcon,
  LifeBuoyIcon,
  PlayIcon,
  ShieldCheckIcon,
  SwordsIcon,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { fetchHealth, monitorFreshness } from '@/api/health';
import { IS_DEVNET, MAINNET_SITE_URL, TESTNET_SITE_URL } from '@/config';
import { t } from '@/i18n';
import { useHealth, useNow } from '@/pages/app/hooks';
import { SiteFooter } from './SiteFooter.tsx';
import { SiteHeader } from './SiteHeader.tsx';

const loadHealth = () => fetchHealth();
const MINUTE_MS = 60_000;

type NavItem = { href: string; label: string; icon: LucideIcon; match: (location: string) => boolean };

/** The console's sections. Short names; the page's own h1 says the rest. */
const NAV: readonly NavItem[] = [
  { href: '/app', label: 'Accounts', icon: LayoutDashboardIcon, match: (l) => l === '/app' || l.startsWith('/withdraw') || l.startsWith('/extend') || l.startsWith('/recovery') },
  { href: '/protect', label: 'Protect', icon: ShieldCheckIcon, match: (l) => l.startsWith('/protect') },
  { href: '/rescue', label: t('nav.rescue'), icon: LifeBuoyIcon, match: (l) => l.startsWith('/rescue') },
  { href: '/demo', label: t('nav.demo'), icon: PlayIcon, match: (l) => l.startsWith('/demo') },
  { href: '/learn', label: 'Learn', icon: BookOpenIcon, match: (l) => l.startsWith('/learn') },
  { href: '/stats', label: t('footer.stats'), icon: BarChart3Icon, match: (l) => l.startsWith('/stats') },
  ...(IS_DEVNET
    ? [{ href: '/challenge', label: t('nav.challenge'), icon: SwordsIcon, match: (l: string) => l.startsWith('/challenge') }]
    : []),
];

function NavLinks({ location }: { location: string }) {
  return (
    <ul role="list" className="flex gap-1 lg:flex-col">
      {NAV.map(({ href, label, icon: Icon, match }) => {
        const current = match(location);
        return (
          <li key={href} className="shrink-0">
            <Link
              href={href}
              aria-current={current ? 'page' : undefined}
              className={cn(
                'relative flex h-9 items-center gap-2.5 rounded-md px-3 text-sm font-medium text-rail-muted transition-colors hover:bg-rail-raised hover:text-rail-fg',
                'aria-[current=page]:bg-rail-raised aria-[current=page]:text-rail-fg',
                'focus-visible:outline-rail-accent',
              )}
            >
              <Icon aria-hidden="true" className={cn('size-4 shrink-0', current && 'text-rail-accent')} />
              {label}
              {current ? (
                <span aria-hidden="true" className="absolute inset-x-3 -bottom-1 h-0.5 rounded-full bg-rail-accent lg:inset-x-auto lg:inset-y-2 lg:-left-3 lg:bottom-auto lg:h-auto lg:w-0.5" />
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function NetworkPill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-rail-border px-2 py-0.5 text-xs font-medium text-rail-fg">
      {IS_DEVNET ? <FlaskConicalIcon aria-hidden="true" className="size-3.5 text-rail-accent" /> : <GlobeIcon aria-hidden="true" className="size-3.5 text-rail-accent" />}
      {IS_DEVNET ? t('common.devnet') : 'Mainnet'}
    </span>
  );
}

/** "Last checked N min ago" of the monitor, in the rail (UX rule 12): a live dot while fresh, red once stale. */
function RailMonitor() {
  const health = useHealth(loadHealth, 0);
  const now = useNow(30_000);
  let text = t('app.monitoring.checking');
  let tone: 'ok' | 'stale' | 'idle' = 'idle';
  if (health.status === 'error') text = t('app.monitoring.unavailable');
  if (health.status === 'ready') {
    const fresh = monitorFreshness(health.health, Math.max(now, health.receivedAt), health.receivedAt);
    if (fresh.kind === 'not-yet') text = t('app.monitoring.notYet');
    else {
      const minutes = Math.floor(fresh.ageMs / MINUTE_MS);
      const hours = Math.floor(minutes / 60);
      text =
        minutes < 1
          ? t('app.monitoring.justNow')
          : minutes < 60
            ? t('app.monitoring.minutes', { count: minutes })
            : hours < 48
              ? t('app.monitoring.hours', { count: hours })
              : t('app.monitoring.days', { count: Math.floor(hours / 24) });
      tone = fresh.stale ? 'stale' : 'ok';
    }
  }
  return (
    <div data-slot="rail-monitor" className="flex flex-col gap-1 rounded-md border border-rail-border bg-rail-raised p-3">
      <p className="flex items-center gap-2 text-xs font-medium text-rail-fg">
        <span
          aria-hidden="true"
          className={cn(
            'size-2 shrink-0 rounded-full',
            tone === 'ok' && 'animate-live bg-rail-ok',
            tone === 'stale' && 'bg-rail-alert',
            tone === 'idle' && 'bg-rail-muted',
          )}
        />
        Monitor
      </p>
      <p className={cn('text-xs text-pretty', tone === 'stale' ? 'font-medium text-rail-alert' : 'text-rail-muted')}>
        {tone === 'stale' ? `${text}. ${t('app.monitoring.stale')}` : text}
      </p>
    </div>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 rounded-sm text-base font-semibold text-rail-fg" aria-label={t('nav.home')}>
      <span className="grid size-7 place-items-center rounded-md bg-rail-raised ring-1 ring-rail-border">
        <img src="/favicon.svg" alt="" className="size-4.5" />
      </span>
      <span className="font-display tracking-tight">{t('common.appName')}</span>
    </Link>
  );
}

/** The slim bar over the console's content (from 1024 px): where you are, the network and the way to the other one. */
function TopBar({ location }: { location: string }) {
  const section = NAV.find((item) => item.match(location));
  return (
    <div className="hidden h-12 items-center justify-between gap-4 border-b border-border bg-surface px-6 lg:flex print:hidden">
      <p className="flex min-w-0 items-center gap-2 text-sm text-muted">
        <span>Console</span>
        <span aria-hidden="true" className="text-border-strong">/</span>
        <span className="truncate font-medium text-foreground">{section?.label ?? t('common.appName')}</span>
      </p>
      <div className="flex items-center gap-3 text-xs text-muted">
        <span>{t('common.neverSeedPhrase')}</span>
        {IS_DEVNET ? (
          <a href={MAINNET_SITE_URL} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 font-medium text-foreground hover:bg-subtle">
            <GlobeIcon aria-hidden="true" className="size-3.5" />
            {t('nav.tryMainnet')}
          </a>
        ) : (
          <a href={TESTNET_SITE_URL} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 font-medium text-foreground hover:bg-subtle">
            <FlaskConicalIcon aria-hidden="true" className="size-3.5" />
            {t('nav.tryTestnet')}
          </a>
        )}
      </div>
    </div>
  );
}

/** The console shell: a dark rail (sidebar from 1024 px, a top bar with a scrolling nav below), then the page. */
function Console({ location, children }: { location: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      {/* The rail's column stretches with the page; the header inside it stays in view (sticky) from 1024 px. */}
      <div className="bg-rail lg:border-r lg:border-rail-border print:hidden">
      <header className="flex flex-col text-rail-fg lg:sticky lg:top-0 lg:h-dvh">
        <div className="flex items-center justify-between gap-3 px-4 pt-3 lg:px-5 lg:pt-5">
          <Brand />
          <span className="lg:hidden">
            <NetworkPill />
          </span>
        </div>
        <nav aria-label={t('nav.label')} className="scrollbar-none overflow-x-auto px-2 pt-2 pb-3 lg:mt-6 lg:overflow-visible lg:px-3 lg:pb-0">
          <p className="hidden px-3 pb-2 text-xs font-medium text-rail-muted lg:block">Workspace</p>
          <NavLinks location={location} />
        </nav>
        <div className="mt-auto hidden flex-col gap-3 p-4 lg:flex">
          <RailMonitor />
          <div className="flex items-center justify-between gap-2 px-1">
            <NetworkPill />
            <span className="text-xs text-rail-muted">{IS_DEVNET ? t('common.devnetNote').replace(/\.$/, '') : 'Real SOL'}</span>
          </div>
        </div>
      </header>
      </div>
      <div className="flex min-w-0 flex-col">
        <TopBar location={location} />
        <main id="main" tabIndex={-1} className="flex w-full flex-1 flex-col px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10">
          {children}
        </main>
        <SiteFooter />
      </div>
    </div>
  );
}

/** Page frame: skip link, then the marketing frame on `/` or the console shell everywhere else. Pages render their own <h1>. */
export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const skip = (
    <a
      href="#main"
      className="sr-only rounded-md bg-surface px-4 py-2 text-sm font-medium text-foreground shadow-md focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
    >
      {t('common.skipToContent')}
    </a>
  );
  if (location === '/') {
    return (
      <div className="flex min-h-dvh flex-col">
        {skip}
        <SiteHeader />
        <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6 sm:py-12">
          {children}
        </main>
        <SiteFooter />
      </div>
    );
  }
  return (
    <>
      {skip}
      <Console location={location}>{children}</Console>
    </>
  );
}
