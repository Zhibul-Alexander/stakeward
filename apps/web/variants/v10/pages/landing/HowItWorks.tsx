import type { Cluster } from '@stakeward/core';
import { BellRingIcon, LifeBuoyIcon, LockKeyholeIcon, type LucideIcon } from 'lucide-react';
import { t } from '@/i18n';
import { Section } from './Section.tsx';

const STEPS: readonly { step: 'step1' | 'step2' | 'step3'; icon: LucideIcon }[] = [
  { step: 'step1', icon: LockKeyholeIcon },
  { step: 'step2', icon: BellRingIcon },
  { step: 'step3', icon: LifeBuoyIcon },
];

/**
 * v10: the three moves as one drawn line (a real sequence, so numbered): Lock, Watch, Withdraw or rescue. A rail joins
 * the stations; down the side on a phone, across from `md`.
 */
export function HowItWorks({ cluster }: { cluster: Cluster }) {
  return (
    <Section id="how-it-works" title={t('landing.how.title')}>
      <ol className="relative grid gap-6 md:grid-cols-3 md:gap-8">
        {/* The rail: vertical on a phone, horizontal from md. */}
        <span aria-hidden="true" className="absolute top-6 bottom-6 left-6 w-0.5 bg-line md:top-6 md:right-[16%] md:bottom-auto md:left-[8%] md:h-0.5 md:w-auto" />
        {STEPS.map(({ step, icon: Icon }, index) => (
          <li key={step} className="relative flex gap-4 md:flex-col md:gap-3">
            <span
              aria-hidden="true"
              className="relative flex size-12 shrink-0 items-center justify-center rounded-md border-2 border-primary bg-surface text-primary"
            >
              <Icon className="size-5" />
              <span className="absolute -top-2.5 -right-2.5 flex size-6 items-center justify-center rounded-full bg-accent font-display text-xs font-semibold text-on-accent tabular-nums">
                {index + 1}
              </span>
            </span>
            <div className="flex min-w-0 flex-col gap-1 pt-1 md:pt-0">
              <h3 className="font-display text-lg font-semibold">{t(`landing.how.${step}.title`)}</h3>
              <p className="max-w-xs text-sm text-pretty text-muted">{t(`landing.how.${step}.body`)}</p>
            </div>
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
