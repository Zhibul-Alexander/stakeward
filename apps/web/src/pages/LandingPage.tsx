import { useEffect } from 'react';
import { CannotDo } from './landing/CannotDo.tsx';
import { Faq } from './landing/Faq.tsx';
import { Hero } from './landing/Hero.tsx';
import { HowItWorks } from './landing/HowItWorks.tsx';

/**
 * The landing page (CLAUDE.md section 9 "/", section 10 step 8): what Stakeward is and the one action (look at your
 * stake), how it works in three steps, what it cannot do (#cannot-do, linked from every footer) and the questions.
 * It reads nothing from the network.
 */
export function LandingPage() {
  useScrollToFragment();
  return (
    <div className="flex flex-col gap-16 sm:gap-20">
      <Hero />
      <HowItWorks />
      <CannotDo />
      <Faq />
    </div>
  );
}

/**
 * Every footer links to /#cannot-do (UX rule 12). From another page that link loads this page fresh, and the browser
 * may look for the fragment before React has rendered it. Scroll to it once it is there; a question (/#faq-wallets)
 * also opens.
 */
function useScrollToFragment() {
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id === '') return;
    const target = document.getElementById(id);
    if (target === null) return;
    if (target instanceof HTMLDetailsElement) target.open = true;
    target.scrollIntoView();
  }, []);
}
