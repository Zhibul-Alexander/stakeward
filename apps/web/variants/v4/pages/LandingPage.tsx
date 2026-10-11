import type { Cluster } from '@stakeward/core';
import { cn } from 'cn';
import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
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
  // v4: the phone dock with "Check my stake" appears once the hero's own buttons have scrolled away, and steps aside
  // while the closing call (the same link) is on screen, so a phone never shows two "Check my stake" at once and the
  // dock is the only filled button in view.
  const [dock, setDock] = useState(false);
  useEffect(() => {
    const heroActions = document.querySelector('[data-slot="hero-actions"]');
    const finalCta = document.querySelector('[data-slot="final-cta"] [data-slot="button"]');
    if (heroActions === null || finalCta === null || typeof IntersectionObserver === 'undefined') return;
    let heroGone = false;
    let finalShown = false;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === heroActions) heroGone = !entry.isIntersecting && entry.boundingClientRect.top < 0;
        else finalShown = entry.isIntersecting;
      }
      setDock(heroGone && !finalShown);
    });
    observer.observe(heroActions);
    observer.observe(finalCta);
    return () => {
      observer.disconnect();
    };
  }, []);
  return (
    <Page className="gap-14 pb-20 sm:gap-20 sm:pb-0">
      <Hero cluster={cluster} />
      <HowItWorks cluster={cluster} />
      <Protects />
      <CannotDo />
      <CoSignCallout />
      <LearnMore />
      <FinalCta />
      {/* v4: on a phone the first step stays in reach at the bottom of the screen. */}
      <div
        data-slot="mobile-dock"
        className={cn(
          'fixed inset-x-0 bottom-0 z-40 rounded-t-xl border-t border-border bg-surface/95 px-4 pt-3 pb-4 shadow-lg backdrop-blur transition-[translate,opacity] duration-300 sm:hidden print:hidden',
          dock ? 'translate-y-0 opacity-100' : 'invisible translate-y-full opacity-0',
        )}
      >
        <Button asChild size="lg" className="w-full">
          <Link href="/app">{t('landing.checkStake')}</Link>
        </Button>
      </div>
    </Page>
  );
}
