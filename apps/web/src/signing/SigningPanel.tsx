import type { Address } from '@solana/kit';
import { formatSol, summariesMatchExceptStakeAccount, type WalletRole } from '@stakeward/core';
import { CircleAlertIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ActionBar } from '@/components/product/action-bar';
import { AddressText } from '@/components/product/address-text';
import { ErrorState } from '@/components/product/error-state';
import { JobStatusList, type JobStatusItem } from '@/components/product/job-status-list';
import { LinkCard } from '@/components/product/link-card';
import { SignerList, SignerListSkeleton } from '@/components/product/signer-list';
import {
  TransactionSummary,
  TransactionSummarySkeleton,
  type OnChainContext,
} from '@/components/product/transaction-summary';
import { roleLabel } from '@/components/product/wallet-slot';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { initialSigningState, type PrepareProblem, type SignStep, type SigningState, type StopReason } from './machine.ts';
import type { SigningSession } from './session.ts';
import { backKind, defaultJobReason, earlierSent, jobItems, jobStatus, linkView, roundProgress, sendProgress, signerItems } from './view.ts';

/** What the panel's buttons call: a SigningSession, or no-ops for the /dev/ui fixtures. */
export type SigningActions = Pick<
  SigningSession,
  | 'sign'
  | 'continueWithWallet'
  | 'continueAfterSwitch'
  | 'stopWaiting'
  | 'restartRound'
  | 'oneAtATime'
  | 'retryPrepare'
  | 'finish'
  | 'resumeLink'
  | 'checkLinkNow'
>;

type SigningViewProps = {
  state: SigningState;
  actions: SigningActions;
  /** Addresses the page knows by role, to name signers the action itself does not name. */
  knownRoles: Partial<Record<WalletRole, Address>>;
  /**
   * The page's key slot for a role, shown when that key must be connected to go on. `address` is the key this step
   * needs, so the slot can say which account to switch to (KeySlot `expected`).
   */
  renderKeySlot: (role: WalletRole, address: Address) => ReactNode;
  /** Back to the page's previous screen. Without it no Back button is shown (/cosign has nowhere to go back to). */
  onBack?: (() => void) | undefined;
  /**
   * A confirmation the user must tick before any wallet is asked: a required checkbox with this label above the sign
   * button, kept for the round and cleared when the next round starts.
   */
  confirm?: { label: string } | undefined;
  /** While a signing link is open: the page's way to cancel it (NonceCloseCard), shown in the link card. */
  renderLinkCancel?: (() => ReactNode) | undefined;
  /**
   * The risk the signature takes on, said right above the Sign button (UX rule 6): usually an inline RiskNote with its
   * date (DECISIONS.md D109).
   */
  risk?: ReactNode;
  /** The summary's line that it is read from the bytes (TransactionSummary `intro`); default true. */
  summaryIntro?: boolean | undefined;
  /**
   * Leave out the signing order while exactly one signer has not signed (/cosign: the one who opened the link signs
   * next). The summary's "Who signs" still lists every signer. Default false.
   */
  hideSingleSigner?: boolean | undefined;
  /**
   * The page's words for why its plan left a stake account out (a refused job), said in the list of accounts that are
   * not in this request. Without it such a row shows its status only.
   */
  refusalText?: ((reason: string) => string) | undefined;
};

/**
 * The signing screen (CLAUDE.md section 6, UX rules 3 and 7), presentational: the round, who signs in which order (one
 * line per key), the inspector's summary of the exact bytes about to be signed as a receipt, then one action area that
 * explains the current wait and offers exactly one way forward (in the ready phase: the risk, then Sign and Back), and
 * from sending on each stake account's outcome.
 */
export function SigningView({
  state,
  actions,
  knownRoles,
  renderKeySlot,
  onBack,
  confirm,
  renderLinkCancel,
  risk,
  summaryIntro = true,
  hideSingleSigner = false,
  refusalText,
}: SigningViewProps) {
  const { phase } = state;
  const linkOpen = phase.kind === 'link';
  // Back on this tab (the other device may have signed meanwhile): check the link now instead of after the pause.
  useEffect(() => {
    if (!linkOpen) return undefined;
    const onVisibility = () => {
      if (document.visibilityState === 'visible') actions.checkLinkNow();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [linkOpen, actions]);
  const progress = roundProgress(state);
  const building = phase.kind === 'idle' || phase.kind === 'preparing';
  // A round that could not be prepared has nothing current to show (a failed rebuild must not show the old bytes).
  const shown = !building && phase.kind !== 'prepare-failed';
  const sent = phase.kind === 'sending' || phase.kind === 'confirming' || phase.kind === 'checking' || phase.kind === 'finished';
  const signers = shown ? signerItems(state) : [];
  // On /cosign, one signer left is the person who opened the link: the order would only repeat the Sign button.
  const singleLeft = signers.filter((signer) => signer.status !== 'signed').length === 1;
  const showOrder = signers.length > 0 && !(hideSingleSigner && singleLeft);
  const earlier = earlierSent(state);
  const leftOut = shown ? leftOutItems(state, refusalText) : [];
  return (
    <div data-slot="signing-panel" data-phase={phase.kind} className="flex flex-col gap-4 text-pretty">
      {progress.total > 1 ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">{t('signing.roundOf', progress)}</p>
          {earlier === 0 ? null : (
            <p className="text-sm text-muted">
              {earlier === 1 ? t('signing.earlierSentOne') : t('signing.earlierSentOther', { count: earlier })}
            </p>
          )}
        </div>
      ) : null}
      {leftOut.length === 0 ? null : (
        // Chosen, but not in the round being signed (read again and refused, failed its simulation, or already done):
        // the screen names them before anyone signs, so the count on the Sign button matches what was chosen.
        <LeftOutOfRound items={leftOut} />
      )}
      {building ? <SignerListSkeleton variant="compact" /> : showOrder ? <SignerList items={signers} variant="compact" /> : null}
      {building ? (
        <TransactionSummarySkeleton />
      ) : shown ? (
        <Summaries state={state} knownRoles={knownRoles} intro={summaryIntro} />
      ) : null}
      <div role="status" aria-live="polite" className="flex flex-col gap-3">
        {/* Keyed by round: the confirmation box holds for one round's signers and starts unticked in the next. */}
        <PhaseActions
          key={state.roundNumber}
          state={state}
          actions={actions}
          renderKeySlot={renderKeySlot}
          onBack={onBack}
          confirm={confirm}
          renderLinkCancel={renderLinkCancel}
          risk={risk}
        />
      </div>
      {sent ? <JobStatusList items={jobItems(state)} label={t('signing.transactions')} /> : null}
    </div>
  );
}

/** The signing screen driven by a session: `state` is the session's snapshot (useSigningSession). */
export function SigningPanel({ session, ...props }: Omit<SigningViewProps, 'actions'> & { session: SigningSession }) {
  return <SigningView {...props} actions={session} />;
}

const noop = () => undefined;

/** The buttons of a panel whose session is not attached yet: nothing to do until it is. */
const IDLE_ACTIONS: SigningActions = {
  sign: noop,
  continueWithWallet: noop,
  continueAfterSwitch: noop,
  stopWaiting: noop,
  restartRound: noop,
  oneAtATime: noop,
  retryPrepare: noop,
  finish: noop,
  resumeLink: noop,
  checkLinkNow: noop,
};

/**
 * A page's panel over the result of useSigningSession. In the first frame, before the session is attached, it shows
 * the same "building" view the session starts with (`ids` in rounds of `roundSize`), so the page does not flash.
 */
export function PageSigningPanel({
  session,
  state,
  ids,
  roundSize,
  ...props
}: Omit<SigningViewProps, 'actions' | 'state'> & {
  session: SigningSession | null;
  state: SigningState | null;
  ids: readonly string[];
  roundSize: number;
}) {
  if (session === null || state === null) {
    return <SigningView state={initialSigningState(ids, roundSize)} actions={IDLE_ACTIONS} {...props} />;
  }
  return <SigningView state={state} actions={session} {...props} />;
}

/**
 * One summary for the whole round when its transactions differ only in the stake account (core
 * `summariesMatchExceptStakeAccount`), otherwise one per transaction; each with the account's state as just read.
 */
function Summaries({
  state,
  knownRoles,
  intro,
}: {
  state: SigningState;
  knownRoles: Partial<Record<WalletRole, Address>>;
  intro: boolean;
}) {
  const txs = state.round?.txs ?? [];
  const [head] = txs;
  if (head === undefined) return null;
  const clock = state.clock ?? undefined;
  const currentOf = (id: string): OnChainContext | undefined => {
    const before = state.jobs[id]?.before ?? null;
    return before === null ? undefined : { lockup: before.lockup, clock };
  };
  const summaries = txs.map((tx) => tx.summary);
  if (txs.length > 1 && summariesMatchExceptStakeAccount(summaries)) {
    const accounts = txs.flatMap((tx) => {
      const { action } = tx.summary;
      if (!('stakeAccount' in action)) return [];
      return [{ address: action.stakeAccount, lamports: state.jobs[tx.id]?.before?.lamports ?? null, current: currentOf(tx.id) }];
    });
    const totalFeeLamports = summaries.reduce((sum, summary) => sum + summary.networkFeeLamports, 0n);
    return (
      <TransactionSummary
        summary={head.summary}
        knownRoles={knownRoles}
        batch={{ accounts, totalFeeLamports }}
        intro={intro}
        headingLevel={3}
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {txs.map((tx) => (
        <TransactionSummary
          key={tx.id}
          summary={tx.summary}
          current={currentOf(tx.id)}
          knownRoles={knownRoles}
          intro={intro}
          headingLevel={3}
        />
      ))}
    </div>
  );
}

type PhaseActionsProps = Omit<SigningViewProps, 'knownRoles' | 'summaryIntro' | 'hideSingleSigner' | 'refusalText'>;

function LeftOutOfRound({ items }: { items: JobStatusItem[] }) {
  const title = items.length === 1 ? t('signing.leftOutOne') : t('signing.leftOutOther', { count: items.length });
  return (
    <div data-slot="left-out-of-round" className="flex flex-col gap-2">
      <p className="text-sm font-medium">{title}</p>
      <JobStatusList items={items} label={title} />
    </div>
  );
}

/** The stake accounts of this round that have no transaction in it, each with its outcome and why. */
function leftOutItems(state: SigningState, refusalText: ((reason: string) => string) | undefined): JobStatusItem[] {
  const { round } = state;
  if (round === null) return [];
  const inRound = new Set(round.txs.map((tx) => tx.id));
  return round.ids.flatMap((id) => {
    const job = state.jobs[id];
    if (inRound.has(id) || job === undefined) return [];
    const { state: jobState } = job;
    if (jobState.kind !== 'refused' && jobState.kind !== 'sim-failed' && jobState.kind !== 'already-done') return [];
    const item: JobStatusItem = { address: id as Address, status: jobStatus(jobState), signature: job.signature };
    const reason = jobState.kind === 'refused' ? refusalText?.(jobState.reason) : defaultJobReason(job);
    if (reason !== undefined) item.reason = reason;
    if (jobState.kind === 'sim-failed') item.detail = jobState.error.detail;
    return [item];
  });
}

/** What happens now and the one way forward (UX rule 7: every wait is explained and has a way out). */
function PhaseActions({ state, actions, renderKeySlot, onBack, confirm, renderLinkCancel, risk }: PhaseActionsProps) {
  const { phase, round } = state;
  const back = backKind(state);
  // The confirmation box (`confirm`): ticked once per round; pressing Sign before that says so and moves focus to it.
  const [confirmed, setConfirmed] = useState(false);
  const [confirmAsked, setConfirmAsked] = useState(false);
  const confirmBox = useRef<HTMLButtonElement>(null);
  const confirmId = useId();
  const confirmErrorId = useId();
  // "Use this wallet" pressed while no wallet here holds the key (the session then does nothing): the step it was pressed
  // at, so the screen says why instead of a button that seems dead.
  const [walletAskedAt, setWalletAskedAt] = useState<number | null>(null);
  // After an earlier round was sent, "Nothing was sent" is about this round only.
  const roundOnly = earlierSent(state) > 0;
  const backButton =
    back === null ? null : back === 'finish' ? (
      <Button
        variant="ghost"
        onClick={() => {
          actions.finish();
        }}
        className="h-auto min-h-10 max-w-full whitespace-normal"
      >
        {t('signing.finishHere')}
      </Button>
    ) : onBack === undefined ? null : (
      <Button variant="ghost" onClick={onBack} className="h-auto min-h-10 max-w-full whitespace-normal">
        {back === 'back' ? t('common.back') : t('signing.backNothingSent')}
      </Button>
    );
  const step = 'step' in phase ? round?.steps[phase.step] : undefined;
  const wallet = step === undefined ? '' : walletOf(step);
  const role = step === undefined ? '' : roleLabel(step.role);

  switch (phase.kind) {
    case 'idle':
    case 'preparing':
      return <Waiting text={t('signing.preparing')}>{backButton}</Waiting>;

    case 'prepare-failed':
      return <PrepareFailed problem={phase.problem} actions={actions} backButton={backButton} finishing={back === 'finish'} />;

    case 'ready': {
      if (step === undefined) return null;
      const sameWallet =
        step.walletName !== null && (round?.steps.some((other) => other !== step && other.walletName === step.walletName) ?? false);
      const mustConfirm = confirm !== undefined && !confirmed;
      const confirmError = confirmAsked && mustConfirm;
      const firstHint = phase.step === 0 ? t('signing.firstHint', { wallet }) : null;
      return (
        <div className="flex flex-col gap-3">
          {phase.refreshed ? (
            <Alert tone="info" role="note">
              <InfoIcon aria-hidden="true" />
              <AlertDescription className="text-foreground">{t('signing.refreshed')}</AlertDescription>
            </Alert>
          ) : null}
          {sameWallet ? <p className="text-sm font-medium">{t('signing.sameWalletHint', { wallet, role })}</p> : null}
          {confirm === undefined ? null : (
            <div className="flex flex-col gap-2">
              <div className="flex items-start gap-3">
                <Checkbox
                  id={confirmId}
                  ref={confirmBox}
                  checked={confirmed}
                  required
                  aria-invalid={confirmError ? true : undefined}
                  aria-describedby={confirmError ? confirmErrorId : undefined}
                  className="mt-0.5"
                  onCheckedChange={(value) => {
                    setConfirmed(value === true);
                  }}
                />
                <Label htmlFor={confirmId}>{confirm.label}</Label>
              </div>
              {confirmError ? (
                <p id={confirmErrorId} className="flex items-start gap-2 text-sm font-medium text-danger">
                  <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <span>{t('signing.confirmRequired')}</span>
                </p>
              ) : null}
            </div>
          )}
          {/* The hint comes before the risk, so the Sign button stands right under the risk it guards. */}
          {firstHint === null ? null : <p className="text-sm text-muted">{firstHint}</p>}
          <ActionBar
            risk={risk}
            primary={
              <Button
                size="lg"
                // Not `disabled`: pressed before the box is ticked it says why and moves focus to the box.
                aria-disabled={mustConfirm ? true : undefined}
                aria-describedby={confirmError ? confirmErrorId : undefined}
                onClick={() => {
                  if (mustConfirm) {
                    setConfirmAsked(true);
                    confirmBox.current?.focus();
                    return;
                  }
                  actions.sign();
                }}
                className="h-auto min-h-12 max-w-full whitespace-normal text-balance aria-disabled:pointer-events-auto"
              >
                {step.count === 1
                  ? t('signing.signWith', { wallet, role })
                  : t('signing.signManyWith', { count: step.count, wallet, role })}
              </Button>
            }
            secondary={backButton ?? undefined}
          />
        </div>
      );
    }

    case 'needs-wallet': {
      if (step === undefined) return null;
      // The key slot's Connect is the screen's one filled button (the page passes emphasis="primary"); the button
      // under it only goes on once a wallet here holds the key (the session checks), so it stays outline. Pressed
      // before that, the session changes nothing and the line under it says why.
      const notYet = walletAskedAt === phase.step;
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">{t('signing.needWallet', { role })}</p>
          {renderKeySlot(step.role, step.address)}
          <ActionBar
            primary={
              <Button
                variant="outline"
                onClick={() => {
                  actions.continueWithWallet();
                  setWalletAskedAt(phase.step);
                }}
              >
                {t('signing.useWallet')}
              </Button>
            }
            reason={
              notYet ? (
                <p className="flex items-start gap-2 text-sm font-medium text-danger">
                  <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <span>{t('signing.connectFirst', { role })}</span>
                </p>
              ) : undefined
            }
            secondary={backButton ?? undefined}
          />
        </div>
      );
    }

    case 'switch-account':
      if (step === undefined) return null;
      return (
        <Alert tone="warning" role="note">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription className="flex flex-col gap-3 text-foreground">
            <p>{t('signing.accountNotOffered', { wallet })}</p>
            <AddressText address={step.address} variant="full" />
            <p className="font-medium">{t(`components.walletSlot.switch.${step.role}`)}</p>
            {phase.again ? <p>{t('signing.stillNotOffered', { wallet })}</p> : null}
            <Buttons>
              <Button
                onClick={() => {
                  actions.continueAfterSwitch();
                }}
              >
                {t('common.continue')}
              </Button>
              {backButton}
            </Buttons>
          </AlertDescription>
        </Alert>
      );

    case 'starting':
      return (
        <Waiting text={phase.waitFor === 'wallet' ? t('signing.waitingWallet', { wallet }) : t('signing.checkingTime', { wallet })}>
          <StopWaiting actions={actions} />
        </Waiting>
      );

    case 'signing':
      return (
        <Waiting text={t('signing.waitingWallet', { wallet })}>
          <StopWaiting actions={actions} />
        </Waiting>
      );

    case 'stopped':
      return (
        <Stopped
          title={roundOnly ? t('signing.stoppedTitleRound') : t('signing.stoppedTitle')}
          reason={phase.reason}
          actions={actions}
          backButton={backButton}
        />
      );

    case 'expired': {
      const several = (round?.txs.length ?? 0) > 1;
      return (
        <Alert tone="warning" role="note">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>{t('signing.expiredTitle')}</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 text-foreground">
            <p>{roundOnly ? t('signing.expiredBodyRound') : t('signing.expiredBody')}</p>
            {several ? <p>{t('signing.oneAtATimeHint')}</p> : null}
            <Buttons>
              <Button
                onClick={() => {
                  actions.restartRound();
                }}
              >
                {t('signing.signAgain')}
              </Button>
              {several ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    actions.oneAtATime();
                  }}
                  className="h-auto min-h-10 max-w-full whitespace-normal"
                >
                  {t('signing.oneAtATime')}
                </Button>
              ) : null}
              {backButton}
            </Buttons>
          </AlertDescription>
        </Alert>
      );
    }

    case 'link': {
      // The rest of the round signs on another device; this page watches the chain for the outcome.
      const link = linkView(state, window.location.origin);
      if (link === null) return null;
      const stopWaiting = (
        <Button
          variant={phase.watching ? 'outline' : 'ghost'}
          onClick={() => {
            actions.stopWaiting();
          }}
          className="h-auto min-h-10 max-w-full whitespace-normal"
        >
          {t('signing.link.stopWaiting')}
        </Button>
      );
      return (
        <div className="flex flex-col gap-3">
          <LinkCard {...link} cancel={renderLinkCancel?.()} />
          <Buttons>
            {phase.watching ? null : (
              <Button
                onClick={() => {
                  actions.resumeLink();
                }}
              >
                {t('signing.link.checkAgain')}
              </Button>
            )}
            {stopWaiting}
          </Buttons>
        </div>
      );
    }

    case 'sending':
      return (
        <Waiting text={t('signing.sending', sendProgress(state))}>
          <StopWaiting actions={actions} />
        </Waiting>
      );

    case 'confirming':
      return (
        <Waiting text={t('signing.confirming')}>
          <StopWaiting actions={actions} />
        </Waiting>
      );

    case 'checking':
      return (
        <Waiting text={t('signing.checking')}>
          <StopWaiting actions={actions} />
        </Waiting>
      );

    case 'finished':
      return null;
  }
}

function PrepareFailed({
  problem,
  actions,
  backButton,
  finishing,
}: {
  problem: PrepareProblem;
  actions: SigningActions;
  backButton: ReactNode;
  /** The way out ends the run (an earlier round has a result to report), not Back: the text must say that. */
  finishing: boolean;
}) {
  const retry = () => {
    actions.retryPrepare();
  };
  switch (problem.kind) {
    case 'read':
      return (
        <ErrorState
          title={t('signing.prepareFailed')}
          message={errorMessage(problem.error)}
          detail={problem.error.detail}
          onRetry={retry}
          actions={backButton}
        />
      );
    case 'fee-balance':
      return (
        <ErrorState
          title={t('signing.prepareFailed')}
          message={
            <span className="flex flex-col gap-2">
              <span>
                {t('signing.feeBalance', {
                  role: roleLabel(problem.role),
                  balance: formatSol(problem.balance),
                  needed: formatSol(problem.needed),
                })}
              </span>
              <AddressText address={problem.payer} variant="full" />
            </span>
          }
          onRetry={retry}
          actions={backButton}
        />
      );
    case 'inspector':
      return (
        <ErrorState
          title={t('signing.prepareFailed')}
          message={t('signing.inspector')}
          detail={`${problem.error.code}: ${problem.error.message}`}
          actions={backButton}
        />
      );
    case 'nonce':
      // A missing or unusable link-signing account needs the page's previous step, or, once an earlier round has a
      // result (a cancelled link), the run's end and a new try; a lagging node needs only time.
      return (
        <ErrorState
          title={t('signing.prepareFailed')}
          message={
            finishing && problem.state !== 'stale'
              ? t(`signing.prepare.nonceLater.${problem.state}`)
              : t(`signing.prepare.nonce.${problem.state}`)
          }
          onRetry={problem.state === 'stale' ? retry : undefined}
          actions={backButton}
        />
      );
  }
}

function Stopped({
  title,
  reason,
  actions,
  backButton,
}: {
  title: string;
  reason: StopReason;
  actions: SigningActions;
  backButton: ReactNode;
}) {
  const startAgain = (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        actions.restartRound();
      }}
    >
      {t('signing.startAgain')}
    </Button>
  );
  switch (reason.kind) {
    case 'wallet': {
      const batch = reason.portError === 'WalletBatchUnsupportedError';
      return (
        <ErrorState
          title={title}
          message={walletStopText(reason)}
          detail={reason.portError === 'cancelled' ? undefined : reason.error.detail}
          onRetry={
            batch || reason.portError === 'WalletUnsupportedError'
              ? undefined
              : () => {
                  actions.sign();
                }
          }
          actions={
            <>
              {batch ? (
                <Button
                  size="sm"
                  onClick={() => {
                    actions.oneAtATime();
                  }}
                  className="h-auto min-h-8 max-w-full whitespace-normal"
                >
                  {t('signing.oneAtATime')}
                </Button>
              ) : null}
              {backButton}
            </>
          }
        />
      );
    }
    case 'check': {
      const { startWith } = reason;
      return (
        <ErrorState
          title={title}
          message={reason.bothWays ? t('signing.check.tailBothWays', { wallet: reason.walletName }) : t(`signing.check.${reason.code}`)}
          detail={`${reason.code}: ${reason.detail}`}
          actions={
            <>
              {startWith === null ? null : (
                <Button
                  size="sm"
                  onClick={() => {
                    actions.restartRound(startWith);
                  }}
                  className="h-auto min-h-8 max-w-full whitespace-normal"
                >
                  {t('signing.startWith', { wallet: reason.walletName })}
                </Button>
              )}
              {startAgain}
              {backButton}
            </>
          }
        />
      );
    }
    case 'inspect':
      return (
        <ErrorState
          title={title}
          message={t('signing.inspect')}
          detail={`${reason.error.code}: ${reason.error.message}`}
          actions={
            <>
              {startAgain}
              {backButton}
            </>
          }
        />
      );
    case 'verify':
      return (
        <ErrorState
          title={title}
          message={t(`signing.verify.${reason.code}`)}
          detail={`${reason.code}: ${reason.detail}`}
          actions={
            <>
              {startAgain}
              {backButton}
            </>
          }
        />
      );
  }
}

function walletStopText(reason: Extract<StopReason, { kind: 'wallet' }>): string {
  const wallet = reason.walletName;
  switch (reason.portError) {
    case 'cancelled':
      return t('signing.walletStopped', { wallet });
    case 'WalletBusyError':
      return t('signing.walletBusy', { wallet });
    case 'WalletUnsupportedError':
      return t('signing.walletUnsupported', { wallet });
    case 'WalletBatchUnsupportedError':
      return t('signing.walletBatch', { wallet });
    case null:
      return errorMessage(reason.error);
  }
}

/** The wallet name, or the role when no wallet in this browser holds the key. */
function walletOf(step: SignStep): string {
  return step.walletName ?? roleLabel(step.role);
}

function StopWaiting({ actions }: { actions: SigningActions }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        actions.stopWaiting();
      }}
    >
      {t('signing.stopWaiting')}
    </Button>
  );
}

/** A wait: the spinner and its text stay together on one line group; only the way out wraps below them. */
function Waiting({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="flex min-w-0 items-center gap-3">
        <Spinner className="size-5 shrink-0 text-muted" />
        <span className="min-w-0">{text}</span>
      </span>
      {children}
    </div>
  );
}

function Buttons({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}
