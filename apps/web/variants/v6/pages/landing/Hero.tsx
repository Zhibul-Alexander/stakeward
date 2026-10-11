import type { Cluster } from '@stakeward/core';
import { CheckIcon, FlaskConicalIcon, GlobeIcon, KeyRoundIcon, LockIcon, PlayIcon } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { MAINNET_SITE_URL, TESTNET_SITE_URL } from '@/config';
import { t, type MessageKey } from '@/i18n';

const TRUST: readonly MessageKey[] = ['landing.points.free', 'landing.points.noCustody', 'common.neverSeedPhrase'];

/** One key of the equation: a square tile, the role in poster type and one plain line under it. */
function KeyTile({ role, caption, inverted }: { role: string; caption: string; inverted: boolean }) {
  return (
    <div
      className={
        inverted
          ? 'flex min-h-36 flex-col justify-between gap-4 border-[3px] border-foreground bg-foreground p-3 text-background sm:min-h-44 sm:p-5'
          : 'flex min-h-36 flex-col justify-between gap-4 border-[3px] border-foreground bg-background p-3 text-foreground sm:min-h-44 sm:p-5'
      }
    >
      <KeyRoundIcon aria-hidden="true" className="size-7 sm:size-9" strokeWidth={2.5} />
      <div className="flex flex-col gap-1">
        <p className="font-display text-lg leading-none uppercase sm:text-2xl">{role}</p>
        <p className="text-xs leading-snug sm:text-sm">{caption}</p>
      </div>
    </div>
  );
}

/**
 * The landing hero as a poster: the statement set enormous across a visible column grid, then the mechanism as an
 * equation (Main key + Second key = locked stake) beside the two ways in. "Check my stake" stays the page's one filled
 * button (look first, UX rule 1).
 */
export function Hero({ cluster }: { cluster: Cluster }) {
  const devnet = cluster === 'devnet';
  return (
    <section aria-labelledby="landing-title" className="-mt-8 flex flex-col gap-8 sm:-mt-14 sm:gap-10">
      <div className="poster-grid -mx-4 flex flex-col gap-5 px-4 pt-6 pb-2 sm:-mx-6 sm:px-6 sm:pt-10">
        <p data-slot="network" className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="micro inline-flex items-center gap-1.5 bg-foreground px-2 py-1 text-background">
            <GlobeIcon aria-hidden="true" className="size-3.5" />
            {t(devnet ? 'landing.network.devnet' : 'landing.network.mainnet')}
          </span>
          <span className={devnet ? 'micro md:hidden' : 'micro'}>{t(devnet ? 'landing.network.devnetNote' : 'landing.network.mainnetNote')}</span>
        </p>
        <h1
          id="landing-title"
          className="max-w-[11ch] text-poster-sm text-balance uppercase sm:text-[5.5rem] sm:leading-[0.88] lg:text-poster"
        >
          {t('landing.title')}
        </h1>
      </div>

      <div className="grid gap-10 border-t-[6px] border-foreground pt-6 md:grid-cols-12 md:gap-x-6 md:pt-8">
        <div className="flex flex-col gap-6 md:col-span-5">
          <p className="text-lg leading-snug font-medium text-pretty sm:text-xl">{t('landing.lead')}</p>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-3 *:flex-1 *:px-3 sm:*:flex-none sm:*:px-7">
              <Button asChild size="lg">
                <Link href="/app">{t('landing.checkStake')}</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/protect">{t('landing.protectStake')}</Link>
              </Button>
            </div>
            <p className="text-sm text-muted">{t('landing.checkStakeHint')}</p>
          </div>
          <div className="flex flex-col items-start gap-2">
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

        {/* The mechanism as an equation. The signs are decoration; the words carry it. */}
        <div className="flex flex-col gap-3 md:col-span-7">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-4">
            <KeyTile role={t('common.roles.main')} caption="The wallet you stake from." inverted={false} />
            <span aria-hidden="true" className="font-display text-4xl leading-none">
              +
            </span>
            <KeyTile role={t('common.roles.second')} caption={t('landing.secondKey.differentSeed')} inverted />
          </div>
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-stretch gap-2 sm:gap-4">
            <span aria-hidden="true" className="flex items-center font-display text-4xl leading-none">
              =
            </span>
            <div className="flex min-w-0 flex-col gap-4 border-[3px] border-foreground bg-signal p-4 text-on-signal sm:p-5">
              <div className="flex items-end justify-between gap-3">
                <p className="font-display text-[1.75rem] leading-none tracking-tight uppercase sm:text-[3rem] lg:text-[3.5rem]">
                  {t('status.protected')}
                </p>
                <LockIcon aria-hidden="true" className="size-8 shrink-0 sm:size-12" strokeWidth={2.75} />
              </div>
              <div className="border-t-2 border-on-signal pt-2">
                <p className="max-w-[34ch] text-sm leading-snug font-semibold sm:text-base sm:leading-snug">{t('landing.protects.thief')}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ul className="grid border-y-2 border-foreground sm:grid-cols-3 sm:divide-x-2 sm:divide-foreground">
        {TRUST.map((key, index) => (
          <li
            key={key}
            className={
              index === 0
                ? 'flex items-start gap-2 py-3 text-sm font-semibold sm:px-4 sm:first:pl-0'
                : 'flex items-start gap-2 border-t-2 border-foreground py-3 text-sm font-semibold sm:border-t-0 sm:px-4'
            }
          >
            <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={3} />
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
