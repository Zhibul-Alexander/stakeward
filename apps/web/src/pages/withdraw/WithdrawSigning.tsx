import type { Address } from '@solana/kit';
import type { WalletRole } from '@stakeward/core';
import { useId, type Ref } from 'react';
import { KeySlot } from '@/pages/app/KeySlot';
import { usePorts } from '@/ports';
import { createPageSession, type SigningTestOptions } from '@/signing/create';
import type { SigningState } from '@/signing/machine';
import { PageSigningPanel } from '@/signing/SigningPanel';
import { useSigningSession } from '@/signing/use-signing-session';
import { deactivatePlan, withdrawPlan } from './plan.ts';

export type WithdrawWhat = 'deactivate' | 'withdraw';

type WithdrawSigningProps = {
  headingRef: Ref<HTMLHeadingElement>;
  /** The stage's title, kept as this section's heading. */
  title: string;
  what: WithdrawWhat;
  account: Address;
  /** The withdrawer: it signs, pays and receives. */
  mainKey: Address;
  /** The second key of a lock in force when the page read the account; it co-signs a withdrawal. */
  secondKey: Address | null;
  /** A new key is a new run (useSigningSession). */
  runKey: number;
  signing?: SigningTestOptions | undefined;
  onFinished: (state: SigningState) => void;
  onBack: () => void;
};

/**
 * The signing section of /withdraw/:account (F3, live only): one transaction for this stake account, a Deactivate signed
 * by the main key or a Withdraw of the whole balance to the main key co-signed by the second key while the lock holds.
 * The engine reads the chain again, shows the inspector's summary of the exact bytes and asks each key's wallet; a key
 * not connected here is asked for by its exact account (KeySlot `expected`).
 */
export function WithdrawSigning({
  headingRef,
  title,
  what,
  account,
  mainKey,
  secondKey,
  runKey,
  signing,
  onFinished,
  onBack,
}: WithdrawSigningProps) {
  const ports = usePorts();
  const headingId = useId();
  const ids = [account];
  const create = () =>
    createPageSession(ports, {
      plan: what === 'withdraw' ? withdrawPlan({ mainKey }) : deactivatePlan({ mainKey }),
      ids,
      roundSize: 1,
      signing,
      onFinished,
    });
  const { session, snapshot } = useSigningSession(create, `withdraw#${String(runKey)}`);
  const knownRoles: Partial<Record<WalletRole, Address>> = secondKey === null ? { main: mainKey } : { main: mainKey, second: secondKey };
  const renderKeySlot = (role: WalletRole, address: Address) => <KeySlot role={role} mainKey={mainKey} expected={address} />;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-6">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-2xl font-semibold">
        {title}
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
