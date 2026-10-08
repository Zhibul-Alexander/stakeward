import type { Address } from '@solana/kit';
import { translateError, type WalletPort, type WalletRole } from '@stakeward/core';
import { useEffect, useRef, useState } from 'react';
import { WalletSlot, type WalletOption } from '@/components/product/wallet-slot';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { connectOffering, usePorts, useSlot, useWallets, WALLET_ROLES } from '@/ports';

/** What the slot is doing on top of the stored slot: a connect in progress, its failure, or an account conflict. */
type Pending =
  | { kind: 'idle' }
  | { kind: 'connecting'; walletId: string }
  | { kind: 'error'; walletId: string; message: string; detail: string }
  | {
      kind: 'conflict';
      walletId: string;
      address: Address;
      conflictRole: WalletRole | undefined;
      /** The account this step needs, which the wallet did not offer. */
      expected?: Address | undefined;
    };

type KeySlotProps = {
  role: WalletRole;
  /**
   * The main key on screen. A view by address has no Main key slot, but its address is still the Main key: another
   * slot never takes it (one address, one role; the second key differs from the main key, F1).
   */
  mainKey?: Address | undefined;
  description?: string | undefined;
  /**
   * The exact account this slot must hold (a signing step names its signer). Only that account fills the slot; a wallet
   * that offers another one is asked to switch to it, and a slot that holds another one says so and offers only
   * Disconnect (replacing a key is Disconnect, then Connect: DECISIONS.md D35).
   */
  expected?: Address | undefined;
  /** Called with the address once it fills the slot. */
  onConnected?: ((address: Address) => void) | undefined;
  className?: string | undefined;
};

function option(wallet: WalletPort): WalletOption {
  return { id: wallet.id, name: wallet.name, icon: wallet.icon };
}

/**
 * Connects a wallet account to one key slot (CLAUDE.md section 6) and shows it with WalletSlot. Connecting is never
 * silent: it starts from the user's click. An account that already fills another role is refused with "switch to
 * your other account in the wallet, then press Continue"; Continue reads the wallet's accounts again. A wallet that
 * keeps offering an account this slot cannot take is disconnected and asked once more (connectOffering, D109):
 * Phantom stays on the account the site connected first until then.
 */
export function KeySlot({ role, mainKey, description, expected, onConnected, className }: KeySlotProps) {
  const { slots } = usePorts();
  const wallets = useWallets();
  const resolved = useSlot(role);
  const [pending, setPending] = useState<Pending>({ kind: 'idle' });
  // Bumped by every connect and cancel, so the answer of an abandoned connect is ignored.
  const request = useRef(0);
  // The wallet request in flight. Cancel (and leaving the page) aborts it, so the wallet's queue lets the next request
  // through even when the wallet never answers this one (core createWalletRequestQueue).
  const inFlight = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      inFlight.current?.abort();
    },
    [],
  );

  function nextRequest(): { id: number; signal: AbortSignal } {
    request.current += 1;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    return { id: request.current, signal: controller.signal };
  }

  const walletById = (walletId: string) => wallets.find((wallet) => wallet.id === walletId) ?? null;

  /** The role that already holds `address`, other than this one (the main key on screen counts). */
  function roleOf(address: Address): WalletRole | undefined {
    const current = slots.getSnapshot();
    return role !== 'main' && address === mainKey
      ? 'main'
      : WALLET_ROLES.find((other) => other !== role && current[other]?.address === address);
  }

  /** Whether the wallet offers an account this slot may take: the expected one, or one no other role holds. */
  function fits(accounts: readonly Address[]): boolean {
    if (expected !== undefined) return accounts.includes(expected);
    // The account this slot let go with Disconnect does not fit: the wallet often stays on it (Phantom, D109), so a
    // Connect asks the wallet again rather than taking it straight back.
    const released = slots.released(role);
    return accounts.some((address) => address !== released && roleOf(address) === undefined);
  }

  function take(wallet: WalletPort, accounts: readonly Address[]) {
    const first = accounts[0];
    if (first === undefined) {
      setPending({ kind: 'error', walletId: wallet.id, message: t('app.connect.noAccount'), detail: '' });
      return;
    }
    // With an expected account only that one may fill the slot; otherwise the first account no other role holds.
    if (expected !== undefined && !accounts.includes(expected)) {
      setPending({ kind: 'conflict', walletId: wallet.id, address: first, conflictRole: undefined, expected });
      return;
    }
    // Prefer an account other than the one this slot just released; it is taken back only when it is all there is.
    const released = slots.released(role);
    const free =
      expected ??
      accounts.find((address) => address !== released && roleOf(address) === undefined) ??
      accounts.find((address) => roleOf(address) === undefined);
    if (free === undefined || roleOf(free) !== undefined) {
      const shown = free ?? first;
      setPending({ kind: 'conflict', walletId: wallet.id, address: shown, conflictRole: roleOf(shown) });
      return;
    }
    const assigned = slots.assign(role, { walletId: wallet.id, address: free });
    if (!assigned.ok) {
      setPending({ kind: 'conflict', walletId: wallet.id, address: free, conflictRole: assigned.role });
      return;
    }
    setPending({ kind: 'idle' });
    onConnected?.(free);
  }

  async function connect(walletId: string) {
    const wallet = walletById(walletId);
    if (wallet === null) return;
    const { id, signal } = nextRequest();
    setPending({ kind: 'connecting', walletId });
    try {
      const accounts = await connectOffering(wallet, fits, { signal });
      if (request.current === id) take(wallet, accounts);
    } catch (error) {
      if (request.current !== id) return;
      const friendly = translateError(error);
      setPending({ kind: 'error', walletId, message: errorMessage(friendly), detail: friendly.detail });
    }
  }

  function cancel() {
    request.current += 1;
    inFlight.current?.abort();
    setPending({ kind: 'idle' });
  }

  /** After the user switched accounts in the wallet: use what it offers now, or ask it again when nothing fits. */
  function continueWith(wallet: WalletPort) {
    if (fits(wallet.accounts)) take(wallet, wallet.accounts);
    else void connect(wallet.id);
  }

  /**
   * Continue on a filled slot whose wallet offers other accounts now: only look again for the slot's own account. It
   * never puts another account in the slot (that would change the key behind the user's back); replacing the key is
   * Disconnect, then Connect. A wallet that does not offer the slot's account is asked again (reconnected once if it
   * still offers another one, D109); what it answers only refreshes its accounts, which re-resolves the slot.
   */
  async function recheck(wallet: WalletPort, address: Address) {
    if (wallet.accounts.includes(address)) return;
    const { id, signal } = nextRequest();
    setPending({ kind: 'connecting', walletId: wallet.id });
    try {
      await connectOffering(wallet, (offered) => offered.includes(address), { signal });
      if (request.current === id) setPending({ kind: 'idle' });
    } catch (error) {
      if (request.current !== id) return;
      const friendly = translateError(error);
      setPending({ kind: 'error', walletId: wallet.id, message: errorMessage(friendly), detail: friendly.detail });
    }
  }

  const common = { role, description, className };
  const pendingWallet = pending.kind === 'idle' ? null : walletById(pending.walletId);
  if (pending.kind !== 'idle' && pendingWallet !== null) {
    const wallet = option(pendingWallet);
    switch (pending.kind) {
      case 'connecting':
        return <WalletSlot {...common} status="connecting" wallet={wallet} onCancel={cancel} />;
      case 'error':
        return (
          <WalletSlot
            {...common}
            status="error"
            wallet={wallet}
            message={pending.message}
            detail={pending.detail === '' ? undefined : pending.detail}
            onRetry={() => void connect(pending.walletId)}
            onCancel={cancel}
          />
        );
      case 'conflict':
        return (
          <WalletSlot
            {...common}
            status="wrong-account"
            wallet={wallet}
            address={pending.address}
            conflictRole={pending.conflictRole}
            expected={pending.expected}
            onContinue={() => {
              continueWith(pendingWallet);
            }}
            onDisconnect={cancel}
          />
        );
    }
  }

  if (resolved !== null && resolved.wallet !== null) {
    const { wallet, slot } = resolved;
    // The slot holds another key than this step needs: say which one it needs. Only Disconnect: Continue must never
    // swap the key in a filled slot.
    if (expected !== undefined && slot.address !== expected) {
      return (
        <WalletSlot
          {...common}
          status="wrong-account"
          wallet={option(wallet)}
          address={slot.address}
          expected={expected}
          onDisconnect={() => {
            slots.clear(role);
          }}
        />
      );
    }
    if (resolved.ready) {
      return (
        <WalletSlot
          {...common}
          status="connected"
          wallet={option(wallet)}
          address={slot.address}
          onDisconnect={() => {
            slots.clear(role);
          }}
        />
      );
    }
    // The wallet offers other accounts right now: the user switched away from this one.
    if (wallet.accounts.length > 0) {
      return (
        <WalletSlot
          {...common}
          status="wrong-account"
          wallet={option(wallet)}
          address={slot.address}
          onContinue={() => {
            void recheck(wallet, slot.address);
          }}
          onDisconnect={() => {
            slots.clear(role);
          }}
        />
      );
    }
  }

  return <WalletSlot {...common} status="empty" wallets={wallets.map(option)} onConnect={(walletId) => void connect(walletId)} />;
}
