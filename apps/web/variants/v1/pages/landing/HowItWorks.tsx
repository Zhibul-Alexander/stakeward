import type { Cluster } from '@stakeward/core';
import { BellRingIcon, KeyRoundIcon, LifeBuoyIcon, type LucideIcon } from 'lucide-react';
import { t } from '@/i18n';
import { Section } from './Section.tsx';

const STEPS: readonly { step: 'step1' | 'step2' | 'step3'; icon: LucideIcon; numeral: string }[] = [
  { step: 'step1', icon: KeyRoundIcon, numeral: 'I' },
  { step: 'step2', icon: BellRingIcon, numeral: 'II' },
  { step: 'step3', icon: LifeBuoyIcon, numeral: 'III' },
];

/**
 * The scheme in three steps: a true sequence, so numbered, in roman numerals set in the serif, divided by hairlines
 * like the clauses of an agreement.
 */
export function HowItWorks({ cluster }: { cluster: Cluster }) {
  return (
    <Section id="how-it-works" title={t('landing.how.title')} intro={t('landing.how.intro')}>
      <ol className="grid border-y border-foreground/60 md:grid-cols-3 md:divide-x md:divide-border">
        {STEPS.map(({ step, icon: Icon, numeral }) => (
          <li
            key={step}
            className="flex flex-col gap-3 border-b border-border py-5 last:border-b-0 md:border-b-0 md:px-6 md:py-6 md:first:pl-0 md:last:pr-0"
          >
            <div aria-hidden="true" className="flex items-baseline justify-between">
              <span className="font-display text-3xl leading-none text-primary">{numeral}</span>
              <Icon className="size-5 text-muted" strokeWidth={1.5} />
            </div>
            <h3 className="text-lg">{t(`landing.how.${step}.title`)}</h3>
            <p className="text-sm text-pretty text-muted">{t(`landing.how.${step}.body`)}</p>
          </li>
        ))}
      </ol>
      <p className="max-w-prose text-sm text-pretty text-muted">
        {t('landing.how.period')}
        {cluster === 'devnet' ? <span> {t('landing.how.periodDevnet')}</span> : null}
      </p>
    </Section>
  );
}
