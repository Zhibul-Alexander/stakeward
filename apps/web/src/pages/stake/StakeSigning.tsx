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
import { createStakePlan } from './plan.ts';

type StakeSigningProps = {
  headingRef: Ref<HTMLHeadingElement>;
  mainKey: Address;
  stakeAccount: Address;
  seed: string;
  lamports: bigint;
  voteAccount: Address;
  /** A new key is a new run (useSigningSession). */
  runKey: number;
  signing?: SigningTestOptions | undefined;
  onFinished: (state: SigningState) => void;
  onBack: () => void;
};

/** The signing section of /stake (D138): one transaction that creates and delegates the account, signed by the main key. */
export function StakeSigning({ headingRef, mainKey, stakeAccount, seed, lamports, voteAccount, runKey, signing, onFinished, onBack }: StakeSigningProps) {
  const ports = usePorts();
  const headingId = useId();
  const ids = [stakeAccount];
  const create = () =>
    createPageSession(ports, {
      plan: createStakePlan({ mainKey, stakeAccount, seed, lamports, voteAccount }),
      ids,
      roundSize: 1,
      signing,
      onFinished,
    });
  const { session, snapshot } = useSigningSession(create, `stake#${String(runKey)}`);
  const knownRoles: Partial<Record<WalletRole, Address>> = { main: mainKey };
  const renderKeySlot = (role: WalletRole, address: Address) => <KeySlot role={role} mainKey={mainKey} expected={address} />;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-5">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold">
        {t('stake.signHeading')}
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
