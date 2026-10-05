import type { Address } from '@solana/kit';
import { CircleAlertIcon, LoaderCircleIcon, RotateCcwIcon, SearchIcon } from 'lucide-react';
import { useId, type Ref } from 'react';
import { JobStatusList, type JobStatusItem } from '@/components/product/job-status-list';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import type { JobView } from '@/signing/machine';
import { defaultJobReason, jobStatus } from '@/signing/view';
import { isRetryable } from './check.ts';

type JobOutcomeProps = {
  headingRef?: Ref<HTMLHeadingElement> | undefined;
  /** The heading and the list's name, e.g. "Withdrawal". */
  title: string;
  /** A run's outcome for the page's stake account that did not land. */
  job: JobView;
  /** The page's words for its plan's refusals. */
  refusalText: (reason: string) => string;
  /** Check again is reading the chain. */
  checking: boolean;
  /** The last Check again could not read the chain. */
  checkFailed: boolean;
  /** A new run (offered when nothing was sent, or what was sent is known not to land). */
  onRetry: () => void;
  /** Read the chain again (offered for an uncertain outcome). */
  onCheckAgain: () => void;
  /** Back to the page's choice. */
  onBack: () => void;
};

/**
 * The outcome of a stake account page's run when it did not land (/withdraw, /extend): the account with its status,
 * why in plain words (a refusal in the page's words, otherwise what the engine knows) with the raw error under
 * Details, and the ways forward: Try again, Check again for an uncertain outcome, and Back. No dead ends (UX rule 8).
 */
export function JobOutcome({
  headingRef,
  title,
  job,
  refusalText,
  checking,
  checkFailed,
  onRetry,
  onCheckAgain,
  onBack,
}: JobOutcomeProps) {
  const headingId = useId();
  const { state } = job;
  const item: JobStatusItem = { address: job.id as Address, status: jobStatus(state), signature: job.signature };
  const reason = state.kind === 'refused' ? refusalText(state.reason) : defaultJobReason(job);
  if (reason !== undefined) item.reason = reason;
  if (state.kind === 'failed' || state.kind === 'sim-failed') item.detail = state.error.detail;
  return (
    <section aria-labelledby={headingId} data-slot="job-outcome" className="flex flex-col gap-4">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-2xl font-semibold">
        {title}
      </h2>
      <JobStatusList items={[item]} label={title} />
      {checkFailed ? (
        <p role="status" className="flex items-start gap-2 text-sm font-medium text-danger">
          <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
          {t('protect.done.checkFailed')}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {isRetryable(job) ? (
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
        <Button variant="ghost" onClick={onBack}>
          {t('common.back')}
        </Button>
      </div>
    </section>
  );
}
