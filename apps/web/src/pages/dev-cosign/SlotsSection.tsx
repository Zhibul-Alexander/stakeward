import type { Address } from '@solana/kit';
import { translateError, type WalletPort, type WalletRole } from '@stakeward/core';
import { InfoIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { WalletSlot } from '@/components/product/wallet-slot';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { connectOffering, type ResolvedSlot, type SlotStore } from '@/ports';

export type DevRole = Extract<WalletRole, 'main' | 'second'>;

/** A slot whose wallet is installed here (an assigned slot whose wallet is gone shows as empty). */
export type DevSlot = ResolvedSlot & { wallet: WalletPort };

type SlotsSectionProps = {
  wallets: readonly WalletPort[];
  slots: SlotStore;
  main: DevSlot | null;
  second: DevSlot | null;
};

/** Step 1: the two wallets. Different wallets, or two accounts of one wallet (CLAUDE.md section 6). */
export function SlotsSection({ wallets, slots, main, second }: SlotsSectionProps) {
  const sameWallet = main !== null && second !== null && main.wallet === second.wallet;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SlotCard role="main" wallets={wallets} slots={slots} slot={main} other={second} />
        <SlotCard role="second" wallets={wallets} slots={slots} slot={second} other={main} />
      </div>
      {sameWallet ? (
        <Alert tone="info" role="note">
          <InfoIcon aria-hidden="true" />
          <AlertDescription className="text-foreground">{t('devCosign.slots.sameWallet', { wallet: main.wallet.name })}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

type Ui =
  | { kind: 'idle' }
  | { kind: 'connecting'; wallet: WalletPort }
  | { kind: 'error'; wallet: WalletPort; message: string; detail: string }
  | { kind: 'wrong-account'; wallet: WalletPort; address: Address; conflictRole: WalletRole | undefined };

function SlotCard({
  role,
  wallets,
  slots,
  slot,
  other,
}: {
  role: DevRole;
  wallets: readonly WalletPort[];
  slots: SlotStore;
  slot: DevSlot | null;
  other: DevSlot | null;
}) {
  const [ui, setUi] = useState<Ui>({ kind: 'idle' });
  const token = useRef(0);
  // The connect in flight; Cancel aborts it so the wallet's queue lets the next request through.
  const pending = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      pending.current?.abort();
    },
    [],
  );
  const otherRole: DevRole = role === 'main' ? 'second' : 'main';

  /** Fills the slot with the first offered account that is not the other role's; otherwise asks to switch. */
  function place(wallet: WalletPort, accounts: readonly Address[]) {
    const candidate = accounts.find((address) => address !== other?.slot.address);
    if (candidate === undefined) {
      const shown = accounts[0];
      if (shown === undefined) {
        setUi({ kind: 'error', wallet, message: t('devCosign.slots.noAccount', { wallet: wallet.name }), detail: '' });
      } else {
        setUi({ kind: 'wrong-account', wallet, address: shown, conflictRole: otherRole });
      }
      return;
    }
    const assigned = slots.assign(role, { walletId: wallet.id, address: candidate });
    if (assigned.ok) setUi({ kind: 'idle' });
    else setUi({ kind: 'wrong-account', wallet, address: candidate, conflictRole: assigned.role });
  }

  async function connect(wallet: WalletPort, forcePrompt = true) {
    token.current += 1;
    const mine = token.current;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setUi({ kind: 'connecting', wallet });
    try {
      const fits = (accounts: readonly Address[]) => accounts.some((address) => address !== other?.slot.address);
      // Connecting is always the user's own click; an already offered account needs no new prompt on Continue. A
      // wallet that keeps offering only the other role's account is reconnected once (Phantom, D109).
      const accounts =
        forcePrompt || !fits(wallet.accounts)
          ? await connectOffering(wallet, fits, { signal: controller.signal })
          : wallet.accounts;
      if (mine !== token.current) return;
      place(wallet, accounts);
    } catch (error) {
      if (mine !== token.current) return;
      const friendly = translateError(error);
      setUi({ kind: 'error', wallet, message: errorMessage(friendly), detail: friendly.detail });
    }
  }

  function disconnect(wallet: WalletPort) {
    slots.clear(role);
    setUi({ kind: 'idle' });
    // The other role may sit in the same wallet: only let go of a wallet nothing else uses.
    if (other?.wallet !== wallet) void wallet.disconnect();
  }

  const description = t(`devCosign.slots.${role}Description`);
  switch (ui.kind) {
    case 'connecting':
      return (
        <WalletSlot
          role={role}
          description={description}
          status="connecting"
          wallet={ui.wallet}
          onCancel={() => {
            token.current += 1;
            pending.current?.abort();
            setUi({ kind: 'idle' });
          }}
        />
      );
    case 'error':
      return (
        <WalletSlot
          role={role}
          description={description}
          status="error"
          wallet={ui.wallet}
          message={ui.message}
          detail={ui.detail === '' ? undefined : ui.detail}
          onRetry={() => void connect(ui.wallet)}
          onCancel={() => {
            setUi({ kind: 'idle' });
          }}
        />
      );
    case 'wrong-account':
      return (
        <WalletSlot
          role={role}
          description={description}
          status="wrong-account"
          wallet={ui.wallet}
          address={ui.address}
          conflictRole={ui.conflictRole}
          onContinue={() => void connect(ui.wallet, false)}
          onDisconnect={() => {
            setUi({ kind: 'idle' });
          }}
        />
      );
    case 'idle':
      break;
  }
  if (slot !== null) {
    return (
      <div className="flex flex-col gap-2">
        <WalletSlot
          role={role}
          description={description}
          status="connected"
          wallet={slot.wallet}
          address={slot.slot.address}
          onDisconnect={() => {
            disconnect(slot.wallet);
          }}
        />
        {slot.ready ? null : (
          <p className="text-sm text-muted">{t('devCosign.slots.notOfferedNow', { wallet: slot.wallet.name, role: t(`common.roles.${role}`) })}</p>
        )}
      </div>
    );
  }
  return (
    <WalletSlot
      role={role}
      description={description}
      status="empty"
      wallets={wallets}
      onConnect={(walletId) => {
        const wallet = wallets.find((candidate) => candidate.id === walletId);
        if (wallet !== undefined) void connect(wallet);
      }}
    />
  );
}
