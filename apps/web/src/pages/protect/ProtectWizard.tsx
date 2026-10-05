import type { Address } from '@solana/kit';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'wouter';
import { StepProgress } from '@/components/product/step-progress';
import { Button } from '@/components/ui/button';
import { watchWithRetry, type WatchState } from '@/api/watch';
import { t, type MessageKey } from '@/i18n';
import { usePorts, useKnownSecondKeys, useSlot, useWalletSlots } from '@/ports';
import { checkLanded, type LandedItem } from '@/signing/check';
import type { SigningTestOptions } from '@/signing/create';
import type { SigningState } from '@/signing/machine';
import { AccountsStep } from './AccountsStep.tsx';
import { DoneStep } from './DoneStep.tsx';
import { useMainKeyAccounts } from './load.ts';
import { PeriodStep } from './PeriodStep.tsx';
import { SecondKeyStep } from './SecondKeyStep.tsx';
import { SignStep } from './SignStep.tsx';
import {
  accountParams,
  blockers,
  candidates,
  effectiveSelection,
  initialWizardState,
  parseAccountParams,
  protectedIds,
  retryableIds,
  secondKeyProblems,
  uncertainIds,
  WIZARD_STEPS,
  wizardReducer,
  type WizardAction,
  type WizardState,
  type WizardStep,
} from './wizard.ts';

const STEP_LABEL: Record<WizardStep, MessageKey> = {
  accounts: 'protect.steps.accounts',
  'second-key': 'protect.steps.secondKey',
  period: 'protect.steps.period',
  sign: 'protect.steps.sign',
  done: 'protect.steps.done',
};

type ProtectWizardProps = {
  /** The main key slot's address; the page remounts the wizard when it changes. */
  mainKey: Address | null;
  signing?: SigningTestOptions | undefined;
};

/**
 * The protect wizard (F1, DECISIONS.md D48): accounts, second key, lock period, review and sign, done. Each step reads
 * what it needs from the chain; nothing is written on this device or sent to the worker before the chain shows the
 * lock (section 4.6 of the step 4 spec): then the second key and the accounts are remembered (D14, F6) and monitoring
 * is turned on (POST /api/watch).
 */
export function ProtectWizard({ mainKey, signing }: ProtectWizardProps) {
  const ports = usePorts();
  const { chain, api } = ports;
  const [params, setParams] = useSearchParams();
  const selected = useMemo(() => parseAccountParams(params), [params]);
  const slots = useWalletSlots();
  const mainReady = useSlot('main')?.ready === true;
  const secondSlot = useSlot('second');
  const secondKey = slots.second?.address ?? null;
  const knownSecondKeys = useKnownSecondKeys();
  const [state, dispatchState] = useReducer(wizardReducer, undefined, initialWizardState);
  const [attempt, setAttempt] = useState(0);
  const [watch, setWatch] = useState<WatchState>({ kind: 'idle' });
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);

  // The wizard state as of the last commit, for handlers that run from async code (onFinished, Check again).
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  // Accounts already written to this device, and accounts the worker confirmed it watches.
  const handled = useRef(new Set<Address>());
  const watched = useRef(new Set<Address>());
  const watchOp = useRef(0);

  // Read the chain only once the main key is connected here (a link is only named before that). Later steps keep the
  // read even while the wallet offers another account (one wallet holding both keys).
  const loadFor = mainKey !== null && (mainReady || state.step !== 'accounts') ? mainKey : null;
  const loaded = useMainKeyAccounts(chain, loadFor, attempt);
  const cands = useMemo(
    () => (loaded.status === 'ready' && mainKey !== null ? candidates(loaded.accounts, mainKey, knownSecondKeys, loaded.clock) : []),
    [loaded, mainKey, knownSecondKeys],
  );
  // Accounts this wizard already protected stay out of a later run (their lock would read as someone else's end date).
  const done = protectedIds(state);
  const chosen = effectiveSelection(selected, cands).filter((id) => !done.includes(id));
  const chosenAccounts = chosen.flatMap((id) => cands.find((candidate) => candidate.account.address === id)?.account ?? []);
  const problems = secondKey === null || mainKey === null ? [] : secondKeyProblems(secondKey, mainKey, chosenAccounts);
  const blockerInput = {
    mainReady,
    selection: chosen.length,
    secondReady: secondSlot?.ready === true,
    problems: problems.length,
    seedConfirmed: state.seedConfirmed,
  };
  const sameWallet =
    slots.main !== null && slots.second !== null && slots.main.walletId === slots.second.walletId
      ? (secondSlot?.wallet?.name ?? null)
      : null;

  // Focus follows the step (UX rule 2): its heading, never on the first render.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef(state.step);
  useEffect(() => {
    if (shownStep.current === state.step) return;
    shownStep.current = state.step;
    headingRef.current?.focus();
  }, [state.step]);

  const setSelected = (next: readonly Address[]) => {
    setParams(accountParams(next), { replace: true });
  };

  function dispatch(action: WizardAction): WizardState {
    const next = wizardReducer(stateRef.current, action);
    stateRef.current = next;
    dispatchState(action);
    return next;
  }

  /** The only writes (step 4 spec 4.6): after the chain shows a lock, once per account. */
  function record(next: WizardState) {
    const all = protectedIds(next);
    const newIds = all.filter((id) => !handled.current.has(id));
    if (newIds.length === 0) return;
    for (const id of newIds) handled.current.add(id);
    for (const id of newIds) {
      const job = next.outcomes[id];
      const after = job?.state.kind === 'done' || job?.state.kind === 'already-done' ? job.state.after : null;
      if (after !== null) ports.secondKeys.remember(after.lockup.custodian);
    }
    ports.protectedAccounts.remember(newIds);
    void turnOnMonitoring(all.filter((id) => !watched.current.has(id)));
  }

  async function turnOnMonitoring(accounts: readonly Address[]) {
    if (accounts.length === 0) return;
    watchOp.current += 1;
    const op = watchOp.current;
    setWatch({ kind: 'working' });
    const result = await watchWithRetry(api, accounts);
    if (result.kind === 'on') for (const id of accounts) watched.current.add(id);
    if (result.kind === 'partial') {
      for (const id of accounts) if (!result.rejected.some((item) => item.account === id)) watched.current.add(id);
    }
    if (op === watchOp.current) setWatch(result);
  }

  function onFinished(signingState: SigningState) {
    const jobs = signingState.ids.flatMap((id) => signingState.jobs[id] ?? []);
    record(dispatch({ type: 'finished', jobs, clock: signingState.clock }));
  }

  async function checkAgain() {
    const current = stateRef.current;
    const items = uncertainIds(current).flatMap((id): LandedItem[] => {
      const job = current.outcomes[id];
      if (job?.action === null || job?.action === undefined) return [];
      return [
        {
          id,
          action: job.action,
          signature: job.signature,
          lifetime: job.lifetime,
          bytes: job.bytes,
          before: job.before,
          confirmed: false,
          why: job.state.kind === 'unknown' ? job.state.why : undefined,
        },
      ];
    });
    setChecking(true);
    setCheckFailed(false);
    try {
      const states = await checkLanded(chain, items, { rereads: 0 });
      record(dispatch({ type: 'checked', states }));
    } catch {
      setCheckFailed(true);
    } finally {
      setChecking(false);
    }
  }

  function goTo(step: 'accounts' | 'second-key' | 'period') {
    dispatch({ type: 'go', step });
  }

  return (
    <div className="flex flex-col gap-8">
      <StepProgress steps={WIZARD_STEPS.map((step) => t(STEP_LABEL[step]))} current={WIZARD_STEPS.indexOf(state.step)} />
      {state.step === 'accounts' ? (
        <AccountsStep
          headingRef={headingRef}
          mainKey={mainKey}
          mainReady={mainReady}
          selected={selected}
          loaded={loaded}
          cands={cands}
          knownSecondKeys={knownSecondKeys}
          blockers={blockers('accounts', { ...blockerInput, clockReady: false })}
          onSelect={(account, checked) => {
            setSelected(checked ? [...selected.filter((id) => id !== account), account] : selected.filter((id) => id !== account));
          }}
          onRetry={() => {
            setAttempt((value) => value + 1);
          }}
          onContinue={() => {
            goTo('second-key');
          }}
        />
      ) : state.step === 'second-key' && mainKey !== null ? (
        <SecondKeyStep
          headingRef={headingRef}
          mainKey={mainKey}
          sameWallet={sameWallet}
          problems={problems}
          seedConfirmed={state.seedConfirmed}
          blockers={blockers('second-key', { ...blockerInput, clockReady: false })}
          onSeed={(value) => {
            dispatch({ type: 'confirm-seed', value });
          }}
          onLeaveOut={(account) => {
            setSelected(selected.filter((id) => id !== account));
          }}
          onBack={() => {
            goTo('accounts');
          }}
          onContinue={() => {
            goTo('period');
          }}
        />
      ) : state.step === 'period' ? (
        <PeriodStep
          headingRef={headingRef}
          period={state.period}
          blockerInput={blockerInput}
          onPeriod={(value) => {
            dispatch({ type: 'period', value });
          }}
          onBack={() => {
            goTo('second-key');
          }}
          onContinue={(lockUntil) => {
            dispatch({ type: 'sign', lockUntil, ids: chosen });
          }}
        />
      ) : state.step === 'sign' && state.run !== null && state.lockUntil !== null && mainKey !== null && secondKey !== null ? (
        <SignStep
          headingRef={headingRef}
          run={state.run}
          mainKey={mainKey}
          secondKey={secondKey}
          lockUntil={state.lockUntil}
          signing={signing}
          onFinished={onFinished}
          onBack={() => {
            goTo('period');
          }}
        />
      ) : state.step === 'done' && mainKey !== null ? (
        <DoneStep
          headingRef={headingRef}
          state={state}
          mainKey={mainKey}
          secondKeySlot={secondKey}
          watch={watch}
          checking={checking}
          checkFailed={checkFailed}
          actions={{
            retry: () => {
              dispatch({ type: 'retry', ids: retryableIds(stateRef.current) });
            },
            choosePeriod: () => {
              goTo('period');
            },
            checkAgain: () => void checkAgain(),
            retryMonitoring: () => void turnOnMonitoring(protectedIds(stateRef.current)),
          }}
        />
      ) : (
        // A key the step needs is gone (disconnected in the middle): start again from the second key.
        <SecondKeyFallback onBack={() => {
            goTo('second-key');
          }} />
      )}
    </div>
  );
}

/** The sign or done step without the key it needs (it was disconnected meanwhile): say so and offer the way back. */
function SecondKeyFallback({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm font-medium">{t('protect.second.needSecond')}</p>
      <Button variant="outline" onClick={onBack}>
        {t('common.back')}
      </Button>
    </div>
  );
}
