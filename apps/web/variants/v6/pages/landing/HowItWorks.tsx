import type { Cluster } from '@stakeward/core';
import { t } from '@/i18n';
import { Section } from './Section.tsx';

const STEPS = ['step1', 'step2', 'step3'] as const;

/**
 * The scheme in three steps. A real sequence, so it is numbered: each step under an oversized numeral, ruled columns.
 */
export function HowItWorks({ cluster }: { cluster: Cluster }) {
  return (
    <Section id="how-it-works" title={t('landing.how.title')} intro={t('landing.how.intro')}>
      <ol className="grid border-t-2 border-foreground md:grid-cols-3 md:divide-x-2 md:divide-foreground">
        {STEPS.map((step, index) => (
          <li
            key={step}
            className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 border-b-2 border-foreground py-4 md:flex md:flex-col md:gap-3 md:border-b-0 md:px-4 md:first:pl-0 md:last:pr-0"
          >
            <span aria-hidden="true" className="font-display text-[4.5rem] leading-[0.8] tabular-nums md:text-[6rem]">
              {index + 1}
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <h3 className="text-base font-bold tracking-wide uppercase">{t(`landing.how.${step}.title`)}</h3>
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
