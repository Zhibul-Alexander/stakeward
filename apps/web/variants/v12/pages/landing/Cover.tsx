import type { Cluster } from '@stakeward/core';
import { FlaskConicalIcon, GlobeIcon, PlayIcon } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { MAINNET_SITE_URL, TESTNET_SITE_URL } from '@/config';
import { t } from '@/i18n';
import { PROCEDURES, TONE_TEXT } from './procedures.ts';

/**
 * v12 cover: what Stakeward is in two sentences, the two ways in, and beside it the situations index: a reader who
 * arrives with a stolen key finds P1 before reading anything else.
 */
export function Cover({ cluster }: { cluster: Cluster }) {
  const devnet = cluster === 'devnet';
  return (
    <section aria-labelledby="landing-title" className="grid gap-8 border-t-2 border-foreground pt-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12 lg:pt-8">
      <div className="flex min-w-0 flex-col gap-5">
        <p data-slot="network" className="text-sm text-muted">
          {t(devnet ? 'landing.network.devnet' : 'landing.network.mainnet')}. {t(devnet ? 'landing.network.devnetNote' : 'landing.network.mainnetNote')}
        </p>
        <h1 id="landing-title" className="text-3xl text-balance lg:text-4xl">
          Lock your staked SOL. Recover it without Stakeward.
        </h1>
        <div className="flex max-w-prose flex-col gap-3 text-base text-pretty sm:text-lg">
          <p>
            Every Solana stake account has a lock built in. Stakeward turns it on with a second key you hold, so a thief with
            your main key cannot withdraw.
          </p>
          <p className="text-muted">
            For each thing that can go wrong there is a numbered procedure below. Each one ends with Solana commands that
            work if this site is gone.
          </p>
        </div>
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
        <ul className="flex flex-col gap-1 text-sm">
          <li>{t('landing.points.free')}.</li>
          <li>{t('landing.points.noCustody')}.</li>
          <li>{t('common.neverSeedPhrase')}</li>
        </ul>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <Button asChild variant="link" className="w-fit px-0">
            <Link href="/demo">
              <PlayIcon aria-hidden="true" />
              {t('landing.demoLink')}
            </Link>
          </Button>
          {devnet ? (
            <Button asChild variant="link" className="w-fit px-0">
              <a href={MAINNET_SITE_URL}>
                <GlobeIcon aria-hidden="true" />
                {t('landing.tryMainnet')}
              </a>
            </Button>
          ) : (
            <Button asChild variant="link" className="w-fit px-0">
              <a href={TESTNET_SITE_URL}>
                <FlaskConicalIcon aria-hidden="true" />
                {t('landing.tryTestnet')}
              </a>
            </Button>
          )}
        </div>
      </div>

      <nav aria-labelledby="situations-title" className="flex flex-col self-start rounded-lg border border-border-strong bg-surface">
        <h2 id="situations-title" className="border-b border-border-strong px-4 py-3 text-base font-bold">
          Find your situation
        </h2>
        <ol role="list" className="flex flex-col divide-y divide-border">
          {PROCEDURES.map(({ id, code, situation, urgency }) => {
            const Icon = urgency.icon;
            return (
              <li key={id}>
                <a href={`#${id}`} className="group flex min-h-11 items-center gap-3 px-4 py-2 hover:bg-subtle">
                  <span className="w-7 shrink-0 font-mono text-sm font-semibold">{code}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-bold underline-offset-4 group-hover:underline">{situation}</span>
                    <span className={`inline-flex items-center gap-1 text-xs ${TONE_TEXT[urgency.tone]}`}>
                      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                      {urgency.word}
                    </span>
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
      </nav>
    </section>
  );
}
