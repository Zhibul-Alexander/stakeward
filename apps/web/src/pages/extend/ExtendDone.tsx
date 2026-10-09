import type { Address } from '@solana/kit';
import { formatUtcDate } from '@stakeward/core';
import { CircleCheckIcon, FileTextIcon } from 'lucide-react';
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
  /** The stake's main key: "Back to your accounts" shows its stake. */
  mainKey: Address;
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
 * The end of a run on /extend/:account: the lock's new end with the way back and an updated recovery card, or that the
 * lock is gone with its risk, the way to withdraw now and the way to protect it again, or what did not happen and the
 * way forward.
 */
export function ExtendDone({ headingRef, account, mainKey, lockUntil, job, checking, checkFailed, onRetry, onCheckAgain, onBack }: ExtendDoneProps) {
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
    <section aria-labelledby={headingId} data-slot="extend-done" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="flex items-start gap-2 text-2xl">
          <CircleCheckIcon aria-hidden="true" className="mt-1 size-6 shrink-0 text-success" />
          {lockUntil === 0n
            ? t('extend.done.removed')
            : t('extend.done.extended', { date: formatUtcDate(lockUntil) ?? lockUntil.toString() })}
        </h2>
        {transaction}
      </div>
      {lockUntil === 0n ? (
        <>
          <div className="flex flex-col gap-2">
            <RiskNote risk="unlock-opens-window" tone="danger" variant="inline" />
            {/* The way on after a "second key may be stolen" alert: a lock under a new second key (SECURITY-CHECK П9).
                The wizard warns again while the old second key is still the one connected. */}
            <p className="max-w-prose text-sm text-muted">{t('extend.done.protectNewKey')}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button asChild>
              <Link href={appLinks.withdraw(account)}>{t('extend.done.withdraw')}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={appLinks.protect([account])}>{t('extend.done.protect')}</Link>
            </Button>
          </div>
        </>
      ) : (
        // Nothing urgent after a longer lock: no filled button. A card printed before names the old end date.
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Button asChild variant="outline">
            <Link href={`/app?${new URLSearchParams({ address: mainKey }).toString()}`}>{t('common.backToAccounts')}</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href={appLinks.recovery(account)}>
              <FileTextIcon aria-hidden="true" />
              {t('extend.done.recovery')}
            </Link>
          </Button>
        </div>
      )}
    </section>
  );
}
