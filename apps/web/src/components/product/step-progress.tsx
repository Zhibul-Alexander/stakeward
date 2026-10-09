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

/** The bar segment of each state below 640 px (decorative: the line above it says the same in words). */
const SEGMENT: Record<StepState, string> = {
  done: 'bg-primary',
  current: 'bg-primary',
  failed: 'bg-danger',
  upcoming: 'bg-subtle',
};

/**
 * Wizard progress (UX rule 2: the wizard shows its steps and where you are). An ordered list with
 * `aria-current="step"`; each state is also spelled out for screen readers ("Done:", "Current step:", "Failed:"), and
 * shown with a number, a check or an X, not colour alone. From 640 px the list is visible as numbered dots with their
 * names. Below, one line "Step 2 of 4: Second key" (after a failure "Failed: Step 4 of 4: Sign" in danger with an X)
 * and a segmented bar stand in for it on screen; the list stays in the page as screen-reader text (never display:
 * none), so assistive technology gets every step at any width.
 */
export function StepProgress({ steps, current, failed, className }: StepProgressProps) {
  const total = steps.length;
  const index = Math.min(Math.max(current, 0), Math.max(total - 1, 0));
  const currentLabel = steps[index] ?? '';
  const stateOf = (i: number): StepState => (i === failed ? 'failed' : i < index ? 'done' : i === index ? 'current' : 'upcoming');
  // Below 640 px the line names the failed step in words, with an X, not only the red segment (UX rule 5, WCAG 1.4.1).
  const failedLabel = failed === undefined ? undefined : steps[failed];
  return (
    <nav aria-label={t('components.steps.label')} data-slot="step-progress" className={cn('flex flex-col gap-2', className)}>
      <div aria-hidden="true" className="flex flex-col gap-2 sm:hidden">
        {failed === undefined || failedLabel === undefined ? (
          <p className="text-sm font-medium">{t('components.steps.stepOf', { current: index + 1, total, label: currentLabel })}</p>
        ) : (
          <p data-state="failed" className="flex items-center gap-1.5 text-sm font-medium text-danger">
            <XIcon aria-hidden="true" className="size-4 shrink-0" />
            {t('components.steps.failed')} {t('components.steps.stepOf', { current: failed + 1, total, label: failedLabel })}
          </p>
        )}
        <div className="flex gap-1">
          {steps.map((label, i) => (
            <span key={`${String(i)}-${label}`} data-state={stateOf(i)} className={cn('h-1 flex-1 rounded-full', SEGMENT[stateOf(i)])} />
          ))}
        </div>
      </div>
      <ol className="sr-only sm:not-sr-only sm:flex sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-2">
        {steps.map((label, i) => {
          const state = stateOf(i);
          return (
            <li
              key={`${String(i)}-${label}`}
              aria-current={i === index ? 'step' : undefined}
              data-state={state}
              className="flex min-w-0 items-center gap-2"
            >
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  state === 'done' && 'bg-primary-soft text-primary',
                  state === 'current' && 'bg-surface text-primary ring-2 ring-primary',
                  state === 'failed' && 'border border-danger bg-danger-soft text-danger',
                  state === 'upcoming' && 'bg-subtle text-muted',
                )}
                aria-hidden="true"
              >
                {state === 'done' ? <CheckIcon className="size-3.5" /> : state === 'failed' ? <XIcon className="size-3.5" /> : i + 1}
              </span>
              <span
                className={cn('text-sm', state === 'current' || state === 'failed' ? 'font-semibold text-foreground' : 'text-muted')}
              >
                {state === 'upcoming' ? null : <span className="sr-only">{t(STATE_PREFIX[state])} </span>}
                {label}
              </span>
              {i < total - 1 ? <span aria-hidden="true" className="h-px w-6 shrink-0 bg-border" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
