import type { Cluster } from '@stakeward/core';
import { t } from '@/i18n';
import { SecondKey } from './Protects.tsx';
import { Section } from './Section.tsx';

const STEPS = ['step1', 'step2', 'step3'] as const;

/**
 * Variant v3, chapter 3: the scheme in three steps, a real sequence, so each step carries its number as a large
 * figure. Then how long a lock lasts and the second key's limit, said before anyone picks one.
 */
export function HowItWorks({ cluster }: { cluster: Cluster }) {
  return (
    <Section id="how-it-works" chapter={3} title={t('landing.how.title')}>
      <ol className="grid gap-8 md:grid-cols-3 md:gap-10">
        {STEPS.map((step, index) => (
          <li key={step} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-rule pt-4 md:flex md:flex-col md:gap-3">
            <span aria-hidden="true" className="font-display text-[3.5rem] leading-[0.8] text-accent tabular-nums md:text-[4.5rem]">
              {index + 1}
            </span>
            <div className="flex min-w-0 flex-col gap-2">
              <h3 className="font-display text-[1.625rem] leading-[1.1] font-normal">{t(`landing.how.${step}.title`)}</h3>
              <p className="text-base text-pretty">{t(`landing.how.${step}.body`)}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="max-w-[40rem] text-base text-pretty text-muted">
        {t('landing.how.period')}
        {cluster === 'devnet' ? <span> {t('landing.how.periodDevnet')}</span> : null}
      </p>
      <SecondKey />
    </Section>
  );
}
