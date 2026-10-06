import type { Address, Blockhash, ReadonlyUint8Array, Signature } from '@solana/kit';
import type { RawAccount, StakeAccount } from './decode.ts';
import type { ClockView } from './lockup.ts';

/**
 * The two narrow interfaces through which the site sees the outside world (CLAUDE.md section 3). Pure types: the
 * site implements ChainPort with HttpChain over /api/rpc and WalletPort over Wallet Standard; tests use LiteSvmChain
 * and in-memory test wallets. Nothing here is RPC- or wallet-library specific: bytes, addresses and bigints only.
 *
 * Failure mode, unless a method says otherwise: the returned promise rejects with the underlying error unchanged
 * (a kit SolanaError, a fetch TypeError or AbortError, a wallet's own error object). Every such value is something
 * `translateError` (errors.ts) classifies, so callers show `translateError(error)` and never parse messages.
 * Methods never resolve with partial data to hide a failure.
 */

/**
 * The Clock sysvar: what lockup rules need (ClockView) plus the slot it was read at and the unix time of the epoch's
 * first slot (epoch-end estimates measure the epoch's slot time from it, status.ts `slotMsEstimate`).
 */
export type ChainClock = ClockView & { slot: bigint; epochStartTimestamp: bigint };

/** A blockhash lifetime for a new transaction (BlockhashLifetime without its `kind`). */
export type LatestBlockhash = { blockhash: Blockhash; lastValidBlockHeight: bigint };

/** Position in the current epoch (getEpochInfo, commitment confirmed). */
export type EpochInfo = { epoch: bigint; slotIndex: bigint; slotsInEpoch: bigint; blockHeight: bigint };

/** Result of simulating a transaction without signature verification. */
export type SimulationResult =
  | { ok: true; logs: readonly string[]; unitsConsumed: bigint | null }
  | {
      ok: false;
      logs: readonly string[];
      unitsConsumed: bigint | null;
      /** The chain's TransactionError (raw RPC `err` with bigints, or a SolanaError); `translateError` reads both. */
      error: unknown;
    };

/** Where a sent transaction stands; `null` in getSignatureStatuses means the cluster does not know it (yet). */
export type TransactionStatus = {
  slot: bigint;
  confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null;
  /** null when the transaction succeeded; otherwise its TransactionError, readable by `translateError`. */
  error: unknown;
};

export type StakeAccountFilter = { withdrawer: Address } | { custodian: Address };

export interface ChainPort {
  /**
   * Accounts in the order asked, `null` where an account does not exist, all read at one slot.
   * Rejects on transport or RPC failure (no partial result).
   */
  getAccounts(addresses: readonly Address[]): Promise<{ slot: bigint; accounts: readonly (RawAccount | null)[] }>;

  /** The Clock sysvar (cluster time and epoch), not the local clock. */
  getClock(): Promise<ChainClock>;

  /** A blockhash for a new transaction and the last block height at which it is still valid. */
  getLatestBlockhash(): Promise<LatestBlockhash>;

  /** Current block height; while it is not above `lastValidBlockHeight` an unconfirmed transaction may still land. */
  getBlockHeight(): Promise<bigint>;

  /** Current epoch, slot index in it, slots per epoch and block height (one RPC call). */
  getEpochInfo(): Promise<EpochInfo>;

  /** Lamports held by `address`; 0 for an account that does not exist. */
  getBalance(address: Address): Promise<bigint>;

  /** Minimum lamports for an account of `size` bytes (rent, taken from the network: DECISIONS.md D22). */
  getMinimumBalanceForRentExemption(size: number): Promise<bigint>;

  /**
   * Simulates signed or partly signed wire bytes without verifying signatures. A transaction the program rejects
   * resolves with `ok: false` and the error; only transport or RPC failures reject.
   */
  simulate(transaction: ReadonlyUint8Array): Promise<SimulationResult>;

  /**
   * Sends fully signed wire bytes and returns the first signature. Resending the same bytes is safe
   * (CLAUDE.md section 12). Rejects when the transaction was not accepted, e.g. the proxy refused it, preflight
   * failed or the blockhash expired; the rejection is what `translateError` expects.
   */
  send(transaction: ReadonlyUint8Array): Promise<Signature>;

  /** Statuses in the order asked; `null` for a signature the cluster does not know (yet). */
  getSignatureStatuses(signatures: readonly Signature[]): Promise<readonly (TransactionStatus | null)[]>;

  /**
   * Stake accounts whose withdrawer (main key) or lockup custodian (second key) is the given address, decoded,
   * read at `slot`. Accounts that do not decode as stake accounts are left out. Order is not meaningful.
   */
  findStakeAccounts(filter: StakeAccountFilter): Promise<{ slot: bigint; accounts: readonly StakeAccount[] }>;
}

/**
 * Error names a WalletPort uses when the wallet cannot serve a request (thrown as an Error with this `name`).
 * The UI checks `name` first; anything else goes through `translateError` (user rejection is code 4001 or a
 * "rejected/declined/cancelled" message, which it reports as `wallet-rejected`).
 * - WalletAccountUnavailableError: the address is not among the wallet's accounts right now (the user switched
 *   accounts); the UI asks them to switch back and press Continue.
 * - WalletUnsupportedError: the wallet cannot sign legacy Solana transactions for this cluster.
 * - WalletBusyError: another request to this wallet is still open (Phantom allows one approval window).
 * - WalletBatchUnsupportedError: the wallet did not return one signed transaction per transaction asked; sign one at a
 *   time.
 */
export type WalletPortErrorName =
  | 'WalletAccountUnavailableError'
  | 'WalletUnsupportedError'
  | 'WalletBusyError'
  | 'WalletBatchUnsupportedError';

/**
 * Options of a wallet request. `signal`: the caller stops waiting (Stop waiting, leaving the screen). The request then
 * rejects with the signal's reason and no longer holds up the next requests to this wallet (wallet-queue.ts).
 */
export type WalletRequestOptions = { signal?: AbortSignal | undefined };

/**
 * One wallet the user can connect (a Wallet Standard wallet in the browser, a test wallet in tests). The port never
 * reads transaction bytes: the caller runs `checkSigningStep` on everything it returns (verify.ts).
 */
export interface WalletPort {
  /** Stable identity across page loads (Wallet Standard: the wallet name), used to remember slots. */
  readonly id: string;
  readonly name: string;
  /** data: URI image (Wallet Standard icon); shown with <img>, allowed by the CSP's `img-src data:`. */
  readonly icon: string;
  /**
   * Addresses this site may use right now. The same array instance until `onChange` fires, so it can serve as a
   * React external-store snapshot. Empty before `connect()` unless the wallet restores an earlier authorisation.
   */
  readonly accounts: readonly Address[];

  /** Asks the wallet for access (may open its prompt). Resolves with `accounts` after the change; rejects on refusal. */
  connect(options?: WalletRequestOptions): Promise<readonly Address[]>;

  /** Forgets this site's session on the wallet side where supported; never rejects. */
  disconnect(): Promise<void>;

  /**
   * One wallet request for all `transactions`, signed by `address`; resolves with the wallet's returned wire bytes in
   * the same order (a wallet may add a Lighthouse tail, DECISIONS.md D24). Rejects with the wallet's error (user
   * rejection included) or an Error named per WalletPortErrorName. Requests to one wallet are serialised; one whose
   * signal aborted stops holding up the next (createWalletRequestQueue).
   */
  signTransactions(
    address: Address,
    transactions: readonly ReadonlyUint8Array[],
    options?: WalletRequestOptions,
  ): Promise<readonly Uint8Array[]>;

  /** Called when accounts (or anything else the UI shows) change. Returns the unsubscribe function. */
  onChange(listener: () => void): () => void;
}

/** Key roles; the UI calls them Main key, Second key and New wallet (CLAUDE.md section 9, UX rule 4). */
export type WalletRole = 'main' | 'second' | 'new';

/** Which wallet and which of its accounts fills a role. Stored by address: wallet account objects go stale. */
export type WalletSlot = { walletId: string; address: Address };

/** The three slots of the site; `null` when a role is not connected. */
export type WalletSlots = Readonly<Record<WalletRole, WalletSlot | null>>;
