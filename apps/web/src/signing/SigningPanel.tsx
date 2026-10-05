import type { Address } from '@solana/kit';
import { formatSol, summariesMatchExceptStakeAccount, type WalletRole } from '@stakeward/core';
import { InfoIcon, TriangleAlertIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { AddressText } from '@/components/product/address-text';
import { ErrorState } from '@/components/product/error-state';
import { JobStatusList } from '@/components/product/job-status-list';
import { SignerList, SignerListSkeleton } from '@/components/product/signer-list';
import {
  TransactionSummary,
  TransactionSummarySkeleton,
  type OnChainContext,
} from '@/components/product/transaction-summary';
import { roleLabel } from '@/components/product/wallet-slot';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import type { PrepareProblem, SignStep, SigningState, StopReason } from './machine.ts';
import type { SigningSession } from './session.ts';
import { backKind, jobItems, roundProgress, sendProgress, signerItems } from './view.ts';

/** What the panel's buttons call: a SigningSession, or no-ops for the /dev/ui fixtures. */
export type SigningActions = Pick<
  SigningSession,
  'sign' | 'continueWithWallet' | 'continueAfterSwitch' | 'stopWaiting' | 'restartRound' | 'oneAtATime' | 'retryPrepare'
>;

type SigningViewProps = {
  state: SigningState;
  actions: SigningActions;
  /** Addresses the page knows by role, to name signers the action itself does not name. */
  knownRoles: Partial<Record<WalletRole, Address>>;
  /** The page's key slot for a role, shown when that key must be connected to go on. */
  renderKeySlot: (role: WalletRole) => ReactNode;
  onBack: () => void;
};

/**
 * The signing screen (CLAUDE.md section 6, UX rules 3 and 7), presentational: the round, the inspector's summary of the
 * exact bytes about to be signed, who signs in which order, then one action area that explains the current wait and
 * offers exactly one way forward, and from sending on each stake account's outcome.
 */
export function SigningView({ state, actions, knownRoles, renderKeySlot, onBack }: SigningViewProps) {
  const { phase } = state;
  const progress = roundProgress(state);
  const building = phase.kind === 'idle' || phase.kind === 'preparing';
  // A round that could not be prepared has nothing current to show (a failed rebuild must not show the old bytes).
  const shown = !building && phase.kind !== 'prepare-failed';
  const sent = phase.kind === 'sending' || phase.kind === 'confirming' || phase.kind === 'checking' || phase.kind === 'finished';
  const signers = shown ? signerItems(state) : [];
  return (
    <div data-slot="signing-panel" data-phase={phase.kind} className="flex flex-col gap-5">
      {progress.total > 1 ? <p className="text-sm font-medium">{t('signing.roundOf', progress)}</p> : null}
      {building ? <TransactionSummarySkeleton /> : shown ? <Summaries state={state} knownRoles={knownRoles} /> : null}
      {building ? <SignerListSkeleton /> : signers.length === 0 ? null : <SignerList items={signers} />}
      <div role="status" aria-live="polite" className="flex flex-col gap-3">
        <PhaseActions state={state} actions={actions} renderKeySlot={renderKeySlot} onBack={onBack} />
      </div>
      {sent ? <JobStatusList items={jobItems(state)} label={t('signing.transactions')} /> : null}
    </div>
  );
}

/** The signing screen driven by a session: `state` is the session's snapshot (useSigningSession). */
export function SigningPanel({
  session,
  state,
  knownRoles,
  renderKeySlot,
  onBack,
}: Omit<SigningViewProps, 'actions'> & { session: SigningSession }) {
  return <SigningView state={state} actions={session} knownRoles={knownRoles} renderKeySlot={renderKeySlot} onBack={onBack} />;
}

/**
 * One summary for the whole round when its transactions differ only in the stake account (core
 * `summariesMatchExceptStakeAccount`), otherwise one per transaction; each with the account's state as just read.
 */
function Summaries({ state, knownRoles }: { state: SigningState; knownRoles: Partial<Record<WalletRole, Address>> }) {
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
      <TransactionSummary summary={head.summary} knownRoles={knownRoles} batch={{ accounts, totalFeeLamports }} headingLevel={3} />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {txs.map((tx) => (
        <TransactionSummary key={tx.id} summary={tx.summary} current={currentOf(tx.id)} knownRoles={knownRoles} headingLevel={3} />
      ))}
    </div>
  );
}

type PhaseActionsProps = Omit<SigningViewProps, 'knownRoles'>;

/** What happens now and the one way forward (UX rule 7: every wait is explained and has a way out). */
function PhaseActions({ state, actions, renderKeySlot, onBack }: PhaseActionsProps) {
  const { phase, round } = state;
  const back = backKind(state);
  const backButton =
    back === null ? null : (
      <Button variant="ghost" onClick={onBack} className="h-auto min-h-10 whitespace-normal">
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
      return <PrepareFailed problem={phase.problem} actions={actions} backButton={backButton} />;

    case 'ready': {
      if (step === undefined) return null;
      const sameWallet =
        step.walletName !== null && (round?.steps.some((other) => other !== step && other.walletName === step.walletName) ?? false);
      return (
        <div className="flex flex-col gap-3">
          {phase.refreshed ? (
            <Alert tone="info" role="note">
              <InfoIcon aria-hidden="true" />
              <AlertDescription className="text-foreground">{t('signing.refreshed')}</AlertDescription>
            </Alert>
          ) : null}
          {sameWallet ? <p className="text-sm font-medium">{t('signing.sameWalletHint', { wallet, role })}</p> : null}
          {phase.step === 0 ? <p className="text-sm">{t('signing.firstHint', { wallet })}</p> : null}
          <Buttons>
            <Button
              onClick={() => {
                actions.sign();
              }}
              className="h-auto min-h-10 whitespace-normal"
            >
              {step.count === 1
                ? t('signing.signWith', { wallet, role })
                : t('signing.signManyWith', { count: step.count, wallet, role })}
            </Button>
            {backButton}
          </Buttons>
        </div>
      );
    }

    case 'needs-wallet':
      if (step === undefined) return null;
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">{t('signing.needWallet', { role })}</p>
          <AddressText address={step.address} variant="full" />
          {renderKeySlot(step.role)}
          <Buttons>
            <Button
              onClick={() => {
                actions.continueWithWallet();
              }}
            >
              {t('common.continue')}
            </Button>
            {backButton}
          </Buttons>
        </div>
      );

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

    case 'signing':
      return (
        <Waiting text={t('signing.waitingWallet', { wallet })}>
          <StopWaiting actions={actions} />
        </Waiting>
      );

    case 'stopped':
      return <Stopped reason={phase.reason} actions={actions} backButton={backButton} />;

    case 'expired': {
      const several = (round?.txs.length ?? 0) > 1;
      return (
        <Alert tone="warning" role="note">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>{t('signing.expiredTitle')}</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 text-foreground">
            <p>{t('signing.expiredBody')}</p>
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
                  className="h-auto min-h-10 whitespace-normal"
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
}: {
  problem: PrepareProblem;
  actions: SigningActions;
  backButton: ReactNode;
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
  }
}

function Stopped({ reason, actions, backButton }: { reason: StopReason; actions: SigningActions; backButton: ReactNode }) {
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
          title={t('signing.stoppedTitle')}
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
                  className="h-auto min-h-8 whitespace-normal"
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
          title={t('signing.stoppedTitle')}
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
                  className="h-auto min-h-8 whitespace-normal"
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
          title={t('signing.stoppedTitle')}
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
          title={t('signing.stoppedTitle')}
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

function Waiting({ text, children }: { text: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <Spinner className="size-5 text-muted" />
      <span>{text}</span>
      {children}
    </div>
  );
}

function Buttons({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}
