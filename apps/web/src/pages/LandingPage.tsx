import type { Cluster } from '@stakeward/core';
import { useEffect } from 'react';
import { Page } from '@/components/layout/Page';
import { CLUSTER } from '@/config';
import { CannotDo } from './landing/CannotDo.tsx';
import { CoSignCallout } from './landing/CoSignCallout.tsx';
import { FinalCta } from './landing/FinalCta.tsx';
import { Hero } from './landing/Hero.tsx';
import { HowItWorks } from './landing/HowItWorks.tsx';
import { LearnMore } from './landing/LearnMore.tsx';
import { Protects } from './landing/Protects.tsx';
import { useHashTarget } from './landing/use-hash-target.ts';
import { learnPathForHash } from './LearnPage.tsx';

/**
 * `/` (CLAUDE.md section 9, DECISIONS.md D79, D112): the answer first (what Stakeward does, "Check my stake"), then how
 * it works, what the lock stops and the second key's limit, what Stakeward cannot do, a word for whoever was sent a link
 * to co-sign, the way to the details, and a last call to look. Alerts, costs, wallets, safety and the FAQ live on
 * /learn, one tab each. Composition only. A hash of the old one-page layout (`/#faq-ledger`) goes to its new place;
 * `/#cannot-do` still opens here.
 */
export function LandingPage({ cluster = CLUSTER }: { cluster?: Cluster | undefined }) {
  useHashTarget();
  // On the first render and on every later hash change: the old address goes where its section lives now. A plain
  // replace keeps the hash, which the router would drop.
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
      <HowItWorks cluster={cluster} />
      <Protects />
      <CannotDo />
      <CoSignCallout />
      <LearnMore />
      <FinalCta />
    </Page>
  );
}
