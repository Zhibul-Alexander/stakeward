import type { ChainPort } from '@stakeward/core';
import { WALLET_CHAIN } from '@/config';
import {
  browserStorage,
  createSlotStore,
  HttpChain,
  StandardWalletRegistry,
  type SlotStore,
  type StorageLike,
  type WalletRegistry,
} from '@/ports';
import { createReportStore, type ReportStore } from './report.ts';

/** Everything the dev page reaches the outside world through; tests pass LiteSvmChain and test wallets. */
export type DevCosignPorts = { chain: ChainPort; wallets: WalletRegistry; slots: SlotStore; reports: ReportStore };

/**
 * The page keeps its own slots (main and second) under a key of its own: a wallet pair set up for the matrix does not
 * become the product's remembered Main key and Second key.
 */
export const DEV_SLOTS_STORAGE_KEY = 'stakeward:dev-cosign:slots:v1';

export function createDevCosignPorts(storage: StorageLike | null = browserStorage()): DevCosignPorts {
  return {
    chain: new HttpChain(),
    wallets: new StandardWalletRegistry(WALLET_CHAIN),
    slots: createSlotStore(storage, DEV_SLOTS_STORAGE_KEY),
    reports: createReportStore(storage),
  };
}
