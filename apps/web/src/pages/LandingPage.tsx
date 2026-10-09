import type { Cluster } from '@stakeward/core';
import { Page } from '@/components/layout/Page';
import { CLUSTER } from '@/config';
import { Alerts } from './landing/Alerts.tsx';
import { CannotDo } from './landing/CannotDo.tsx';
import { CoSignCallout } from './landing/CoSignCallout.tsx';
import { useNonceDeposit } from './landing/deposit.ts';
import { Faq } from './landing/Faq.tsx';
import { useFaqParams } from './landing/faq.ts';
import { Fees } from './landing/Fees.tsx';
import { FinalCta } from './landing/FinalCta.tsx';
import { Hero } from './landing/Hero.tsx';
import { HowItWorks } from './landing/HowItWorks.tsx';
import { Protects } from './landing/Protects.tsx';
import { Security } from './landing/Security.tsx';
import { useHashTarget } from './landing/use-hash-target.ts';
import { Wallets } from './landing/Wallets.tsx';

/**
 * `/` (CLAUDE.md section 9, DECISIONS.md D79, D109): the answer first (what Stakeward does, "Check my stake"), then how
 * it works, what the lock stops and the second key's limit, alerts, fees, wallets, what Stakeward cannot do, how it
 * keeps you safe and what is left if it disappears, a word for whoever was sent a link to co-sign, the FAQ in closed
 * groups, and a last call to look. Composition only. The one network read is the link-signing deposit. A hash
 * (`/#faq-ledger`, `/#cannot-do`) opens and shows its target.
 */
export function LandingPage({ cluster = CLUSTER }: { cluster?: Cluster | undefined }) {
  useHashTarget();
  const deposit = useNonceDeposit();
  const faqParams = useFaqParams(deposit);
  return (
    <Page className="gap-8 sm:gap-16">
      <Hero cluster={cluster} />
      <HowItWorks cluster={cluster} />
      <Protects />
      <Alerts params={faqParams} />
      <Fees deposit={deposit} />
      <Wallets />
      <CannotDo />
      <Security />
      <CoSignCallout />
      <Faq params={faqParams} />
      <FinalCta />
    </Page>
  );
}
