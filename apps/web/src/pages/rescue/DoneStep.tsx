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
import { cn } from 'cn';
import {
  CircleAlertIcon,
  CircleCheckIcon,
  ExternalLinkIcon,
  FileTextIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
  SearchIcon,
  SendIcon,
  ShieldCheckIcon,
  TrendingUpIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from 'lucide-react';
import { useId, useRef, useState, type ReactNode, type Ref } from 'react';
import { Link } from 'wouter';
import { Section } from '@/components/layout/Section';
import { AccountList, AccountListItem, AccountRow } from '@/components/product/account-row';
import { AddressText } from '@/components/product/address-text';
import { JobStatusList, type JobStatusItem } from '@/components/product/job-status-list';
import { Button } from '@/components/ui/button';
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
 * Step 5 (F4 step 6): what the chain now shows moved to the new wallet (its address once, in full), what did not move
 * yet and the way forward for it, then the next steps after a rescue as one checklist (DECISIONS.md D109): use the new
 * wallet from now on, delegate again what stopped staking, print a new recovery card, alerts for the new wallet, close
 * the link-signing account, and a fresh look for stake accounts split off meanwhile. One filled button: Try again
 * while something can be retried, else the new wallet's stake.
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
  const TitleIcon = done === 0 ? CircleAlertIcon : done < total ? TriangleAlertIcon : CircleCheckIcon;
  const titleTone = done === 0 ? 'text-danger' : done < total ? 'text-warning' : 'text-success';
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
  const closeCard = <NonceCloseCard authority={newWallet} role="new" signing={signing} />;

  return (
    <section aria-labelledby={headingId} data-slot="rescue-done" className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="flex items-start gap-2 text-2xl">
          <TitleIcon aria-hidden="true" className={cn('mt-1 size-6 shrink-0', titleTone)} />
          {title}
        </h2>
        {done === 0 ? null : (
          <div data-slot="rescue-new-owner" className="flex flex-col gap-1">
            <p className="text-sm text-muted">{t('rescue.done.owner')}</p>
            <AddressText address={newWallet} variant="full" explorer />
          </div>
        )}
      </div>

      {moved.length === 0 ? null : (
        <Section title={t('rescue.done.movedList')} headingLevel={3} count={moved.length}>
          <AccountList label={t('rescue.done.movedList')}>
            {moved.map(({ job, after }) => (
              <AccountListItem key={job.id}>
                <MovedRow job={job} after={after} clock={clock} secondKey={secondKey} />
              </AccountListItem>
            ))}
          </AccountList>
        </Section>
      )}

      {others.length === 0 ? null : (
        <Section title={t('rescue.done.notMovedList')} headingLevel={3} count={others.length}>
          <JobStatusList items={others.map(notMovedItem)} label={t('rescue.done.notMovedList')} />
          {checkFailed ? (
            <p role="status" className="flex items-start gap-2 text-sm font-medium text-danger">
              <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
              {t('protect.done.checkFailed')}
            </p>
          ) : null}
          {waitsForLink ? <p className="max-w-prose text-sm">{t('components.jobs.retryAfterLink')}</p> : null}
          {retryable.length === 0 && uncertain.length === 0 ? null : (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
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
        </Section>
      )}

      {done === 0 ? (
        closeCard
      ) : (
        <Section title={t('rescue.done.nextSteps')} headingLevel={3}>
          <ol className="flex flex-col gap-5">
            <NextStep icon={TriangleAlertIcon} tone="warning" slot="use-new-wallet">
              <p className="max-w-prose font-medium">{t('rescue.done.useNew')}</p>
              {locks.held === 0 ? null : <p className="max-w-prose text-sm text-muted">{t('rescue.done.lockKept')}</p>}
              {locks.noLock.length === 0 ? null : (
                <p className="max-w-prose text-sm text-muted">
                  {locks.noLock.length === 1 ? t('rescue.done.noLockOne') : t('rescue.done.noLockOther', { count: locks.noLock.length })}
                </p>
              )}
              {locks.ended.length === 0 ? null : (
                <p className="max-w-prose text-sm text-muted">
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
            </NextStep>
            {idle.length === 0 ? null : <DelegateStep accounts={idle} newWallet={newWallet} signing={signing} />}
            {locks.card === null ? null : (
              // A card printed before names the old main key; one new card covers every account of the pair (D74).
              <NextStep icon={FileTextIcon} title={t('rescue.done.recovery.title')} slot="recovery-card">
                <p className="max-w-prose text-sm text-muted">{t('rescue.done.recovery.body')}</p>
                <div>
                  <Button asChild variant="outline" className="h-auto min-h-10 max-w-full whitespace-normal">
                    <Link href={appLinks.recovery(locks.card)}>{t('rescue.done.recovery.open')}</Link>
                  </Button>
                </div>
              </NextStep>
            )}
            <NextStep icon={SendIcon} title={t('rescue.done.telegram')} slot="telegram">
              <div>
                <Button asChild variant="outline">
                  <a
                    href={telegramLinkPath(newWallet)}
                    target="_blank"
                    rel={NEW_TAB_REL}
                    aria-label={`${t('rescue.done.telegramAction')} ${t('common.opensInNewTab')}`}
                  >
                    {t('rescue.done.telegramAction')}
                    <ExternalLinkIcon aria-hidden="true" />
                  </a>
                </Button>
              </div>
            </NextStep>
          </ol>
          {/* The link-signing account: shown only while it holds the deposit (NonceCloseCard). */}
          {closeCard}
        </Section>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button asChild variant={retryable.length > 0 ? 'outline' : 'primary'}>
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

type NextStepProps = {
  icon: LucideIcon;
  /** The step's h4; a step without one says its sentence in its body. */
  title?: string | undefined;
  tone?: 'default' | 'warning' | undefined;
  slot: string;
  children: ReactNode;
};

/** One item of the Done checklist: an icon tile, its title, one or two lines and at most one outline action. */
function NextStep({ icon: Icon, title, tone = 'default', slot, children }: NextStepProps) {
  return (
    <li data-slot="next-step" data-step={slot} className="flex items-start gap-3">
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full',
          tone === 'warning' ? 'bg-warning-soft text-warning' : 'bg-primary-soft text-primary',
        )}
      >
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
        {title === undefined ? null : <h4 className="text-base font-semibold">{title}</h4>}
        {children}
      </div>
    </li>
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

function MovedRow({ job, after, clock, secondKey }: { job: JobView; after: StakeAccount | null; clock: ClockView; secondKey: Address }) {
  const transaction =
    job.signature === null ? null : (
      <span className="inline-flex flex-wrap items-center gap-x-1">
        <span>{t('components.jobs.transaction')}</span>
        <AddressText address={job.signature} kind="tx" />
      </span>
    );
  if (after === null) {
    // Applied on the chain but not readable as a stake account now: the outcome without the row.
    return (
      <div className="flex flex-col gap-2">
        <JobStatusList items={[{ address: job.id as Address, status: 'done', signature: job.signature }]} label={t('rescue.done.movedList')} />
      </div>
    );
  }
  const view = scannerStatus(after, [secondKey], clock);
  return (
    <AccountRow
      account={after}
      activation={stakeActivationStatus(after.delegation, clock.epoch)}
      clock={clock}
      protection={view.status}
      managedByService={view.managedByService}
      secondKeyKnown
      hint={false}
      serviceDetail
      meta={transaction}
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
 * to, and one request to the new wallet that delegates them all back to it. An outline action: the screen's one filled
 * button stays the way on.
 */
function DelegateStep({ accounts, newWallet, signing }: { accounts: readonly StakeAccount[]; newWallet: Address; signing?: SigningTestOptions | undefined }) {
  const [state, setState] = useState<DelegateState>({ kind: 'idle' });
  const runs = useRef(0);
  const start = () => {
    runs.current += 1;
    setState({ kind: 'sign', key: runs.current });
  };
  const ids = accounts.map((account) => account.address);
  return (
    <NextStep icon={TrendingUpIcon} title={t('rescue.done.delegate.title')} slot="delegate">
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
          <p className="max-w-prose text-sm text-muted">{t('rescue.done.delegate.body')}</p>
          <ul className="flex flex-col gap-3">
            {accounts.map((account) =>
              account.delegation === null ? null : (
                <li key={account.address} className="flex flex-col gap-0.5 text-sm">
                  <span className="font-medium">{t('components.accountRow.label', { address: shortAddress(account.address) })}</span>
                  <span className="text-muted">{t('components.tx.validator')}</span>
                  <AddressText address={account.delegation.voter} variant="full" explorer />
                </li>
              ),
            )}
          </ul>
          {state.kind === 'done' ? <JobStatusList items={state.jobs.map(notMovedItem)} label={t('rescue.done.delegate.title')} /> : null}
          {state.kind === 'done' && state.jobs.every((job) => movedAccountOf(job) !== undefined) ? null : (
            <div>
              <Button variant="outline" onClick={start}>
                {state.kind === 'done' ? <RotateCcwIcon aria-hidden="true" /> : null}
                {state.kind === 'done' ? t('common.tryAgain') : t('rescue.done.delegate.action')}
              </Button>
            </div>
          )}
        </>
      )}
    </NextStep>
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
