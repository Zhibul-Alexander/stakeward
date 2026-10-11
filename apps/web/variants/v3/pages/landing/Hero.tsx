import type { Cluster } from '@stakeward/core';
import { CheckIcon, FlaskConicalIcon, GlobeIcon, PlayIcon } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { MAINNET_SITE_URL, TESTNET_SITE_URL } from '@/config';
import { t, type MessageKey } from '@/i18n';

const TRUST: readonly MessageKey[] = ['landing.points.free', 'landing.points.noCustody', 'common.neverSeedPhrase'];

/** The chapters of the long read below, in order: the cover's table of contents. */
const CONTENTS: readonly { href: `#${string}`; title: string }[] = [
  { href: '#threat', title: 'One hidden instruction' },
  { href: '#the-lock', title: 'A lock in every stake account' },
  { href: '#how-it-works', title: t('landing.how.title') },
  { href: '#cannot-do', title: t('landing.cannotDo.title') },
];

/**
 * Variant v3: the cover. The headline set as large as the screen allows, the standfirst, the two ways in, and on wide
 * screens a contents column for the story that follows. "Check my stake" stays the one primary button (UX rule 1).
 */
export function Hero({ cluster }: { cluster: Cluster }) {
  const devnet = cluster === 'devnet';
  return (
    <section aria-labelledby="landing-title" className="grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="flex min-w-0 flex-col gap-6 sm:gap-8">
        <p data-slot="network" className="sr-only">
          {devnet ? <FlaskConicalIcon aria-hidden="true" className="size-4 text-accent-ink" /> : <GlobeIcon aria-hidden="true" className="size-4" />}
          <span className="font-semibold text-foreground">{t(devnet ? 'landing.network.devnet' : 'landing.network.mainnet')}</span>
          <span>{t(devnet ? 'landing.network.devnetNote' : 'landing.network.mainnetNote')}</span>
        </p>
        <h1
          id="landing-title"
          className="animate-rise text-[3.4rem] leading-[0.92] tracking-[-0.03em] text-balance min-[420px]:text-[4.25rem] sm:text-[6rem] lg:text-mast"
        >
          {t('landing.title')}
        </h1>
        <p className="animate-rise delay-rise-1 max-w-[36rem] font-display text-[1.5rem] leading-[1.25] text-pretty italic sm:text-[2rem]">
          {t('landing.lead')}
        </p>
        <div className="animate-rise delay-rise-2 flex flex-col gap-3">
          <div className="flex flex-col gap-3 min-[400px]:flex-row min-[400px]:*:flex-1 sm:*:flex-none">
            <Button asChild size="lg">
              <Link href="/app">{t('landing.checkStake')}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/protect">{t('landing.protectStake')}</Link>
            </Button>
          </div>
          <p className="text-sm text-muted">{t('landing.checkStakeHint')}</p>
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
      </div>
      <aside aria-label="In this story" className="flex flex-col gap-8 border-t border-rule pt-4 lg:mt-12 lg:border-t-0 lg:border-l lg:border-border lg:pt-0 lg:pl-6">
        <nav aria-label="Chapters">
          <p className="font-display text-[1.5rem] leading-none italic">In this story</p>
          <ol className="mt-4 flex flex-col">
            {CONTENTS.map(({ href, title }, index) => (
              <li key={href} className="border-b border-border last:border-b-0">
                <a href={href} className="group grid grid-cols-[2rem_minmax(0,1fr)] items-baseline gap-2 rounded-sm py-2.5 text-sm">
                  <span className="font-display text-[1.75rem] leading-none text-accent tabular-nums">{index + 1}</span>
                  <span className="font-medium group-hover:underline group-hover:decoration-accent group-hover:underline-offset-4">{title}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <ul className="flex flex-col gap-2 text-sm">
          {TRUST.map((key) => (
            <li key={key} className="flex items-start gap-2">
              <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>
      </aside>
    </section>
  );
}
