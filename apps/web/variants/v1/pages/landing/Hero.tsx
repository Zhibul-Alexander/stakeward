import type { Cluster } from '@stakeward/core';
import { CheckIcon, FlaskConicalIcon, GlobeIcon, LockKeyholeIcon, PlayIcon } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { MAINNET_SITE_URL, TESTNET_SITE_URL } from '@/config';
import { t, type MessageKey } from '@/i18n';

const TRUST: readonly MessageKey[] = ['landing.points.free', 'landing.points.noCustody', 'common.neverSeedPhrase'];
const GUARDED: readonly MessageKey[] = [
  'landing.protects.needsSecond.withdraw',
  'landing.protects.needsSecond.owner',
  'landing.protects.needsSecond.lock',
];

/**
 * Vault hero: a confident statement on the left and, beside it, a "statement of protection" set like a safe-deposit
 * receipt: what the lock guards, who must sign, and the house terms. "Check my stake" stays the page's one primary
 * button (look first, connect later: UX rule 1).
 */
export function Hero({ cluster }: { cluster: Cluster }) {
  const devnet = cluster === 'devnet';
  return (
    <section
      aria-labelledby="landing-title"
      className="grid gap-10 border-b border-border pb-12 sm:pb-16 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-center lg:gap-16"
    >
      <div className="flex flex-col gap-6 sm:gap-8">
        <div className="flex flex-col gap-4 sm:gap-5">
          <p data-slot="network" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <GlobeIcon aria-hidden="true" className="size-4 text-primary" strokeWidth={1.5} />
            <span className="smallcaps font-medium text-foreground">
              {t(devnet ? 'landing.network.devnet' : 'landing.network.mainnet')}
            </span>
            <span className={devnet ? 'md:hidden' : undefined}>{t(devnet ? 'landing.network.devnetNote' : 'landing.network.mainnetNote')}</span>
          </p>
          <h1 id="landing-title" className="text-3xl text-balance sm:text-4xl">
            {t('landing.title')}
          </h1>
          <p className="max-w-[34rem] font-display text-lg text-pretty text-muted sm:text-xl">{t('landing.lead')}</p>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex gap-3 *:flex-1 *:px-3 sm:*:flex-none sm:*:px-7">
            <Button asChild size="lg">
              <Link href="/app">{t('landing.checkStake')}</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/protect">{t('landing.protectStake')}</Link>
            </Button>
          </div>
          <p className="text-sm text-muted">{t('landing.checkStakeHint')}</p>
        </div>
        <div className="flex flex-col items-start gap-1">
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

      {/* The receipt. One slow reveal on load: the page's only unprompted motion. */}
      <div className="cert motion-safe:animate-vault-open rounded-sm bg-surface p-1.5 shadow-lg">
        <div className="flex flex-col gap-5 border border-border px-5 py-6 sm:px-8 sm:py-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <p className="smallcaps text-sm font-medium text-primary">Statement of protection</p>
              <p className="font-display text-xl">{t('landing.protects.needsSecondTitle')}</p>
            </div>
            <span
              aria-hidden="true"
              className="flex size-12 shrink-0 items-center justify-center rounded-full border border-seal text-primary outline outline-1 outline-offset-2 outline-seal/60"
            >
              <LockKeyholeIcon className="size-5" strokeWidth={1.25} />
            </span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-foreground/60">
                <th scope="col" className="smallcaps pb-1.5 text-left font-medium text-muted">
                  Action
                </th>
                <th scope="col" className="smallcaps pb-1.5 text-right font-medium text-muted">
                  Co-signed by
                </th>
              </tr>
            </thead>
            <tbody>
              {GUARDED.map((key) => (
                <tr key={key} className="border-b border-border last:border-b-0">
                  <td className="py-2.5 pr-3 text-pretty">{t(key)}</td>
                  <td className="py-2.5 text-right align-top whitespace-nowrap text-primary">
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <LockKeyholeIcon aria-hidden="true" className="size-3.5" />
                      {t('common.roles.second')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-y-[3px] border-double border-seal py-3 font-display text-lg text-pretty italic">
            {t('landing.protects.thief')}
          </p>
          <ul className="flex flex-col gap-2 text-sm">
            {TRUST.map((key) => (
              <li key={key} className="flex items-start gap-2.5">
                <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
