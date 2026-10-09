import type { Cluster } from '@stakeward/core';
import { BellRingIcon, KeyRoundIcon, LifeBuoyIcon, type LucideIcon } from 'lucide-react';
import { t } from '@/i18n';
import { Section } from './Section.tsx';

const STEPS: readonly { step: 'step1' | 'step2' | 'step3'; icon: LucideIcon }[] = [
  { step: 'step1', icon: KeyRoundIcon },
  { step: 'step2', icon: BellRingIcon },
  { step: 'step3', icon: LifeBuoyIcon },
];

/**
 * The scheme in three steps (CLAUDE.md section 10, step 8): lock with a second key, get alerts, rescue or withdraw.
 * Rows on a phone, three columns on a soft panel from `md` up.
 */
export function HowItWorks({ cluster }: { cluster: Cluster }) {
  return (
    <Section id="how-it-works" title={t('landing.how.title')} intro={t('landing.how.intro')}>
      <ol className="grid gap-3 sm:gap-4 md:grid-cols-3 md:gap-8 md:rounded-lg md:bg-subtle md:p-6">
        {STEPS.map(({ step, icon: Icon }, index) => (
          <li key={step} className="flex gap-4 md:flex-col md:gap-3">
            {/* The list numbers the steps for assistive technology; the tile repeats it for the eye. */}
            <span aria-hidden="true" className="relative flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
              <Icon className="size-5" />
              <span className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-surface text-xs font-semibold text-foreground tabular-nums">
                {index + 1}
              </span>
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <h3 className="text-base font-semibold">{t(`landing.how.${step}.title`)}</h3>
              <p className="text-sm text-pretty">{t(`landing.how.${step}.body`)}</p>
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
