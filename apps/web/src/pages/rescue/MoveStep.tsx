import type { Address } from '@solana/kit';
import type { WalletRole } from '@stakeward/core';
import { useId, type Ref } from 'react';
import { AddressText } from '@/components/product/address-text';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { KeySlot } from '@/pages/app/KeySlot';
import { usePorts } from '@/ports';
import { createPageSession, type SigningTestOptions } from '@/signing/create';
import type { SigningState } from '@/signing/machine';
import { NonceCloseCard } from '@/signing/NonceCloseCard';
import { NonceGate } from '@/signing/NonceGate';
import { PageSigningPanel } from '@/signing/SigningPanel';
import type { SignMode } from '@/signing/SignWhere';
import { useSigningSession } from '@/signing/use-signing-session';
import { rescuePlan } from './plan.ts';
import { SameWalletWarning, type SameWallet } from './SameWalletWarning.tsx';
import type { RescueRun } from './wizard.ts';

type MoveStepProps = {
  headingRef: Ref<HTMLHeadingElement>;
  run: RescueRun;
  mainKey: Address;
  mainMode: SignMode;
  secondMode: SignMode;
  /**
   * The new wallet's wallet app also holds these keys, or null (SECURITY-CHECK П5). The main key and the second key are
   * often first connected here, when the run asks for them; the warning then shows before they sign.
   */
  sameWallet: SameWallet | null;
  signing?: SigningTestOptions | undefined;
  onFinished: (state: SigningState) => void;
  onBack: () => void;
};

/**
 * Step 4 (F4 steps 3-5): one transaction per stake account, one after another: the new wallet signs here, the main key
 * and the second key here or by link. With every key here it runs on a recent blockhash; with a key signing by link,
 * on the new wallet's link-signing account (durable nonce), set up first (D121, a change to F4.3). The new owner is
 * shown in full before anything is signed.
 */
export function MoveStep({ headingRef, run, mainKey, mainMode, secondMode, sameWallet, signing, onFinished, onBack }: MoveStepProps) {
  const headingId = useId();
  const count = run.ids.length;
  const remote = [...(mainMode === 'link' ? [mainKey] : []), ...(secondMode === 'link' ? [run.secondKey] : [])];
  const rescue = (nonceAccount: Address | null) => (
    <RescueSigning
      run={run}
      mainKey={mainKey}
      nonceAccount={nonceAccount}
      remote={remote}
      signing={signing}
      onFinished={onFinished}
      onBack={onBack}
    />
  );
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold">
          {t('rescue.move.heading')}
        </h2>
        {/* The new owner in full before anything is signed (F4, UX rule 9). */}
        <div className="flex flex-col gap-1 rounded-lg bg-subtle px-4 py-3">
          <p className="text-sm font-medium">{t('rescue.move.newOwner')}</p>
          <AddressText address={run.newWallet} variant="full" explorer />
        </div>
        {sameWallet === null ? null : <SameWalletWarning sameWallet={sameWallet} action="sign" />}
        <div className="flex flex-col gap-1">
          <p className="max-w-prose text-pretty">{count === 1 ? t('rescue.move.countOne') : t('rescue.move.countOther', { count })}</p>
          <p className="max-w-prose text-sm text-muted">{t('rescue.move.ledger')}</p>
        </div>
      </div>
      {remote.length === 0 ? (
        rescue(null)
      ) : (
        <NonceGate
          authority={run.newWallet}
          role="new"
          blockedHint={t('nonce.blockedRescue')}
          variant="rescue"
          signing={signing}
          actions={
            <Button variant="ghost" onClick={onBack}>
              {t('common.back')}
            </Button>
          }
        >
          {(nonceAccount) => rescue(nonceAccount)}
        </NonceGate>
      )}
    </section>
  );
}

type RescueSigningProps = {
  run: RescueRun;
  mainKey: Address;
  /** The new wallet's nonce when a key signs by link; null when every key is here (a recent blockhash, D121). */
  nonceAccount: Address | null;
  /** Keys that sign on another device by link. */
  remote: readonly Address[];
  signing?: SigningTestOptions | undefined;
  onFinished: (state: SigningState) => void;
  onBack: () => void;
};

/** The run itself, on the new wallet's nonce or a recent blockhash: one session per run key. */
function RescueSigning({ run, mainKey, nonceAccount, remote, signing, onFinished, onBack }: RescueSigningProps) {
  const ports = usePorts();
  const { secondKey, newWallet } = run;
  const create = () =>
    createPageSession(ports, {
      plan: rescuePlan({
        mainKey,
        secondKey,
        newWallet,
        nonce: nonceAccount === null ? undefined : { nonceAccount, nonceAuthority: newWallet },
        remote,
      }),
      ids: run.ids,
      signing,
      onFinished,
    });
  const { session, snapshot } = useSigningSession(create, `rescue#${String(run.key)}`);
  const renderKeySlot = (role: WalletRole, address: Address) => <KeySlot role={role} mainKey={mainKey} expected={address} />;
  return (
    <PageSigningPanel
      session={session}
      state={snapshot}
      ids={run.ids}
      roundSize={1}
      knownRoles={{ main: mainKey, second: secondKey, new: newWallet }}
      renderKeySlot={renderKeySlot}
      renderLinkCancel={() => (
        <NonceCloseCard
          authority={newWallet}
          role="new"
          variant="cancel-link"
          signing={signing}
          onClosed={() => {
            session?.checkLinkNow();
          }}
        />
      )}
      onBack={onBack}
    />
  );
}
