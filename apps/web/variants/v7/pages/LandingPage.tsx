import type { Cluster } from '@stakeward/core';
import { useEffect } from 'react';
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
 * `/`, v7 "Two futures": the split-screen story of one leaked seed phrase first, edge to edge; then, in the content
 * column, how to end up in the right-hand future, where both futures look the same, what Stakeward cannot do, a word
 * for whoever was sent a link, the way to the details and a last call to look.
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
    <div data-slot="page" data-width="app" className="flex w-full flex-col">
      <Hero cluster={cluster} />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-4 py-14 sm:gap-24 sm:py-20">
        <HowItWorks cluster={cluster} />
        <Protects />
        <CannotDo />
        <CoSignCallout />
        <LearnMore />
      </div>
      <FinalCta />
    </div>
  );
}
