import type { Cluster } from '@stakeward/core';
import { cn } from 'cn';
import { BellRingIcon, LifeBuoyIcon, LockKeyholeIcon, type LucideIcon } from 'lucide-react';
import { t } from '@/i18n';
import { Section } from './Section.tsx';

const STEPS: readonly { step: 'step1' | 'step2' | 'step3'; icon: LucideIcon }[] = [
  { step: 'step1', icon: LockKeyholeIcon },
  { step: 'step2', icon: BellRingIcon },
  { step: 'step3', icon: LifeBuoyIcon },
];

/**
 * The scheme in three steps (CLAUDE.md section 10, step 8): lock with a second key, get alerts, withdraw or rescue.
 * A real sequence, so numbered, and drawn as one line (D145): a rail joins each station to the next, down the side on a
 * phone and across from `md`. Each step draws its own piece of rail, from its tile to the next one across the gap.
 */
export function HowItWorks({ cluster }: { cluster: Cluster }) {
  return (
    <Section id="how-it-works" title={t('landing.how.title')}>
      <ol className="grid gap-6 md:grid-cols-3 md:gap-8">
        {STEPS.map(({ step, icon: Icon }, index) => (
          <li key={step} className="relative flex gap-4 md:flex-col md:gap-3">
            {index < STEPS.length - 1 ? (
              <span
                aria-hidden="true"
                className={cn('absolute top-12 -bottom-6 left-6 w-0.5 bg-line', 'md:top-6 md:-right-8 md:bottom-auto md:left-12 md:h-0.5 md:w-auto')}
              />
            ) : null}
            <span
              aria-hidden="true"
              className="relative flex size-12 shrink-0 items-center justify-center rounded-md border-2 border-primary bg-surface text-primary"
            >
              <Icon className="size-5" />
            </span>
            <div className="flex min-w-0 flex-col gap-1 pt-1 md:pt-0">
              {/* The list numbers the steps for assistive technology; the label repeats it for the eye, like the
                  number of a part on a drawing (not a badge on the tile: D150). */}
              <span aria-hidden="true" className="font-display text-xs font-medium text-muted tabular-nums">
                {String(index + 1).padStart(2, '0')}
              </span>
              <h3 className="text-lg font-semibold">{t(`landing.how.${step}.title`)}</h3>
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
