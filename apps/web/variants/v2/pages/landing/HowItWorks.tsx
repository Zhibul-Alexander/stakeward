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
 * The scheme in three steps, as a man page's numbered table: step, title, body. One framed table with 1px rules; on a
 * phone each step stacks its title over its body.
 */
export function HowItWorks({ cluster }: { cluster: Cluster }) {
  return (
    <Section id="how-it-works" title={t('landing.how.title')} intro={t('landing.how.intro')}>
      <ol className="divide-y divide-border border border-border-strong bg-surface">
        {STEPS.map(({ step, icon: Icon }, index) => (
          <li key={step} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-3 py-3 sm:px-4 md:grid-cols-[3rem_minmax(0,18rem)_minmax(0,1fr)] md:items-baseline md:gap-x-6">
            <span aria-hidden="true" className="row-span-2 text-sm text-primary tabular-nums phosphor md:row-span-1">
              [{index + 1}]
            </span>
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <Icon aria-hidden="true" className="size-4 shrink-0 text-primary" />
              {t(`landing.how.${step}.title`)}
            </h3>
            <p className="text-sm text-pretty text-muted">{t(`landing.how.${step}.body`)}</p>
          </li>
        ))}
      </ol>
      <p className="max-w-prose text-sm text-pretty text-muted">
        <span aria-hidden="true" className="text-primary"># </span>
        {t('landing.how.period')}
        {cluster === 'devnet' ? <span> {t('landing.how.periodDevnet')}</span> : null}
      </p>
    </Section>
  );
}
