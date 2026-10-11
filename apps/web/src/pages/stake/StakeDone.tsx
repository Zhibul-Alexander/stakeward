import type { Address } from '@solana/kit';
import { CircleCheckIcon, ShieldCheckIcon } from 'lucide-react';
import { useId, type Ref } from 'react';
import { Link } from 'wouter';
import { AddressText } from '@/components/product/address-text';
import { SolAmount } from '@/components/product/sol-amount';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { isLanded } from '@/pages/account/check';
import { JobOutcome } from '@/pages/account/JobOutcome';
import { accountParams } from '@/pages/protect/wizard';
import type { JobView } from '@/signing/machine';
import { stakeRefusalText } from './plan.ts';

type StakeDoneProps = {
  headingRef: Ref<HTMLHeadingElement>;
  mainKey: Address;
  stakeAccount: Address;
  lamports: bigint;
  voteAccount: Address;
  job: JobView;
  checking: boolean;
  checkFailed: boolean;
  onRetry: () => void;
  onCheckAgain: () => void;
  onBack: () => void;
};

/**
 * The end of a run on /stake: the new stake account exists and is delegated, and the next step is to protect it (it
 * has no lock yet); or what did not happen and the way forward.
 */
export function StakeDone({ headingRef, mainKey, stakeAccount, lamports, voteAccount, job, checking, checkFailed, onRetry, onCheckAgain, onBack }: StakeDoneProps) {
  const headingId = useId();
  if (!isLanded(job)) {
    return (
      <JobOutcome
        headingRef={headingRef}
        title={t('stake.result')}
        job={job}
        refusalText={stakeRefusalText}
        checking={checking}
        checkFailed={checkFailed}
        onRetry={onRetry}
        onCheckAgain={onCheckAgain}
        onBack={onBack}
      />
    );
  }
  return (
    <section aria-labelledby={headingId} data-slot="stake-done" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="flex items-start gap-2 text-2xl">
          <CircleCheckIcon aria-hidden="true" className="mt-1 size-6 shrink-0 text-success" />
          {t('stake.done.title')}
        </h2>
        <p className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className="text-muted">{t('stake.done.account')}</span>
          <AddressText address={stakeAccount} />
        </p>
        <p className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className="text-muted">{t('components.tx.amount')}</span>
          <SolAmount lamports={lamports} />
        </p>
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
      <p className="max-w-prose text-pretty">{t('stake.done.body')}</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button asChild>
          <Link href={`/protect?${accountParams([stakeAccount]).toString()}`}>
            <ShieldCheckIcon aria-hidden="true" />
            {t('stake.done.protect')}
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={`/app?${new URLSearchParams({ address: mainKey }).toString()}`}>{t('common.backToAccounts')}</Link>
        </Button>
      </div>
    </section>
  );
}
