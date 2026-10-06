import type { Address } from '@solana/kit';
import type { WalletRole } from '@stakeward/core';
import { TriangleAlertIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ErrorState } from '@/components/product/error-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { useChain } from '@/ports';
import type { SigningTestOptions } from './create.ts';
import { useNonceAccount } from './nonce.ts';
import { NonceStep } from './NonceStep.tsx';

type NonceGateProps = {
  /** The fee payer of the linked transactions: it owns the account (never a key that may be stolen). */
  authority: Address;
  role: WalletRole;
  /** What to do instead when the account's address is taken (e.g. sign in this browser). */
  blockedHint: string;
  /** `rescue`: the setup texts of a rescue, which always uses the account (NonceStep); signing by link otherwise. */
  variant?: 'rescue' | undefined;
  /** What needs the account, once it is ready (the signing session on that nonce). */
  children: (nonceAccount: Address) => ReactNode;
  /** The page's way out while the account is not ready (e.g. Back), shown below the gate; never next to `children`. */
  actions?: ReactNode;
  signing?: SigningTestOptions | undefined;
};

/**
 * Signing by link needs the fee payer's link-signing account (a durable nonce, CLAUDE.md section 6): read it, offer to
 * set it up when it is missing (NonceStep, the fee payer signs alone), then render `children` with its address. Every
 * wait is explained and an error has Try again (UX rules 7 and 8). An address taken by another account cannot be
 * used: the gate says so with the page's way around it.
 */
export function NonceGate({ authority, role, blockedHint, variant, children, actions, signing }: NonceGateProps) {
  const chain = useChain();
  const [attempt, setAttempt] = useState(0);
  const nonce = useNonceAccount(chain, authority, attempt);
  const again = () => {
    setAttempt((value) => value + 1);
  };
  if (nonce.status === 'ready' && nonce.value.state.kind === 'ready') return children(nonce.value.address);
  const gate = (
    <GateState
      nonce={nonce}
      authority={authority}
      role={role}
      blockedHint={blockedHint}
      variant={variant}
      again={again}
      signing={signing}
    />
  );
  if (actions === undefined) return gate;
  return (
    <div className="flex flex-col gap-4">
      {gate}
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}

type GateStateProps = Omit<NonceGateProps, 'children' | 'actions'> & {
  nonce: ReturnType<typeof useNonceAccount>;
  again: () => void;
};

/** The gate while the account is not ready to use: reading it, a read error, setting it up, or its address taken. */
function GateState({ nonce, authority, role, blockedHint, variant, again, signing }: GateStateProps) {
  switch (nonce.status) {
    case 'idle':
    case 'loading':
      return (
        <p role="status" data-slot="nonce-gate" className="flex items-center gap-3 text-sm">
          <Spinner className="size-5 shrink-0 text-muted" />
          <span>{t('nonce.loading')}</span>
        </p>
      );
    case 'error':
      return <ErrorState title={t('nonce.loadError')} message={errorMessage(nonce.error)} detail={nonce.error.detail} onRetry={again} />;
    case 'ready': {
      const { address, state, deposit } = nonce.value;
      switch (state.kind) {
        case 'ready':
          // NonceGate renders its children before it gets here.
          return null;
        case 'missing':
          return (
            <NonceStep
              authority={authority}
              nonceAccount={address}
              role={role}
              mode="setup"
              variant={variant === 'rescue' ? 'rescue' : 'close'}
              amount={deposit}
              onDone={again}
              signing={signing}
            />
          );
        case 'unusable':
          return <NonceBlocked hint={blockedHint} />;
      }
    }
  }
}

/** The account's address is taken by an account Stakeward cannot use: what that means and the page's way around it. */
export function NonceBlocked({ hint }: { hint: string }) {
  return (
    <Alert tone="warning" data-slot="nonce-blocked">
      <TriangleAlertIcon aria-hidden="true" />
      <AlertDescription className="flex flex-col gap-2 text-foreground">
        <p>{t('nonce.blocked')}</p>
        <p className="font-medium">{hint}</p>
      </AlertDescription>
    </Alert>
  );
}
