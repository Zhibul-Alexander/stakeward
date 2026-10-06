import type { Address } from '@solana/kit';
import { formatSol, networkFeeFor, type WalletRole } from '@stakeward/core';
import { InfoIcon, RefreshCwIcon } from 'lucide-react';
import { useId, type Ref } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { Load } from '@/hooks/use-load';
import { t } from '@/i18n';
import { KeySlot } from '@/pages/app/KeySlot';
import { usePorts } from '@/ports';
import { createPageSession, type SigningTestOptions } from '@/signing/create';
import type { SigningState } from '@/signing/machine';
import { PageSigningPanel } from '@/signing/SigningPanel';
import { useSigningSession } from '@/signing/use-signing-session';
import { backKind } from '@/signing/view';
import { extendPlan } from './plan.ts';

type ExtendSigningProps = {
  headingRef: Ref<HTMLHeadingElement>;
  /** The choice in words, kept as this section's heading. */
  title: string;
  account: Address;
  mainKey: Address;
  /** The second key that holds the lock: it signs, and pays when it can. */
  secondKey: Address;
  /** The new lock end, or 0 to remove the lock; the same on every retry. */
  lockUntil: bigint;
  /** A new key is a new run (useSigningSession). */
  runKey: number;
  /** The network's minimum balance for a wallet, for "send it at least". */
  rent0: Load<bigint>;
  signing?: SigningTestOptions | undefined;
  onFinished: (state: SigningState) => void;
  /** A new run with the same lock end: the plan reads the second key's balance again. */
  onCheckAgain: () => void;
  onBack: () => void;
};

/**
 * The signing section of /extend/:account (F5, live only): one SetLockup for this stake account, signed by the second
 * key. When the second key has too little SOL for the fee the main key pays and signs too; the page says so and how
 * much to send the second key so that it signs alone next time. Removing the lock needs a ticked confirmation first.
 */
export function ExtendSigning({
  headingRef,
  title,
  account,
  mainKey,
  secondKey,
  lockUntil,
  runKey,
  rent0,
  signing,
  onFinished,
  onCheckAgain,
  onBack,
}: ExtendSigningProps) {
  const ports = usePorts();
  const headingId = useId();
  const ids = [account];
  const create = () =>
    createPageSession(ports, { plan: extendPlan({ secondKey, lockUntil }), ids, roundSize: 1, signing, onFinished });
  const { session, snapshot } = useSigningSession(create, `extend#${String(runKey)}`);
  const knownRoles: Partial<Record<WalletRole, Address>> = { main: mainKey, second: secondKey };
  const renderKeySlot = (role: WalletRole, address: Address) => <KeySlot role={role} mainKey={mainKey} expected={address} />;
  const feePayer = snapshot?.round?.txs[0]?.summary.feePayer;
  // Its Check again starts a new run: only while nothing may be in flight (the panel offers Back then, view backKind).
  // Once a wallet is asked or the transaction is sent, a new run could build and send a second SetLockup.
  const restartable = snapshot !== null && backKind(snapshot) !== null;
  // Said whenever the main key pays, also when the rent read failed: then without the amount (the plan already chose).
  const mainPays = feePayer !== undefined && feePayer !== secondKey && restartable;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-6">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-2xl font-semibold">
        {title}
      </h2>
      {mainPays ? (
        <Alert tone="info" role="note">
          <InfoIcon aria-hidden="true" />
          <AlertDescription className="flex flex-col gap-3 text-foreground">
            <p>
              {rent0.status === 'ready'
                ? t('extend.mainPays', { amount: formatSol(networkFeeFor(1) + rent0.value) })
                : t('extend.mainPaysNoAmount')}
            </p>
            <div>
              <Button variant="outline" size="sm" onClick={onCheckAgain}>
                <RefreshCwIcon aria-hidden="true" />
                {t('common.checkAgain')}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
      <PageSigningPanel
        session={session}
        state={snapshot}
        ids={ids}
        roundSize={1}
        knownRoles={knownRoles}
        renderKeySlot={renderKeySlot}
        onBack={onBack}
        confirm={lockUntil === 0n ? { label: t('extend.removeConfirm') } : undefined}
      />
    </section>
  );
}
