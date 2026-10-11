import type { Cluster } from '@stakeward/core';
import {
  BellRingIcon,
  CheckIcon,
  FlaskConicalIcon,
  GlobeIcon,
  LayoutDashboardIcon,
  LifeBuoyIcon,
  PlayIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'wouter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MAINNET_SITE_URL, TESTNET_SITE_URL } from '@/config';
import { t, type MessageKey } from '@/i18n';

const TRUST: readonly MessageKey[] = ['landing.points.free', 'landing.points.noCustody', 'common.neverSeedPhrase'];

type MockRow = { address: string; sol: string; status: MessageKey; icon: LucideIcon; tone: string; note: string };

/** Sample rows of the preview: one of each status the console shows, with made-up addresses. */
const MOCK_ROWS: readonly MockRow[] = [
  { address: '7xKX…gAsU', sol: '1,250.5', status: 'status.protected', icon: ShieldCheckIcon, tone: 'bg-rail-ok/15 text-rail-ok', note: 'until 12 Apr 2027' },
  { address: '4GmQ…2Lpe', sol: '48', status: 'status.expiring', icon: ShieldAlertIcon, tone: 'bg-rail-warn/15 text-rail-warn', note: 'until 24 Oct 2026' },
  { address: '5Rz9…Vt9H', sol: '320', status: 'status.unprotected', icon: ShieldOffIcon, tone: 'bg-rail-muted/15 text-rail-fg', note: 'no lock' },
];

/** The ring of the preview: 80% of SOL locked, as SVG attributes (no inline style under the CSP). */
function MockRing() {
  return (
    <div className="relative grid size-20 shrink-0 place-items-center sm:size-24">
      <svg viewBox="0 0 120 120" className="absolute inset-0 size-full -rotate-90">
        <circle cx="60" cy="60" r="50" fill="none" strokeWidth="12" className="stroke-rail-border" />
        <circle
          cx="60"
          cy="60"
          r="50"
          fill="none"
          strokeWidth="12"
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray="79 100"
          className="animate-ring stroke-rail-accent"
        />
      </svg>
      <span className="relative font-display text-lg font-semibold tabular-nums sm:text-xl">80%</span>
    </div>
  );
}

/**
 * A preview of the accounts console built from real markup (not a picture): the rail, the protection ring, the KPIs,
 * the table of stake accounts and a Telegram alert. Dark in both themes, like the console's rail. One image for
 * assistive technology, named by its label; the sample text inside is hidden from it.
 */
function ConsolePreview() {
  return (
    <div
      role="img"
      aria-label="Preview of the Stakeward accounts console: 1,298.5 of 1,618.5 SOL protected, one lock ending soon, one account without a lock, and a Telegram alert."
      className="relative min-w-0 sm:mb-10"
    >
      <div aria-hidden="true" className="overflow-hidden rounded-xl bg-rail text-rail-fg shadow-lg ring-1 ring-rail-border">
        <div className="flex items-center justify-between gap-3 border-b border-rail-border px-4 py-2.5 text-xs">
          <span className="text-rail-muted">
            Console <span className="px-1">/</span> <span className="text-rail-fg">Accounts</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-rail-muted">
            <span className="size-1.5 animate-live rounded-full bg-rail-ok" />
            Last checked 1 min ago
          </span>
        </div>
        <div className="flex">
          <div className="hidden flex-col gap-1 border-r border-rail-border p-2 sm:flex">
            {[LayoutDashboardIcon, ShieldCheckIcon, LifeBuoyIcon, BellRingIcon].map((Icon, index) => (
              <span
                key={index}
                className={
                  index === 0
                    ? 'grid size-8 place-items-center rounded-md bg-rail-raised text-rail-accent'
                    : 'grid size-8 place-items-center rounded-md text-rail-muted'
                }
              >
                <Icon className="size-4" />
              </span>
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3 p-3 sm:p-4 sm:pb-12">
            <div className="flex items-center gap-4 rounded-lg border border-rail-border bg-rail-raised p-3">
              <MockRing />
              <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div className="col-span-2">
                  <p className="text-rail-muted">SOL protected</p>
                  <p className="font-display text-lg font-semibold tabular-nums sm:text-xl">
                    1,298.5 <span className="text-sm font-medium text-rail-muted">/ 1,618.5</span>
                  </p>
                </div>
                <div>
                  <p className="text-rail-muted">Accounts</p>
                  <p className="font-display text-base font-semibold tabular-nums">2 / 3</p>
                </div>
                <div>
                  <p className="text-rail-muted">{t('status.expiring')}</p>
                  <p className="font-display text-base font-semibold text-rail-warn tabular-nums">1</p>
                </div>
              </div>
            </div>
            <div className="overflow-hidden rounded-lg border border-rail-border">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 bg-rail-raised px-3 py-1.5 text-xs text-rail-muted">
                <span>Status and account</span>
                <span>Balance</span>
              </div>
              {MOCK_ROWS.map(({ address, sol, status, icon: Icon, tone, note }) => (
                <div key={address} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-rail-border px-3 py-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium ${tone}`}>
                      <Icon className="size-3" />
                      {t(status)}
                    </span>
                    <span className="font-mono text-xs">{address}</span>
                    <span className="hidden text-xs text-rail-muted sm:inline">{note}</span>
                  </div>
                  <span className="font-display text-sm font-semibold tabular-nums">{sol} SOL</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* The alert a thief sets off: the monitoring half of the product, overlapping the console's corner. */}
      <div
        aria-hidden="true"
        className="relative mx-3 -mt-6 flex items-start gap-3 rounded-lg border border-border bg-surface-raised p-3 text-xs shadow-lg sm:absolute sm:-right-4 sm:-bottom-10 sm:mx-0 sm:mt-0 sm:w-80"
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-danger-soft text-danger">
          <BellRingIcon className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="font-medium text-foreground">Telegram alert</p>
          <p className="text-pretty text-muted">
            Stake 7xK…AsU was deactivated. Your SOL cannot be withdrawn without the second key.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * The top of the landing page: which network this site works on, what Stakeward does in one sentence, the two ways in,
 * and beside them a preview of the console. "Check my stake" is the page's one primary button: look first, connect
 * later (UX rule 1).
 */
export function Hero({ cluster }: { cluster: Cluster }) {
  const devnet = cluster === 'devnet';
  return (
    <section
      aria-labelledby="landing-title"
      className="grid items-center gap-10 sm:gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-14"
    >
      <div className="flex min-w-0 flex-col gap-5 sm:gap-6">
        <div className="flex max-w-prose flex-col gap-3 sm:gap-4">
          <p data-slot="network" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted sm:text-sm">
            <Badge tone="outline">
              <GlobeIcon aria-hidden="true" />
              {t(devnet ? 'landing.network.devnet' : 'landing.network.mainnet')}
            </Badge>
            <span>{t(devnet ? 'landing.network.devnetNote' : 'landing.network.mainnetNote')}</span>
          </p>
          <h1 id="landing-title" className="text-3xl font-semibold text-balance sm:text-5xl sm:leading-[1.05]">
            {t('landing.title')}
          </h1>
          <p className="text-base text-pretty text-muted sm:text-lg">{t('landing.lead')}</p>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex gap-3 *:flex-1 *:px-3 sm:*:flex-none sm:*:px-6">
            <Button asChild size="lg">
              <Link href="/app">{t('landing.checkStake')}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/protect">{t('landing.protectStake')}</Link>
            </Button>
          </div>
          <p className="text-sm text-muted">{t('landing.checkStakeHint')}</p>
          <div className="flex flex-col items-start gap-1">
            <Button asChild variant="link" className="h-8 w-fit">
              <Link href="/demo">
                <PlayIcon aria-hidden="true" />
                {t('landing.demoLink')}
              </Link>
            </Button>
            {devnet ? (
              <Button asChild variant="link" className="h-8 w-fit">
                <a href={MAINNET_SITE_URL}>
                  <GlobeIcon aria-hidden="true" />
                  {t('landing.tryMainnet')}
                </a>
              </Button>
            ) : (
              <Button asChild variant="link" className="h-8 w-fit">
                <a href={TESTNET_SITE_URL}>
                  <FlaskConicalIcon aria-hidden="true" />
                  {t('landing.tryTestnet')}
                </a>
              </Button>
            )}
          </div>
        </div>
        <ul className="flex flex-col gap-1.5 border-t border-border pt-4 text-sm">
          {TRUST.map((key) => (
            <li key={key} className="flex items-start gap-2">
              <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>
      </div>
      <ConsolePreview />
    </section>
  );
}
