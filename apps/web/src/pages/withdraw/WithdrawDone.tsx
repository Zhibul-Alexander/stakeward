import type { Address, Signature } from '@solana/kit';
import { formatSol } from '@stakeward/core';
import { CircleCheckIcon } from 'lucide-react';
import { useId, type Ref } from 'react';
import { Link } from 'wouter';
import { AddressText } from '@/components/product/address-text';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { isLanded } from '@/pages/account/check';
import { JobOutcome } from '@/pages/account/JobOutcome';
import type { SigningTestOptions } from '@/signing/create';
import type { JobView } from '@/signing/machine';
import { NonceCloseCard } from '@/signing/NonceCloseCard';
import { withdrawRefusalText } from './plan.ts';
import type { WithdrawWhat } from './WithdrawSigning.tsx';

type WithdrawDoneProps = {
  headingRef: Ref<HTMLHeadingElement>;
  what: WithdrawWhat;
  /** The run's outcome for this stake account. */
  job: JobView;
  mainKey: Address;
  /** The run went by link: the main key's link-signing account can be closed here (its deposit comes back). */
  byLink: boolean;
  signing?: SigningTestOptions | undefined;
  checking: boolean;
  checkFailed: boolean;
  onRetry: () => void;
  onCheckAgain: () => void;
  onBack: () => void;
};

/** The transaction's explorer link (UX rule 9). */
function TransactionLink({ signature }: { signature: Signature | null }) {
  if (signature === null) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-sm">
      <span className="text-muted">{t('components.jobs.transaction')}</span>
      <AddressText address={signature} kind="tx" />
    </p>
  );
}

/**
 * The end of a run on /withdraw/:account: the SOL that went to the main key, or that staking stops at the end of the
 * epoch (the page shows the countdown below from a fresh read) or stopped at once, or what did not happen and the way
 * forward.
 */
export function WithdrawDone(props: WithdrawDoneProps) {
  const { headingRef, what, job, mainKey, byLink, signing, checking, checkFailed, onRetry, onCheckAgain, onBack } = props;
  const headingId = useId();
  // After signing by link: close the link-signing account (step 7 spec 10.2). While the outcome is open it also
  // cancels the link; it is shown only while the account is there.
  const closeCard = byLink ? <NonceCloseCard authority={mainKey} role="main" signing={signing} /> : null;
  if (!isLanded(job)) {
    return (
      <JobOutcome
        headingRef={headingRef}
        title={t('withdraw.result')}
        job={job}
        refusalText={withdrawRefusalText}
        checking={checking}
        checkFailed={checkFailed}
        onRetry={onRetry}
        onCheckAgain={onCheckAgain}
        onBack={onBack}
      >
        {closeCard}
      </JobOutcome>
    );
  }
  if (what === 'deactivate') {
    // A stake stopped in the epoch it was delegated in never earned: it is inactive at once (the status rule:
    // activation epoch = deactivation epoch), so the withdrawal is open now, not at the epoch's end.
    const after = job.state.kind === 'done' || job.state.kind === 'already-done' ? job.state.after : null;
    const stoppedAtOnce = after?.delegation !== null && after?.delegation !== undefined && after.delegation.activationEpoch === after.delegation.deactivationEpoch;
    // One line with its transaction (DECISIONS.md D112): the stage below says what comes next, from a fresh read.
    return (
      <div role="status" data-slot="withdraw-done" className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <h2 ref={headingRef} tabIndex={-1} className="flex items-start gap-2 text-base font-medium">
          <CircleCheckIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
          {stoppedAtOnce ? t('withdraw.done.deactivatedNow') : t('withdraw.done.deactivated')}
        </h2>
        <TransactionLink signature={job.signature} />
      </div>
    );
  }
  const amount = job.action?.kind === 'withdraw' ? job.action.lamports : (job.before?.lamports ?? null);
  return (
    <section aria-labelledby={headingId} data-slot="withdraw-done" className="flex flex-col gap-4">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="flex items-start gap-2 text-2xl font-semibold">
        <CircleCheckIcon aria-hidden="true" className="mt-1 size-6 shrink-0 text-success" />
        {t('withdraw.done.title', { amount: amount === null ? '' : formatSol(amount) })}
      </h2>
      <TransactionLink signature={job.signature} />
      {closeCard}
      <div>
        <Button asChild>
          <Link href={`/app?${new URLSearchParams({ address: mainKey }).toString()}`}>{t('common.backToAccounts')}</Link>
        </Button>
      </div>
    </section>
  );
}
