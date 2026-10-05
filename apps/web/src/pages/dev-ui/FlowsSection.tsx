import type { WalletRole } from '@stakeward/core';
import { useEffect, useState } from 'react';
import { ErrorState } from '@/components/product/error-state';
import { TransactionSummarySkeleton } from '@/components/product/transaction-summary';
import { WalletSlot } from '@/components/product/wallet-slot';
import { t } from '@/i18n';
import { ProtectDoneView, type ProtectDoneActions } from '@/pages/protect/DoneStep';
import { SigningView, type SigningActions } from '@/signing/SigningPanel';
import { NonceBlocked } from '@/signing/NonceGate';
import { NonceStepView } from '@/signing/NonceStep';
import {
  SAMPLE_NONCE_DEPOSIT,
  sampleDoneViews,
  sampleLinkStates,
  sampleNonceSteps,
  sampleSigningStates,
  type NonceSample,
  type SigningSample,
} from './flows.ts';
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
  resumeLink: noop,
  checkLinkNow: noop,
};

const NO_DONE_ACTIONS: ProtectDoneActions = { retry: noop, choosePeriod: noop, checkAgain: noop, retryMonitoring: noop };

const KNOWN_ROLES = { main: SAMPLE.mainKey, second: SAMPLE.secondKey };
const RESCUE_ROLES = { main: SAMPLE.mainKey, second: SAMPLE.secondKey, new: SAMPLE.newWallet };

function keySlot(role: WalletRole) {
  return <WalletSlot role={role} status="empty" wallets={SAMPLE_WALLETS} onConnect={noop} />;
}

/** The link card's cancel slot as the rescue page fills it (NonceCloseCard, variant cancel-link). */
function linkCancel() {
  return <NonceStepView mode="close" variant="cancel-link" role="new" amount={SAMPLE_NONCE_DEPOSIT} onStart={noop} />;
}

function NonceDemo({ sample }: { sample: NonceSample }) {
  return (
    <Demo label={t(sample.label)}>
      {sample.kind === 'step' ? <NonceStepView {...sample.props} onStart={noop} /> : <NonceBlocked hint={t('nonce.blockedHere')} />}
    </Demo>
  );
}

/**
 * Flows on /dev/ui (devnet only, loaded lazily like the product components): the signing panel in every phase it
 * explains, signing by link, and the protect wizard's Done screen. Presentational views fed with fixtures; the buttons
 * do nothing.
 */
export function FlowsSection() {
  const [clock] = useState(sampleClock);
  const [signing, setSigning] = useState<SigningSample[] | null>(null);
  const [link, setLink] = useState<SigningSample[] | null>(null);
  const [nonceSteps, setNonceSteps] = useState<NonceSample[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [doneViews] = useState(() => sampleDoneViews(clock));

  useEffect(() => {
    let cancelled = false;
    const fail = (error: unknown) => {
      if (!cancelled) setFailure(String(error));
    };
    sampleSigningStates(clock).then((result) => {
      if (!cancelled) setSigning(result);
    }, fail);
    sampleLinkStates(clock).then((result) => {
      if (!cancelled) setLink(result);
    }, fail);
    sampleNonceSteps().then((result) => {
      if (!cancelled) setNonceSteps(result);
    }, fail);
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
      <DevSection id="link" title={t('devUi.link')}>
        <p className="text-sm text-muted">{t('devUi.flows.linkNote')}</p>
        <div className="grid grid-cols-1 items-start gap-10 xl:grid-cols-2">
          {link === null ? (
            <>
              <TransactionSummarySkeleton />
              <TransactionSummarySkeleton />
            </>
          ) : (
            link.map((sample) => (
              <Demo key={sample.key} label={t(sample.label)}>
                <SigningView
                  state={sample.state}
                  actions={NO_SIGNING_ACTIONS}
                  knownRoles={RESCUE_ROLES}
                  renderKeySlot={keySlot}
                  confirm={sample.confirm === undefined ? undefined : { label: t(sample.confirm) }}
                  renderLinkCancel={linkCancel}
                />
              </Demo>
            ))
          )}
        </div>
        <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2 xl:grid-cols-3">
          {nonceSteps?.map((sample) => <NonceDemo key={sample.key} sample={sample} />)}
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
