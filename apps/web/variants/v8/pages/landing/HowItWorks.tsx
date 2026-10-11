import type { Cluster } from '@stakeward/core';
import { BellRingIcon, KeyRoundIcon, LifeBuoyIcon, type LucideIcon } from 'lucide-react';
import { t } from '@/i18n';
import { Section } from './Section.tsx';

const STEPS: readonly { step: 'step1' | 'step2' | 'step3'; icon: LucideIcon }[] = [
  { step: 'step1', icon: KeyRoundIcon },
  { step: 'step2', icon: BellRingIcon },
  { step: 'step3', icon: LifeBuoyIcon },
];

/** v8: the three steps as a procedure strip, numbered because it is a sequence; one line under it on lock lengths. */
export function HowItWorks({ cluster }: { cluster: Cluster }) {
  return (
    <Section id="how-it-works" title={t('landing.how.title')} intro={t('landing.how.intro')}>
      <ol className="grid overflow-hidden rounded-lg border border-border bg-surface md:grid-cols-3 md:divide-x md:divide-border">
        {STEPS.map(({ step, icon: Icon }, index) => (
          <li key={step} className="flex flex-col gap-2 border-b border-border p-4 last:border-b-0 sm:p-6 md:border-b-0">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-2xl text-muted tabular-nums" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <Icon aria-hidden="true" className="size-5 text-primary" />
            </div>
            <h3 className="text-base font-semibold">{t(`landing.how.${step}.title`)}</h3>
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
