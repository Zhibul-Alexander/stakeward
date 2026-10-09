import type { Address } from '@solana/kit';
import type { WalletRole } from '@stakeward/core';
import { CircleAlertIcon, CircleCheckIcon, LoaderCircleIcon, RotateCcwIcon } from 'lucide-react';
import { useState } from 'react';
import { roleLabel } from '@/components/product/wallet-slot';
import { Button } from '@/components/ui/button';
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
 * back. After signing by link nothing is shown while it is read, when there is no account, or when it cannot be read:
 * closing is never required there. Inside an open link (`cancel-link`) the user asked to cancel, so every state says
 * what it is (UX rule 7): reading, could not read (with Try again), or already closed.
 */
export function NonceCloseCard({ authority, role, variant = 'close', onClosed, signing }: NonceCloseCardProps) {
  const chain = useChain();
  const [attempt, setAttempt] = useState(0);
  const [closedHere, setClosedHere] = useState(false);
  const nonce = useNonceAccount(chain, authority, attempt);
  const cancelLink = variant === 'cancel-link';
  if (nonce.status === 'idle' || nonce.status === 'loading') {
    if (!cancelLink) return null;
    return (
      <p role="status" data-slot="nonce-loading" className="flex items-center gap-2 text-sm text-muted">
        <LoaderCircleIcon aria-hidden="true" className="size-4 shrink-0 animate-spin" />
        {t('nonce.loading')}
      </p>
    );
  }
  if (nonce.status === 'error') {
    if (!cancelLink) return null;
    return (
      <div data-slot="nonce-load-error" className="flex flex-col items-start gap-2">
        <p role="status" className="flex items-start gap-2 text-sm font-medium">
          <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
          {t('nonce.loadError')}
        </p>
        <Button
          variant="outline"
          onClick={() => {
            setAttempt((value) => value + 1);
          }}
        >
          <RotateCcwIcon aria-hidden="true" />
          {t('common.tryAgain')}
        </Button>
      </div>
    );
  }
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
  // No account to close (closed elsewhere, or its address holds something else): a link on it can no longer land.
  if (cancelLink) {
    return (
      <p role="status" data-slot="nonce-gone" className="text-sm">
        {t('nonce.cancelGone')}
      </p>
    );
  }
  return null;
}
