import { cn } from 'cn';
import { CheckIcon, XIcon } from 'lucide-react';
import { t } from '@/i18n';

type StepProgressProps = {
  /** Step names, in order. */
  steps: readonly string[];
  /** Index of the current step (0-based). Steps before it are done. */
  current: number;
  /** Index of a step that failed (shown in danger with an X); usually `current`. */
  failed?: number | undefined;
  className?: string | undefined;
};

type StepState = 'done' | 'current' | 'failed' | 'upcoming';

const STATE_PREFIX: Record<Exclude<StepState, 'upcoming'>, 'components.steps.done' | 'components.steps.current' | 'components.steps.failed'> = {
  done: 'components.steps.done',
  current: 'components.steps.current',
  failed: 'components.steps.failed',
};

/**
 * Wizard progress (UX rule 2: the wizard shows its steps and where you are). An ordered list with
 * `aria-current="step"`; each state is also spelled out for screen readers ("Done:", "Current step:"), and shown
 * with a number, a check or an X, not colour alone. On narrow screens only the current step's name is visible;
 * the others keep their names for screen readers.
 */
export function StepProgress({ steps, current, failed, className }: StepProgressProps) {
  const total = steps.length;
  const index = Math.min(Math.max(current, 0), Math.max(total - 1, 0));
  const currentLabel = steps[index] ?? '';
  return (
    <nav aria-label={t('components.steps.label')} className={cn('flex flex-col gap-2', className)}>
      <p aria-hidden="true" className="text-sm font-medium sm:hidden">
        {t('components.steps.stepOf', { current: index + 1, total, label: currentLabel })}
      </p>
      <ol className="flex items-center gap-2 sm:gap-3">
        {steps.map((label, i) => {
          const state: StepState = i === failed ? 'failed' : i < index ? 'done' : i === index ? 'current' : 'upcoming';
          return (
            <li
              key={`${String(i)}-${label}`}
              aria-current={i === index ? 'step' : undefined}
              data-state={state}
              className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none"
            >
              <span
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                  state === 'done' && 'border-primary bg-primary text-on-primary',
                  state === 'current' && 'border-primary bg-surface text-primary',
                  state === 'failed' && 'border-danger bg-danger-soft text-danger',
                  state === 'upcoming' && 'border-border-strong bg-surface text-muted',
                )}
                aria-hidden="true"
              >
                {state === 'done' ? <CheckIcon className="size-4" /> : state === 'failed' ? <XIcon className="size-4" /> : i + 1}
              </span>
              <span
                className={cn(
                  'text-sm',
                  state === 'current' || state === 'failed' ? 'font-semibold text-foreground' : 'text-muted',
                  'sr-only sm:not-sr-only',
                )}
              >
                {state === 'upcoming' ? null : <span className="sr-only">{t(STATE_PREFIX[state])} </span>}
                {label}
              </span>
              {i < total - 1 ? <span aria-hidden="true" className="h-px min-w-2 flex-1 bg-border sm:w-8 sm:flex-none" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
