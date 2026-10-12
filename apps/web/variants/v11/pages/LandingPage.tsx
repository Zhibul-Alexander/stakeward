import type { Cluster } from '@stakeward/core';
import { useEffect } from 'react';
import { Page } from '@/components/layout/Page';
import { CLUSTER } from '@/config';
import { CannotDo } from './landing/CannotDo.tsx';
import { CoSignCallout } from './landing/CoSignCallout.tsx';
import { Evidence } from './landing/Evidence.tsx';
import { FinalCta } from './landing/FinalCta.tsx';
import { Hero } from './landing/Hero.tsx';
import { LearnMore } from './landing/LearnMore.tsx';
import { Protects } from './landing/Protects.tsx';
import { useHashTarget } from './landing/use-hash-target.ts';
import { learnPathForHash } from './LearnPage.tsx';

/**
 * v11 "Specimen" landing: the claim with an example record before and after, the rule table of a locked account and
 * the second key's limit, the incidents and the recorded mechanism checks, what Stakeward cannot do, a word for a
 * co-signer, the index of details and a last call to look. The hash handling is the base page's.
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
    <Page className="gap-16 sm:gap-24">
      <Hero cluster={cluster} />
      <Protects />
      <Evidence />
      <CannotDo />
      <CoSignCallout />
      <LearnMore />
      <FinalCta />
    </Page>
  );
}
