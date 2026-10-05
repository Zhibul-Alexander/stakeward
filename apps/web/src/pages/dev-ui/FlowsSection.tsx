import type { WalletRole } from '@stakeward/core';
import { useEffect, useState } from 'react';
import { ErrorState } from '@/components/product/error-state';
import { TransactionSummarySkeleton } from '@/components/product/transaction-summary';
import { WalletSlot } from '@/components/product/wallet-slot';
import { t } from '@/i18n';
import { ProtectDoneView, type ProtectDoneActions } from '@/pages/protect/DoneStep';
import { SigningView, type SigningActions } from '@/signing/SigningPanel';
import { sampleDoneViews, sampleSigningStates, type SigningSample } from './flows.ts';
import { Demo, DevSection } from './layout.tsx';
import { SAMPLE, SAMPLE_WALLETS, sampleClock } from './samples.ts';

const noop = () => undefined;

const NO_SIGNING_ACTIONS: SigningActions = {
  sign: noop,
  continueWithWallet: noop,
  continueAfterSwitch: noop,
  stopWaiting: noop,
  restartRound: noop,
  oneAtATime: noop,
  retryPrepare: noop,
  finish: noop,
};

const NO_DONE_ACTIONS: ProtectDoneActions = { retry: noop, choosePeriod: noop, checkAgain: noop, retryMonitoring: noop };

const KNOWN_ROLES = { main: SAMPLE.mainKey, second: SAMPLE.secondKey };

function keySlot(role: WalletRole) {
  return <WalletSlot role={role} status="empty" wallets={SAMPLE_WALLETS} onConnect={noop} />;
}

/**
 * Flows on /dev/ui (devnet only, loaded lazily like the product components): the signing panel in every phase it
 * explains, and the protect wizard's Done screen. Presentational views fed with fixtures; the buttons do nothing.
 */
export function FlowsSection() {
  const [clock] = useState(sampleClock);
  const [signing, setSigning] = useState<SigningSample[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [doneViews] = useState(() => sampleDoneViews(clock));

  useEffect(() => {
    let cancelled = false;
    sampleSigningStates(clock).then(
      (result) => {
        if (!cancelled) setSigning(result);
      },
      (error: unknown) => {
        if (!cancelled) setFailure(String(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [clock]);

  return (
    <>
      <DevSection id="signing" title={t('devUi.signing')}>
        <p className="text-sm text-muted">{t('devUi.flows.signingNote')}</p>
        {failure === null ? null : <ErrorState title={t('devUi.states.error')} message={failure} />}
        <div className="grid grid-cols-1 items-start gap-10 xl:grid-cols-2">
          {signing === null ? (
            <>
              <TransactionSummarySkeleton />
              <TransactionSummarySkeleton />
            </>
          ) : (
            signing.map((sample) => (
              <Demo key={sample.key} label={t(sample.label)}>
                <SigningView
                  state={sample.state}
                  actions={NO_SIGNING_ACTIONS}
                  knownRoles={KNOWN_ROLES}
                  renderKeySlot={keySlot}
                  onBack={noop}
                />
              </Demo>
            ))
          )}
        </div>
      </DevSection>
      <DevSection id="protect-result" title={t('devUi.protectResult')}>
        <p className="text-sm text-muted">{t('devUi.flows.protectResultNote')}</p>
        <div className="flex flex-col gap-12">
          {doneViews.map((sample) => (
            <Demo key={sample.key} label={t(sample.label)}>
              <ProtectDoneView {...sample.props} actions={NO_DONE_ACTIONS} />
            </Demo>
          ))}
        </div>
      </DevSection>
    </>
  );
}
