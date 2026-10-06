import type { Address } from '@solana/kit';
import type { ChainPort, WalletPort, WalletRole, WalletSlots } from '@stakeward/core';
import { createContext, use, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { ApiPort } from '@/api/watch';
import { systemDeviceClock, type DeviceClock } from './device-clock.ts';
import type { ProtectedAccountMemory } from './protected-accounts.ts';
import { knownSecondKeys, resolveSlot, type ResolvedSlot, type SecondKeyMemory, type SlotStore } from './slots.ts';
import type { WalletRegistry } from './wallet-registry.ts';

/**
 * Everything the screens use to reach the outside world. Production: createBrowserPorts() (HttpChain, Wallet Standard
 * wallets, localStorage-backed slots, the worker's API). Tests: LiteSvmChain and test wallets in a StaticWalletRegistry,
 * and a fake API.
 */
export type Ports = {
  chain: ChainPort;
  wallets: WalletRegistry;
  slots: SlotStore;
  secondKeys: SecondKeyMemory;
  /** Stake accounts seen protected on this device (F6 banner). */
  protectedAccounts: ProtectedAccountMemory;
  /** The worker's own endpoints beyond the RPC proxy (POST /api/watch). */
  api: ApiPort;
  /**
   * This device's clock. The cluster clock reaches the site through the worker, so protect and extend check it against
   * this one before they compute a lock end (SECURITY-CHECK П12). Default: the system clock (useDeviceClock); tests
   * on a LiteSVM chain, whose clock is set, pass one that follows it.
   */
  deviceClock?: DeviceClock | undefined;
};

const PortsContext = createContext<Ports | null>(null);

export function PortsProvider({ ports, children }: { ports: Ports; children: ReactNode }) {
  return <PortsContext value={ports}>{children}</PortsContext>;
}

export function usePorts(): Ports {
  const ports = use(PortsContext);
  if (ports === null) throw new Error('usePorts() outside <PortsProvider>');
  return ports;
}

export function useChain(): ChainPort {
  return usePorts().chain;
}

export function useApi(): ApiPort {
  return usePorts().api;
}

/** This device's clock (Ports `deviceClock`, else the system clock). */
export function useDeviceClock(): DeviceClock {
  return usePorts().deviceClock ?? systemDeviceClock;
}

/** Wallets the user can connect; re-renders when the list or a wallet's accounts change. */
export function useWallets(): readonly WalletPort[] {
  const { wallets } = usePorts();
  return useSyncExternalStore(wallets.subscribe, wallets.getSnapshot);
}

export function useWalletSlots(): WalletSlots {
  const { slots } = usePorts();
  return useSyncExternalStore(slots.subscribe, slots.getSnapshot);
}

/** One slot with its wallet and whether that wallet can sign for it now; null when the role is empty. */
export function useSlot(role: WalletRole): ResolvedSlot | null {
  const slots = useWalletSlots();
  const wallets = useWallets();
  const slot = slots[role];
  return useMemo(() => resolveSlot(slot, wallets), [slot, wallets]);
}

/** The viewer's known second keys for scannerStatus (DECISIONS.md D14). */
export function useKnownSecondKeys(): readonly Address[] {
  const { secondKeys } = usePorts();
  const slots = useWalletSlots();
  const wallets = useWallets();
  const remembered = useSyncExternalStore(secondKeys.subscribe, secondKeys.getSnapshot);
  return useMemo(() => knownSecondKeys(slots, wallets, remembered), [slots, wallets, remembered]);
}

/** Stake accounts remembered on this device as protected (F6). */
export function useProtectedAccounts(): readonly Address[] {
  const { protectedAccounts } = usePorts();
  return useSyncExternalStore(protectedAccounts.subscribe, protectedAccounts.getSnapshot);
}
