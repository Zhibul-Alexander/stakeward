import type { Address, Signature } from '@solana/kit';
import {
  actionRoles,
  actionTarget,
  formatUtcDate,
  scannerStatus,
  stakeActivationStatus,
  type ChainClock,
  type TransactionSummary,
  type WalletRole,
} from '@stakeward/core';
import { CircleCheckIcon, CopyIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type Ref } from 'react';
import { AccountRow } from '@/components/product/account-row';
import { AddressText } from '@/components/product/address-text';
import { RiskNote } from '@/components/product/risk-note';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { checkJobAgain, isLanded } from '@/pages/account/check';
import { JobOutcome } from '@/pages/account/JobOutcome';
import { KeySlot } from '@/pages/app/KeySlot';
import { useKnownSecondKeys, usePorts, useWallets } from '@/ports';
import { createPageSession, type SigningTestOptions } from '@/signing/create';
import type { JobView, SigningState } from '@/signing/machine';
import { slotSignerResolver } from '@/signing/resolve';
import { PageSigningPanel } from '@/signing/SigningPanel';
import { useSigningSession } from '@/signing/use-signing-session';
import { cosignPlan, cosignRefusalText, cosignResolver } from './plan.ts';

type CosignSigningProps = {
  /** The link's bytes, partly signed; the inspector and the link-format rules accepted them (read.ts). */
  bytes: Uint8Array;
  summary: TransactionSummary;
  fragment: string;
  signing?: SigningTestOptions | undefined;
};

/** Outcomes this link cannot get past: the sender has to make a new one (nothing was sent from here, or it failed). */
const NEEDS_NEW_LINK: readonly JobView['state']['kind'][] = ['refused', 'failed', 'sim-failed', 'expired'];

/** A new link helps, unless no link could do it: a protect over a lock in force is refused whatever link carries it. */
function asksForNewLink(job: JobView): boolean {
  const { state } = job;
  return NEEDS_NEW_LINK.includes(state.kind) && !(state.kind === 'refused' && state.reason === 'already-locked');
}

/** A finished run: its outcome for the link's stake account and the cluster clock it was read at. */
type Outcome = { run: number; job: JobView; clock: ChainClock | null };

/**
 * The link's transaction on /cosign: who asks for what (the risk before the action, UX rule 6), then the signing
 * engine over the bytes as they are (cosignPlan): the chain check, the inspector's summary with what was and what
 * becomes, a required confirmation for a withdrawal or a rescue, and every remaining signer in this browser. The end
 * says what the chain shows. Nothing is stored on this device.
 */
export function CosignSigning({ bytes, summary, fragment, signing }: CosignSigningProps) {
  const ports = usePorts();
  const wallets = useWallets();
  const { action } = summary;
  const target = actionTarget(action);
  const [run, setRun] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const checkOp = useRef(0);
  const ids = [target];
  const mainKey = 'mainKey' in action ? action.mainKey : undefined;

  const create = () =>
    createPageSession(ports, {
      plan: cosignPlan(bytes, summary),
      ids,
      roundSize: 1,
      signing,
      resolveSigner: cosignResolver(slotSignerResolver(ports), action),
      onFinished: (state: SigningState) => {
        const job = state.jobs[target];
        if (job !== undefined) setOutcome({ run, job, clock: state.clock });
      },
    });
  const { session, snapshot } = useSigningSession(create, `cosign#${fragment}#${String(run)}`);

  // Focus follows the page (UX rule 2): the outcome's heading once the run ends, never on the first render.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const finished = outcome !== null && outcome.run === run;
  // A Check again that finds the landing swaps the outcome for the Done heading: focus follows it too.
  const shown = finished ? outcome.job.state.kind : null;
  useEffect(() => {
    if (shown !== null) headingRef.current?.focus();
  }, [shown]);

  async function checkAgain(current: Outcome) {
    checkOp.current += 1;
    const op = checkOp.current;
    setChecking(true);
    setCheckFailed(false);
    try {
      const job = await checkJobAgain(ports.chain, current.job);
      if (op === checkOp.current) setOutcome((now) => (now?.run === current.run ? { ...now, job } : now));
    } catch {
      if (op === checkOp.current) setCheckFailed(true);
    } finally {
      if (op === checkOp.current) setChecking(false);
    }
  }

  if (finished) {
    const { job } = outcome;
    if (isLanded(job)) return <CosignDone headingRef={headingRef} job={job} clock={outcome.clock} />;
    return (
      <JobOutcome
        headingRef={headingRef}
        title={t(`components.tx.kind.${action.kind}`)}
        job={job}
        refusalText={cosignRefusalText}
        checking={checking}
        checkFailed={checkFailed}
        onRetry={() => {
          checkOp.current += 1;
          setChecking(false);
          setCheckFailed(false);
          setRun((value) => value + 1);
        }}
        onCheckAgain={() => void checkAgain(outcome)}
      >
        {asksForNewLink(job) ? <p className="text-sm font-medium">{t('cosign.newLink')}</p> : null}
      </JobOutcome>
    );
  }

  const phase = snapshot?.phase;
  const tailStop = phase?.kind === 'stopped' && phase.reason.kind === 'check' && phase.reason.code === 'tail-not-first-signer';
  const confirm =
    action.kind === 'withdraw'
      ? { label: t('cosign.confirm.withdraw') }
      : action.kind === 'rescue'
        ? { label: t('cosign.confirm.rescue') }
        : undefined;
  const renderKeySlot = (role: WalletRole, address: Address) => <KeySlot role={role} mainKey={mainKey} expected={address} />;
  return (
    <div className="flex flex-col gap-6">
      <AskBlock summary={summary} />
      <p className="max-w-prose text-sm text-muted">{t('cosign.stale')}</p>
      {wallets.length === 0 ? <OpenInWallet /> : null}
      {tailStop ? (
        <Alert tone="info" role="note" data-slot="cosign-tail-hint">
          <InfoIcon aria-hidden="true" />
          <AlertDescription className="text-foreground">{t('cosign.tailHint')}</AlertDescription>
        </Alert>
      ) : null}
      <PageSigningPanel
        session={session}
        state={snapshot}
        ids={ids}
        roundSize={1}
        // The link's action names every key; this device's slots never rename them.
        knownRoles={actionRoles(action)}
        renderKeySlot={renderKeySlot}
        confirm={confirm}
      />
    </div>
  );
}

/** What the link asks of this wallet, before anything else: the risk in plain words and the address it is about. */
function AskBlock({ summary }: { summary: TransactionSummary }) {
  const { action } = summary;
  switch (action.kind) {
    case 'protect':
      return (
        <div className="flex flex-col gap-3">
          <Alert tone="info" role="note" data-slot="cosign-ask" data-kind="protect">
            <InfoIcon aria-hidden="true" />
            <AlertDescription className="text-foreground">
              <p className="font-medium">
                {t('cosign.ask.protect', { date: formatUtcDate(action.lockUntil) ?? action.lockUntil.toString() })}
              </p>
            </AlertDescription>
          </Alert>
          <RiskNote risk="second-key-can-freeze" />
        </div>
      );
    case 'withdraw':
      return (
        <Alert tone="danger" role="note" data-slot="cosign-ask" data-kind="withdraw">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription className="flex flex-col gap-2 text-foreground">
            <p className="font-medium">{t('cosign.ask.withdraw')}</p>
            <AddressText address={action.recipient} variant="full" />
          </AlertDescription>
        </Alert>
      );
    case 'rescue':
      return (
        <Alert tone="danger" role="note" data-slot="cosign-ask" data-kind="rescue">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription className="flex flex-col gap-2 text-foreground">
            <p className="font-medium">{t('cosign.ask.rescue')}</p>
            <AddressText address={action.newWallet} variant="full" />
          </AlertDescription>
        </Alert>
      );
    default:
      // The link-format rules let only protect, withdraw and rescue through (read.ts).
      return null;
  }
}

type CopyState = 'idle' | 'copied' | 'failed';

/** No wallet in this browser: the link has to be opened in the wallet app's own browser. */
function OpenInWallet() {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  async function copyPage() {
    try {
      // navigator.clipboard is missing on insecure origins and in some embedded browsers.
      if (!('clipboard' in navigator)) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(window.location.href);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }
  return (
    <div data-slot="cosign-no-wallet" className="flex flex-col items-start gap-2">
      <p className="text-sm font-medium">{t('cosign.openInWallet')}</p>
      <Button
        variant="outline"
        onClick={() => {
          void copyPage();
        }}
      >
        <CopyIcon aria-hidden="true" />
        {t('cosign.copyPage')}
      </Button>
      <p aria-live="polite" className={copyState === 'failed' ? 'text-sm text-danger' : 'text-sm text-muted'}>
        {copyState === 'copied' ? t('common.copied') : copyState === 'failed' ? t('signing.link.copyFailed') : ''}
      </p>
    </div>
  );
}

/** The chain shows the change: sent from here (`done`), or already there before this device signed. */
function CosignDone({ headingRef, job, clock }: { headingRef: Ref<HTMLHeadingElement>; job: JobView; clock: ChainClock | null }) {
  const headingId = useId();
  const knownSecondKeys = useKnownSecondKeys();
  const { state } = job;
  if (state.kind === 'already-done') {
    return (
      <section aria-labelledby={headingId} data-slot="cosign-done" data-outcome="already" className="flex flex-col gap-3">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-2xl font-semibold">
          {t('cosign.already.title')}
        </h2>
        <p className="max-w-prose">{t('cosign.already.body')}</p>
      </section>
    );
  }
  const after = state.kind === 'done' ? state.after : null;
  const secondKey = job.action !== null ? actionRoles(job.action).second : undefined;
  const view = after === null || clock === null ? null : scannerStatus(after, secondKey === undefined ? knownSecondKeys : [...knownSecondKeys, secondKey], clock);
  return (
    <section aria-labelledby={headingId} data-slot="cosign-done" data-outcome="done" className="flex flex-col gap-4">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-2xl font-semibold">
        <CircleCheckIcon aria-hidden="true" className="size-6 shrink-0 text-success" />
        {t('cosign.done.title')}
      </h2>
      <p className="max-w-prose">{t('cosign.done.body')}</p>
      <TransactionLink signature={job.signature} />
      {after === null || view === null || clock === null ? null : (
        <AccountRow
          account={after}
          activation={stakeActivationStatus(after.delegation, clock.epoch)}
          protection={view.status}
          managedByService={view.managedByService}
        />
      )}
    </section>
  );
}

/** The transaction's explorer link (UX rule 9). */
function TransactionLink({ signature }: { signature: Signature | null }) {
  if (signature === null) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-sm">
      <span className="text-muted">{t('components.jobs.transaction')}</span>
      <AddressText address={signature} kind="tx" />
    </p>
  );
}
