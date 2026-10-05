import { formatUtcDate, lockPeriodsFor, lockupEnd, type LockPeriod } from '@stakeward/core';
import { LoaderCircleIcon } from 'lucide-react';
import { useId, useState, type Ref } from 'react';
import { ErrorState } from '@/components/product/error-state';
import { RiskNote } from '@/components/product/risk-note';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { CLUSTER } from '@/config';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { useChain } from '@/ports';
import { useClusterClock } from './load.ts';
import { StepButtons } from './StepButtons.tsx';
import { blockers, type BlockerInput } from './wizard.ts';

type PeriodStepProps = {
  headingRef: Ref<HTMLHeadingElement>;
  period: LockPeriod;
  /** The wizard's input to `blockers`; this step adds whether the clock is read. */
  blockerInput: Omit<BlockerInput, 'clockReady'>;
  onPeriod: (period: LockPeriod) => void;
  onBack: () => void;
  /** Continue with T, the lock end computed from the cluster clock read on this step. */
  onContinue: (lockUntil: bigint) => void;
};

/**
 * Step 3 (F1 step 3): how long the lock holds. T (00:00 UTC after the period, CLAUDE.md section 5) comes from the
 * cluster clock read when the step opens, and the risk is said with that date (UX rule 6).
 */
export function PeriodStep({ headingRef, period, blockerInput, onPeriod, onBack, onContinue }: PeriodStepProps) {
  const chain = useChain();
  const [attempt, setAttempt] = useState(0);
  const clock = useClusterClock(chain, attempt);
  const headingId = useId();
  const legendId = useId();
  const periods = lockPeriodsFor(CLUSTER);
  const lockUntil = clock.status === 'ready' ? lockupEnd(clock.clock.unixTimestamp, period, CLUSTER) : null;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-6">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-2xl font-semibold">
        {t('protect.period.heading')}
      </h2>
      <fieldset className="flex flex-col gap-3">
        <legend id={legendId} className="mb-3 text-sm font-medium">
          {t('protect.period.legend')}
        </legend>
        <RadioGroup
          aria-labelledby={legendId}
          value={period}
          onValueChange={(value) => {
            const chosen = periods.find((candidate) => candidate === value);
            if (chosen !== undefined) onPeriod(chosen);
          }}
        >
          {periods.map((option) => (
            <div key={option} className="flex items-center gap-3">
              <RadioGroupItem value={option} id={`${legendId}-${option}`} />
              <Label htmlFor={`${legendId}-${option}`}>{t(`protect.period.options.${option}`)}</Label>
            </div>
          ))}
        </RadioGroup>
      </fieldset>
      {clock.status === 'loading' ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted">
          <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
          {t('protect.period.loading')}
        </p>
      ) : clock.status === 'error' ? (
        <ErrorState
          title={t('protect.period.loadError')}
          message={errorMessage(clock.error)}
          detail={clock.error.detail}
          onRetry={() => {
            setAttempt((value) => value + 1);
          }}
        />
      ) : lockUntil === null ? null : (
        <div className="flex flex-col gap-3">
          <p role="status" className="text-lg font-semibold">
            {t('protect.period.until', { date: formatUtcDate(lockUntil) ?? '' })}
          </p>
          <RiskNote risk="lose-second-key" date={lockUntil} />
          <p className="text-sm text-muted">{t('protect.period.renew')}</p>
        </div>
      )}
      <StepButtons
        blockers={blockers('period', { ...blockerInput, clockReady: lockUntil !== null })}
        onBack={onBack}
        onContinue={() => {
          if (lockUntil !== null) onContinue(lockUntil);
        }}
      />
    </section>
  );
}
