import type { Address } from '@solana/kit';
import {
  isLockupInForce,
  scannerStatus,
  shortAddress,
  stakeActivationStatus,
  type ClockView,
  type StakeAccount,
  type WalletRole,
} from '@stakeward/core';
import { CircleAlertIcon, FileTextIcon, LoaderCircleIcon, RotateCcwIcon, SearchIcon, SendIcon, ShieldCheckIcon } from 'lucide-react';
import { useId, useRef, useState, type ReactNode, type Ref } from 'react';
import { Link } from 'wouter';
import { AccountRow } from '@/components/product/account-row';
import { AddressText } from '@/components/product/address-text';
import { JobStatusList, type JobStatusItem } from '@/components/product/job-status-list';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { telegramLinkPath } from '@/api/telegram';
import { t } from '@/i18n';
import { KeySlot } from '@/pages/app/KeySlot';
import { appLinks } from '@/pages/app/view';
import { cardLock } from '@/pages/recovery/view';
import { usePorts } from '@/ports';
import { createPageSession, type SigningTestOptions } from '@/signing/create';
import { isLinkOpen, isRetryable, retryableOutcomes } from '@/pages/account/check';
import type { JobView, SigningState } from '@/signing/machine';
import { NonceCloseCard } from '@/signing/NonceCloseCard';
import { PageSigningPanel } from '@/signing/SigningPanel';
import { useSigningSession } from '@/signing/use-signing-session';
import { defaultJobReason, jobStatus } from '@/signing/view';
import { delegatePlan, rescueRefusalText } from './plan.ts';

export type RescueDoneActions = {
  /** A new run (through the nonce gate again) for the accounts known not to have moved. */
  retry: () => void;
  /** Read the uncertain ones again. */
  checkAgain: () => void;
  /** Back to the first step for a fresh search (splits made meanwhile). */
  lookAgain: () => void;
};

type DoneStepProps = {
  headingRef: Ref<HTMLHeadingElement>;
  /** Every account of the wizard's runs, in the order they were first signed, with its last outcome. */
  outcomes: readonly JobView[];
  clock: ClockView;
  newWallet: Address;
  secondKey: Address;
  checking: boolean;
  checkFailed: boolean;
  actions: RescueDoneActions;
  signing?: SigningTestOptions | undefined;
};

/** A link that opens in a new tab shares neither this page (window.opener) nor its address (Referer). */
const NEW_TAB_REL = 'noopener noreferrer';

/** The account as the chain showed it once moved; undefined for an account that did not move. */
function movedAccountOf(job: JobView): StakeAccount | null | undefined {
  const { state } = job;
  return state.kind === 'done' || state.kind === 'already-done' ? state.after : undefined;
}

/**
 * Step 5 (F4 step 6): what the chain now shows moved to the new wallet, what did not move yet and the way forward for
 * it, then what comes after a rescue: use the new wallet from now on, delegate again what stopped staking, close the
 * link-signing account, alerts for the new wallet, and a fresh look for stake accounts split off meanwhile.
 */
export function DoneStep({ headingRef, outcomes, clock, newWallet, secondKey, checking, checkFailed, actions, signing }: DoneStepProps) {
  const headingId = useId();
  const moved = outcomes.flatMap((job) => {
    const after = movedAccountOf(job);
    return after === undefined ? [] : [{ job, after }];
  });
  const others = outcomes.filter((job) => movedAccountOf(job) === undefined);
  const total = outcomes.length;
  const done = moved.length;
  const title =
    done === 0
      ? t('rescue.done.titleNone')
      : done < total
        ? t('rescue.done.titlePartial', { done, total })
        : done === 1
          ? t('rescue.done.titleOne')
          : t('rescue.done.titleOther', { count: done });
  const retryable = retryableOutcomes(others);
  // A link still open holds back Try again for the rest (retryableOutcomes): say why.
  const waitsForLink = others.some(isLinkOpen) && others.some(isRetryable);
  const uncertain = others.filter((job) => job.state.kind === 'unknown');
  // Moved accounts that stopped staking (a thief deactivated them) can earn rewards again with the same validator.
  const idle = moved.flatMap(({ after }) => {
    if (after?.delegation === null || after?.delegation === undefined) return [];
    const activation = stakeActivationStatus(after.delegation, clock.epoch);
    return activation === 'inactive' || activation === 'deactivating' ? [after] : [];
  });
  const locks = lockSummary(moved, clock, secondKey);

  return (
    <section aria-labelledby={headingId} data-slot="rescue-done" className="flex flex-col gap-8">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-2xl font-semibold">
        {title}
      </h2>

      {moved.length === 0 ? null : (
        <List title={t('rescue.done.movedList')}>
          <ul className="flex flex-col gap-3">
            {moved.map(({ job, after }) => (
              <li key={job.id}>
                <MovedRow job={job} after={after} clock={clock} newWallet={newWallet} secondKey={secondKey} />
              </li>
            ))}
          </ul>
        </List>
      )}

      {others.length === 0 ? null : (
        <List title={t('rescue.done.notMovedList')}>
          <JobStatusList items={others.map(notMovedItem)} label={t('rescue.done.notMovedList')} />
          {checkFailed ? (
            <p role="status" className="flex items-start gap-2 text-sm font-medium text-danger">
              <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
              {t('protect.done.checkFailed')}
            </p>
          ) : null}
          {waitsForLink ? <p className="max-w-prose text-sm">{t('components.jobs.retryAfterLink')}</p> : null}
          {retryable.length === 0 && uncertain.length === 0 ? null : (
            <div className="flex flex-wrap gap-2">
              {retryable.length === 0 ? null : (
                <Button onClick={actions.retry}>
                  <RotateCcwIcon aria-hidden="true" />
                  {t('common.tryAgain')}
                </Button>
              )}
              {uncertain.length === 0 ? null : (
                <Button variant="outline" onClick={actions.checkAgain} disabled={checking}>
                  {checking ? <LoaderCircleIcon aria-hidden="true" className="animate-spin" /> : <SearchIcon aria-hidden="true" />}
                  {t('common.checkAgain')}
                </Button>
              )}
            </div>
          )}
        </List>
      )}

      {done === 0 ? null : (
        <div className="flex max-w-prose flex-col gap-2">
          <p className="font-medium">{t('rescue.done.useNew')}</p>
          {locks.held === 0 ? null : <p>{t('rescue.done.lockKept')}</p>}
          {locks.noLock.length === 0 ? null : (
            <p>
              {locks.noLock.length === 1
                ? t('rescue.done.noLockOne')
                : t('rescue.done.noLockOther', { count: locks.noLock.length })}
            </p>
          )}
          {locks.ended.length === 0 ? null : (
            <p>
              {locks.ended.length === 1
                ? t('rescue.done.lockEndedOne')
                : t('rescue.done.lockEndedOther', { count: locks.ended.length })}
            </p>
          )}
          {locks.open.length === 0 ? null : (
            <div>
              <Button asChild variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal">
                <Link href={appLinks.protect(locks.open)}>
                  <ShieldCheckIcon aria-hidden="true" />
                  {locks.open.length === 1
                    ? t('rescue.done.protectOne')
                    : t('rescue.done.protectOther', { count: locks.open.length })}
                </Link>
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
        {idle.length === 0 ? null : <DelegateCard accounts={idle} newWallet={newWallet} signing={signing} />}
        {locks.card === null ? null : (
          // A card printed before names the old main key; one new card covers every account of the pair (D74).
          <DoneCard title={t('rescue.done.recovery.title')} description={t('rescue.done.recovery.body')}>
            <div>
              <Button asChild variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal">
                <Link href={appLinks.recovery(locks.card)}>
                  <FileTextIcon aria-hidden="true" />
                  {t('rescue.done.recovery.open')}
                </Link>
              </Button>
            </div>
          </DoneCard>
        )}
        <NonceCloseCard authority={newWallet} role="new" signing={signing} />
        <DoneCard title={t('rescue.done.telegram')}>
          <div>
            <Button asChild variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal">
              <a
                href={telegramLinkPath(newWallet)}
                target="_blank"
                rel={NEW_TAB_REL}
                aria-label={`${t('rescue.done.telegram')} ${t('common.opensInNewTab')}`}
              >
                <SendIcon aria-hidden="true" />
                {t('rescue.done.telegram')}
              </a>
            </Button>
          </div>
        </DoneCard>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href={`/app?${new URLSearchParams({ address: newWallet }).toString()}`}>{t('rescue.done.view')}</Link>
        </Button>
        <Button variant="outline" onClick={actions.lookAgain}>
          <SearchIcon aria-hidden="true" />
          {t('rescue.done.more')}
        </Button>
      </div>
    </section>
  );
}

type LockSummary = {
  /** Moved accounts whose lock is in force and held by this rescue's second key. */
  held: number;
  /** The first of them a recovery card can be written for, or null (a lock an epoch holds has no card, D74). */
  card: Address | null;
  /** Moved accounts that never had a lock (`lockText` says "No lock"), and those whose lock had ended. */
  noLock: readonly Address[];
  ended: readonly Address[];
  /** Both, in the order they moved: the accounts to protect again. */
  open: readonly Address[];
};

/**
 * A rescue keeps each lock as it was (D70). The Done screen says the second key holds a lock only where it holds one
 * in force (as MovedRow's status does), tells an account that never had a lock from one whose lock had ended, and
 * offers a recovery card only where one can be written.
 */
function lockSummary(moved: readonly { after: StakeAccount | null }[], clock: ClockView, secondKey: Address): LockSummary {
  const summary: { held: number; card: Address | null; noLock: Address[]; ended: Address[]; open: Address[] } = {
    held: 0,
    card: null,
    noLock: [],
    ended: [],
    open: [],
  };
  for (const { after } of moved) {
    if (after === null) continue;
    if (isLockupInForce(after.lockup, clock)) {
      if (after.lockup.custodian !== secondKey) continue;
      summary.held += 1;
      if (summary.card === null && cardLock(after, clock) === 'protected') summary.card = after.address;
      continue;
    }
    (after.lockup.unixTimestamp > 0n ? summary.ended : summary.noLock).push(after.address);
    summary.open.push(after.address);
  }
  return summary;
}

function List({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h3 id={id} className="text-xl font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

function DoneCard({ title, description, children }: { title: string; description?: string | undefined; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle asChild>
          <h3>{title}</h3>
        </CardTitle>
        {description === undefined ? null : <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

function MovedRow({
  job,
  after,
  clock,
  newWallet,
  secondKey,
}: {
  job: JobView;
  after: StakeAccount | null;
  clock: ClockView;
  newWallet: Address;
  secondKey: Address;
}) {
  const details = (
    <span className="flex w-full flex-col gap-2 text-sm">
      <span className="flex flex-col gap-1">
        <span className="font-medium">{t('rescue.done.owner')}</span>
        <AddressText address={newWallet} variant="full" />
      </span>
      {job.signature === null ? null : (
        <span className="flex flex-wrap items-center gap-x-2">
          <span className="text-muted">{t('components.jobs.transaction')}</span>
          <AddressText address={job.signature} kind="tx" />
        </span>
      )}
    </span>
  );
  if (after === null) {
    // Applied on the chain but not readable as a stake account now: the outcome without the row.
    return (
      <div className="flex flex-col gap-2">
        <JobStatusList items={[{ address: job.id as Address, status: 'done', signature: job.signature }]} label={t('rescue.done.movedList')} />
        {details}
      </div>
    );
  }
  const view = scannerStatus(after, [secondKey], clock);
  return (
    <AccountRow
      account={after}
      activation={stakeActivationStatus(after.delegation, clock.epoch)}
      protection={view.status}
      managedByService={view.managedByService}
      secondKeyKnown
      actions={details}
    />
  );
}

/** A "Not moved yet" line: the refusal in the page's words, or what the engine says about the outcome. */
function notMovedItem(job: JobView): JobStatusItem {
  const { state } = job;
  const item: JobStatusItem = { address: job.id as Address, status: jobStatus(state), signature: job.signature };
  const reason = state.kind === 'refused' ? rescueRefusalText(state.reason) : defaultJobReason(job);
  if (reason !== undefined) item.reason = reason;
  if (state.kind === 'failed' || state.kind === 'sim-failed') item.detail = state.error.detail;
  return item;
}

type DelegateState = { kind: 'idle' } | { kind: 'sign'; key: number } | { kind: 'done'; jobs: readonly JobView[] };

/**
 * "Earn rewards again" (F4 step 6): the moved accounts that stopped staking, each with the validator it was delegated
 * to, and one request to the new wallet that delegates them all back to it.
 */
function DelegateCard({ accounts, newWallet, signing }: { accounts: readonly StakeAccount[]; newWallet: Address; signing?: SigningTestOptions | undefined }) {
  const [state, setState] = useState<DelegateState>({ kind: 'idle' });
  const runs = useRef(0);
  const start = () => {
    runs.current += 1;
    setState({ kind: 'sign', key: runs.current });
  };
  const ids = accounts.map((account) => account.address);
  return (
    <DoneCard title={t('rescue.done.delegate.title')} description={t('rescue.done.delegate.body')}>
      {state.kind === 'sign' ? (
        <DelegateSigning
          ids={ids}
          newWallet={newWallet}
          runKey={state.key}
          signing={signing}
          onFinished={(finished) => {
            setState({ kind: 'done', jobs: finished.ids.flatMap((id) => finished.jobs[id] ?? []) });
          }}
          onBack={() => {
            setState({ kind: 'idle' });
          }}
        />
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {accounts.map((account) =>
              account.delegation === null ? null : (
                <li key={account.address} className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">{t('components.accountRow.label', { address: shortAddress(account.address) })}</span>
                  <span className="text-muted">{t('components.tx.validator')}</span>
                  <AddressText address={account.delegation.voter} variant="full" />
                </li>
              ),
            )}
          </ul>
          {state.kind === 'done' ? <JobStatusList items={state.jobs.map(notMovedItem)} label={t('rescue.done.delegate.title')} /> : null}
          {state.kind === 'done' && state.jobs.every((job) => movedAccountOf(job) !== undefined) ? null : (
            <div>
              <Button onClick={start}>
                {state.kind === 'done' ? <RotateCcwIcon aria-hidden="true" /> : null}
                {state.kind === 'done' ? t('common.tryAgain') : t('rescue.done.delegate.action')}
              </Button>
            </div>
          )}
        </>
      )}
    </DoneCard>
  );
}

function DelegateSigning({
  ids,
  newWallet,
  runKey,
  signing,
  onFinished,
  onBack,
}: {
  ids: readonly Address[];
  newWallet: Address;
  runKey: number;
  signing?: SigningTestOptions | undefined;
  onFinished: (state: SigningState) => void;
  onBack: () => void;
}) {
  const ports = usePorts();
  const create = () => createPageSession(ports, { plan: delegatePlan({ newWallet }), ids, signing, onFinished });
  const { session, snapshot } = useSigningSession(create, `delegate#${String(runKey)}`);
  return (
    <PageSigningPanel
      session={session}
      state={snapshot}
      ids={ids}
      roundSize={ids.length}
      knownRoles={{ new: newWallet }}
      renderKeySlot={(role: WalletRole, address: Address) => <KeySlot role={role} expected={address} />}
      onBack={onBack}
    />
  );
}
