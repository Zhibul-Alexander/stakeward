import { createApiPort } from '@/api/watch';
import { WALLET_CHAIN } from '@/config';
import { HttpChain } from './http-chain.ts';
import { createProtectedAccountMemory } from './protected-accounts.ts';
import type { Ports } from './react.tsx';
import { createSecondKeyMemory, createSlotStore } from './slots.ts';
import { StandardWalletRegistry } from './wallet-registry.ts';

/**
 * The production ports: the worker's RPC proxy, Wallet Standard wallets on the build's cluster, slots in localStorage,
 * the worker's API on this origin.
 */
export function createBrowserPorts(): Ports {
  return {
    chain: new HttpChain(),
    wallets: new StandardWalletRegistry(WALLET_CHAIN),
    slots: createSlotStore(),
    secondKeys: createSecondKeyMemory(),
    protectedAccounts: createProtectedAccountMemory(),
    api: createApiPort(),
  };
}
