import type { Address } from '@solana/kit';
import { isLockupInForce } from '@stakeward/core';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSearch } from 'wouter';
import { PageHeader } from '@/components/layout/PageHeader';
import { StepProgress } from '@/components/product/step-progress';
import { Button } from '@/components/ui/button';
import { t, type MessageKey } from '@/i18n';
import { parseAccountParam } from '@/pages/account/load';
import { useMainKeyAccounts } from '@/pages/protect/load';
import { useKnownSecondKeys, usePorts, useSlot, useWallets, useWalletSlots } from '@/ports';
import { checkLanded, type LandedItem } from '@/signing/check';
import type { SigningTestOptions } from '@/signing/create';
import type { SigningState } from '@/signing/machine';
import type { SignMode } from '@/signing/SignWhere';
import { DoneStep } from './DoneStep.tsx';
import { KeysStep } from './KeysStep.tsx';
import { MoveStep } from './MoveStep.tsx';
import { NewWalletStep } from './NewWalletStep.tsx';
import { StakeStep } from './StakeStep.tsx';
import type { SameWallet } from './SameWalletWarning.tsx';
import {
  addOfferedAccounts,
  initialRescueState,
  MAX_RESCUE_ACCOUNTS,
  movedIds,
  newWalletProblems,
  newWalletSharesWallet,
  RESCUE_STEPS,
  rescueBlockers,
  rescueGroups,
  rescueReducer,
  retryableRescueIds,
  secondKeyChoices,
  uncertainRescueIds,
  type OfferedAccounts,
  type RescueAction,
  type RescueBlocker,
  type RescueState,
  type RescueStep,
} from './wizard.ts';

const STEP_LABEL: Record<RescueStep, MessageKey> = {
  stake: 'rescue.steps.stake',
  'new-wallet': 'rescue.steps.newWallet',
  keys: 'rescue.steps.keys',
  move: 'rescue.steps.move',
  done: 'rescue.steps.done',
};

const EMPTY_GROUPS = { movable: [], otherKey: [], unsupported: [] };
const NOTHING_OFFERED: OfferedAccounts = new Map();

/** What the first step says when Continue cannot go on yet. */
function stakeBlockerText(blocker: RescueBlocker): string {
  return blocker === 'need-main' ? t('rescue.stake.needMain') : t('rescue.stake.needMovable');
}

/**
 * The rescue wizard (F4, DECISIONS.md D70): your stake, new wallet, keys, move, done. The main key comes from the page
 * address (`?address=`, e.g. a Telegram alert), the main key slot or the field, in that order; the first step needs no
 * wallet. One second key per run, at most MAX_RESCUE_ACCOUNTS accounts, most urgent first, always on the new wallet's
 * nonce. Nothing is written on this device before the chain shows a move.
 */
export function RescueWizard({ signing }: { signing?: SigningTestOptions | undefined }) {
  const ports = usePorts();
  const { chain } = ports;
  const search = useSearch();
  const paramA = parseAccountParam(new URLSearchParams(search).get('address') ?? undefined);
  const slots = useWalletSlots();
  const wallets = useWallets();
  const mainSlot = useSlot('main');
  const secondSlot = useSlot('second');
  const newSlot = useSlot('new');
  const known = useKnownSecondKeys();
  const [state, dispatchState] = useReducer(rescueReducer, paramA, initialRescueState);
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  // Every account each wallet app has offered since the page opened (SECURITY-CHECK П5): an app switched from the main
  // key to an "Add account" new wallet still holds the main key. Kept like derived state: set while rendering, only
  // when a wallet offers something new.
  const [offeredSeen, setOfferedSeen] = useState(NOTHING_OFFERED);
  const offered = addOfferedAccounts(offeredSeen, wallets);
  if (offered !== offeredSeen) setOfferedSeen(offered);

  // The wizard state as of the last commit, for handlers that run from async code (onFinished, Check again).
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  // Accounts already written to this device.
  const handled = useRef(new Set<Address>());

  // The main key: on the first step from the page address, the main key slot or the field (first wins); fixed when
  // its Continue is pressed, so a wallet connected later never changes whose stake moves.
  const slotA = mainSlot?.ready === true ? (slots.main?.address ?? null) : null;
  const liveA = paramA ?? slotA ?? state.mainKey;
  const A = state.step === 'stake' ? liveA : (state.mainKey ?? liveA);
  const loaded = useMainKeyAccounts(chain, A, state.attempt);
  const accounts = useMemo(() => (loaded.status === 'ready' ? loaded.accounts : []), [loaded]);
  const clock = loaded.status === 'ready' ? loaded.clock : null;
  const choices = A === null || clock === null ? [] : secondKeyChoices(accounts, A, clock);
  const secondSlotKey = secondSlot?.ready === true ? (slots.second?.address ?? null) : null;
  const K =
    choices.length === 0
      ? secondSlotKey
      : state.secondChoice !== null && choices.includes(state.secondChoice)
        ? state.secondChoice
        : (choices[0] ?? null);
  const groups = A === null || clock === null ? EMPTY_GROUPS : rescueGroups(accounts, A, K, clock);
  const runIds = groups.movable.slice(0, MAX_RESCUE_ACCOUNTS).map((account) => account.address);
  const D = newSlot?.ready === true ? (slots.new?.address ?? null) : null;
  // The new wallet sits in the same wallet app as a key: probably the same seed phrase (SECURITY-CHECK П5). Checked on
  // every step that connects a key: the main key and the second key are often connected only at the keys or move step.
  // The keys: the main key; the second keys that lock this stake (any slot's key when none does) and the run's.
  const sharedWith = newWalletSharesWallet(
    slots,
    {
      newWallet: state.step === 'move' && state.run !== null ? state.run.newWallet : (slots.new?.address ?? null),
      main: A,
      second: [
        ...(choices.length === 0 ? (slots.second === null ? [] : [slots.second.address]) : choices),
        ...(state.run === null ? [] : [state.run.secondKey]),
      ],
    },
    offered,
  );
  const newWalletName = newSlot?.wallet?.name ?? null;
  const sameWallet: SameWallet | null =
    newWalletName === null || sharedWith.length === 0 ? null : { wallet: newWalletName, roles: sharedWith };
  // Where each key signs: the user's choice, else here when its slot holds it and its wallet offers it.
  const mainMode: SignMode = state.mainMode ?? (A !== null && slots.main?.address === A && mainSlot?.ready === true ? 'here' : 'link');
  const secondMode: SignMode =
    choices.length === 0
      ? 'here'
      : (state.secondMode ?? (K !== null && slots.second?.address === K && secondSlot?.ready === true ? 'here' : 'link'));

  // Focus follows the step (UX rule 2): its heading, never on the first render.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef(state.step);
  useEffect(() => {
    if (shownStep.current === state.step) return;
    shownStep.current = state.step;
    headingRef.current?.focus();
  }, [state.step]);

  function dispatch(action: RescueAction): RescueState {
    const next = rescueReducer(stateRef.current, action);
    stateRef.current = next;
    dispatchState(action);
    return next;
  }

  /** The only writes: after the chain shows a move, once per account (the second key, the accounts still locked). */
  function record(next: RescueState) {
    const run = next.run;
    const newIds = movedIds(next).filter((id) => !handled.current.has(id));
    if (run === null || newIds.length === 0) return;
    for (const id of newIds) handled.current.add(id);
    ports.secondKeys.remember(run.secondKey);
    const lockedNow = newIds.filter((id) => {
      const job = next.outcomes[id];
      const after = job?.state.kind === 'done' || job?.state.kind === 'already-done' ? job.state.after : null;
      return after !== null && next.clock !== null && isLockupInForce(after.lockup, next.clock);
    });
    if (lockedNow.length > 0) ports.protectedAccounts.remember(lockedNow);
  }

  function onFinished(signingState: SigningState) {
    const jobs = signingState.ids.flatMap((id) => signingState.jobs[id] ?? []);
    record(dispatch({ type: 'finished', jobs, clock: signingState.clock }));
  }

  async function checkAgain() {
    const current = stateRef.current;
    const items = uncertainRescueIds(current).flatMap((id): LandedItem[] => {
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

  const stakeProblems =
    A !== null && loaded.status !== 'ready'
      ? [t('rescue.stake.loading')]
      : rescueBlockers('stake', {
          mainKey: liveA,
          movable: groups.movable.length,
          choices: choices.length,
          newWallet: null,
          newProblems: 0,
          seedConfirmed: false,
          balance: null,
          needed: null,
          secondKey: K,
        }).map(stakeBlockerText);

  return (
    <>
      <PageHeader
        title={t('common.pages.rescue')}
        lead={state.step === 'stake' ? t('rescue.intro') : undefined}
        meta={
          <>
            <p>{t('rescue.desktop')}</p>
            <p>{t('common.neverSeedPhrase')}</p>
          </>
        }
        progress={<StepProgress steps={RESCUE_STEPS.map((step) => t(STEP_LABEL[step]))} current={RESCUE_STEPS.indexOf(state.step)} />}
      />
      {state.step === 'stake' ? (
        <StakeStep
          headingRef={headingRef}
          mainKey={liveA}
          mainKeyFrom={paramA !== null ? 'address' : slotA !== null ? 'slot' : null}
          typed={state.typed}
          loaded={loaded}
          groups={groups}
          knownSecondKeys={K === null ? known : [...known, K]}
          problems={stakeProblems}
          onTyped={(text) => {
            dispatch({ type: 'typed', text });
          }}
          onFind={(address) => {
            dispatch({ type: 'main-key', address });
          }}
          onRetry={() => {
            dispatch({ type: 'look-again' });
          }}
          onContinue={() => {
            dispatch({ type: 'main-key', address: liveA });
            dispatch({ type: 'go', step: 'new-wallet' });
          }}
        />
      ) : state.step === 'new-wallet' && A !== null ? (
        <NewWalletStep
          headingRef={headingRef}
          mainKey={A}
          newWallet={D}
          sameWallet={sameWallet}
          problems={D === null ? [] : newWalletProblems(D, A, secondSlotKey === null ? choices : [...choices, secondSlotKey], accounts)}
          count={runIds.length}
          seedConfirmed={state.seedConfirmed}
          onSeed={(value) => {
            dispatch({ type: 'confirm-seed', value });
          }}
          onBack={() => {
            dispatch({ type: 'go', step: 'stake' });
          }}
          onContinue={() => {
            dispatch({ type: 'go', step: 'keys' });
          }}
        />
      ) : state.step === 'keys' && A !== null && D !== null ? (
        <KeysStep
          headingRef={headingRef}
          mainKey={A}
          newWallet={D}
          choices={choices}
          secondKey={K}
          sameWallet={sameWallet}
          mainMode={mainMode}
          secondMode={secondMode}
          onChoose={(address) => {
            dispatch({ type: 'second-choice', address });
          }}
          onMainMode={(value) => {
            dispatch({ type: 'main-mode', value });
          }}
          onSecondMode={(value) => {
            dispatch({ type: 'second-mode', value });
          }}
          onBack={() => {
            dispatch({ type: 'go', step: 'new-wallet' });
          }}
          onContinue={() => {
            if (K === null) return;
            // The modes as shown are the run's: a wallet connected later does not move a key to this browser.
            dispatch({ type: 'main-mode', value: mainMode });
            dispatch({ type: 'second-mode', value: secondMode });
            dispatch({ type: 'move', ids: runIds, secondKey: K, newWallet: D });
          }}
        />
      ) : state.step === 'move' && state.run !== null && A !== null ? (
        <MoveStep
          headingRef={headingRef}
          run={state.run}
          mainKey={A}
          mainMode={state.mainMode ?? mainMode}
          secondMode={state.secondMode ?? secondMode}
          sameWallet={sameWallet}
          signing={signing}
          onFinished={onFinished}
          onBack={() => {
            dispatch({ type: 'go', step: 'keys' });
          }}
        />
      ) : state.step === 'done' && state.run !== null ? (
        <DoneStep
          headingRef={headingRef}
          outcomes={state.order.flatMap((id) => state.outcomes[id] ?? [])}
          clock={state.clock ?? { unixTimestamp: 0n, epoch: 0n }}
          newWallet={state.run.newWallet}
          secondKey={state.run.secondKey}
          checking={checking}
          checkFailed={checkFailed}
          signing={signing}
          actions={{
            retry: () => {
              const { run } = stateRef.current;
              if (run === null) return;
              dispatch({ type: 'move', ids: retryableRescueIds(stateRef.current), secondKey: run.secondKey, newWallet: run.newWallet });
            },
            checkAgain: () => void checkAgain(),
            lookAgain: () => {
              dispatch({ type: 'look-again' });
            },
          }}
        />
      ) : (
        // A key the step needs is gone (disconnected in the middle): back to the step that connects it.
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm font-medium">{A === null ? t('rescue.stake.needMain') : t('rescue.newWallet.needNew')}</p>
          <Button
            variant="outline"
            onClick={() => {
              dispatch({ type: 'go', step: A === null ? 'stake' : 'new-wallet' });
            }}
          >
            {t('common.back')}
          </Button>
        </div>
      )}
    </>
  );
}
