import type { Cluster } from '@stakeward/core';
import { cn } from 'cn';
import { BellRingIcon, ClockIcon, KeyRoundIcon, LifeBuoyIcon, type LucideIcon } from 'lucide-react';
import { t } from '@/i18n';
import { Helper, Section } from './Section.tsx';

const STEPS: readonly { step: 'step1' | 'step2' | 'step3'; icon: LucideIcon; tile: string }[] = [
  { step: 'step1', icon: KeyRoundIcon, tile: 'bg-lilac text-lilac-ink' },
  { step: 'step2', icon: BellRingIcon, tile: 'bg-sky text-sky-ink' },
  { step: 'step3', icon: LifeBuoyIcon, tile: 'bg-mint text-mint-ink' },
];

/**
 * The scheme as a short journey in three stops: lock with a second key, get alerts, rescue or withdraw. Big pastel
 * icon tiles joined by a dashed path (down the page on a phone, across from `md`).
 */
export function HowItWorks({ cluster }: { cluster: Cluster }) {
  return (
    <Section id="how-it-works" title={t('landing.how.title')} intro={t('landing.how.intro')}>
      <ol className="relative grid gap-6 md:grid-cols-3 md:gap-6">
        {/* The path between the tiles. */}
        <span aria-hidden="true" className="journey-line absolute top-12 right-[16%] left-[16%] hidden h-0.5 md:block" />
        <span aria-hidden="true" className="journey-line-v absolute top-12 bottom-12 left-12 w-0.5 md:hidden" />
        {STEPS.map(({ step, icon: Icon, tile }, index) => (
          <li
            key={step}
            className="relative flex gap-5 md:flex-col md:items-center md:gap-4 md:text-center"
          >
            <span aria-hidden="true" className="relative shrink-0">
              <span className={cn('flex size-24 items-center justify-center rounded-xl shadow-md ring-8 ring-background', tile)}>
                <Icon className="size-10" strokeWidth={1.8} />
              </span>
              <span className="absolute -top-2 -right-2 flex size-8 items-center justify-center rounded-full bg-primary text-sm font-extrabold text-on-primary shadow-md tabular-nums">
                {index + 1}
              </span>
            </span>
            <div className="flex min-w-0 flex-col gap-1.5 pt-2 md:max-w-xs md:pt-0">
              <h3 className="text-lg font-extrabold">{t(`landing.how.${step}.title`)}</h3>
              <p className="text-sm text-pretty text-muted sm:text-base">{t(`landing.how.${step}.body`)}</p>
            </div>
          </li>
        ))}
      </ol>
      <Helper icon={ClockIcon} tone="sky" className="max-w-2xl md:mx-auto">
        {t('landing.how.period')}
        {cluster === 'devnet' ? <span> {t('landing.how.periodDevnet')}</span> : null}
      </Helper>
    </Section>
  );
}
