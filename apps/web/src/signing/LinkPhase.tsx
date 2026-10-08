import type { Address } from '@solana/kit';
import type { WalletRole } from '@stakeward/core';
import type { ReactNode } from 'react';
import { Disclosure } from '@/components/product/disclosure';
import { joinRoles, LinkCard } from '@/components/product/link-card';
import { TransactionSummary } from '@/components/product/transaction-summary';
import { roleLabel } from '@/components/product/wallet-slot';
import { t } from '@/i18n';
import type { SigningState } from './machine.ts';
import type { SigningActions } from './SigningPanel.tsx';
import { earlierSent, linkView, roundProgress } from './view.ts';

type LinkPhaseProps = {
  state: SigningState;
  actions: SigningActions;
  knownRoles: Partial<Record<WalletRole, Address>>;
  /** The page's way to cancel the link (NonceCloseCard), inside the link card. */
  renderLinkCancel?: (() => ReactNode) | undefined;
};

/**
 * The signing panel while the rest of the round signs on another device (phase `link`, DECISIONS.md D109): the link
 * card first (QR code, the link with Copy, the wait and its ways out), then what was signed here, folded (the decision
 * was made on the previous screen with the summary open), and one line on who signed here and who signs there.
 */
export function LinkPhase({ state, actions, knownRoles, renderLinkCancel }: LinkPhaseProps) {
  const link = linkView(state, window.location.origin);
  const tx = state.round?.txs[0];
  const progress = roundProgress(state);
  const earlier = earlierSent(state);
  const steps = state.round?.steps ?? [];
  const here = steps.filter((step) => step.local).map((step) => step.role);
  const there = steps.filter((step) => !step.local).map((step) => step.role);
  const before = tx === undefined ? null : (state.jobs[tx.id]?.before ?? null);
  return (
    <div data-slot="signing-panel" data-phase="link" className="flex flex-col gap-5">
      {progress.total > 1 ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">{t('signing.roundOf', progress)}</p>
          {earlier === 0 ? null : (
            <p className="text-sm text-muted">
              {earlier === 1 ? t('signing.earlierSentOne') : t('signing.earlierSentOther', { count: earlier })}
            </p>
          )}
        </div>
      ) : null}
      {link === null ? null : (
        <LinkCard
          {...link}
          onStopWaiting={() => {
            actions.stopWaiting();
          }}
          onCheckAgain={
            link.watching
              ? undefined
              : () => {
                  actions.resumeLink();
                }
          }
          cancel={renderLinkCancel?.()}
        />
      )}
      {tx === undefined ? null : (
        <Disclosure summary={t('signing.link.otherDevice')} className="text-sm">
          <TransactionSummary
            summary={tx.summary}
            current={before === null ? undefined : { lockup: before.lockup, clock: state.clock ?? undefined }}
            knownRoles={knownRoles}
            headingLevel={3}
            className="mt-2"
          />
        </Disclosure>
      )}
      <p data-slot="link-signers" className="text-sm text-muted">
        {[
          here.length === 0 ? null : t('signing.link.signedHere', { roles: joinRoles(here) }),
          there.length === 0
            ? null
            : there.length === 1
              ? t('signing.link.signsThereOne', { role: roleLabel(there[0] ?? 'second') })
              : t('signing.link.signsThereMany', { roles: joinRoles(there) }),
        ]
          .filter((part) => part !== null)
          .join(' · ')}
      </p>
    </div>
  );
}
