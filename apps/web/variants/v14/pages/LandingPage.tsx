import type { Cluster } from '@stakeward/core';
import { useEffect } from 'react';
import { Page } from '@/components/layout/Page';
import { CLUSTER } from '@/config';
import { CannotDo } from './landing/CannotDo.tsx';
import { CoSignCallout } from './landing/CoSignCallout.tsx';
import { FinalCta } from './landing/FinalCta.tsx';
import { Hero } from './landing/Hero.tsx';
import { Incidents } from './landing/Incidents.tsx';
import { Live } from './landing/Live.tsx';
import { Record } from './landing/Record.tsx';
import { useHashTarget } from './landing/use-hash-target.ts';
import { learnPathForHash } from './LearnPage.tsx';

/**
 * `/` in v14 "Evidence": the main claim with the mainnet transaction that tested it, what the monitor says right now,
 * every other claim next to its checks (limits included), two real losses and what the record says about each, what
 * Stakeward cannot do, a word for whoever was sent a link to co-sign, and a last call to look. Old one-page hashes
 * still go to their place on /learn; `/#cannot-do` still opens here.
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
    <Page>
      <Hero cluster={cluster} />
      <Live />
      <Record />
      <Incidents />
      <CannotDo />
      <CoSignCallout />
      <FinalCta />
    </Page>
  );
}
