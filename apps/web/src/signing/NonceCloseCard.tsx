import type { Address } from '@solana/kit';
import type { WalletRole } from '@stakeward/core';
import { CircleCheckIcon } from 'lucide-react';
import { useState } from 'react';
import { roleLabel } from '@/components/product/wallet-slot';
import { t } from '@/i18n';
import { useChain } from '@/ports';
import type { SigningTestOptions } from './create.ts';
import { useNonceAccount } from './nonce.ts';
import { NonceStep, type NonceVariant } from './NonceStep.tsx';

type NonceCloseCardProps = {
  /** The key that owns the account; the deposit goes back to it. */
  authority: Address;
  role: WalletRole;
  /** `cancel-link`: the card inside an open link, where closing the account is how the link is cancelled. */
  variant?: NonceVariant | undefined;
  /** The close landed (the engine checked it on the chain). */
  onClosed?: (() => void) | undefined;
  signing?: SigningTestOptions | undefined;
};

/**
 * Close the link-signing account of `authority` and get its deposit back (after signing by link, or to cancel an open
 * link, DECISIONS.md D68). Shown only while the account is there; after a close done here it says the deposit went
 * back. Nothing is shown while it is read, when there is no account, or when it cannot be read: closing is never
 * required.
 */
export function NonceCloseCard({ authority, role, variant = 'close', onClosed, signing }: NonceCloseCardProps) {
  const chain = useChain();
  const [attempt, setAttempt] = useState(0);
  const [closedHere, setClosedHere] = useState(false);
  const nonce = useNonceAccount(chain, authority, attempt);
  if (nonce.status !== 'ready') return null;
  const { address, state } = nonce.value;
  if (state.kind === 'ready') {
    return (
      <NonceStep
        authority={authority}
        nonceAccount={address}
        role={role}
        mode="close"
        variant={variant}
        amount={state.lamports}
        onDone={() => {
          setClosedHere(true);
          setAttempt((value) => value + 1);
          onClosed?.();
        }}
        signing={signing}
      />
    );
  }
  if (state.kind === 'missing' && closedHere) {
    return (
      <p role="status" data-slot="nonce-closed" className="flex items-start gap-2 text-sm">
        <CircleCheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
        <span>{t('nonce.close.done', { role: roleLabel(role) })}</span>
      </p>
    );
  }
  return null;
}
