import type { Address } from '@solana/kit';
import type { WalletRole } from '@stakeward/core';
import { useId, type Ref } from 'react';
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
import { deactivatePlan, withdrawPlan } from './plan.ts';
import { WithdrawRisk } from './StageBlock.tsx';

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
  /**
   * Where the second key signs: here, or on another device by link (step 7 spec 10.2; only for a withdrawal with a
   * second key). By link, the main key's link-signing account comes first.
   */
  mode: SignMode;
  /** A new key is a new run (useSigningSession). */
  runKey: number;
  signing?: SigningTestOptions | undefined;
  onFinished: (state: SigningState) => void;
  onBack: () => void;
};

/**
 * The signing section of /withdraw/:account (F3): one transaction for this stake account, a Deactivate signed by the
 * main key or a Withdraw of the whole balance to the main key co-signed by the second key while the lock holds. The
 * engine reads the chain again, shows the inspector's summary of the exact bytes and asks each key's wallet; a key not
 * connected here is asked for by its exact account (KeySlot `expected`). By link, the transaction is built on the main
 * key's durable nonce: the main key signs here, then the page shows the link for the second key and waits for it.
 */
export function WithdrawSigning(props: WithdrawSigningProps) {
  const { headingRef, title, what, mainKey, secondKey, mode, signing, onBack } = props;
  const headingId = useId();
  const byLink = what === 'withdraw' && secondKey !== null && mode === 'link';
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-5">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-balance">
        {title}
      </h2>
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
          {(nonceAccount) => <WithdrawRun {...props} link={{ nonceAccount, remote: [secondKey] }} />}
        </NonceGate>
      ) : (
        <WithdrawRun {...props} link={undefined} />
      )}
    </section>
  );
}

type WithdrawRunProps = WithdrawSigningProps & {
  /** By link: the main key's link-signing account and the keys that sign on another device. */
  link: { nonceAccount: Address; remote: readonly Address[] } | undefined;
};

/** The run itself: one session per run key, live or on the main key's nonce. */
function WithdrawRun({ what, account, mainKey, secondKey, runKey, signing, onFinished, onBack, link }: WithdrawRunProps) {
  const ports = usePorts();
  const ids = [account];
  const create = () =>
    createPageSession(ports, {
      plan: what === 'withdraw' ? withdrawPlan({ mainKey, link }) : deactivatePlan({ mainKey }),
      ids,
      roundSize: 1,
      signing,
      onFinished,
    });
  const { session, snapshot } = useSigningSession(create, `withdraw#${String(runKey)}`);
  const knownRoles: Partial<Record<WalletRole, Address>> = secondKey === null ? { main: mainKey } : { main: mainKey, second: secondKey };
  const renderKeySlot = (role: WalletRole, address: Address) => <KeySlot role={role} mainKey={mainKey} expected={address} />;
  return (
    <PageSigningPanel
      session={session}
      state={snapshot}
      ids={ids}
      roundSize={1}
      knownRoles={knownRoles}
      renderKeySlot={renderKeySlot}
      // F3 step 3 right above the Sign button it guards, as on /protect: the SOL goes to the main key.
      risk={<WithdrawRisk mainKey={mainKey} />}
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
