import type { Cluster } from '@stakeward/core';
import { FlaskConicalIcon, GlobeIcon, KeyRoundIcon, PlayIcon } from 'lucide-react';
import { Link } from 'wouter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MAINNET_SITE_URL, TESTNET_SITE_URL } from '@/config';
import { t, type MessageKey } from '@/i18n';

const TRUST: readonly MessageKey[] = ['landing.points.free', 'landing.points.noCustody', 'common.neverSeedPhrase'];

/*
 * v13 "Tbilisi": the carved wooden balcony, the variant's one signature drawing. Two SVG bands (the carved valance on
 * top, the railing with its balusters and drops below) frame the statement of the lock rule. Patterns tile across any
 * width, so the carving keeps its proportions from 360 px up. Decorative: aria-hidden, the words carry the meaning.
 */
function Valance() {
  return (
    <svg aria-hidden="true" focusable="false" className="block h-12 w-full" height="48">
      <defs>
        <pattern id="v13-valance" x="50%" width="32" height="48" patternUnits="userSpaceOnUse">
          {/* A carved board: pointed scallops, a pierced quatrefoil in each, a turned drop between them. */}
          <path d="M0 9 H32 V20 C28 20 24 22 16 36 C8 22 4 20 0 20 Z" className="fill-wood" />
          <circle cx="16" cy="20" r="3" className="fill-background" />
          <circle cx="16" cy="14.5" r="1.6" className="fill-background" />
          <circle cx="11" cy="18" r="1.4" className="fill-background" />
          <circle cx="21" cy="18" r="1.4" className="fill-background" />
          <rect x="-1" y="20" width="2" height="16" className="fill-wood" />
          <circle cx="0" cy="40" r="3.5" className="fill-wood" />
          <rect x="31" y="20" width="2" height="16" className="fill-wood" />
          <circle cx="32" cy="40" r="3.5" className="fill-wood" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="100%" height="48" fill="url(#v13-valance)" />
      <rect x="0" y="0" width="100%" height="9" rx="1" className="fill-wood" />
      <rect x="0" y="0" width="6" height="48" className="fill-wood" />
      <rect x="100%" y="0" width="6" height="48" transform="translate(-6 0)" className="fill-wood" />
    </svg>
  );
}

function Railing() {
  return (
    <svg aria-hidden="true" focusable="false" className="block h-20 w-full" height="80">
      <defs>
        <pattern id="v13-railing" x="50%" width="40" height="80" patternUnits="userSpaceOnUse">
          {/* One carved panel: a pierced lozenge with a brick boss, quarter rosettes in the corners, a post at each edge. */}
          <rect x="-1.5" y="8" width="3" height="50" className="fill-wood" />
          <path d="M20 13 L35 33 L20 53 L5 33 Z" fill="none" strokeWidth="3" className="stroke-wood" />
          <path d="M20 21 L29 33 L20 45 L11 33 Z" className="fill-wood-soft" />
          <circle cx="20" cy="33" r="3.5" className="fill-brick" />
          <path d="M1.5 8 A9 9 0 0 0 10.5 17" fill="none" strokeWidth="2" className="stroke-wood" />
          <path d="M38.5 8 A9 9 0 0 1 29.5 17" fill="none" strokeWidth="2" className="stroke-wood" />
          <path d="M1.5 58 A9 9 0 0 1 10.5 49" fill="none" strokeWidth="2" className="stroke-wood" />
          <path d="M38.5 58 A9 9 0 0 0 29.5 49" fill="none" strokeWidth="2" className="stroke-wood" />
          {/* The drop under each post. */}
          <path d="M-4.5 64 H4.5 L0 77 Z" className="fill-wood" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="100%" height="80" fill="url(#v13-railing)" />
      <rect x="0" y="0" width="100%" height="8" rx="1" className="fill-wood" />
      <rect x="0" y="58" width="100%" height="6" className="fill-wood" />
      {/* The corner posts, carried down from the window frame. */}
      <rect x="0" y="0" width="6" height="72" className="fill-wood" />
      <rect x="100%" y="0" width="6" height="72" transform="translate(-6 0)" className="fill-wood" />
    </svg>
  );
}

/** The lock rule inside the balcony: the two keys and what each can do while the lock holds. */
function KeysInBalcony() {
  return (
    <div className="flex flex-col gap-4 border-x-[6px] border-wood bg-surface px-4 py-5 sm:px-6 sm:py-6">
      <p className="font-display text-lg font-semibold text-balance">While the lock holds</p>
      <dl className="flex flex-col gap-4">
        <div className="flex gap-3">
          <dt className="flex w-28 shrink-0 items-start gap-2 text-sm font-semibold">
            <KeyRoundIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted" />
            {t('common.roles.main')}
          </dt>
          <dd className="text-sm text-pretty">Can stop staking, move or split the stake. Cannot withdraw a single lamport.</dd>
        </div>
        <div className="flex gap-3">
          <dt className="flex w-28 shrink-0 items-start gap-2 text-sm font-semibold">
            <KeyRoundIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brick" />
            {t('common.roles.second')}
          </dt>
          <dd className="text-sm text-pretty">Signs together with the main key to withdraw or rescue. Alone, it cannot move your SOL.</dd>
        </div>
      </dl>
      <p className="border-t border-border pt-4 text-base font-semibold text-pretty">{t('landing.protects.thief')}</p>
    </div>
  );
}

/**
 * The top of the landing page: what Stakeward does, the two ways in, and the balcony with the lock rule. "Check my
 * stake" is the page's one primary button: look first, connect later (UX rule 1).
 */
export function Hero({ cluster }: { cluster: Cluster }) {
  const devnet = cluster === 'devnet';
  return (
    <section aria-labelledby="landing-title" className="grid items-start gap-8 lg:grid-cols-12 lg:gap-x-12 lg:gap-y-6">
      <div className="flex flex-col gap-6 lg:col-span-7">
        <p data-slot="network" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          <Badge tone="outline">
            <GlobeIcon aria-hidden="true" />
            {t(devnet ? 'landing.network.devnet' : 'landing.network.mainnet')}
          </Badge>
          <span className={devnet ? 'md:hidden' : undefined}>{t(devnet ? 'landing.network.devnetNote' : 'landing.network.mainnetNote')}</span>
        </p>
        <h1 id="landing-title" className="text-3xl text-balance sm:text-4xl">
          {t('landing.title')}
        </h1>
        <p className="max-w-prose text-base text-pretty text-muted sm:text-lg">{t('landing.lead')}</p>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 min-[400px]:flex-row">
            <Button asChild size="lg">
              <Link href="/app">{t('landing.checkStake')}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/protect">{t('landing.protectStake')}</Link>
            </Button>
          </div>
          <p className="text-sm text-muted">{t('landing.checkStakeHint')}</p>
        </div>
      </div>
      <figure className="lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1 lg:mt-14" aria-label="The lock rule">
        <Valance />
        <KeysInBalcony />
        <Railing />
      </figure>
      <div className="flex flex-col gap-4 lg:col-span-7">
        <ul className="flex flex-col gap-1 border-t border-border pt-4 text-sm sm:flex-row sm:flex-wrap sm:gap-x-6">
          {TRUST.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
        <div className="flex flex-col items-start gap-1">
          <Button asChild variant="link" className="min-h-11 px-0">
            <Link href="/demo">
              <PlayIcon aria-hidden="true" />
              {t('landing.demoLink')}
            </Link>
          </Button>
          {devnet ? (
            <Button asChild variant="link" className="min-h-11 px-0">
              <a href={MAINNET_SITE_URL}>
                <GlobeIcon aria-hidden="true" />
                {t('landing.tryMainnet')}
              </a>
            </Button>
          ) : (
            <Button asChild variant="link" className="min-h-11 px-0">
              <a href={TESTNET_SITE_URL}>
                <FlaskConicalIcon aria-hidden="true" />
                {t('landing.tryTestnet')}
              </a>
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
