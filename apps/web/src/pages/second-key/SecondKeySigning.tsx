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
import { secondKeyPlan } from './plan.ts';

type SecondKeySigningProps = {
  headingRef: Ref<HTMLHeadingElement>;
  account: Address;
  mainKey: Address;
  /** The second key that holds the lock: it signs, and never pays. */
  secondKey: Address;
  /** The new second key: it signs, and pays when it can. */
  newSecondKey: Address;
  /** A new key is a new run (useSigningSession). */
  runKey: number;
  /** The network's minimum balance for a wallet, for "send it at least". */
  rent0: Load<bigint>;
  signing?: SigningTestOptions | undefined;
  onFinished: (state: SigningState) => void;
  /** A new run with the same keys: the plan reads the new second key's balance again. */
  onCheckAgain: () => void;
  onBack: () => void;
};

/**
 * The signing section of /second-key/:account (F7, live only): one SetLockupChecked for this stake account, signed by
 * the second key that holds the lock and by the new second key. When the new second key has too little SOL for the fee
 * the main key pays and signs too (the F5 fallback); the page says so and how much to send the new key so that it pays.
 */
export function SecondKeySigning({
  headingRef,
  account,
  mainKey,
  secondKey,
  newSecondKey,
  runKey,
  rent0,
  signing,
  onFinished,
  onCheckAgain,
  onBack,
}: SecondKeySigningProps) {
  const ports = usePorts();
  const headingId = useId();
  const ids = [account];
  const create = () =>
    createPageSession(ports, { plan: secondKeyPlan({ secondKey, newSecondKey }), ids, roundSize: 1, signing, onFinished });
  const { session, snapshot } = useSigningSession(create, `second-key#${String(runKey)}`);
  const knownRoles: Partial<Record<WalletRole, Address>> = { main: mainKey, second: secondKey, new: newSecondKey };
  const renderKeySlot = (role: WalletRole, address: Address) => <KeySlot role={role} mainKey={mainKey} expected={address} />;
  const feePayer = snapshot?.round?.txs[0]?.summary.feePayer;
  // Its Check again starts a new run: only while nothing may be in flight (as on /extend).
  const restartable = snapshot !== null && backKind(snapshot) !== null;
  const mainPays = feePayer !== undefined && feePayer !== newSecondKey && rent0.status === 'ready' && restartable;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-2xl font-semibold">
          {t('secondKey.sign.heading')}
        </h2>
        {/* The Ledger app names the new custodian "New authority" (CLAUDE.md section 6), as on the protect step. */}
        <p className="max-w-prose text-sm text-muted">{t('secondKey.sign.ledger')}</p>
      </div>
      {mainPays ? (
        <Alert tone="info" role="note">
          <InfoIcon aria-hidden="true" />
          <AlertDescription className="flex flex-col gap-3 text-foreground">
            <p>{t('secondKey.sign.mainPays', { amount: formatSol(networkFeeFor(2) + rent0.value) })}</p>
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
      />
    </section>
  );
}
