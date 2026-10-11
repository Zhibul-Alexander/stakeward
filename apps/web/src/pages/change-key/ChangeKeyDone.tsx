import type { Address } from '@solana/kit';
import { CircleCheckIcon, FileTextIcon } from 'lucide-react';
import { useId, type Ref } from 'react';
import { Link } from 'wouter';
import { AddressText } from '@/components/product/address-text';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { isLanded } from '@/pages/account/check';
import { JobOutcome } from '@/pages/account/JobOutcome';
import { appLinks } from '@/pages/app/view';
import type { JobView } from '@/signing/machine';
import { changeKeyRefusalText } from './plan.ts';

type ChangeKeyDoneProps = {
  headingRef: Ref<HTMLHeadingElement>;
  account: Address;
  /** The stake's main key: "Back to your accounts" shows its stake. */
  mainKey: Address;
  newKey: Address;
  job: JobView;
  checking: boolean;
  checkFailed: boolean;
  onRetry: () => void;
  onCheckAgain: () => void;
  onBack: () => void;
};

/**
 * The end of a run on /change-key/:account: the new second key holds the lock, the old one can no longer change it, and
 * a printed recovery card names the old key, so print a new one; or what did not happen and the way forward.
 */
export function ChangeKeyDone({ headingRef, account, mainKey, newKey, job, checking, checkFailed, onRetry, onCheckAgain, onBack }: ChangeKeyDoneProps) {
  const headingId = useId();
  if (!isLanded(job)) {
    return (
      <JobOutcome
        headingRef={headingRef}
        title={t('changeKey.result')}
        job={job}
        refusalText={changeKeyRefusalText}
        checking={checking}
        checkFailed={checkFailed}
        onRetry={onRetry}
        onCheckAgain={onCheckAgain}
        onBack={onBack}
      />
    );
  }
  return (
    <section aria-labelledby={headingId} data-slot="change-key-done" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="flex items-start gap-2 text-2xl">
          <CircleCheckIcon aria-hidden="true" className="mt-1 size-6 shrink-0 text-success" />
          {t('changeKey.done.title')}
        </h2>
        <p className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className="text-muted">{t('common.roles.second')}</span>
          <AddressText address={newKey} />
        </p>
        {job.signature === null ? null : (
          <p className="flex flex-wrap items-center gap-x-2 text-sm">
            <span className="text-muted">{t('components.jobs.transaction')}</span>
            <AddressText address={job.signature} kind="tx" />
          </p>
        )}
      </div>
      <p className="max-w-prose text-pretty">{t('changeKey.done.body')}</p>
      {/* A card printed before names the old second key: the new card is the way on. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button asChild>
          <Link href={appLinks.recovery(account)}>
            <FileTextIcon aria-hidden="true" />
            {t('changeKey.done.recovery')}
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={`/app?${new URLSearchParams({ address: mainKey }).toString()}`}>{t('common.backToAccounts')}</Link>
        </Button>
      </div>
    </section>
  );
}
