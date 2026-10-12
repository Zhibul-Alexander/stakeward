import type { Cluster } from '@stakeward/core';
import { CheckIcon, FlaskConicalIcon, GlobeIcon, PlayIcon } from 'lucide-react';
import { Link } from 'wouter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MAINNET_SITE_URL, TESTNET_SITE_URL } from '@/config';
import { t, type MessageKey } from '@/i18n';

const TRUST: readonly MessageKey[] = ['landing.points.free', 'landing.points.noCustody', 'common.neverSeedPhrase'];

/**
 * The top of the landing page: which network this site works on, what Stakeward does in one sentence, and the two
 * ways in. "Check my stake" is the page's one primary button: look first, connect later (UX rule 1). "Protect my
 * stake" is the outline alternative for whoever came to act. Its three parts arrive in reading order on load: the site's
 * one motion nobody triggers (D142).
 */
export function Hero({ cluster }: { cluster: Cluster }) {
  const devnet = cluster === 'devnet';
  return (
    <section aria-labelledby="landing-title" className="stagger-in flex flex-col gap-4 sm:gap-6">
      <div className="flex max-w-prose flex-col gap-3 sm:gap-4">
        <p data-slot="network" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted sm:text-sm">
          <Badge tone="outline">
            <GlobeIcon aria-hidden="true" />
            {t(devnet ? 'landing.network.devnet' : 'landing.network.mainnet')}
          </Badge>
          {/* From 1024 px the header says the devnet note in the same words, so the hero does not repeat it there. */}
          <span className={devnet ? 'lg:hidden' : undefined}>{t(devnet ? 'landing.network.devnetNote' : 'landing.network.mainnetNote')}</span>
        </p>
        <h1 id="landing-title" className="text-2xl text-balance sm:text-3xl">
          {t('landing.title')}
        </h1>
        <p className="text-pretty text-muted sm:text-lg">{t('landing.lead')}</p>
      </div>
      <div className="flex flex-col gap-3">
        {/* Side by side: below 640 px the two share the row equally, so both stand in the first screen. A translation too
            long for one row (D140) puts the second under the first instead of past the screen's edge. */}
        <div className="flex flex-wrap gap-3 *:flex-1 *:px-3 sm:*:flex-none sm:*:px-6">
          <Button asChild size="lg">
            <Link href="/app">{t('landing.checkStake')}</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/protect">{t('landing.protectStake')}</Link>
          </Button>
        </div>
        <p className="text-sm text-muted">{t('landing.checkStakeHint')}</p>
        {/* The demo and the other network's site: one row of small links under the buttons, not two more blocks. */}
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Button asChild variant="link" className="w-fit">
            <Link href="/demo">
              <PlayIcon aria-hidden="true" />
              {t('landing.demoLink')}
            </Link>
          </Button>
          {/* On mainnet, a way to try every flow with test SOL first, on the devnet copy of the site (D136). */}
          {/* On devnet, the way back to the real site. */}
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
      <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {TRUST.map((key) => (
          <li key={key} className="flex items-start gap-2">
            <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
