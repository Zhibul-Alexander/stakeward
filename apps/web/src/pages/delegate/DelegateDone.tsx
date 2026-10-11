import type { Address } from '@solana/kit';
import { CircleCheckIcon } from 'lucide-react';
import { useId, type Ref } from 'react';
import { Link } from 'wouter';
import { AddressText } from '@/components/product/address-text';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { isLanded } from '@/pages/account/check';
import { JobOutcome } from '@/pages/account/JobOutcome';
import type { JobView } from '@/signing/machine';
import { delegateRefusalText } from './plan.ts';

type DelegateDoneProps = {
  headingRef: Ref<HTMLHeadingElement>;
  mainKey: Address;
  voteAccount: Address;
  job: JobView;
  checking: boolean;
  checkFailed: boolean;
  onRetry: () => void;
  onCheckAgain: () => void;
  onBack: () => void;
};

/**
 * The end of a run on /delegate/:account: the stake is delegated and starts earning at the next epoch, with the lock as
 * it was; or what did not happen and the way forward.
 */
export function DelegateDone({ headingRef, mainKey, voteAccount, job, checking, checkFailed, onRetry, onCheckAgain, onBack }: DelegateDoneProps) {
  const headingId = useId();
  if (!isLanded(job)) {
    return (
      <JobOutcome
        headingRef={headingRef}
        title={t('delegate.result')}
        job={job}
        refusalText={delegateRefusalText}
        checking={checking}
        checkFailed={checkFailed}
        onRetry={onRetry}
        onCheckAgain={onCheckAgain}
        onBack={onBack}
      />
    );
  }
  return (
    <section aria-labelledby={headingId} data-slot="delegate-done" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="flex items-start gap-2 text-2xl">
          <CircleCheckIcon aria-hidden="true" className="mt-1 size-6 shrink-0 text-success" />
          {t('delegate.done.title')}
        </h2>
        <p className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className="text-muted">{t('delegate.done.validator')}</span>
          <AddressText address={voteAccount} />
        </p>
        {job.signature === null ? null : (
          <p className="flex flex-wrap items-center gap-x-2 text-sm">
            <span className="text-muted">{t('components.jobs.transaction')}</span>
            <AddressText address={job.signature} kind="tx" />
          </p>
        )}
      </div>
      <p className="max-w-prose text-pretty">{t('delegate.done.body')}</p>
      <div>
        <Button asChild>
          <Link href={`/app?${new URLSearchParams({ address: mainKey }).toString()}`}>{t('common.backToAccounts')}</Link>
        </Button>
      </div>
    </section>
  );
}
