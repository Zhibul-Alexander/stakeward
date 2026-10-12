import type { Cluster } from '@stakeward/core';
import { ExternalLinkIcon, FlaskConicalIcon, GlobeIcon, PlayIcon } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { explorerUrl, MAINNET_SITE_URL, TESTNET_SITE_URL } from '@/config';
import { t } from '@/i18n';
import { CHECKS, HERO_CHECK, RUNS, SIGNATURES } from './evidence.ts';
import { Outcome, shortSignature } from './Record.tsx';

const LINK_CLASS = 'rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover';

/**
 * The top of the landing page (v14 "Evidence"): the product's main claim as the h1, and beside it the mainnet
 * transaction that tested it. "Check my stake" stays the page's one primary button: look first (UX rule 1).
 */
export function Hero({ cluster }: { cluster: Cluster }) {
  const devnet = cluster === 'devnet';
  const check = CHECKS[HERO_CHECK];
  const signature = SIGNATURES[HERO_CHECK]?.mainnet;
  return (
    <section aria-labelledby="landing-title" className="flex flex-col gap-6 sm:gap-8">
      <div className="flex max-w-4xl flex-col gap-4">
        <p data-slot="network" className="text-sm text-muted">
          {t(devnet ? 'landing.network.devnet' : 'landing.network.mainnet')}
          {'. '}
          {t(devnet ? 'landing.network.devnetNote' : 'landing.network.mainnetNote')}
        </p>
        <h1 id="landing-title" className="text-3xl text-balance sm:text-4xl">
          A thief with your main key cannot withdraw your staked SOL.
        </h1>
      </div>
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
      <div className="flex flex-col gap-5 sm:gap-6">
        <div className="flex max-w-prose flex-col gap-3 text-base text-pretty sm:text-lg">
          <p>
            Stakeward turns on the lock that every Solana stake account already has, and makes a second key you hold its
            keeper. Your SOL stays in your stake accounts and keeps earning.
          </p>
          <p className="text-muted">Free apart from network fees. No program of its own. It never asks for your seed phrase.</p>
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
        </div>
        <ul className="flex flex-col gap-2 text-sm">
          <li>
            <Link href="/demo" className={LINK_CLASS}>
              <PlayIcon aria-hidden="true" className="mr-1.5 inline size-4 align-text-bottom" />
              {t('landing.demoLink')}
            </Link>
          </li>
          <li>
            {devnet ? (
              <a href={MAINNET_SITE_URL} className={LINK_CLASS}>
                <GlobeIcon aria-hidden="true" className="mr-1.5 inline size-4 align-text-bottom" />
                {t('landing.tryMainnet')}
              </a>
            ) : (
              <a href={TESTNET_SITE_URL} className={LINK_CLASS}>
                <FlaskConicalIcon aria-hidden="true" className="mr-1.5 inline size-4 align-text-bottom" />
                {t('landing.tryTestnet')}
              </a>
            )}
          </li>
        </ul>
      </div>

      {check === undefined || signature === undefined ? null : (
        <figure
          aria-labelledby="hero-proof-title"
          data-slot="hero-proof"
          className="flex flex-col self-start rounded-lg border border-border-strong bg-surface"
        >
          <figcaption className="flex flex-col gap-1 border-b border-border px-5 py-4">
            <p id="hero-proof-title" className="text-base font-semibold">
              {`Tested on Solana mainnet, ${RUNS.mainnet.date}`}
            </p>
            <p className="text-sm text-muted">A real stake account was locked with a second key. Then the main key alone tried to empty it.</p>
          </figcaption>
          <dl className="flex flex-col divide-y divide-border text-sm">
            <div className="flex flex-col gap-1 px-5 py-3">
              <dt className="text-muted">{`Check ${check.id}: what was tried`}</dt>
              <dd className="text-base text-pretty">{check.tried}</dd>
            </div>
            <div className="flex flex-col gap-1 px-5 py-3">
              <dt className="text-muted">What the network answered</dt>
              <dd className="flex flex-col gap-0.5">
                <Outcome check={check} />
                <span>Error code 1. The balance did not change.</span>
              </dd>
            </div>
            <div className="flex flex-col gap-1 px-5 py-3">
              <dt className="text-muted">The transaction</dt>
              <dd>
                <a
                  href={explorerUrl('tx', signature, 'mainnet')}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Mainnet transaction ${shortSignature(signature)} ${t('common.opensInNewTab')}`}
                  className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
                >
                  <span className="truncate font-mono text-sm">{`${signature.slice(0, 16)}…${signature.slice(-6)}`}</span>
                  <ExternalLinkIcon aria-hidden="true" className="size-4 shrink-0" />
                </a>
              </dd>
            </div>
            <div className="flex flex-col gap-1 px-5 py-3">
              <dt className="text-muted">Repeated</dt>
              <dd className="text-pretty">{`On devnet (${RUNS.devnet.date}) and in LiteSVM, with the same stake program binary.`}</dd>
            </div>
          </dl>
          <p className="border-t border-border px-5 py-3 text-sm">
            <a href="#record" className="rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover">
              {`See the other ${String(Object.keys(CHECKS).length - 1)} checks below`}
            </a>
          </p>
        </figure>
      )}
      </div>
    </section>
  );
}
