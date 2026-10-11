import type { Cluster } from '@stakeward/core';
import { CheckIcon, FlaskConicalIcon, GlobeIcon, KeyRoundIcon, LockKeyholeIcon, PlayIcon, ShieldCheckIcon, SmileIcon } from 'lucide-react';
import { Link } from 'wouter';
import { StatusBadge } from '@/components/product/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MAINNET_SITE_URL, TESTNET_SITE_URL } from '@/config';
import { t, type MessageKey } from '@/i18n';
import { Helper } from './Section.tsx';

const TRUST: readonly MessageKey[] = ['landing.points.free', 'landing.points.noCustody', 'common.neverSeedPhrase'];

/** The picture beside the hero: two keys guarding one shielded stake. Decorative; the copy says the same in words. */
function HeroScene() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-sm animate-rise sm:max-w-md">
      <div className="relative flex flex-col items-center gap-6 overflow-hidden rounded-2xl border border-border bg-surface px-6 pt-10 pb-6 shadow-lg">
        <div className="relative flex size-40 items-center justify-center">
          <span className="absolute inset-0 animate-breathe rounded-full bg-mint" />
          <span className="absolute inset-5 rounded-full bg-surface/70" />
          <span className="relative flex size-24 items-center justify-center rounded-full bg-surface text-mint-ink shadow-md">
            <ShieldCheckIcon className="size-12" strokeWidth={2} />
          </span>
        </div>
        <div className="grid w-full grid-cols-2 gap-3">
          <div className="flex items-center gap-2 rounded-lg bg-sky px-3 py-2.5 text-sm font-bold text-sky-ink">
            <KeyRoundIcon className="size-4 shrink-0" />
            {t('common.roles.main')}
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-lilac px-3 py-2.5 text-sm font-bold text-lilac-ink">
            <LockKeyholeIcon className="size-4 shrink-0" />
            {t('common.roles.second')}
          </div>
        </div>
        <div className="flex w-full items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
          <span className="text-lg font-extrabold tabular-nums">320 SOL</span>
          <StatusBadge status="protected" size="md" />
        </div>
      </div>
    </div>
  );
}

/**
 * The top of the landing page: which network, what Stakeward does, and the two ways in. "Check my stake" is the
 * page's one primary button: look first, connect later (UX rule 1).
 */
export function Hero({ cluster }: { cluster: Cluster }) {
  const devnet = cluster === 'devnet';
  return (
    <section aria-labelledby="landing-title" className="grid items-center gap-10 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:gap-12">
      <div className="flex flex-col gap-6">
        <div className="flex max-w-prose animate-rise flex-col gap-4">
          <p data-slot="network" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted sm:text-sm">
            <Badge tone="outline" size="md">
              <GlobeIcon aria-hidden="true" />
              {t(devnet ? 'landing.network.devnet' : 'landing.network.mainnet')}
            </Badge>
            <span className={devnet ? 'md:hidden' : undefined}>{t(devnet ? 'landing.network.devnetNote' : 'landing.network.mainnetNote')}</span>
          </p>
          <h1 id="landing-title" className="text-3xl text-balance sm:text-4xl">
            {t('landing.title')}
          </h1>
          <p className="text-lg text-pretty text-muted">{t('landing.lead')}</p>
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/app">{t('landing.checkStake')}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/protect">{t('landing.protectStake')}</Link>
            </Button>
          </div>
          <Helper icon={SmileIcon} tone="mint">
            {t('landing.checkStakeHint')}
          </Helper>
          <div className="flex flex-col gap-2 pl-1">
            <Button asChild variant="link" className="w-fit px-0">
              <Link href="/demo">
                <PlayIcon aria-hidden="true" />
                {t('landing.demoLink')}
              </Link>
            </Button>
            {devnet ? (
              <Button asChild variant="link" className="w-fit px-0 text-left whitespace-normal">
                <a href={MAINNET_SITE_URL}>
                  <GlobeIcon aria-hidden="true" />
                  {t('landing.tryMainnet')}
                </a>
              </Button>
            ) : (
              <Button asChild variant="link" className="w-fit px-0 text-left whitespace-normal">
                <a href={TESTNET_SITE_URL}>
                  <FlaskConicalIcon aria-hidden="true" />
                  {t('landing.tryTestnet')}
                </a>
              </Button>
            )}
          </div>
        </div>
        <ul className="flex flex-wrap gap-2 text-sm">
          {TRUST.map((key) => (
            <li key={key} className="flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 font-medium shadow-sm">
              <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-full bg-mint text-mint-ink">
                <CheckIcon className="size-3.5" strokeWidth={3} />
              </span>
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>
      </div>
      <HeroScene />
    </section>
  );
}
