import type { Address } from '@solana/kit';
import { formatUtcDate } from '@stakeward/core';
import { CircleCheckIcon } from 'lucide-react';
import { useId, type Ref } from 'react';
import { Link } from 'wouter';
import { AddressText } from '@/components/product/address-text';
import { RiskNote } from '@/components/product/risk-note';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { isLanded } from '@/pages/account/check';
import { JobOutcome } from '@/pages/account/JobOutcome';
import { appLinks } from '@/pages/app/view';
import type { JobView } from '@/signing/machine';
import { extendRefusalText } from './plan.ts';

type ExtendDoneProps = {
  headingRef: Ref<HTMLHeadingElement>;
  account: Address;
  /** The lock end the run signed; 0 removed the lock. */
  lockUntil: bigint;
  /** The run's outcome for this stake account. */
  job: JobView;
  checking: boolean;
  checkFailed: boolean;
  onRetry: () => void;
  onCheckAgain: () => void;
  onBack: () => void;
};

/**
 * The end of a run on /extend/:account: the lock's new end, or that the lock is gone with its risk and the way to
 * withdraw now, or what did not happen and the way forward.
 */
export function ExtendDone({ headingRef, account, lockUntil, job, checking, checkFailed, onRetry, onCheckAgain, onBack }: ExtendDoneProps) {
  const headingId = useId();
  if (!isLanded(job)) {
    return (
      <JobOutcome
        headingRef={headingRef}
        title={t('extend.result')}
        job={job}
        refusalText={extendRefusalText}
        checking={checking}
        checkFailed={checkFailed}
        onRetry={onRetry}
        onCheckAgain={onCheckAgain}
        onBack={onBack}
      />
    );
  }
  const transaction =
    job.signature === null ? null : (
      <p className="flex flex-wrap items-center gap-x-2 text-sm">
        <span className="text-muted">{t('components.jobs.transaction')}</span>
        <AddressText address={job.signature} kind="tx" />
      </p>
    );
  return (
    <section aria-labelledby={headingId} data-slot="extend-done" className="flex flex-col gap-4">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-2xl font-semibold">
        <CircleCheckIcon aria-hidden="true" className="size-6 shrink-0 text-success" />
        {lockUntil === 0n
          ? t('extend.done.removed')
          : t('extend.done.extended', { date: formatUtcDate(lockUntil) ?? lockUntil.toString() })}
      </h2>
      {transaction}
      {lockUntil === 0n ? (
        <>
          <RiskNote risk="unlock-opens-window" tone="danger" />
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href={appLinks.withdraw(account)}>{t('extend.done.withdraw')}</Link>
            </Button>
            {/* After a stolen second key (FAQ), the way back to a lock with a new one. */}
            <Button asChild variant="outline">
              <Link href={appLinks.protect([account])}>{t('extend.done.protectAgain')}</Link>
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}
