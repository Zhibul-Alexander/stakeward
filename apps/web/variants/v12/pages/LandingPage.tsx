import type { Cluster } from '@stakeward/core';
import { useEffect } from 'react';
import { Page } from '@/components/layout/Page';
import { CLUSTER } from '@/config';
import { BeforeCli } from './landing/BeforeCli.tsx';
import { CannotDo } from './landing/CannotDo.tsx';
import { CoSignCallout } from './landing/CoSignCallout.tsx';
import { Cover } from './landing/Cover.tsx';
import { LearnMore } from './landing/LearnMore.tsx';
import { LockSpec } from './landing/LockSpec.tsx';
import { Procedures } from './landing/Procedures.tsx';
import { useHashTarget } from './landing/use-hash-target.ts';
import { learnPathForHash } from './LearnPage.tsx';

/**
 * v12 "Field manual" `/`: the cover with the situations index, what the lock stops and the second key's limit, then
 * the procedures (P1 to P7) with the recovery card's commands, what a command needs, what Stakeward cannot do, a word
 * for whoever was sent a link to co-sign, and the details. Same hash handling as the base landing page.
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
    <Page className="gap-12 sm:gap-16">
      <Cover cluster={cluster} />
      <LockSpec />
      <Procedures cluster={cluster} />
      <BeforeCli />
      <CannotDo />
      <CoSignCallout />
      <LearnMore />
    </Page>
  );
}
