import type { Cluster } from '@stakeward/core';
import { BellRingIcon, KeyRoundIcon, LifeBuoyIcon, type LucideIcon } from 'lucide-react';
import { t } from '@/i18n';

const STEPS: readonly { step: 'step1' | 'step2' | 'step3'; icon: LucideIcon; when: string }[] = [
  { step: 'step1', icon: KeyRoundIcon, when: 'Once, today' },
  { step: 'step2', icon: BellRingIcon, when: 'Every few minutes' },
  { step: 'step3', icon: LifeBuoyIcon, when: 'The day you need it' },
];

/**
 * How to end up in the right-hand future: everything on the right was set up before 09:14. Three steps on one
 * horizontal rail (a vertical one on a phone), each with when it happens.
 */
export function HowItWorks({ cluster }: { cluster: Cluster }) {
  return (
    <section id="how-it-works" aria-labelledby="how-it-works-title" className="flex scroll-mt-4 flex-col gap-8">
      <div className="flex max-w-2xl flex-col gap-3">
        <p className="font-mono text-sm font-medium text-primary tabular-nums">Before 09:14</p>
        <h2 id="how-it-works-title" className="text-2xl text-balance sm:text-3xl">
          Everything on the right is set up before the leak
        </h2>
        <p className="text-base text-pretty text-muted sm:text-lg">{t('landing.how.intro')}</p>
      </div>
      <ol className="relative grid gap-8 md:grid-cols-3 md:gap-10">
        <span aria-hidden="true" className="absolute top-5 bottom-5 left-5 w-0.5 bg-border md:top-5 md:right-5 md:bottom-auto md:left-5 md:h-0.5 md:w-auto" />
        {STEPS.map(({ step, icon: Icon, when }, index) => (
          <li key={step} className="relative flex gap-4 md:flex-col">
            <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-background text-primary">
              <Icon className="size-5" />
            </span>
            <div className="flex min-w-0 flex-col gap-1.5">
              <p className="text-sm text-muted">
                <span className="font-mono tabular-nums">{index + 1}</span> <span aria-hidden="true">/</span> {when}
              </p>
              <h3 className="text-lg font-semibold">{t(`landing.how.${step}.title`)}</h3>
              <p className="text-base text-pretty">{t(`landing.how.${step}.body`)}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="max-w-prose text-sm text-pretty text-muted">
        {t('landing.how.period')}
        {cluster === 'devnet' ? <span> {t('landing.how.periodDevnet')}</span> : null}
      </p>
    </section>
  );
}
