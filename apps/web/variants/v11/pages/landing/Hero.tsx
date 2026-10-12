import type { Cluster } from '@stakeward/core';
import { FlaskConicalIcon, GlobeIcon, KeyRoundIcon, PlayIcon, ShieldCheckIcon, ShieldOffIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { MAINNET_SITE_URL, TESTNET_SITE_URL } from '@/config';
import { t } from '@/i18n';

/** One field of the specimen: the label, then the value before and after. */
function SpecimenRow({ label, before, after }: { label: string; before: ReactNode; after: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 border-t border-border py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)] sm:gap-x-5">
      <div className="col-span-2 pb-1 text-xs text-muted sm:col-span-1 sm:pb-0 sm:text-sm">{label}</div>
      <div className="min-w-0 text-sm text-muted">{before}</div>
      <div className="min-w-0 text-sm text-foreground">{after}</div>
    </div>
  );
}

/**
 * The specimen: one example stake account as its record, before and after Stakeward turns the lock on. Illustrative
 * only, so it is hidden from assistive technology and its caption says so; the sr-only line says the same facts.
 */
function Specimen() {
  const second = t('common.roles.second');
  const main = t('common.roles.main');
  return (
    <figure className="flex min-w-0 flex-col gap-3">
      <p className="sr-only">
        Example: before Stakeward, the main key alone can withdraw a stake account. After, a withdrawal also needs the
        second key until the lock date.
      </p>
      <div aria-hidden="true" className="rounded-record border border-border border-t-2 border-t-foreground/70 bg-surface px-4 pt-3 pb-1 sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pb-3">
          <p className="text-sm text-muted">
            Stake account <span className="font-mono text-foreground">Example…1</span>
          </p>
          <p className="font-serif text-2xl font-medium tabular-nums">1,250.5 SOL</p>
        </div>
        <div className="grid grid-cols-2 gap-x-4 border-t border-foreground/70 py-2 text-xs font-semibold sm:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)] sm:gap-x-5 sm:text-sm">
          <span className="hidden sm:block" />
          <span className="text-muted">Before</span>
          <span>With Stakeward</span>
        </div>
        <SpecimenRow
          label="Status"
          before={
            <span className="inline-flex items-center gap-1 rounded-sm border border-neutral-border bg-neutral-soft px-1.5 py-px text-xs font-semibold text-neutral">
              <ShieldOffIcon className="size-3.5" />
              {t('status.unprotected')}
            </span>
          }
          after={
            <span className="inline-flex items-center gap-1 rounded-sm border border-success-border bg-success-soft px-1.5 py-px text-xs font-semibold text-success">
              <ShieldCheckIcon className="size-3.5" />
              {t('status.protected')}
            </span>
          }
        />
        <SpecimenRow
          label="Withdrawal needs"
          before={<span className="font-semibold text-foreground">{main} alone</span>}
          after={
<span className="font-semibold">
              {main} and {second.toLowerCase()}
            </span>
          }
        />
        <SpecimenRow
          label="Locked until"
          before="No lock"
          after={<span className="font-serif text-lg leading-6 font-medium">12 April 2027</span>}
        />
        <SpecimenRow
          label={second}
          before="None"
          after={
            <span className="inline-flex items-center gap-1">
              <KeyRoundIcon className="size-3.5 shrink-0 text-muted" />
              Your wallet from another seed phrase
            </span>
          }
        />
        <SpecimenRow label="Thief with your main key" before="Withdraws it all" after="Can unstake or move it, gets no SOL" />
      </div>
      <figcaption className="text-xs text-muted">Example record. The account and date are made up; the rules are the stake program&apos;s own.</figcaption>
    </figure>
  );
}

/**
 * v11 hero: the claim on the left, the specimen record on the right (under it on a phone). "Check my stake" stays the
 * page's one primary button: look first, connect later (UX rule 1).
 */
export function Hero({ cluster }: { cluster: Cluster }) {
  const devnet = cluster === 'devnet';
  return (
    <section aria-labelledby="landing-title" className="grid items-start gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12">
      <div className="flex flex-col gap-5">
        <p data-slot="network" className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
          <GlobeIcon aria-hidden="true" className="size-4" />
          <span className="font-semibold text-foreground">{t(devnet ? 'landing.network.devnet' : 'landing.network.mainnet')}</span>
          <span>{t(devnet ? 'landing.network.devnetNote' : 'landing.network.mainnetNote')}</span>
        </p>
        <h1 id="landing-title" className="font-serif text-4xl font-medium text-balance sm:text-[3.5rem] sm:leading-[1.05]">
          {t('landing.title')}
        </h1>
        <p className="max-w-prose text-lg text-pretty text-muted">{t('landing.lead')}</p>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-3 *:flex-1 sm:*:flex-none">
            <Button asChild size="lg">
              <Link href="/app">{t('landing.checkStake')}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/protect">{t('landing.protectStake')}</Link>
            </Button>
          </div>
          <p className="text-sm text-muted">{t('landing.checkStakeHint')}</p>
        </div>
        <ul className="flex flex-col gap-1 border-t border-border pt-4 text-sm">
          <li>{t('landing.points.free')}.</li>
          <li>{t('landing.points.noCustody')}.</li>
          <li>{t('common.neverSeedPhrase')}</li>
        </ul>
        <div className="flex flex-col items-start gap-1">
          <Button asChild variant="link" className="h-10 px-0">
            <Link href="/demo">
              <PlayIcon aria-hidden="true" />
              {t('landing.demoLink')}
            </Link>
          </Button>
          {devnet ? (
            <Button asChild variant="link" className="h-10 px-0">
              <a href={MAINNET_SITE_URL}>
                <GlobeIcon aria-hidden="true" />
                {t('landing.tryMainnet')}
              </a>
            </Button>
          ) : (
            <Button asChild variant="link" className="h-10 px-0">
              <a href={TESTNET_SITE_URL}>
                <FlaskConicalIcon aria-hidden="true" />
                {t('landing.tryTestnet')}
              </a>
            </Button>
          )}
        </div>
      </div>
      <Specimen />
    </section>
  );
}
