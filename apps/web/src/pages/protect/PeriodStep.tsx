import {
  customLockBounds,
  customLockEnd,
  DEFAULT_LOCK_PERIOD,
  formatUtcDate,
  formatUtcDateTime,
  lockPeriodsFor,
  lockupEnd,
  type LockPeriod,
} from '@stakeward/core';
import { LoaderCircleIcon } from 'lucide-react';
import { useId, useState, type Ref } from 'react';
import { ErrorState } from '@/components/product/error-state';
import { RadioCardGroup } from '@/components/product/radio-card';
import { RiskNote } from '@/components/product/risk-note';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { CLUSTER } from '@/config';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { useChain, useDeviceClock } from '@/ports';
import { ClockSkewError } from './ClockSkewError.tsx';
import { useClusterClock } from './load.ts';
import { StepButtons } from './StepButtons.tsx';
import { blockers, type BlockerInput, type PeriodChoice } from './wizard.ts';

type PeriodStepProps = {
  headingRef: Ref<HTMLHeadingElement>;
  period: PeriodChoice;
  /** The date typed for Custom date (`YYYY-MM-DD`, D119). */
  customDate: string;
  /** The wizard's input to `blockers`; this step adds whether the clock is read and the date is valid. */
  blockerInput: Omit<BlockerInput, 'clockReady' | 'dateReady'>;
  onPeriod: (period: PeriodChoice) => void;
  onCustomDate: (text: string) => void;
  onBack: () => void;
  /** Continue with T, the lock end computed from the cluster clock read on this step. */
  onContinue: (lockUntil: bigint) => void;
};

/** The devnet test periods end within the day: their card names the time too. */
const SHORT_PERIODS: readonly LockPeriod[] = ['10-minutes', '1-hour'];

/**
 * Step 3 (F1 step 3): how long the lock holds, one card per period with the date it ends, and Custom date: a date
 * field from tomorrow to CUSTOM_LOCK_MAX_YEARS (10) years on, the lock ending at 00:00 UTC on that date (D119). T (00:00 UTC after the
 * period, CLAUDE.md section 5) comes from the cluster clock read when the step opens, and the risk is said with the
 * chosen date right under the cards (UX rule 6). A cluster clock more than a day off this device's clock gives no T:
 * the step says so and offers Try again (SECURITY-CHECK П12).
 */
export function PeriodStep({ headingRef, period, customDate, blockerInput, onPeriod, onCustomDate, onBack, onContinue }: PeriodStepProps) {
  const chain = useChain();
  const deviceClock = useDeviceClock();
  const [attempt, setAttempt] = useState(0);
  const clock = useClusterClock(chain, attempt, deviceClock);
  const retry = () => {
    setAttempt((value) => value + 1);
  };
  const headingId = useId();
  const dateId = useId();
  const periods = lockPeriodsFor(CLUSTER);
  const choices: readonly PeriodChoice[] = [...periods, 'custom'];
  const now = clock.status === 'ready' ? clock.clock.unixTimestamp : null;
  const custom = now === null ? null : customLockEnd(customDate, now);
  const bounds = now === null ? null : customLockBounds(now);
  const boundDate = (date: string) => (now === null ? date : (formatUtcDate(okEnd(customLockEnd(date, now))) ?? date));
  const endOf = (option: PeriodChoice) =>
    now === null ? null : option === 'custom' ? (custom?.ok === true ? custom.lockUntil : null) : lockupEnd(now, option, CLUSTER);
  const lockUntil = endOf(period);
  // A problem is said once something is typed; an empty field is the step button's blocker.
  const problem = custom === null || custom.ok || customDate.trim() === '' ? null : custom.problem;
  const count = blockerInput.selection;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-6 text-pretty">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-balance">
        {t('protect.period.heading')}
      </h2>
      <RadioCardGroup
        legend={t('protect.period.legend')}
        legendHidden
        value={period}
        onValueChange={(value) => {
          const chosen = choices.find((candidate) => candidate === value);
          if (chosen !== undefined) onPeriod(chosen);
        }}
        columns={2}
        options={choices.map((option) => {
          const end = endOf(option);
          const date =
            end === null ? null : option !== 'custom' && SHORT_PERIODS.includes(option) ? formatUtcDateTime(end) : formatUtcDate(end);
          return {
            value: option,
            title: t(`protect.period.options.${option}`),
            meta:
              clock.status === 'loading' ? (
                <Skeleton className="inline-block h-4 w-32 align-middle" />
              ) : date !== null ? (
                t('protect.period.until', { date })
              ) : option === 'custom' && clock.status === 'ready' ? (
                t('protect.period.customPick')
              ) : undefined,
            badge:
              option === DEFAULT_LOCK_PERIOD ? (
                <Badge tone="success">{t('protect.period.recommended')}</Badge>
              ) : undefined,
          };
        })}
      />
      {period === 'custom' && bounds !== null ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={dateId}>{t('protect.period.customLabel')}</Label>
          <Input
            id={dateId}
            type="date"
            className="w-auto max-w-56"
            value={customDate}
            min={bounds.min}
            max={bounds.max}
            required
            aria-invalid={problem !== null}
            aria-describedby={problem === null ? `${dateId}-hint` : `${dateId}-hint ${dateId}-error`}
            onChange={(event) => {
              onCustomDate(event.target.value);
            }}
          />
          <p id={`${dateId}-hint`} className="text-sm text-muted">
            {t('protect.period.customHint', { min: boundDate(bounds.min), max: boundDate(bounds.max) })}
          </p>
          {problem === null ? null : (
            <p id={`${dateId}-error`} role="alert" className="text-sm font-medium text-danger">
              {t(`protect.period.customProblem.${problem}`, { min: boundDate(bounds.min), max: boundDate(bounds.max) })}
            </p>
          )}
        </div>
      ) : null}
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
          onRetry={retry}
        />
      ) : clock.status === 'skewed' ? (
        <ClockSkewError skew={clock.skew} onRetry={retry} />
      ) : lockUntil === null ? null : (
        <div className="flex flex-col gap-2">
          <RiskNote risk="lose-second-key" date={lockUntil} />
          <p className="text-sm text-muted">{t('protect.period.renew')}</p>
        </div>
      )}
      <StepButtons
        label={count === 1 ? t('protect.continue.periodOne') : t('protect.continue.periodOther', { count })}
        blockers={blockers('period', { ...blockerInput, clockReady: now !== null, dateReady: lockUntil !== null })}
        onBack={onBack}
        onContinue={() => {
          if (lockUntil !== null) onContinue(lockUntil);
        }}
      />
    </section>
  );
}

/** The lock end of a bound from `customLockBounds`, which `customLockEnd` always accepts. */
function okEnd(result: ReturnType<typeof customLockEnd>): bigint {
  if (!result.ok) throw new Error(`Custom lock bound refused: ${result.problem}`);
  return result.lockUntil;
}
