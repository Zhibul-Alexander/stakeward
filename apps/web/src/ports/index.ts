// The site's side of the two ports (CLAUDE.md section 3): HttpChain for ChainPort, Wallet Standard for WalletPort,
// the three key slots, the worker's API (src/api) and the React glue. Test doubles (LiteSvmChain, test wallets, the
// fake API) live in packages/core/test and apps/web/test and are never imported from src.
export { createBrowserPorts } from './browser.ts';
export {
  DEFAULT_CONFIRMATION_TIMEOUT_MS,
  DEFAULT_POLL_INTERVAL_MS,
  waitForConfirmation,
  waitForConfirmations,
  type ConfirmationEntry,
  type ConfirmationLifetime,
  type ConfirmationOptions,
  type ConfirmationOutcome,
} from './confirm.ts';
export { connectOffering } from './connect-offering.ts';
export { systemDeviceClock, type DeviceClock } from './device-clock.ts';
export { refreshStakeAccounts } from './fresh-accounts.ts';
export { HttpChain, type HttpChainOptions } from './http-chain.ts';
export {
  createProtectedAccountMemory,
  MAX_REMEMBERED_PROTECTED_ACCOUNTS,
  PROTECTED_ACCOUNTS_STORAGE_KEY,
  type ProtectedAccountMemory,
} from './protected-accounts.ts';
export {
  PortsProvider,
  useApi,
  useChain,
  useDeviceClock,
  useKnownSecondKeys,
  usePorts,
  useProtectedAccounts,
  useSlot,
  useWallets,
  useWalletSlots,
  type Ports,
} from './react.tsx';
export {
  browserStorage,
  createSecondKeyMemory,
  createSlotStore,
  knownSecondKeys,
  resolveSlot,
  WALLET_ROLES,
  type AssignResult,
  type ResolvedSlot,
  type SecondKeyMemory,
  type SlotStore,
  type StorageLike,
} from './slots.ts';
export { MAX_RETRIES, REQUEST_TIMEOUT_MS } from './transport.ts';
export { StandardWalletRegistry, StaticWalletRegistry, type WalletRegistry } from './wallet-registry.ts';
export { isSupportedWallet, StandardWalletPort } from './wallet-standard.ts';
