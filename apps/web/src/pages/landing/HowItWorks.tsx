import type { Cluster } from '@stakeward/core';
import { BellRingIcon, KeyRoundIcon, LifeBuoyIcon, type LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { t } from '@/i18n';
import { Section } from './Section.tsx';

const STEPS: readonly { step: 'step1' | 'step2' | 'step3'; icon: LucideIcon }[] = [
  { step: 'step1', icon: KeyRoundIcon },
  { step: 'step2', icon: BellRingIcon },
  { step: 'step3', icon: LifeBuoyIcon },
];

/** The scheme in three steps (CLAUDE.md section 10, step 8): lock with a second key, get alerts, rescue or withdraw. */
export function HowItWorks({ cluster }: { cluster: Cluster }) {
  return (
    <Section id="how-it-works" title={t('landing.how.title')}>
      <ol className="grid gap-4 md:grid-cols-3">
        {STEPS.map(({ step, icon: Icon }, index) => (
          <li key={step} className="flex">
            <Card className="w-full">
              <CardHeader className="gap-3">
                <div className="flex items-center gap-3">
                  {/* The list numbers the steps for assistive technology; the badge repeats it for the eye. */}
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-on-primary"
                  >
                    {index + 1}
                  </span>
                  <Icon aria-hidden="true" className="size-5 text-muted" />
                </div>
                <CardTitle asChild>
                  <h3>{t(`landing.how.${step}.title`)}</h3>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{t(`landing.how.${step}.body`)}</p>
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>
      <div className="flex max-w-prose flex-col gap-1">
        <p>{t('landing.how.period')}</p>
        {cluster === 'devnet' ? <p className="text-sm text-muted">{t('landing.how.periodDevnet')}</p> : null}
      </div>
    </Section>
  );
}
