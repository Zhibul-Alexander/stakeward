// The site's side of the two ports (CLAUDE.md section 3): HttpChain for ChainPort, Wallet Standard for WalletPort,
// the three key slots, and the React glue. Test doubles (LiteSvmChain, test wallets) live in packages/core/test and
// are never imported from src.
export { createBrowserPorts } from './browser.ts';
export {
  DEFAULT_CONFIRMATION_TIMEOUT_MS,
  DEFAULT_POLL_INTERVAL_MS,
  waitForConfirmation,
  type ConfirmationLifetime,
  type ConfirmationOptions,
  type ConfirmationOutcome,
} from './confirm.ts';
export { HttpChain, type HttpChainOptions } from './http-chain.ts';
export {
  PortsProvider,
  useChain,
  useKnownSecondKeys,
  usePorts,
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
