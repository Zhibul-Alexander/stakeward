import type { Cluster } from '@stakeward/core';
import { CLUSTER } from '@/config';
import { Alerts } from './landing/Alerts.tsx';
import { CannotDo } from './landing/CannotDo.tsx';
import { useNonceDeposit } from './landing/deposit.ts';
import { Faq } from './landing/Faq.tsx';
import { useFaqParams } from './landing/faq.ts';
import { Fees } from './landing/Fees.tsx';
import { FinalCta } from './landing/FinalCta.tsx';
import { Hero, Why } from './landing/Hero.tsx';
import { HowItWorks } from './landing/HowItWorks.tsx';
import { Protects, SecondKey } from './landing/Protects.tsx';
import { Recover, Security } from './landing/Security.tsx';
import { useHashTarget } from './landing/use-hash-target.ts';
import { Wallets } from './landing/Wallets.tsx';
import { WhoFor } from './landing/WhoFor.tsx';

/**
 * `/` (CLAUDE.md section 9, DECISIONS.md D79): what Stakeward protects and how, in three steps; what it cannot do; the
 * fees; which wallets were tested; alerts; the security model; recovery without Stakeward; the FAQ. Composition only.
 * The one network read is the link-signing deposit. A hash (`/#faq-ledger`, `/#cannot-do`) opens and shows its target.
 */
export function LandingPage({ cluster = CLUSTER }: { cluster?: Cluster | undefined }) {
  useHashTarget();
  const deposit = useNonceDeposit();
  const faqParams = useFaqParams(deposit);
  return (
    <div className="flex flex-col gap-12 sm:gap-16">
      <Hero cluster={cluster} />
      <Why />
      <HowItWorks cluster={cluster} />
      <Protects />
      <SecondKey />
      <CannotDo />
      <WhoFor />
      <Fees deposit={deposit} />
      <Wallets />
      <Alerts params={faqParams} />
      <Security />
      <Recover />
      <Faq params={faqParams} />
      <FinalCta />
    </div>
  );
}
