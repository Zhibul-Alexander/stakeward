import { FlaskConicalIcon, LifeBuoyIcon, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IS_DEVNET } from '@/config';
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
 * The site header (DECISIONS.md D109): the mark and name, the network on devnet (a badge and, from 768 px, what it
 * means), and two links: Rescue, for someone whose main key was just stolen, and the accounts page. Below 640 px the
 * links take a second row rather than hiding their words; the ghost padding is pulled back so the words line up with
 * the name above them.
 */
export function SiteHeader() {
  return (
    <header className="border-b border-border bg-background print:hidden">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/" className="flex items-center gap-2 rounded-sm text-base font-semibold" aria-label={t('nav.home')}>
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
            </>
          ) : null}
        </div>
        <nav aria-label={t('nav.label')} className="-ml-3 flex w-full items-center gap-2 sm:-mr-3 sm:ml-0 sm:w-auto">
          <NavLink href="/rescue" icon={LifeBuoyIcon}>
            {t('nav.rescue')}
          </NavLink>
          <NavLink href="/app">{t('nav.app')}</NavLink>
        </nav>
      </div>
    </header>
  );
}
