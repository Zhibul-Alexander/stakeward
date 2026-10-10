import type { Address } from '@solana/kit';
import { rescueKitNonceSeed, type ChainClock, type WalletRole } from '@stakeward/core';
import { useId, useRef, useState, type Ref } from 'react';
import { RescueKitHttpError } from '@/api/rescue-kits';
import { AddressText } from '@/components/product/address-text';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { KeySlot } from '@/pages/app/KeySlot';
import { useApi, usePorts, useRescueKits } from '@/ports';
import { createPageSession, type SigningTestOptions } from '@/signing/create';
import type { JobView, SigningState } from '@/signing/machine';
import { NonceGate } from '@/signing/NonceGate';
import { PageSigningPanel } from '@/signing/SigningPanel';
import { useSigningSession } from '@/signing/use-signing-session';
import { rescueKitPlan } from './plan.ts';
import { SameWalletWarning, type SameWallet } from './SameWalletWarning.tsx';
import type { RescueRun } from './wizard.ts';

type KitStepProps = {
  headingRef: Ref<HTMLHeadingElement>;
  run: RescueRun;
  mainKey: Address;
  sameWallet: SameWallet | null;
  signing?: SigningTestOptions | undefined;
  /** `telegram`: per stored kit, its one-time Telegram link (null without a bot). */
  onFinished: (jobs: readonly JobView[], clock: ChainClock | null, telegram: ReadonlyMap<Address, string | null>) => void;
  onBack: () => void;
};

/**
 * One-tap rescue kits (D118), one stake account after another: the new wallet sets up that account's own nonce, then
 * the new wallet, the main key and the second key sign its rescue here (never by link: /cosign would send it at once),
 * and the worker keeps the signed bytes. Nothing changes on the chain except the nonce accounts.
 */
export function KitStep({ headingRef, run, mainKey, sameWallet, signing, onFinished, onBack }: KitStepProps) {
  const headingId = useId();
  const [index, setIndex] = useState(0);
  const collected = useRef<{ jobs: JobView[]; clock: ChainClock | null }>({ jobs: [], clock: null });
  const telegram = useRef(new Map<Address, string | null>());
  const id = run.ids[index];

  const next = (state: SigningState) => {
    collected.current.jobs.push(...state.ids.flatMap((jobId) => state.jobs[jobId] ?? []));
    collected.current.clock = state.clock ?? collected.current.clock;
    if (index + 1 < run.ids.length) setIndex(index + 1);
    else onFinished(collected.current.jobs, collected.current.clock, telegram.current);
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold">
          {t('rescueKit.sign.heading')}
        </h2>
        <p className="max-w-prose text-pretty">{t('rescueKit.sign.lead')}</p>
        <div className="flex flex-col gap-1 rounded-lg bg-subtle px-4 py-3">
          <p className="text-sm font-medium">{t('rescue.move.newOwner')}</p>
          <AddressText address={run.newWallet} variant="full" explorer />
        </div>
        {sameWallet === null ? null : <SameWalletWarning sameWallet={sameWallet} action="sign" />}
        <p className="text-sm text-muted">{t('rescueKit.sign.progress', { current: index + 1, count: run.ids.length })}</p>
      </div>
      {id === undefined ? null : (
        <NonceGate
          key={id}
          authority={run.newWallet}
          role="new"
          seed={rescueKitNonceSeed(id)}
          blockedHint={t('rescueKit.sign.nonceBlocked')}
          variant="rescue"
          signing={signing}
          actions={
            <Button variant="ghost" onClick={onBack}>
              {t('common.back')}
            </Button>
          }
        >
          {(nonceAccount) => (
            <KitSigning
              key={id}
              id={id}
              run={run}
              mainKey={mainKey}
              nonceAccount={nonceAccount}
              signing={signing}
              onStored={(url) => {
                telegram.current.set(id, url);
              }}
              onFinished={next}
              onBack={onBack}
            />
          )}
        </NonceGate>
      )}
    </section>
  );
}

type KitSigningProps = {
  id: Address;
  run: RescueRun;
  mainKey: Address;
  nonceAccount: Address;
  signing?: SigningTestOptions | undefined;
  onStored: (telegramUrl: string | null) => void;
  onFinished: (state: SigningState) => void;
  onBack: () => void;
};

/** The kit of one account: signed by the three keys here, then stored by the worker (watched first if it asks). */
function KitSigning({ id, run, mainKey, nonceAccount, signing, onStored, onFinished, onBack }: KitSigningProps) {
  const ports = usePorts();
  const api = useApi();
  const kits = useRescueKits();
  const { secondKey, newWallet } = run;
  const deliver = async (bytes: Uint8Array) => {
    try {
      onStored((await kits.store(bytes)).telegramUrl);
    } catch (error) {
      // The worker keeps kits only for watched accounts; a lock that just landed may not be watched yet.
      if (!(error instanceof RescueKitHttpError) || error.code !== 'not-watched') throw error;
      await api.watch([id]);
      onStored((await kits.store(bytes)).telegramUrl);
    }
  };
  const create = () =>
    createPageSession(ports, {
      plan: rescueKitPlan({ mainKey, secondKey, newWallet, nonceAccount, deliver }),
      ids: [id],
      signing,
      onFinished,
    });
  const { session, snapshot } = useSigningSession(create, `rescue-kit#${String(run.key)}#${id}`);
  const renderKeySlot = (role: WalletRole, address: Address) => <KeySlot role={role} mainKey={mainKey} expected={address} />;
  return (
    <PageSigningPanel
      session={session}
      state={snapshot}
      ids={[id]}
      roundSize={1}
      knownRoles={{ main: mainKey, second: secondKey, new: newWallet }}
      renderKeySlot={renderKeySlot}
      onBack={onBack}
    />
  );
}
