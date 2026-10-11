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
 * `/` in v8 ("pre-flight checklist"): the checklist and an empty score gauge first, then what the lock holds and what
 * it does not, the caution about the second key, the three-step procedure, what is outside the checklist, the co-sign
 * note, the details and a last call to run the check.
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
    <Page className="gap-14 sm:gap-20">
      <Hero cluster={cluster} />
      <Protects />
      <HowItWorks cluster={cluster} />
      <CannotDo />
      <CoSignCallout />
      <LearnMore />
      <FinalCta />
    </Page>
  );
}
