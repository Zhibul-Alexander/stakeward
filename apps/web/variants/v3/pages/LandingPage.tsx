import type { Cluster } from '@stakeward/core';
import { useEffect } from 'react';
import { Page } from '@/components/layout/Page';
import { CLUSTER } from '@/config';
import { t } from '@/i18n';
import { CannotDo } from './landing/CannotDo.tsx';
import { CoSignCallout } from './landing/CoSignCallout.tsx';
import { FinalCta } from './landing/FinalCta.tsx';
import { Hero } from './landing/Hero.tsx';
import { HowItWorks } from './landing/HowItWorks.tsx';
import { LearnMore } from './landing/LearnMore.tsx';
import { Protects } from './landing/Protects.tsx';
import { Section } from './landing/Section.tsx';
import { useHashTarget } from './landing/use-hash-target.ts';
import { learnPathForHash } from './LearnPage.tsx';

/** Public incidents (CLAUDE.md section 1): the figures that open the story. */
const INCIDENTS: readonly { amount: string; who: string; when: string; what: string }[] = [
  {
    amount: '192,600',
    who: 'SwissBorg',
    when: '8 September 2025',
    what: 'A hacked staking API slipped a hidden change of the withdraw key into routine transactions. Multi-party signing did not stop it.',
  },
  {
    amount: '261,854',
    who: 'Step Finance',
    when: '31 January 2026',
    what: 'Staked SOL lost in a single incident, once the keys were in the wrong hands.',
  },
];

/** Chapter 1: the threat, told with the two numbers before any product is named. */
function Threat() {
  return (
    <Section
      id="threat"
      chapter={1}
      title="One hidden instruction"
      intro="A stake account answers to whoever holds its withdraw key. Steal that key, or slip one extra instruction into a transaction its owner signs, and the stake changes hands."
    >
      <ul className="grid gap-10 sm:grid-cols-2 sm:gap-12">
        {INCIDENTS.map((incident) => (
          <li key={incident.who} className="flex flex-col gap-3 border-t border-border pt-4">
            <p className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-display text-[3.75rem] leading-[0.95] tracking-[-0.02em] tabular-nums sm:text-figure lg:text-[5.5rem]">
                {incident.amount}
              </span>
              <span className="font-display text-[1.75rem] text-accent-ink italic">SOL</span>
            </p>
            <p className="text-sm">
              <span className="font-semibold">{incident.who}</span>
              <span className="text-muted">, {incident.when}</span>
            </p>
            <p className="max-w-[30rem] text-base text-pretty">{incident.what}</p>
          </li>
        ))}
      </ul>
      <blockquote className="max-w-[44rem] border-l-[3px] border-accent pl-5 font-display text-[1.75rem] leading-[1.2] text-pretty sm:pl-8 sm:text-[2.5rem]">
        In both cases the stake did exactly what its key told it to.
      </blockquote>
    </Section>
  );
}

/** Chapter 2: the lockup that already sits in every stake account. */
function TheLock() {
  return (
    <Section id="the-lock" chapter={2} title="A lock in every stake account">
      <div className="grid gap-8 xl:grid-cols-[minmax(0,38rem)_minmax(0,1fr)] xl:gap-12">
        <div className="flex max-w-[38rem] flex-col gap-4 text-lg leading-[1.75rem] text-pretty">
          <p className="drop-cap">
            Every Solana stake account carries a lockup: an end date and a second key. While the lock holds, the stake
            program will not release SOL or hand the account to a new owner unless that second key signs as well.
          </p>
          <p>
            It is part of the network itself, not an add-on, and it can be switched on for accounts that already exist.
            Almost nobody does. Your stake keeps earning the whole time.
          </p>
        </div>
        <blockquote className="self-start border-t-[3px] border-b border-accent py-5 font-display text-[2rem] leading-[1.1] text-pretty italic sm:text-[2.75rem]">
          {t('landing.how.intro')}
        </blockquote>
      </div>
    </Section>
  );
}

/**
 * Variant v3 `/`: a long read. The cover, then the threat, the lock that is already there, how Stakeward turns it on
 * and what it cannot do, then the word for a co-signer, further reading and the call to look. The old one-page hashes
 * still go where their sections live now.
 */
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
    <Page className="max-w-6xl gap-16 sm:gap-24">
      <Hero cluster={cluster} />
      <Threat />
      <div className="flex flex-col gap-12 sm:gap-16">
        <TheLock />
        <Protects />
      </div>
      <HowItWorks cluster={cluster} />
      <CannotDo />
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
        <CoSignCallout />
        <LearnMore />
      </div>
      <FinalCta />
    </Page>
  );
}
