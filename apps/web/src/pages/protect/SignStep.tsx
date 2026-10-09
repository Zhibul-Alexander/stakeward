import type { Address } from '@solana/kit';
import type { WalletRole } from '@stakeward/core';
import { useId, type Ref } from 'react';
import { RiskNote } from '@/components/product/risk-note';
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
import { protectPlan, refusalText } from './plan.ts';

type SignStepProps = {
  headingRef: Ref<HTMLHeadingElement>;
  run: { key: number; ids: readonly Address[] };
  mainKey: Address;
  secondKey: Address;
  lockUntil: bigint;
  /** Where the second key signs: here, or on another device by link (on the main key's link-signing account). */
  mode: SignMode;
  signing?: SigningTestOptions | undefined;
  onFinished: (state: SigningState) => void;
  onBack: () => void;
};

/**
 * Step 4 (F1 steps 4-5): one SetLockupChecked per stake account, signed by the main key and the second key. The
 * signing engine reads the chain again, shows the inspector's summary of the exact bytes, asks each wallet once for
 * the whole round, sends, and checks the result on the chain. A new run key is a new session. The risk of losing the
 * second key, with its date, stands right above the Sign button (UX rule 6). By link (step 7 spec 10.1) the main key's
 * link-signing account comes first; then one transaction per stake account, one after another: the main key signs
 * here and the page shows a link for the second key and waits for it.
 */
export function SignStep(props: SignStepProps) {
  const { headingRef, run, mainKey, mode, signing, onBack } = props;
  const headingId = useId();
  const count = run.ids.length;
  const byLink = mode === 'link';
  // By link the line says how the transactions travel. Live it would only repeat the signing order's "Approves N in one
  // request", which counts the round actually built (an account read again and left out is named there).
  const linkText = count === 1 ? t('protect.sign.linkOne') : t('protect.sign.linkOther', { count });
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-balance">
          {t('protect.sign.heading')}
        </h2>
        {byLink ? <p className="max-w-prose text-pretty text-muted">{linkText}</p> : null}
      </div>
      {byLink ? (
        <NonceGate
          authority={mainKey}
          role="main"
          blockedHint={t('nonce.blockedHere')}
          signing={signing}
          actions={
            <Button variant="ghost" onClick={onBack}>
              {t('common.back')}
            </Button>
          }
        >
          {(nonceAccount) => <ProtectRun {...props} nonceAccount={nonceAccount} />}
        </NonceGate>
      ) : (
        <ProtectRun {...props} nonceAccount={null} />
      )}
    </section>
  );
}

/** The run itself: one session per run key, live or (with a nonce account) by link. */
function ProtectRun({
  run,
  mainKey,
  secondKey,
  lockUntil,
  signing,
  onFinished,
  onBack,
  nonceAccount,
}: SignStepProps & { nonceAccount: Address | null }) {
  const ports = usePorts();
  const link = nonceAccount === null ? undefined : { nonceAccount };
  const create = () =>
    createPageSession(ports, { plan: protectPlan({ mainKey, secondKey, lockUntil, link }), ids: run.ids, signing, onFinished });
  const { session, snapshot } = useSigningSession(create, `protect#${String(run.key)}`);
  const knownRoles = { main: mainKey, second: secondKey };
  // The step names the exact account: a wallet that offers another one is told which account this step needs. While
  // the key is missing, its Connect is the screen's one filled button.
  const renderKeySlot = (role: WalletRole, address: Address) => (
    <KeySlot role={role} mainKey={mainKey} expected={address} emphasis="primary" />
  );
  return (
    <PageSigningPanel
      session={session}
      state={snapshot}
      ids={run.ids}
      // On a nonce every transaction is a round of its own (the engine forces it); live, one round for all.
      roundSize={link === undefined ? run.ids.length : 1}
      knownRoles={knownRoles}
      renderKeySlot={renderKeySlot}
      risk={<RiskNote risk="lose-second-key" date={lockUntil} variant="inline" />}
      refusalText={refusalText}
      renderLinkCancel={
        link === undefined
          ? undefined
          : () => (
              <NonceCloseCard
                authority={mainKey}
                role="main"
                variant="cancel-link"
                signing={signing}
                onClosed={() => {
                  session?.checkLinkNow();
                }}
              />
            )
      }
      onBack={onBack}
    />
  );
}
