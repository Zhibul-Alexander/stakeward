import { getSignatureFromTransaction, getTransactionDecoder, type Address, type Signature } from '@solana/kit';
import {
  checkSigningStep,
  inspectTransaction,
  translateError,
  verifyAllSignatures,
  type BuiltTransaction,
  type ChainPort,
  type FriendlyError,
  type InspectResult,
  type SimulationResult,
  type WalletPort,
  type WalletRole,
} from '@stakeward/core';
import { CircleCheckIcon, CircleDashedIcon, CircleXIcon, LoaderCircleIcon, TriangleAlertIcon, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AddressText } from '@/components/product/address-text';
import { ErrorDetails, ErrorState } from '@/components/product/error-state';
import { StepProgress } from '@/components/product/step-progress';
import {
  TransactionSummary,
  TransactionSummaryError,
  TransactionSummarySkeleton,
  type OnChainContext,
} from '@/components/product/transaction-summary';
import { roleLabel } from '@/components/product/wallet-slot';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { t, type MessageKey } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { connectOffering, StandardWalletPort, waitForConfirmation, type ConfirmationOptions } from '@/ports';
import { describeMessageChange, type MessageChange } from './diff.ts';
import { changeCode, type SendOutcome, type SignerRecord, type SigningRunResult, type VerifyOutcome } from './report.ts';

/** One wallet account that signs, in signing order. */
export type Signer = { role: WalletRole; wallet: WalletPort; address: Address };

export type ConfirmOptions = Pick<ConfirmationOptions, 'pollIntervalMs' | 'timeoutMs'>;

type Phase =
  | { kind: 'checking' }
  /** The inspector refused the bytes (never for bytes core built): nothing to sign. */
  | { kind: 'rejected' }
  | { kind: 'simulation-failed'; error: FriendlyError }
  /** Waiting for the user to ask wallet `step` to sign. */
  | { kind: 'ready'; step: number }
  | { kind: 'signing'; step: number }
  /** The wallet does not offer the account right now (one wallet, two accounts): switch, then Continue. */
  | { kind: 'switch-account'; step: number; again: boolean }
  | { kind: 'to-send' }
  /** `signature`: the fee payer's, known from the bytes before the send answers. */
  | { kind: 'sending'; signature: Signature }
  | { kind: 'confirming'; signature: Signature }
  | { kind: 'finished'; result: SigningRunResult };

type SigningRunProps = {
  chain: ChainPort;
  built: BuiltTransaction;
  signers: readonly Signer[];
  /** The stake account's lockup and the cluster clock, for "now -> after" in the summary. */
  current?: OnChainContext | undefined;
  knownRoles: Partial<Record<WalletRole, Address>>;
  confirmOptions?: ConfirmOptions | undefined;
  /** Called once when a run that reached a wallet ends (signed and sent, or stopped). */
  onFinished: (result: SigningRunResult) => void;
  /** Called when the user drops the run before any wallet was asked. */
  onCancel: () => void;
};

/**
 * One transaction through the whole signing path of CLAUDE.md section 6, step by step, with every check shown:
 * inspector summary of the exact bytes -> simulation -> each wallet signs the bytes the previous one returned ->
 * `checkSigningStep` and a description of any change -> `verifyAllSignatures` -> send -> wait for confirmation
 * (finite and cancellable). Each wallet request starts from a button, so the user can switch accounts in between.
 */
export function SigningRun({ chain, built, signers, current, knownRoles, confirmOptions, onFinished, onCancel }: SigningRunProps) {
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  const [inspection, setInspection] = useState<InspectResult | null>(null);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [records, setRecords] = useState<readonly SignerRecord[]>(() => signers.map((signer) => record(signer, { kind: 'not-reached' })));
  const [checkRound, setCheckRound] = useState(0);
  // Handler-only state: the bytes the next wallet signs, the request in flight, the confirmation wait.
  const bytesRef = useRef<Uint8Array>(built.bytes);
  const recordsRef = useRef<SignerRecord[]>(signers.map((signer) => record(signer, { kind: 'not-reached' })));
  const verifyRef = useRef<VerifyOutcome | null>(null);
  const tokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const run = new AbortController();
    const stale = () => run.signal.aborted;
    void (async () => {
      const inspected = await inspectTransaction(built.bytes);
      if (stale()) return;
      setInspection(inspected);
      if (!inspected.ok) {
        setPhase({ kind: 'rejected' });
        return;
      }
      let simulated: SimulationResult;
      try {
        simulated = await chain.simulate(built.bytes);
      } catch (error) {
        if (!stale()) setPhase({ kind: 'simulation-failed', error: translateError(error, { transaction: built.bytes }) });
        return;
      }
      if (stale()) return;
      setSimulation(simulated);
      setPhase(
        simulated.ok
          ? { kind: 'ready', step: 0 }
          : { kind: 'simulation-failed', error: translateError(simulated.error, { transaction: built.bytes }) },
      );
    })();
    return () => {
      run.abort();
    };
  }, [chain, built, checkRound]);

  useEffect(() => {
    const abort = abortRef;
    const token = tokenRef;
    return () => {
      // Leaving the page: stop waiting, ignore any late wallet answer.
      token.current += 1;
      abort.current?.abort();
    };
  }, []);

  // Async handlers outlive renders: call the latest callback.
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  function setRecord(step: number, outcome: SignerRecord['outcome']) {
    const signer = signers[step];
    if (signer === undefined) return;
    recordsRef.current[step] = record(signer, outcome);
    setRecords([...recordsRef.current]);
  }

  function finish(send: SendOutcome | null) {
    const result: SigningRunResult = { signers: [...recordsRef.current], verify: verifyRef.current, send };
    setPhase({ kind: 'finished', result });
    onFinishedRef.current(result);
  }

  async function sign(step: number, afterSwitch = false) {
    const signer = signers[step];
    if (signer === undefined) return;
    tokenRef.current += 1;
    const token = tokenRef.current;
    setPhase({ kind: 'signing', step });
    const sent = bytesRef.current;
    // Stop waiting aborts it: the wallet's queue then lets the next request through (core createWalletRequestQueue).
    const controller = new AbortController();
    abortRef.current = controller;
    if (!signer.wallet.accounts.includes(signer.address)) {
      // The user's own click (Sign, or Continue after switching): ask the wallet for the account selected in it now,
      // reconnecting once if it stays on another one (Phantom, D109).
      try {
        await connectOffering(signer.wallet, (offered) => offered.includes(signer.address), { signal: controller.signal });
      } catch {
        // Declined or failed: the check below keeps the user on the switch step.
      }
      if (token !== tokenRef.current) return;
      if (!signer.wallet.accounts.includes(signer.address)) {
        setPhase({ kind: 'switch-account', step, again: afterSwitch });
        return;
      }
    }
    let returned: Uint8Array;
    try {
      const [answer] = await signer.wallet.signTransactions(signer.address, [sent], { signal: controller.signal });
      if (answer === undefined) throw new Error(`${signer.wallet.name} returned no transaction`);
      returned = answer;
    } catch (error) {
      if (token !== tokenRef.current) return;
      if (errorName(error) === 'WalletAccountUnavailableError') {
        setPhase({ kind: 'switch-account', step, again: false });
        return;
      }
      setRecord(step, walletError(error));
      finish(null);
      return;
    }
    if (token !== tokenRef.current) return;
    const check = await checkSigningStep(sent, returned);
    const change = describeMessageChange(sent, returned);
    if (token !== tokenRef.current) return;
    setRecord(step, {
      kind: 'signed',
      change,
      check: check.ok
        ? { ok: true, lighthouseInstructions: check.lighthouseInstructions }
        : { ok: false, code: check.error.code, message: check.error.message },
    });
    if (!check.ok) {
      finish(null);
      return;
    }
    bytesRef.current = returned;
    // The summary follows the bytes: the next wallet (and the user) sees what is about to be signed now.
    setInspection(await inspectTransaction(returned));
    if (token !== tokenRef.current) return;
    if (step + 1 < signers.length) {
      setPhase({ kind: 'ready', step: step + 1 });
      return;
    }
    const verified = await verifyAllSignatures(returned);
    if (token !== tokenRef.current) return;
    verifyRef.current = verified.ok ? { ok: true } : { ok: false, code: verified.error.code, message: verified.error.message };
    if (verified.ok) setPhase({ kind: 'to-send' });
    else finish(null);
  }

  function stopWaitingForWallet(step: number) {
    tokenRef.current += 1;
    abortRef.current?.abort();
    setRecord(step, { kind: 'wallet-error', code: 'cancelled', message: t('devCosign.run.walletCancelled'), detail: '' });
    finish(null);
  }

  async function continueAfterSwitch(step: number) {
    await sign(step, true);
  }

  async function send() {
    const bytes = bytesRef.current;
    tokenRef.current += 1;
    const token = tokenRef.current;
    // verifyAllSignatures passed, so the fee payer's signature (the transaction id) is in the bytes.
    setPhase({ kind: 'sending', signature: getSignatureFromTransaction(getTransactionDecoder().decode(bytes)) });
    let signature: Signature;
    try {
      signature = await chain.send(bytes);
    } catch (error) {
      if (token !== tokenRef.current) return;
      const friendly = translateError(error, { transaction: bytes });
      finish({ kind: 'failed', signature: null, code: friendly.code, message: errorMessage(friendly), detail: friendly.detail });
      return;
    }
    if (token !== tokenRef.current) return;
    setPhase({ kind: 'confirming', signature });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const outcome = await waitForConfirmation(chain, signature, built.meta.lifetime, { ...confirmOptions, signal: controller.signal });
      if (token !== tokenRef.current) return;
      switch (outcome.status) {
        case 'confirmed':
          finish({ kind: 'confirmed', signature });
          return;
        case 'failed': {
          const friendly = translateError(outcome.error, { transaction: bytes });
          finish({ kind: 'failed', signature, code: friendly.code, message: errorMessage(friendly), detail: friendly.detail });
          return;
        }
        case 'expired':
          finish({ kind: 'failed', signature, code: 'blockhash-expired', message: errorMessage({ code: 'blockhash-expired' }), detail: '' });
          return;
        case 'timeout':
          finish({ kind: 'unconfirmed', signature, reason: 'timeout' });
          return;
      }
    } catch {
      // Aborted: by the Cancel button (it already finished the run) or by leaving the page.
    } finally {
      abortRef.current = null;
    }
  }

  /** Stop waiting for the send's answer or for the confirmation: the transaction may still land (its explorer link). */
  function stopWaitingForConfirmation(signature: Signature) {
    tokenRef.current += 1;
    abortRef.current?.abort();
    finish({ kind: 'unconfirmed', signature, reason: 'cancelled' });
  }

  const progress = progressOf(phase, records, signers.length);
  const stepNames = [
    ...signers.map((signer) => t('devCosign.run.stepSign', { role: roleLabel(signer.role) })),
    t('devCosign.run.stepSend'),
    t('devCosign.run.stepConfirm'),
  ];

  return (
    <div data-slot="signing-run" data-phase={phase.kind} className="flex flex-col gap-5">
      <StepProgress steps={stepNames} current={progress.current} failed={progress.failed} />
      {inspection === null ? (
        <TransactionSummarySkeleton />
      ) : inspection.ok ? (
        <TransactionSummary summary={inspection.summary} current={current} knownRoles={knownRoles} headingLevel={3} />
      ) : (
        <TransactionSummaryError
          error={inspection.error}
          headingLevel={3}
          action={
            <Button variant="outline" size="sm" onClick={onCancel}>
              {t('common.close')}
            </Button>
          }
        />
      )}
      {simulation === null ? null : <SimulationLine simulation={simulation} />}

      <ol aria-label={t('devCosign.run.signatures')} className="flex flex-col gap-3">
        {records.map((item, index) => (
          <SignerStep key={`${String(index)}-${item.address}`} index={index} item={item} phase={phase} />
        ))}
      </ol>

      <div role="status" aria-live="polite" className="flex flex-col gap-3">
        <PhasePanel
          phase={phase}
          signers={signers}
          onSign={(step) => void sign(step)}
          onStopWallet={stopWaitingForWallet}
          onContinue={(step) => void continueAfterSwitch(step)}
          onStopRun={() => {
            finish(null);
          }}
          onSend={() => void send()}
          onStopConfirm={stopWaitingForConfirmation}
          onRetryChecks={() => {
            setPhase({ kind: 'checking' });
            setSimulation(null);
            setCheckRound((round) => round + 1);
          }}
          onCancel={onCancel}
        />
      </div>
    </div>
  );
}

function record(signer: Signer, outcome: SignerRecord['outcome']): SignerRecord {
  return {
    role: signer.role,
    walletName: signer.wallet.name,
    walletVersion: walletVersion(signer.wallet),
    accountsOffered: signer.wallet.accounts.length,
    address: signer.address,
    outcome,
  };
}

/** Wallet Standard `wallet.version` for the report; null for wallets that are not Wallet Standard (tests). */
export function walletVersion(wallet: WalletPort): string | null {
  return wallet instanceof StandardWalletPort ? wallet.wallet.version : null;
}

function errorName(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'name' in error ? error.name : undefined;
}

const PORT_ERRORS: Partial<Record<string, MessageKey>> = {
  WalletBusyError: 'devCosign.run.walletBusy',
  WalletUnsupportedError: 'devCosign.run.walletUnsupported',
};

function walletError(error: unknown): SignerRecord['outcome'] {
  const friendly = translateError(error);
  const name = errorName(error);
  const portError = typeof name === 'string' ? PORT_ERRORS[name] : undefined;
  return portError !== undefined && typeof name === 'string'
    ? { kind: 'wallet-error', code: name, message: t(portError), detail: friendly.detail }
    : { kind: 'wallet-error', code: friendly.code, message: errorMessage(friendly), detail: friendly.detail };
}

function progressOf(phase: Phase, records: readonly SignerRecord[], signerCount: number): { current: number; failed?: number } {
  const send = signerCount;
  const confirm = signerCount + 1;
  switch (phase.kind) {
    case 'checking':
    case 'rejected':
      return { current: 0 };
    case 'simulation-failed':
      return { current: 0, failed: 0 };
    case 'ready':
    case 'signing':
    case 'switch-account':
      return { current: phase.step };
    case 'to-send':
    case 'sending':
      return { current: send };
    case 'confirming':
      return { current: confirm };
    case 'finished': {
      const { result } = phase;
      const stopped = records.findIndex((item) => item.outcome.kind === 'wallet-error' || (item.outcome.kind === 'signed' && !item.outcome.check.ok));
      if (stopped >= 0) return { current: stopped, failed: stopped };
      if (result.verify !== null && !result.verify.ok) return { current: send, failed: send };
      if (result.send === null) return { current: send };
      if (result.send.kind === 'failed') return { current: confirm, failed: result.send.signature === null ? send : confirm };
      return { current: confirm };
    }
  }
}

type Chip = { tone: NonNullable<BadgeProps['tone']>; icon: LucideIcon; label: MessageKey };

const CHIPS = {
  pending: { tone: 'outline', icon: CircleDashedIcon, label: 'devCosign.run.statusPending' },
  waiting: { tone: 'info', icon: LoaderCircleIcon, label: 'devCosign.run.statusWaiting' },
  switch: { tone: 'warning', icon: TriangleAlertIcon, label: 'devCosign.run.statusSwitch' },
  signed: { tone: 'success', icon: CircleCheckIcon, label: 'devCosign.run.statusSigned' },
  stopped: { tone: 'danger', icon: CircleXIcon, label: 'devCosign.run.statusStopped' },
} as const satisfies Record<string, Chip>;

function SignerStep({ index, item, phase }: { index: number; item: SignerRecord; phase: Phase }) {
  const { outcome } = item;
  const active = (phase.kind === 'signing' || phase.kind === 'switch-account') && phase.step === index;
  const chip: Chip =
    outcome.kind === 'signed'
      ? outcome.check.ok
        ? CHIPS.signed
        : CHIPS.stopped
      : outcome.kind === 'wallet-error'
        ? CHIPS.stopped
        : active
          ? phase.kind === 'signing'
            ? CHIPS.waiting
            : CHIPS.switch
          : CHIPS.pending;
  return (
    <li data-slot="signer-step" data-role={item.role} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 font-medium">
          {t('devCosign.run.signerTitle', { n: index + 1, role: roleLabel(item.role), wallet: item.walletName })}
        </span>
        <Badge tone={chip.tone}>
          <chip.icon aria-hidden="true" />
          {t(chip.label)}
        </Badge>
      </div>
      {/* A signing screen shows addresses in full (UX rule 9): a short form can be matched by another key. */}
      <AddressText address={item.address} variant="full" />
      {outcome.kind === 'signed' ? (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-icon">
          <dt className="text-muted">{t('devCosign.run.changeLabel')}</dt>
          <dd data-change={changeCode(outcome.change)}>
            <ChangeText change={outcome.change} />
          </dd>
          <dt className="text-muted">{t('devCosign.run.checkLabel')}</dt>
          <dd data-check={outcome.check.ok ? 'ok' : outcome.check.code} className="flex flex-col gap-1">
            {outcome.check.ok ? (
              t('devCosign.run.checkOk')
            ) : (
              <>
                <span className="font-medium text-danger">{t(`devCosign.check.${outcome.check.code}`)}</span>
                <ErrorDetails detail={`${outcome.check.code}: ${outcome.check.message}`} />
              </>
            )}
          </dd>
        </dl>
      ) : null}
      {outcome.kind === 'wallet-error' ? (
        <div data-wallet-error={outcome.code} className="flex flex-col gap-1 text-sm">
          <p className="font-medium text-danger">{outcome.message}</p>
          <ErrorDetails detail={outcome.detail === '' ? outcome.code : `${outcome.code}: ${outcome.detail}`} />
        </div>
      ) : null}
    </li>
  );
}

function ChangeText({ change }: { change: MessageChange }) {
  switch (change.kind) {
    case 'none':
      return <>{t('devCosign.run.changeNone')}</>;
    case 'lighthouse-tail':
      return (
        <span className="flex flex-col gap-1">
          <span>{t('devCosign.run.changeTail', { count: change.instructions })}</span>
          {change.addedAccounts.length === 0 ? null : (
            <span className="flex flex-col">
              <span className="text-muted">{t('devCosign.run.addedAccounts')}</span>
              {change.addedAccounts.map((address) => (
                <AddressText key={address} address={address} variant="full" />
              ))}
            </span>
          )}
        </span>
      );
    case 'other':
      return (
        <span className="flex flex-col gap-1">
          <span className="font-medium">{t('devCosign.run.changeOther')}</span>
          <ul className="list-disc pl-5 break-all">
            {change.parts.map((part, index) => (
              <li key={`${String(index)}-${part.code}`}>{part.text}</li>
            ))}
          </ul>
        </span>
      );
  }
}

function SimulationLine({ simulation }: { simulation: SimulationResult }) {
  if (!simulation.ok) return null;
  return (
    <p className="text-sm text-muted">
      {simulation.unitsConsumed === null
        ? t('devCosign.run.simulationOk')
        : t('devCosign.run.simulationOkUnits', { units: simulation.unitsConsumed.toString() })}
    </p>
  );
}

type PhasePanelProps = {
  phase: Phase;
  signers: readonly Signer[];
  onSign: (step: number) => void;
  onStopWallet: (step: number) => void;
  onContinue: (step: number) => void;
  onStopRun: () => void;
  onSend: () => void;
  onStopConfirm: (signature: Signature) => void;
  onRetryChecks: () => void;
  onCancel: () => void;
};

/** What happens now and the way forward (UX rule 7: every wait is explained and has a way out). */
function PhasePanel(props: PhasePanelProps) {
  const { phase, signers } = props;
  switch (phase.kind) {
    case 'checking':
      return <Waiting text={t('devCosign.run.checking')} action={t('common.cancel')} onAction={props.onCancel} />;
    case 'rejected':
      return null;
    case 'simulation-failed':
      return (
        <ErrorState
          title={t('devCosign.run.simulationFailed')}
          message={errorMessage(phase.error)}
          detail={phase.error.detail}
          onRetry={props.onRetryChecks}
          actions={
            <Button variant="ghost" size="sm" onClick={props.onCancel}>
              {t('common.cancel')}
            </Button>
          }
        />
      );
    case 'ready': {
      const signer = signers[phase.step];
      if (signer === undefined) return null;
      const sameWallet = signers.some((other) => other !== signer && other.wallet === signer.wallet);
      return (
        <div className="flex flex-col gap-3">
          {sameWallet ? (
            <Alert tone="info" role="note">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertDescription className="text-foreground">
                {t('devCosign.run.sameWalletHint', { wallet: signer.wallet.name, role: roleLabel(signer.role) })}
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                props.onSign(phase.step);
              }}
            >
              {t('devCosign.run.signWith', { wallet: signer.wallet.name, role: roleLabel(signer.role) })}
            </Button>
            {phase.step === 0 ? (
              <Button variant="ghost" onClick={props.onCancel}>
                {t('common.cancel')}
              </Button>
            ) : (
              <Button variant="ghost" onClick={props.onStopRun}>
                {t('devCosign.run.stopRun')}
              </Button>
            )}
          </div>
        </div>
      );
    }
    case 'signing': {
      const signer = signers[phase.step];
      if (signer === undefined) return null;
      return (
        <Waiting
          text={t('devCosign.run.waitingWallet', { wallet: signer.wallet.name })}
          action={t('devCosign.run.stopWaiting')}
          onAction={() => {
            props.onStopWallet(phase.step);
          }}
        />
      );
    }
    case 'switch-account': {
      const signer = signers[phase.step];
      if (signer === undefined) return null;
      return (
        <Alert tone="warning" role="note">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription className="flex flex-col gap-3 text-foreground">
            <p>{t('devCosign.run.accountNotOffered', { wallet: signer.wallet.name })}</p>
            <AddressText address={signer.address} variant="full" />
            <p className="font-medium">{t(`components.walletSlot.switch.${signer.role}`)}</p>
            {phase.again ? <p>{t('devCosign.run.stillNotOffered', { wallet: signer.wallet.name })}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => {
                  props.onContinue(phase.step);
                }}
              >
                {t('common.continue')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  props.onStopWallet(phase.step);
                }}
              >
                {t('devCosign.run.stopRun')}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      );
    }
    case 'to-send':
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm">{t('devCosign.run.verifyOk')}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={props.onSend}>{t('devCosign.run.send')}</Button>
            <Button variant="ghost" onClick={props.onStopRun}>
              {t('devCosign.run.stopWithoutSending')}
            </Button>
          </div>
        </div>
      );
    case 'sending':
      return (
        <Waiting
          text={t('devCosign.run.sending')}
          action={t('devCosign.run.stopWaiting')}
          onAction={() => {
            props.onStopConfirm(phase.signature);
          }}
        />
      );
    case 'confirming':
      return (
        <Waiting
          text={t('devCosign.run.confirming')}
          action={t('devCosign.run.stopWaiting')}
          onAction={() => {
            props.onStopConfirm(phase.signature);
          }}
        />
      );
    case 'finished':
      return <FinishedPanel result={phase.result} />;
  }
}

function Waiting({ text, action, onAction }: { text: string; action?: string; onAction?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <Spinner className="size-5 text-muted" />
      <span>{text}</span>
      {action === undefined || onAction === undefined ? null : (
        <Button variant="outline" size="sm" onClick={onAction}>
          {action}
        </Button>
      )}
    </div>
  );
}

function FinishedPanel({ result }: { result: SigningRunResult }) {
  const { verify, send } = result;
  if (verify !== null && !verify.ok) {
    return (
      <ErrorState
        title={t('devCosign.run.verifyFailedTitle')}
        message={t(`devCosign.verify.${verifyCode(verify.code)}`)}
        detail={`${verify.code}: ${verify.message}`}
      />
    );
  }
  if (send === null) {
    const stopped = result.signers.some((item) => item.outcome.kind !== 'signed' || !item.outcome.check.ok);
    return <p className="text-sm font-medium">{stopped ? t('devCosign.run.endedStopped') : t('devCosign.run.endedNotSent')}</p>;
  }
  switch (send.kind) {
    case 'confirmed':
      return (
        <Alert tone="success" data-outcome="confirmed">
          <CircleCheckIcon aria-hidden="true" />
          <AlertDescription className="flex flex-col gap-1 text-foreground">
            <p className="font-medium">{t('devCosign.run.confirmed')}</p>
            <AddressText address={send.signature} kind="tx" />
          </AlertDescription>
        </Alert>
      );
    case 'failed':
      return (
        <div data-outcome="failed" className="flex flex-col gap-2">
          <ErrorState title={t('devCosign.run.sendFailedTitle')} message={send.message} detail={send.detail === '' ? send.code : `${send.code}: ${send.detail}`} />
          {send.signature === null ? null : <AddressText address={send.signature} kind="tx" />}
        </div>
      );
    case 'unconfirmed':
      return (
        <Alert tone="warning" data-outcome="unconfirmed">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription className="flex flex-col gap-1 text-foreground">
            <p className="font-medium">{send.reason === 'timeout' ? t('devCosign.run.timeout') : t('devCosign.run.waitStopped')}</p>
            <AddressText address={send.signature} kind="tx" />
          </AlertDescription>
        </Alert>
      );
  }
}

type VerifyCode = 'malformed' | 'missing-signatures' | 'invalid-signatures' | 'verification-unavailable';

function verifyCode(code: string): VerifyCode {
  return code === 'missing-signatures' || code === 'invalid-signatures' || code === 'verification-unavailable' ? code : 'malformed';
}
