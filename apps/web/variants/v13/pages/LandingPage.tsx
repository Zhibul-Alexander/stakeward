import type { Cluster } from '@stakeward/core';
import { ExternalLinkIcon, LockIcon, TriangleAlertIcon } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Link } from 'wouter';
import { Page } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { CLUSTER, GATE_RESULTS_URL } from '@/config';
import { t, type Messages, type MessageKey } from '@/i18n';
import { MAX_RESCUE_ACCOUNTS } from '@/pages/rescue/wizard';
import { Hero } from './landing/Hero.tsx';
import { useHashTarget } from './landing/use-hash-target.ts';
import { LEARN_TABS, learnPathForHash } from './LearnPage.tsx';

/*
 * v13 "Tbilisi" landing. Each block has the shape its content needs (DIRECTION.md, RHYTHM 3): the split hero with the
 * balcony, a dated record of two stake thefts, the three steps as a ruled sequence, a two-sided ledger of what the lock
 * stops, the honest limit on a dark walnut band, the mechanism checks with their real results, what Stakeward cannot
 * do, the co-sign note, and the closing look. Anchors kept: #how-it-works, #protects, #second-key, #cannot-do,
 * #for-second-key.
 */

const LINK = 'inline-block py-3 rounded-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover';

function SectionTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="text-2xl text-balance sm:text-3xl">
      {children}
    </h2>
  );
}

/** Two real incidents from the project brief (CLAUDE.md section 1). Dates and amounts only, as reported. */
const THEFTS: readonly { date: string; who: string; amount: string; what: string }[] = [
  {
    date: '8 Sep 2025',
    who: 'SwissBorg',
    amount: '192,600 SOL',
    what: 'A hacked staking API inserted a hidden change of the withdraw key. MPC wallets did not stop it.',
  },
  {
    date: '31 Jan 2026',
    who: 'Step Finance',
    amount: '261,854 SOL',
    what: 'Another loss of staked SOL, months later.',
  },
];

function Thefts() {
  return (
    <section aria-labelledby="thefts-title" className="grid gap-6 lg:grid-cols-12 lg:gap-12">
      <div className="flex flex-col gap-3 lg:col-span-4">
        <SectionTitle id="thefts-title">Staked SOL has been stolen before</SectionTitle>
        <p className="text-base text-pretty text-muted">
          While a lock holds, changing the withdraw key needs the second key&apos;s signature too. A hidden change fails on
          the network.
        </p>
      </div>
      <ol className="flex flex-col divide-y divide-border border-y border-border lg:col-span-8">
        {THEFTS.map((theft) => (
          <li key={theft.who} className="grid gap-1 py-5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-6">
            <p className="text-sm text-muted tabular-nums">{theft.date}</p>
            <div className="flex flex-col gap-1">
              <p className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-display text-2xl tabular-nums">{theft.amount}</span>
                <span className="text-base font-semibold">{theft.who}</span>
              </p>
              <p className="max-w-prose text-sm text-pretty text-muted">{theft.what}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

const STEPS = ['step1', 'step2', 'step3'] as const;

function HowItWorks({ cluster }: { cluster: Cluster }) {
  return (
    <section id="how-it-works" aria-labelledby="how-it-works-title" className="flex scroll-mt-4 flex-col gap-6">
      <div className="flex max-w-prose flex-col gap-2">
        <SectionTitle id="how-it-works-title">{t('landing.how.title')}</SectionTitle>
        <p className="text-base text-pretty text-muted">{t('landing.how.intro')}</p>
      </div>
      <ol className="grid border-t-2 border-foreground md:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step} className="flex flex-col gap-2 border-b border-border py-5 md:border-b-0 md:py-6 md:pr-8 md:not-first:border-l md:not-first:pl-8">
            <span aria-hidden="true" className="font-display text-3xl text-muted tabular-nums">
              {index + 1}
            </span>
            <h3 className="text-lg font-semibold">{t(`landing.how.${step}.title`)}</h3>
            <p className="text-sm text-pretty">{t(`landing.how.${step}.body`)}</p>
          </li>
        ))}
      </ol>
      <p className="max-w-prose text-sm text-pretty text-muted">
        {t('landing.how.period')}
        {cluster === 'devnet' ? <span> {t('landing.how.periodDevnet')}</span> : null}
      </p>
    </section>
  );
}

const NEEDS_SECOND: readonly MessageKey[] = ['landing.protects.needsSecond.withdraw', 'landing.protects.needsSecond.owner', 'landing.protects.needsSecond.lock'];
const MAIN_ALONE: readonly MessageKey[] = [
  'landing.protects.mainAlone.deactivate',
  'landing.protects.mainAlone.redelegate',
  'landing.protects.mainAlone.split',
  'landing.protects.mainAlone.manager',
];

function Protects() {
  return (
    <section id="protects" aria-labelledby="protects-title" className="flex scroll-mt-4 flex-col gap-6">
      <SectionTitle id="protects-title">{t('landing.protects.title')}</SectionTitle>
      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-2">
        <div className="flex flex-col gap-3 bg-surface p-5 sm:p-6">
          <h3 className="flex items-center gap-2 text-base font-semibold text-success">
            <LockIcon aria-hidden="true" className="size-4" />
            {t('landing.protects.needsSecondTitle')}
          </h3>
          <ul className="flex flex-col gap-2 text-base">
            {NEEDS_SECOND.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-3 bg-background p-5 sm:p-6">
          <h3 className="text-base font-semibold">{t('landing.protects.mainAloneTitle')}</h3>
          <ul className="flex flex-col gap-2 text-base text-muted">
            {MAIN_ALONE.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** The honest limit (CLAUDE.md section 1), said before anyone picks a second key, on the page's one dark band. */
function HonestLimit() {
  return (
    <section
      id="second-key"
      aria-labelledby="second-key-title"
      className="grid scroll-mt-4 gap-6 rounded-xl bg-inverse p-6 text-on-inverse sm:p-10 lg:grid-cols-12 lg:gap-12"
    >
      <div className="flex flex-col gap-3 lg:col-span-7">
        <h2 id="second-key-title" className="flex items-center gap-2 text-base font-semibold">
          <TriangleAlertIcon aria-hidden="true" className="size-4" />
          {t('landing.secondKey.title')}
        </h2>
        <p className="font-display text-2xl text-balance sm:text-3xl">{t('components.risk.secondKeyCanFreeze')}</p>
        <p className="text-base text-pretty">{t('landing.secondKey.freeze')}</p>
      </div>
      <div className="flex flex-col gap-3 text-base lg:col-span-5 lg:pt-8">
        <ul className="flex list-disc flex-col gap-2 pl-5">
          <li className="text-pretty">{t('landing.secondKey.differentSeed')}</li>
          <li className="text-pretty">{t('landing.secondKey.apart')}</li>
        </ul>
        <p>
          <a href="/learn/faq#faq-good-second-key" className="inline-block rounded-sm py-3 font-semibold underline underline-offset-4">
            {t('landing.secondKey.more')}
          </a>
        </p>
      </div>
    </section>
  );
}

/** The results of scripts/gate.ts as recorded in docs/gate.md: real runs, linked to the record. */
const RUNS: readonly { where: string; result: string; note: string }[] = [
  { where: 'LiteSVM', result: '31 of 31', note: 'The stake program in a local test validator. The same run is a CI test.' },
  { where: 'Solana devnet', result: '28 of 28', note: 'Every check sent as a real transaction.' },
  { where: 'Solana mainnet', result: '8 of 8', note: 'A small unstaked account, 5 Oct 2026, all SOL withdrawn back.' },
];

function Checked() {
  return (
    <section aria-labelledby="checked-title" className="grid gap-6 lg:grid-cols-12 lg:gap-12">
      <div className="flex flex-col gap-3 lg:col-span-5">
        <SectionTitle id="checked-title">Checked on the real stake program</SectionTitle>
        <p className="text-base text-pretty text-muted">
          Before any screen was built, a script tried each rule: the main key alone withdrawing, handing the stake to a thief,
          moving the lock, and a rescue to a new wallet. Each run lists every transaction.
        </p>
        <p>
          <a href={GATE_RESULTS_URL} target="_blank" rel="noreferrer" className={LINK}>
            Read the results
            <span className="sr-only"> {t('common.opensInNewTab')}</span>
            <ExternalLinkIcon aria-hidden="true" className="ml-1 inline size-4 align-text-bottom" />
          </a>
        </p>
      </div>
      <dl className="flex flex-col lg:col-span-7">
        {RUNS.map((run) => (
          <div key={run.where} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 border-b border-border py-4 first:border-t">
            <dt className="text-base font-semibold">{run.where}</dt>
            <dd className="font-display text-2xl tabular-nums">
              {run.result}
              <span className="sr-only"> steps matched the expected result</span>
            </dd>
            <dd className="col-span-2 text-sm text-muted">{run.note}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

type CannotDoItem = keyof Messages['landing']['cannotDo']['items'];
const CANNOT: readonly CannotDoItem[] = ['scope', 'mainKeyActions', 'split', 'afterEnd', 'lostKey', 'freeze', 'sameSeed', 'newAccounts', 'cliKeys', 'alerts'];

function CannotDo() {
  return (
    <section id="cannot-do" aria-labelledby="cannot-do-title" className="flex scroll-mt-4 flex-col gap-6">
      <div className="flex max-w-prose flex-col gap-2">
        <SectionTitle id="cannot-do-title">{t('landing.cannotDo.title')}</SectionTitle>
        <p className="text-base text-pretty text-muted">{t('landing.cannotDo.intro')}</p>
      </div>
      <ul className="grid gap-x-12 md:grid-cols-2">
        {CANNOT.map((item) => (
          <li key={item} className="border-t border-border py-3 text-base text-pretty">
            {t(`landing.cannotDo.items.${item}`, { max: MAX_RESCUE_ACCOUNTS })}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CoSignNote() {
  return (
    <section
      id="for-second-key"
      aria-labelledby="for-second-key-title"
      className="flex scroll-mt-4 flex-col gap-2 rounded-lg border border-info-border bg-info-soft p-5 sm:p-6"
    >
      <h2 id="for-second-key-title" className="text-lg font-semibold text-info">
        {t('landing.coSign.title')}
      </h2>
      <p className="max-w-prose text-base text-pretty">{t('landing.coSign.body')}</p>
      <p>
        <a href="/learn/faq#faq-co-sign" className={LINK}>
          {t('landing.coSign.more')}
        </a>
      </p>
    </section>
  );
}

function Closing() {
  return (
    <div className="grid gap-10 border-t-2 border-foreground pt-8 lg:grid-cols-12 lg:gap-12">
      <section aria-labelledby="cta-title" className="flex flex-col items-start gap-3 lg:col-span-6">
        <h2 id="cta-title" className="text-2xl sm:text-3xl">
          {t('landing.cta.title')}
        </h2>
        <p className="max-w-prose text-base text-pretty text-muted">{t('landing.cta.body')}</p>
        <Button asChild size="lg" variant="outline" className="mt-2 w-full sm:w-auto">
          <Link href="/app">{t('landing.checkStake')}</Link>
        </Button>
      </section>
      <section aria-labelledby="learn-more-title" className="flex flex-col gap-3 lg:col-span-6">
        <h2 id="learn-more-title" className="text-lg font-semibold">
          {t('landing.learnMore.title')}
        </h2>
        <ul role="list" className="flex flex-col">
          {LEARN_TABS.map((id) => (
            <li key={id} className="border-b border-border first:border-t">
              <Link href={`/learn/${id}`} className="flex flex-col gap-0.5 rounded-sm py-3 hover:bg-subtle sm:flex-row sm:items-baseline sm:gap-4">
                <span className="w-24 shrink-0 text-base font-semibold text-primary underline underline-offset-4">{t(`learn.tabs.${id}`)}</span>
                <span className="text-sm text-muted">{t(`landing.learnMore.${id}`)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** `/`: composition and the old one-page hash redirects, as in src/pages/LandingPage.tsx. */
export function LandingPage({ cluster = CLUSTER }: { cluster?: Cluster | undefined }) {
  useHashTarget();
  useEffect(() => {
    const follow = () => {
      const moved = learnPathForHash(window.location.hash);
      if (moved !== null) window.location.replace(moved);
    };
    follow();
    window.addEventListener('hashchange', follow);
    return () => {
      window.removeEventListener('hashchange', follow);
    };
  }, []);
  return (
    <Page className="gap-16 sm:gap-24">
      <Hero cluster={cluster} />
      <Thefts />
      <HowItWorks cluster={cluster} />
      <Protects />
      <HonestLimit />
      <Checked />
      <CannotDo />
      <CoSignNote />
      <Closing />
    </Page>
  );
}
