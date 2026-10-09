import type { Address } from '@solana/kit';
import { CircleAlertIcon, LoaderCircleIcon, RotateCcwIcon, SearchIcon } from 'lucide-react';
import { useId, type ReactNode, type Ref } from 'react';
import { JobStatusList, type JobStatus, type JobStatusItem } from '@/components/product/job-status-list';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import type { JobView } from '@/signing/machine';
import { defaultJobReason, jobStatus } from '@/signing/view';
import { isRetryable } from './check.ts';

type JobOutcomeProps = {
  headingRef?: Ref<HTMLHeadingElement> | undefined;
  /** What was tried, e.g. "Withdrawal": the list's name, and the subject of the heading ("Withdrawal did not go through"). */
  title: string;
  /** A run's outcome for the page's stake account that did not land. */
  job: JobView;
  /** The page's words for its plan's refusals. */
  refusalText: (reason: string) => string;
  /** The page's words for any other outcome; the engine's (`defaultJobReason`) by default. */
  reasonText?: ((job: JobView) => string | undefined) | undefined;
  /** Check again is reading the chain. */
  checking: boolean;
  /** The last Check again could not read the chain. */
  checkFailed: boolean;
  /**
   * A new run (offered when nothing was sent, or what was sent is known not to land). Without it no Try again is shown
   * (/cosign, where a link that failed needs a new link, not the same bytes again).
   */
  onRetry?: (() => void) | undefined;
  /** Read the chain again (offered for an uncertain outcome). */
  onCheckAgain: () => void;
  /** Back to the page's choice; without it no Back button is shown (/cosign has nowhere to go back to). */
  onBack?: (() => void) | undefined;
  /** What the page adds below the outcome (e.g. "Ask the sender for a new link"). */
  children?: ReactNode;
  /** The page's own way out, after the buttons above (e.g. /cosign's "Back to the start page"). */
  exit?: ReactNode;
};

/**
 * The heading names the outcome, not the action (DECISIONS.md D112): "Withdrawal did not go through", "Not confirmed
 * yet", "Lock change expired, nothing changed", in the words of the status badge below it.
 */
function outcomeHeading(status: JobStatus, subject: string): string {
  switch (status) {
    case 'failed':
      return t('components.jobs.heading.failed', { subject });
    case 'expired':
      return t('components.jobs.heading.expired', { subject });
    case 'unknown':
      return t('components.jobs.heading.unknown');
    case 'not-sent':
    case 'left-out':
      return t('components.jobs.heading.notSent', { subject });
    default:
      // A run that ends here did not land, so only the cases above reach it; the subject alone is still true.
      return subject;
  }
}

/**
 * The outcome of a stake account page's run when it did not land (/withdraw, /extend, /cosign): the account with its status,
 * why in plain words (a refusal in the page's words, otherwise what the engine knows) with the raw error under
 * Details, and the ways forward: Try again, Check again for an uncertain outcome, and Back. No dead ends (UX rule 8).
 */
export function JobOutcome({
  headingRef,
  title,
  job,
  refusalText,
  reasonText = defaultJobReason,
  checking,
  checkFailed,
  onRetry,
  onCheckAgain,
  onBack,
  children,
  exit,
}: JobOutcomeProps) {
  const headingId = useId();
  const { state } = job;
  const item: JobStatusItem = { address: job.id as Address, status: jobStatus(state), signature: job.signature };
  const reason = state.kind === 'refused' ? refusalText(state.reason) : reasonText(job);
  if (reason !== undefined) item.reason = reason;
  if (state.kind === 'failed' || state.kind === 'sim-failed') item.detail = state.error.detail;
  return (
    <section aria-labelledby={headingId} data-slot="job-outcome" className="flex flex-col gap-4">
      {/* Focused when the outcome replaces the step; a heading is not a control, so no focus ring on it. */}
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-2xl text-balance outline-none">
        {outcomeHeading(item.status, title)}
      </h2>
      <JobStatusList items={[item]} label={title} />
      {children}
      {checkFailed ? (
        <p role="status" className="flex items-start gap-2 text-sm font-medium text-danger">
          <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
          {t('protect.done.checkFailed')}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {onRetry !== undefined && isRetryable(job) ? (
          <Button onClick={onRetry}>
            <RotateCcwIcon aria-hidden="true" />
            {t('common.tryAgain')}
          </Button>
        ) : null}
        {state.kind === 'unknown' ? (
          <Button variant="outline" onClick={onCheckAgain} disabled={checking}>
            {checking ? <LoaderCircleIcon aria-hidden="true" className="animate-spin" /> : <SearchIcon aria-hidden="true" />}
            {t('common.checkAgain')}
          </Button>
        ) : null}
        {onBack === undefined ? null : (
          <Button variant="ghost" onClick={onBack}>
            {t('common.back')}
          </Button>
        )}
        {exit}
      </div>
    </section>
  );
}
