import type { Address } from '@solana/kit';
import { formatUtcDate, shortAddress } from '@stakeward/core';
import { CircleCheckIcon, LoaderCircleIcon, TriangleAlertIcon } from 'lucide-react';
import { useId, type Ref } from 'react';
import { Link } from 'wouter';
import { AddressText } from '@/components/product/address-text';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { isLanded } from '@/pages/account/check';
import { JobOutcome } from '@/pages/account/JobOutcome';
import type { JobView } from '@/signing/machine';
import { secondKeyRefusalText } from './plan.ts';

/** Whether the old second key still holds other locks of this main key (SecondKeyPage, memory.ts). */
export type OthersCheck = { kind: 'checking' } | { kind: 'found'; accounts: readonly Address[] } | { kind: 'failed' };

type SecondKeyDoneProps = {
  headingRef: Ref<HTMLHeadingElement>;
  account: Address;
  /** The second key the run handed the lock from. */
  secondKey: Address;
  /** The second key the run handed the lock to. */
  newSecondKey: Address;
  /** The main key, for the way back to its accounts. */
  mainKey: Address;
  /** The old key's other locks of this main key. */
  others: OthersCheck;
  /** The run's outcome for this stake account. */
  job: JobView;
  checking: boolean;
  checkFailed: boolean;
  onRetry: () => void;
  onCheckAgain: () => void;
  onBack: () => void;
};

/**
 * The end of a run on /second-key/:account: what changed (the key that holds the lock now, the old one that no longer
 * can, the end that stays), the transaction, and the new recovery card to print; or what did not happen and the way
 * forward (JobOutcome).
 */
export function SecondKeyDone({
  headingRef,
  account,
  secondKey,
  newSecondKey,
  mainKey,
  others,
  job,
  checking,
  checkFailed,
  onRetry,
  onCheckAgain,
  onBack,
}: SecondKeyDoneProps) {
  const headingId = useId();
  if (!isLanded(job)) {
    return (
      <JobOutcome
        headingRef={headingRef}
        title={t('secondKey.result')}
        job={job}
        refusalText={secondKeyRefusalText}
        checking={checking}
        checkFailed={checkFailed}
        onRetry={onRetry}
        onCheckAgain={onCheckAgain}
        onBack={onBack}
      />
    );
  }
  // The account as the chain showed it when the change was confirmed (or found already made).
  const after = job.state.kind === 'done' || job.state.kind === 'already-done' ? job.state.after : null;
  const end = after === null ? null : formatUtcDate(after.lockup.unixTimestamp);
  return (
    <section aria-labelledby={headingId} data-slot="second-key-done" className="flex flex-col gap-4">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-2xl font-semibold">
        <CircleCheckIcon aria-hidden="true" className="size-6 shrink-0 text-success" />
        {t('secondKey.done.heading')}
      </h2>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{t('secondKey.done.newKey')}</p>
        <AddressText address={newSecondKey} variant="full" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{t('secondKey.done.oldKey')}</p>
        <AddressText address={secondKey} variant="full" />
      </div>
      {end === null ? null : <p>{t('secondKey.done.end', { date: end })}</p>}
      {job.signature === null ? null : (
        <p className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className="text-muted">{t('components.jobs.transaction')}</span>
          <AddressText address={job.signature} kind="tx" />
        </p>
      )}
      <OtherLocks others={others} mainKey={mainKey} />
      <p className="max-w-prose">{t('secondKey.done.card')}</p>
      <div>
        <Button asChild>
          <Link href={`/recovery/${account}`}>{t('secondKey.done.openCard')}</Link>
        </Button>
      </div>
    </section>
  );
}

/**
 * The old second key's other locks of this main key: if it was stolen, those are exactly the stake accounts the thief
 * can still freeze, so each gets its way to the same hand-over. Said while checking, and when the check failed.
 */
function OtherLocks({ others, mainKey }: { others: OthersCheck; mainKey: Address }) {
  switch (others.kind) {
    case 'checking':
      return (
        <p role="status" className="flex items-center gap-2 text-sm text-muted">
          <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
          {t('secondKey.done.others.checking')}
        </p>
      );
    case 'failed':
      return (
        <Alert tone="warning" role="note" data-slot="other-locks">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription className="flex flex-col gap-2 text-foreground">
            <p>{t('secondKey.done.others.failed')}</p>
            <div>
              <Button asChild variant="outline" size="sm">
                <Link href={`/app?${new URLSearchParams({ address: mainKey }).toString()}`}>{t('secondKey.done.others.accounts')}</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      );
    case 'found':
      if (others.accounts.length === 0) return null;
      return (
        <Alert tone="warning" data-slot="other-locks">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>{t('secondKey.done.others.title')}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2 text-foreground">
            <p>{t('secondKey.done.others.body')}</p>
            <ul className="flex flex-col gap-1">
              {others.accounts.map((other) => (
                <li key={other} className="flex flex-wrap items-center gap-x-3">
                  <AddressText address={other} />
                  <Link
                    href={`/second-key/${other}`}
                    aria-label={t('secondKey.done.others.handOverLabel', { address: shortAddress(other) })}
                    className="rounded-sm text-sm font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
                  >
                    {t('secondKey.done.others.handOver')}
                  </Link>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      );
  }
}
