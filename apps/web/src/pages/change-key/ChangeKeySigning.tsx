import type { Address } from '@solana/kit';
import type { WalletRole } from '@stakeward/core';
import { useId, type Ref } from 'react';
import { t } from '@/i18n';
import { KeySlot } from '@/pages/app/KeySlot';
import { usePorts } from '@/ports';
import { createPageSession, type SigningTestOptions } from '@/signing/create';
import type { SigningState } from '@/signing/machine';
import { PageSigningPanel } from '@/signing/SigningPanel';
import { useSigningSession } from '@/signing/use-signing-session';
import { changeKeyPlan } from './plan.ts';

type ChangeKeySigningProps = {
  headingRef: Ref<HTMLHeadingElement>;
  account: Address;
  mainKey: Address;
  /** The second key that holds the lock now: it signs. */
  secondKey: Address;
  /** The new second key: it signs and pays. */
  newKey: Address;
  /** A new key is a new run (useSigningSession). */
  runKey: number;
  signing?: SigningTestOptions | undefined;
  onFinished: (state: SigningState) => void;
  onBack: () => void;
};

/**
 * The signing section of /change-key/:account (F7, live only): one SetLockupChecked for this stake account, signed by
 * the second key that holds the lock and by the new second key, which pays. The engine's fee check names the new key
 * as the one to fund when it has too little SOL; the old key never pays, as it may be stolen.
 */
export function ChangeKeySigning({ headingRef, account, mainKey, secondKey, newKey, runKey, signing, onFinished, onBack }: ChangeKeySigningProps) {
  const ports = usePorts();
  const headingId = useId();
  const ids = [account];
  const create = () => createPageSession(ports, { plan: changeKeyPlan({ secondKey, newKey }), ids, roundSize: 1, signing, onFinished });
  const { session, snapshot } = useSigningSession(create, `change-key#${String(runKey)}`);
  const knownRoles: Partial<Record<WalletRole, Address>> = { main: mainKey, second: secondKey, new: newKey };
  const renderKeySlot = (role: WalletRole, address: Address) => <KeySlot role={role} mainKey={mainKey} expected={address} />;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-5">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold">
        {t('changeKey.signHeading')}
      </h2>
      <PageSigningPanel
        session={session}
        state={snapshot}
        ids={ids}
        roundSize={1}
        knownRoles={knownRoles}
        renderKeySlot={renderKeySlot}
        onBack={onBack}
      />
    </section>
  );
}
