import type { Address, Signature } from '@solana/kit';
import { formatSol } from '@stakeward/core';
import { CircleCheckIcon } from 'lucide-react';
import { useId, type Ref } from 'react';
import { Link } from 'wouter';
import { AddressText } from '@/components/product/address-text';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { isLanded } from '@/pages/account/check';
import { JobOutcome } from '@/pages/account/JobOutcome';
import type { JobView } from '@/signing/machine';
import { withdrawRefusalText } from './plan.ts';
import type { WithdrawWhat } from './WithdrawSigning.tsx';

type WithdrawDoneProps = {
  headingRef: Ref<HTMLHeadingElement>;
  what: WithdrawWhat;
  /** The run's outcome for this stake account. */
  job: JobView;
  mainKey: Address;
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
 * epoch (the page shows the countdown below from a fresh read), or what did not happen and the way forward.
 */
export function WithdrawDone({ headingRef, what, job, mainKey, checking, checkFailed, onRetry, onCheckAgain, onBack }: WithdrawDoneProps) {
  const headingId = useId();
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
      />
    );
  }
  if (what === 'deactivate') {
    return (
      <Alert tone="success" role="status" data-slot="withdraw-done">
        <CircleCheckIcon aria-hidden="true" />
        <AlertDescription className="flex flex-col gap-2 text-foreground">
          <h2 ref={headingRef} tabIndex={-1} className="text-base font-semibold">
            {t('withdraw.done.deactivated')}
          </h2>
          <TransactionLink signature={job.signature} />
        </AlertDescription>
      </Alert>
    );
  }
  const amount = job.action?.kind === 'withdraw' ? job.action.lamports : (job.before?.lamports ?? null);
  return (
    <section aria-labelledby={headingId} data-slot="withdraw-done" className="flex flex-col gap-4">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-2xl font-semibold">
        <CircleCheckIcon aria-hidden="true" className="size-6 shrink-0 text-success" />
        {t('withdraw.done.title', { amount: amount === null ? '' : formatSol(amount) })}
      </h2>
      <TransactionLink signature={job.signature} />
      <div>
        <Button asChild>
          <Link href={`/app?${new URLSearchParams({ address: mainKey }).toString()}`}>{t('common.backToAccounts')}</Link>
        </Button>
      </div>
    </section>
  );
}
