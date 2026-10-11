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
import { delegatePlan } from './plan.ts';

type DelegateSigningProps = {
  headingRef: Ref<HTMLHeadingElement>;
  account: Address;
  /** The main key: it manages staking here, so it signs and pays. */
  mainKey: Address;
  voteAccount: Address;
  /** A new key is a new run (useSigningSession). */
  runKey: number;
  signing?: SigningTestOptions | undefined;
  onFinished: (state: SigningState) => void;
  onBack: () => void;
};

/**
 * The signing section of /delegate/:account (DECISIONS.md D134): one DelegateStake for this stake account, signed and
 * paid by the main key. The lock does not matter, as delegating moves no SOL; the second key is not asked.
 */
export function DelegateSigning({ headingRef, account, mainKey, voteAccount, runKey, signing, onFinished, onBack }: DelegateSigningProps) {
  const ports = usePorts();
  const headingId = useId();
  const ids = [account];
  const create = () => createPageSession(ports, { plan: delegatePlan({ mainKey, voteAccount }), ids, roundSize: 1, signing, onFinished });
  const { session, snapshot } = useSigningSession(create, `delegate#${String(runKey)}`);
  const knownRoles: Partial<Record<WalletRole, Address>> = { main: mainKey };
  const renderKeySlot = (role: WalletRole, address: Address) => <KeySlot role={role} mainKey={mainKey} expected={address} />;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-5">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold">
        {t('delegate.signHeading')}
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
