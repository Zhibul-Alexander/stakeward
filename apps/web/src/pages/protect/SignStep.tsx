import type { Address } from '@solana/kit';
import type { WalletRole } from '@stakeward/core';
import { useId, type Ref } from 'react';
import { RiskNote } from '@/components/product/risk-note';
import { t } from '@/i18n';
import { KeySlot } from '@/pages/app/KeySlot';
import { usePorts } from '@/ports';
import { createPageSession, type SigningTestOptions } from '@/signing/create';
import { initialSigningState, type SigningState } from '@/signing/machine';
import { SigningPanel, SigningView, type SigningActions } from '@/signing/SigningPanel';
import { useSigningSession } from '@/signing/use-signing-session';
import { protectPlan } from './plan.ts';

type SignStepProps = {
  headingRef: Ref<HTMLHeadingElement>;
  run: { key: number; ids: readonly Address[] };
  mainKey: Address;
  secondKey: Address;
  lockUntil: bigint;
  signing?: SigningTestOptions | undefined;
  onFinished: (state: SigningState) => void;
  onBack: () => void;
};

const noop = () => undefined;
const NO_ACTIONS: SigningActions = {
  sign: noop,
  continueWithWallet: noop,
  continueAfterSwitch: noop,
  stopWaiting: noop,
  restartRound: noop,
  oneAtATime: noop,
  retryPrepare: noop,
  finish: noop,
};

/**
 * Step 4 (F1 steps 4-5): one SetLockupChecked per stake account, signed by the main key and the second key. The
 * signing engine reads the chain again, shows the inspector's summary of the exact bytes, asks each wallet once for
 * the whole round, sends, and checks the result on the chain. A new run key is a new session.
 */
export function SignStep({ headingRef, run, mainKey, secondKey, lockUntil, signing, onFinished, onBack }: SignStepProps) {
  const ports = usePorts();
  const headingId = useId();
  const create = () =>
    createPageSession(ports, { plan: protectPlan({ mainKey, secondKey, lockUntil }), ids: run.ids, signing, onFinished });
  const { session, snapshot } = useSigningSession(create, `protect#${String(run.key)}`);
  const knownRoles = { main: mainKey, second: secondKey };
  // The step names the exact account: a wallet that offers another one is told which account this step needs.
  const renderKeySlot = (role: WalletRole, address: Address) => <KeySlot role={role} mainKey={mainKey} expected={address} />;
  const count = run.ids.length;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-2xl font-semibold">
          {t('protect.sign.heading')}
        </h2>
        <p className="max-w-prose text-muted">
          {count === 1 ? t('protect.sign.countOne') : t('protect.sign.countOther', { count })}
        </p>
      </div>
      <RiskNote risk="lose-second-key" date={lockUntil} />
      {session === null || snapshot === null ? (
        // The first frame, before the session starts: the same "building" view the session shows next.
        <SigningView
          state={initialSigningState(run.ids, count)}
          actions={NO_ACTIONS}
          knownRoles={knownRoles}
          renderKeySlot={renderKeySlot}
          onBack={onBack}
        />
      ) : (
        <SigningPanel session={session} state={snapshot} knownRoles={knownRoles} renderKeySlot={renderKeySlot} onBack={onBack} />
      )}
    </section>
  );
}
