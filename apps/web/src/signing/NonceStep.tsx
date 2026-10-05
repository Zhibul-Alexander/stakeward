import type { Address } from '@solana/kit';
import { formatSol, type WalletRole } from '@stakeward/core';
import { cn } from 'cn';
import { RotateCcwIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react';
import { JobStatusList, type JobStatusItem } from '@/components/product/job-status-list';
import { roleLabel } from '@/components/product/wallet-slot';
import { Button } from '@/components/ui/button';
import { t, type MessageKey } from '@/i18n';
import { KeySlot } from '@/pages/app/KeySlot';
import { usePorts } from '@/ports';
import { createPageSession, type SigningTestOptions } from './create.ts';
import type { JobView, SigningState } from './machine.ts';
import { nonceRefusalText, noncePlan } from './nonce.ts';
import { PageSigningPanel } from './SigningPanel.tsx';
import { useSigningSession } from './use-signing-session.ts';
import { defaultJobReason, jobStatus } from './view.ts';

export type NonceMode = 'setup' | 'close';
/** How a close is put: closing the account (`close`), or cancelling the open link by closing it (`cancel-link`). */
export type NonceVariant = 'close' | 'cancel-link';

type Texts = { title: MessageKey; body: MessageKey; action: MessageKey };

function textsOf(mode: NonceMode, variant: NonceVariant): Texts {
  if (mode === 'setup') return { title: 'nonce.setup.title', body: 'nonce.setup.body', action: 'nonce.setup.action' };
  if (variant === 'cancel-link') {
    return { title: 'signing.link.cancelTitle', body: 'signing.link.cancelBody', action: 'signing.link.cancelAction' };
  }
  return { title: 'nonce.close.title', body: 'nonce.close.body', action: 'nonce.close.action' };
}

/** The outcome of a run that did not set up or close the account, as one line of JobStatusList. */
export function nonceOutcomeItem(job: JobView): JobStatusItem {
  const { state } = job;
  const item: JobStatusItem = { address: job.id as Address, status: jobStatus(state), signature: job.signature };
  const reason = state.kind === 'refused' ? nonceRefusalText(state.reason) : defaultJobReason(job);
  if (reason !== undefined) item.reason = reason;
  if (state.kind === 'failed' || state.kind === 'sim-failed') item.detail = state.error.detail;
  return item;
}

type FrameProps = {
  mode: NonceMode;
  variant: NonceVariant;
  headingRef?: Ref<HTMLHeadingElement> | undefined;
  children: ReactNode;
};

/** The card around the step: its heading (h4 inside the link card, h3 elsewhere) and what comes below it. */
function Frame({ mode, variant, headingRef, children }: FrameProps) {
  const headingId = useId();
  const Heading = variant === 'cancel-link' ? 'h4' : 'h3';
  return (
    <section
      aria-labelledby={headingId}
      data-slot="nonce-step"
      data-mode={mode}
      data-variant={variant}
      className={cn('flex flex-col gap-3 rounded-md border bg-surface p-4', variant === 'cancel-link' ? 'border-border-strong' : 'border-border')}
    >
      <Heading id={headingId} ref={headingRef} tabIndex={-1} className="text-base font-semibold">
        {t(textsOf(mode, variant).title)}
      </Heading>
      {children}
    </section>
  );
}

export type NonceStepViewProps = {
  mode: NonceMode;
  variant?: NonceVariant | undefined;
  /** The key that owns the account: it signs, pays and gets the deposit back. */
  role: WalletRole;
  /** The deposit a setup locks, or the balance a close returns. */
  amount: bigint;
  /** The last run's outcome when it did not land (refused, failed, expired, unknown): shown with Try again. */
  outcome?: JobStatusItem | undefined;
  onStart: () => void;
  headingRef?: Ref<HTMLHeadingElement> | undefined;
};

/**
 * Before anything is signed: what the link-signing account is for and what it costs, or what closing it does, said
 * with the amount and the key (UX rules 3 and 6), and the one button that starts the signing. After a run that did not
 * land it also shows why, and the button becomes Try again. Presentational (/dev/ui shows every state).
 */
export function NonceStepView({ mode, variant = 'close', role, amount, outcome, onStart, headingRef }: NonceStepViewProps) {
  const texts = textsOf(mode, variant);
  return (
    <Frame mode={mode} variant={variant} headingRef={headingRef}>
      <p className="text-sm">{t(texts.body, { amount: formatSol(amount), role: roleLabel(role) })}</p>
      {outcome === undefined ? null : <JobStatusList items={[outcome]} label={t(texts.title)} />}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={mode === 'setup' && outcome === undefined ? 'primary' : 'outline'}
          onClick={onStart}
          className="h-auto min-h-10 max-w-full whitespace-normal"
        >
          {outcome === undefined ? null : <RotateCcwIcon aria-hidden="true" />}
          {outcome === undefined ? t(texts.action) : t('common.tryAgain')}
        </Button>
      </div>
    </Frame>
  );
}

type NonceStepProps = {
  /** The key that owns the account (always the fee payer of the transactions that use it, never a stolen key). */
  authority: Address;
  nonceAccount: Address;
  role: WalletRole;
  mode: NonceMode;
  variant?: NonceVariant | undefined;
  amount: bigint;
  /** The account is set up (or closed): the chain shows it. */
  onDone: () => void;
  signing?: SigningTestOptions | undefined;
};

type Step = { kind: 'card'; outcome: JobView | null } | { kind: 'signing'; key: number };

/**
 * Sets up or closes the link-signing account of `authority` (F4 step 3, signing by link): the card first, then on its
 * button a signing session of its own over `noncePlan`, one transaction signed and paid by `authority` alone. A run
 * that lands calls `onDone`; any other outcome goes back to the card with the reason and Try again. Back returns to
 * the card.
 */
export function NonceStep({ authority, nonceAccount, role, mode, variant = 'close', amount, onDone, signing }: NonceStepProps) {
  const [step, setStep] = useState<Step>({ kind: 'card', outcome: null });
  const runs = useRef(0);

  // Focus follows the step (UX rule 2): the card's heading when the card and the signing swap, never on first render.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shown = useRef(step.kind);
  useEffect(() => {
    if (shown.current === step.kind) return;
    shown.current = step.kind;
    headingRef.current?.focus();
  }, [step.kind]);

  const start = () => {
    runs.current += 1;
    setStep({ kind: 'signing', key: runs.current });
  };
  const finished = (state: SigningState) => {
    const job = state.jobs[nonceAccount];
    if (job?.state.kind === 'done' || job?.state.kind === 'already-done') {
      onDone();
      return;
    }
    setStep({ kind: 'card', outcome: job ?? null });
  };

  if (step.kind === 'card') {
    return (
      <NonceStepView
        mode={mode}
        variant={variant}
        role={role}
        amount={amount}
        outcome={step.outcome === null ? undefined : nonceOutcomeItem(step.outcome)}
        onStart={start}
        headingRef={headingRef}
      />
    );
  }
  return (
    <Frame mode={mode} variant={variant} headingRef={headingRef}>
      <NonceSigning
        authority={authority}
        nonceAccount={nonceAccount}
        role={role}
        mode={mode}
        runKey={step.key}
        signing={signing}
        onFinished={finished}
        onBack={() => {
          setStep({ kind: 'card', outcome: null });
        }}
      />
    </Frame>
  );
}

type NonceSigningProps = {
  authority: Address;
  nonceAccount: Address;
  role: WalletRole;
  mode: NonceMode;
  runKey: number;
  signing?: SigningTestOptions | undefined;
  onFinished: (state: SigningState) => void;
  onBack: () => void;
};

/** The run itself: mounted only after the user's click, so no session reads the chain before it. */
function NonceSigning({ authority, nonceAccount, role, mode, runKey, signing, onFinished, onBack }: NonceSigningProps) {
  const ports = usePorts();
  const ids = [nonceAccount];
  const create = () => createPageSession(ports, { plan: noncePlan({ authority, nonceAccount, mode }), ids, signing, onFinished });
  const { session, snapshot } = useSigningSession(create, `nonce#${mode}#${String(runKey)}`);
  return (
    <PageSigningPanel
      session={session}
      state={snapshot}
      ids={ids}
      roundSize={1}
      knownRoles={{ [role]: authority }}
      renderKeySlot={(slotRole, address) => <KeySlot role={slotRole} expected={address} />}
      onBack={onBack}
    />
  );
}
