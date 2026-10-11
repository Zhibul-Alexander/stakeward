import type { Cluster } from '@stakeward/core';
import { FlaskConicalIcon, GlobeIcon, PlayIcon } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { MAINNET_SITE_URL, TESTNET_SITE_URL } from '@/config';
import { t, type MessageKey } from '@/i18n';
import { KeyDiagram } from './KeyDiagram.tsx';

const TRUST: readonly MessageKey[] = ['landing.points.free', 'landing.points.noCustody', 'common.neverSeedPhrase'];

/**
 * v10 hero: one headline, the two ways in, then the drawing that explains the product (KeyDiagram). The words stay
 * short; the diagram carries the mechanism. "Check my stake" is the page's one filled button (UX rule 1).
 */
export function Hero({ cluster }: { cluster: Cluster }) {
  const devnet = cluster === 'devnet';
  return (
    <section aria-labelledby="landing-title" className="flex flex-col gap-8 sm:gap-10">
      <div className="flex flex-col gap-5 sm:gap-6">
        <p data-slot="network" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          <span className="inline-flex items-center gap-1.5 rounded-sm border border-line px-2 py-0.5 font-display text-xs font-medium text-foreground">
            <GlobeIcon aria-hidden="true" className="size-3.5" />
            {t(devnet ? 'landing.network.devnet' : 'landing.network.mainnet')}
          </span>
          <span className={devnet ? 'md:hidden' : undefined}>{t(devnet ? 'landing.network.devnetNote' : 'landing.network.mainnetNote')}</span>
        </p>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-end lg:gap-12">
          <h1 id="landing-title" className="font-display text-3xl text-balance sm:text-display">
            {t('landing.title')}
          </h1>
          <div className="flex flex-col gap-4">
            <p className="text-base text-pretty text-muted sm:text-lg">{t('landing.lead')}</p>
            <div className="flex flex-col gap-2">
              <div className="flex gap-3 *:flex-1 *:px-3 sm:*:flex-none sm:*:px-6">
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
        </div>
      </div>

      <KeyDiagram />

      <div className="flex flex-col gap-4 border-t border-border pt-5 sm:flex-row sm:items-start sm:justify-between">
        <ul className="flex flex-col gap-1.5 text-sm sm:flex-row sm:flex-wrap sm:gap-x-6">
          {TRUST.map((key) => (
            <li key={key} className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rotate-45 bg-accent" />
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <Button asChild variant="link" className="w-fit">
            <Link href="/demo">
              <PlayIcon aria-hidden="true" />
              {t('landing.demoLink')}
            </Link>
          </Button>
          {devnet ? (
            <Button asChild variant="link" className="w-fit">
              <a href={MAINNET_SITE_URL}>
                <GlobeIcon aria-hidden="true" />
                {t('landing.tryMainnet')}
              </a>
            </Button>
          ) : (
            <Button asChild variant="link" className="w-fit">
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
