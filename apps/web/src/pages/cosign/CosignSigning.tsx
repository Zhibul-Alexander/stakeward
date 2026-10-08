import type { Address, Signature } from '@solana/kit';
import {
  actionRoles,
  actionTarget,
  formatSol,
  formatUtcDate,
  scannerStatus,
  stakeActivationStatus,
  type ChainClock,
  type TransactionSummary,
  type WalletRole,
} from '@stakeward/core';
import { CircleCheckIcon, CopyIcon, InfoIcon, Link2OffIcon, RotateCcwIcon, TriangleAlertIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react';
import { AccountRow, SINGLE_ROW_FRAME } from '@/components/product/account-row';
import { AddressText } from '@/components/product/address-text';
import { CosignRequest, type CosignCheck } from '@/components/product/cosign-request';
import { RiskNote } from '@/components/product/risk-note';
import { StopPanel } from '@/components/product/stop-panel';
import { roleLabel } from '@/components/product/wallet-slot';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { BackHome, CosignHeader } from './CosignHeader.tsx';
import { cosignPlan, cosignRefusalText, cosignResolver } from './plan.ts';

type CosignSigningProps = {
  /** The link's bytes, partly signed; the inspector and the link-format rules accepted them (read.ts). */
  bytes: Uint8Array;
  summary: TransactionSummary;
  fragment: string;
  signing?: SigningTestOptions | undefined;
};

/** Outcomes this link cannot get past: the sender has to make a new one (nothing was sent from here, or it failed). */
const NEEDS_NEW_LINK: readonly JobView['state']['kind'][] = ['failed', 'sim-failed', 'expired'];

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
    const { state } = job;
    if (isLanded(job)) {
      return (
        <>
          <CosignHeader lead />
          <CosignDone headingRef={headingRef} job={job} clock={outcome.clock} />
        </>
      );
    }
    if (state.kind === 'refused') {
      // The chain says no before anything was asked: a protect over a lock in force is "Do not sign" (a new link would
      // be refused the same way); anything else means this link no longer fits the chain.
      return (
        <>
          <CosignHeader lead={false} />
          {state.reason === 'already-locked' ? (
            <StopPanel
              headingRef={headingRef}
              title={t('cosign.stop.title')}
              reason={cosignRefusalText(state.reason)}
              whatToDo={t('cosign.stop.whatToDo')}
              action={<BackHome />}
              reasonCode={state.reason}
            />
          ) : (
            <LinkEnded headingRef={headingRef} reason={cosignRefusalText(state.reason)} refusal={state.reason} />
          )}
        </>
      );
    }
    return (
      <>
        <CosignHeader lead />
        <JobOutcome
          headingRef={headingRef}
          title={t('cosign.result')}
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
          exit={<BackHome variant="ghost" />}
        >
          {NEEDS_NEW_LINK.includes(state.kind) ? <p className="text-sm font-medium">{t('cosign.ended.body')}</p> : null}
        </JobOutcome>
      </>
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
  // The key this step needs, connected here; with no wallet in this browser, the way to open the link in one.
  const renderKeySlot = (role: WalletRole, address: Address) =>
    wallets.length === 0 ? (
      <OpenInWallet />
    ) : (
      <KeySlot role={role} mainKey={mainKey} expected={address} emphasis="primary" />
    );
  // Right above the sign button: the risk this wallet takes on (protect), and that the link may be old.
  const risk = (
    <div className="flex flex-col gap-2">
      {action.kind === 'protect' ? <RiskNote risk="second-key-can-freeze" variant="inline" /> : null}
      <p className="text-sm text-muted">{t('cosign.stale')}</p>
    </div>
  );
  const before = snapshot?.jobs[target]?.before ?? null;
  const feeShort = phase?.kind === 'prepare-failed' && phase.problem.kind === 'fee-balance' ? phase.problem : null;
  return (
    <>
      <CosignHeader lead />
      <Request summary={summary} lamports={before?.lamports ?? null} />
      {tailStop ? (
        <Alert tone="info" role="note" data-slot="cosign-tail-hint">
          <InfoIcon aria-hidden="true" />
          <AlertDescription className="text-foreground">{t('cosign.tailHint')}</AlertDescription>
        </Alert>
      ) : null}
      {feeShort === null ? (
        <PageSigningPanel
          session={session}
          state={snapshot}
          ids={ids}
          roundSize={1}
          // The link's action names every key; this device's slots never rename them.
          knownRoles={actionRoles(action)}
          renderKeySlot={renderKeySlot}
          confirm={confirm}
          risk={risk}
          summaryIntro={false}
          hideSingleSigner
        />
      ) : (
        // The fee payer is the sender's key, on their device: they add the SOL, this page tries again. Not red: nothing
        // is wrong with the link (red on /cosign means "Do not sign").
        <Alert tone="warning" data-slot="cosign-fee-short">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>{t('signing.prepareFailed')}</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 text-foreground [&_p:not(:last-child)]:mb-0">
            <p>{t('cosign.feeBalance', { role: roleLabel(feeShort.role), balance: formatSol(feeShort.balance) })}</p>
            <AddressText address={feeShort.payer} variant="full" />
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  session?.retryPrepare();
                }}
              >
                <RotateCcwIcon aria-hidden="true" />
                {t('common.tryAgain')}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}

/** The role of the key that paid and signed before the link was made: who sent it. */
function senderRole(summary: TransactionSummary): WalletRole {
  const roles = actionRoles(summary.action);
  const found = (Object.entries(roles) as [WalletRole, Address | undefined][]).find(([, address]) => address === summary.feePayer);
  return found?.[0] ?? 'main';
}

/** What the link asks of this wallet, before anything else: the ask in plain words and the one address to check. */
function Request({ summary, lamports }: { summary: TransactionSummary; lamports: bigint | null }) {
  const { action } = summary;
  const common = { kind: action.kind, title: t(`components.tx.kind.${action.kind}`), from: senderRole(summary) };
  switch (action.kind) {
    case 'protect': {
      // The holder of the second key learns, with the date, what they take on: the owner then needs their signature.
      const date = formatUtcDate(action.lockUntil) ?? action.lockUntil.toString();
      return (
        <CosignRequest
          {...common}
          ask={t('cosign.ask.protect.title', { date })}
          lines={[t('cosign.ask.protect.needs'), t('cosign.ask.protect.lose', { date }), t('cosign.ask.protect.cannot')]}
          meta={lamports === null ? undefined : t('cosign.holds', { amount: formatSol(lamports) })}
        />
      );
    }
    case 'withdraw': {
      const check: CosignCheck = {
        title: t('cosign.ask.withdraw.check'),
        lines: [t('cosign.ask.withdraw.thief'), t('cosign.ask.withdraw.only')],
        role: 'main',
        address: action.recipient,
      };
      return <CosignRequest {...common} ask={t('cosign.ask.withdraw.title', { amount: formatSol(action.lamports) })} check={check} />;
    }
    case 'rescue': {
      const check: CosignCheck = {
        title: t('cosign.ask.rescue.check'),
        lines: [t('cosign.ask.rescue.thief'), t('cosign.ask.rescue.only')],
        role: 'new',
        address: action.newWallet,
      };
      return <CosignRequest {...common} ask={t('cosign.ask.rescue.title')} check={check} />;
    }
    default:
      // The link-format rules let only protect, withdraw and rescue through (read.ts).
      return null;
  }
}

type CopyState = 'idle' | 'copied' | 'failed';

/** No wallet in this browser: the link has to be opened where one is (the wallet app's own browser, or an extension). */
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
        onClick={() => {
          void copyPage();
        }}
        className="w-full sm:w-auto"
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

/**
 * The chain no longer fits the link (used or cancelled, the stake changed or is gone): nothing was asked or signed.
 * Says so and how to get a new link, with the way back (UX rule 8).
 */
function LinkEnded({ headingRef, reason, refusal }: { headingRef: Ref<HTMLHeadingElement>; reason: string; refusal: string }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-slot="link-ended" data-reason={refusal} className="flex flex-col gap-3">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-2xl text-balance">
        <Link2OffIcon aria-hidden="true" className="size-6 shrink-0 text-muted" />
        {t('cosign.ended.title')}
      </h2>
      <p className="max-w-prose font-medium">{reason}</p>
      <p className="max-w-prose">{t('cosign.ended.body')}</p>
      <div className="mt-1">
        <BackHome />
      </div>
    </section>
  );
}

/** The chain shows the change: sent from here (`done`), or already there before this device signed. */
function CosignDone({ headingRef, job, clock }: { headingRef: Ref<HTMLHeadingElement>; job: JobView; clock: ChainClock | null }) {
  const headingId = useId();
  const knownSecondKeys = useKnownSecondKeys();
  const { state } = job;
  const already = state.kind === 'already-done';
  const after = state.kind === 'done' ? state.after : null;
  const secondKey = job.action !== null ? actionRoles(job.action).second : undefined;
  const secondKeys = secondKey === undefined ? knownSecondKeys : [...knownSecondKeys, secondKey];
  const view = after === null || clock === null ? null : scannerStatus(after, secondKeys, clock);
  let row: ReactNode = null;
  if (after !== null && view !== null && clock !== null) {
    row = (
      <AccountRow
        account={after}
        activation={stakeActivationStatus(after.delegation, clock.epoch)}
        clock={clock}
        protection={view.status}
        managedByService={view.managedByService}
        secondKeyKnown={secondKeys.length > 0}
        hint={false}
        serviceDetail
        className={SINGLE_ROW_FRAME}
      />
    );
  }
  return (
    <section
      aria-labelledby={headingId}
      data-slot="cosign-done"
      data-outcome={already ? 'already' : 'done'}
      className="flex flex-col gap-4"
    >
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-2xl">
        <CircleCheckIcon aria-hidden="true" className="size-6 shrink-0 text-success" />
        {already ? t('cosign.already.title') : t('cosign.done.title')}
      </h2>
      <p className="max-w-prose">{already ? t('cosign.already.body') : t('cosign.done.body')}</p>
      {already ? null : <TransactionLink signature={job.signature} />}
      {already ? null : row}
      <div>
        <BackHome variant="ghost" />
      </div>
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
