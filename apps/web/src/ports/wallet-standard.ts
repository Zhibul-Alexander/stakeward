import { isAddress, type Address, type ReadonlyUint8Array } from '@solana/kit';
import {
  SolanaSignTransaction,
  type SolanaSignTransactionFeature,
  type SolanaSignTransactionOutput,
} from '@solana/wallet-standard-features';
import {
  createWalletRequestQueue,
  translateError,
  type WalletPort,
  type WalletPortErrorName,
  type WalletRequestOptions,
  type WalletRequestQueue,
} from '@stakeward/core';
import type { IdentifierString, Wallet, WalletAccount } from '@wallet-standard/base';
import {
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  type StandardConnectFeature,
  type StandardDisconnectFeature,
  type StandardEventsFeature,
} from '@wallet-standard/features';

/**
 * WalletPort over a Wallet Standard wallet (CLAUDE.md sections 3 and 6; wallet-rpc reference, section 2).
 *
 * - Signing is ONE variadic `solana:signTransaction` call for all transactions, with the wallet account object looked
 *   up by address right before the call: wallets compare the object by identity, and it goes stale when the user
 *   switches accounts. The port stores addresses only.
 * - Requests to one wallet (connect and sign) are serialised: Phantom fails a second open approval window (-32002).
 *   A request whose signal aborts (Stop waiting) stops holding up the next ones (core createWalletRequestQueue).
 * - A user rejection (code 4001 or "rejected/declined/cancelled", as translateError reads it) is rethrown as an Error
 *   with code 4001 and the wallet's error as `cause`; -32002 becomes WalletBusyError. Other errors pass unchanged.
 * - An answer with another number of signed transactions than asked is WalletBatchUnsupportedError: sign one at a time.
 * - Never signMessage, never signAndSendTransaction (section 2 rule 2, section 6): the site sends every transaction.
 */

type SignFeature = SolanaSignTransactionFeature[typeof SolanaSignTransaction];
type ConnectFeature = StandardConnectFeature[typeof StandardConnect];
type DisconnectFeature = StandardDisconnectFeature[typeof StandardDisconnect];
type EventsFeature = StandardEventsFeature[typeof StandardEvents];

/** A wallet the site can use on `chain`: it connects, signs legacy transactions and claims the chain. */
export function isSupportedWallet(wallet: Wallet, chain: IdentifierString): boolean {
  return connectFeature(wallet) !== null && signFeature(wallet) !== null && wallet.chains.includes(chain);
}

/** Calls to one wallet, in order (keyed by the Wallet object, shared by every port over it). */
const queues = new WeakMap<Wallet, WalletRequestQueue>();

function serialised<T>(wallet: Wallet, task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  let queue = queues.get(wallet);
  if (queue === undefined) {
    queue = createWalletRequestQueue();
    queues.set(wallet, queue);
  }
  return queue(task, signal);
}

export class StandardWalletPort implements WalletPort {
  readonly wallet: Wallet;
  readonly chain: IdentifierString;
  readonly id: string;
  readonly name: string;
  readonly icon: string;

  private snapshot: readonly Address[] = [];
  /** Accounts a connect() returned while `wallet.accounts` was still empty; cleared by the next change event. */
  private connected: readonly WalletAccount[] = [];
  private readonly listeners = new Set<() => void>();
  private stopEvents: (() => void) | null = null;

  constructor(wallet: Wallet, chain: IdentifierString) {
    this.wallet = wallet;
    this.chain = chain;
    this.id = wallet.name;
    this.name = wallet.name;
    this.icon = wallet.icon;
  }

  /** Addresses that can sign here now; the same array until they change. */
  get accounts(): readonly Address[] {
    const next = eligibleAddresses(this.liveAccounts());
    if (next.length !== this.snapshot.length || next.some((address, i) => address !== this.snapshot[i])) {
      this.snapshot = next;
    }
    return this.snapshot;
  }

  connect(options: WalletRequestOptions = {}): Promise<readonly Address[]> {
    return serialised(this.wallet, async () => {
      const feature = connectFeature(this.wallet);
      if (feature === null) throw walletError('WalletUnsupportedError', `${this.name} cannot connect`);
      let output;
      try {
        // Not silent: connecting is always the user's own action.
        output = await feature.connect();
      } catch (error) {
        throw mapWalletError(error, this.name);
      }
      this.connected = this.wallet.accounts.length === 0 ? output.accounts : [];
      this.notify();
      return this.accounts;
    }, options.signal);
  }

  async disconnect(): Promise<void> {
    const feature = disconnectFeature(this.wallet);
    try {
      if (feature !== null) await serialised(this.wallet, () => feature.disconnect());
    } catch {
      // Disconnecting is a courtesy to the wallet; the site forgets the slot either way.
    }
    this.connected = [];
    this.notify();
  }

  signTransactions(
    address: Address,
    transactions: readonly ReadonlyUint8Array[],
    options: WalletRequestOptions = {},
  ): Promise<readonly Uint8Array[]> {
    if (transactions.length === 0) return Promise.resolve([]);
    return serialised(this.wallet, async () => {
      const feature = signFeature(this.wallet);
      if (feature === null) {
        throw walletError('WalletUnsupportedError', `${this.name} cannot sign legacy transactions`);
      }
      // The live account object, looked up now: an object kept from earlier may be stale.
      const account = this.liveAccounts().find((candidate) => candidate.address === address);
      if (account === undefined) {
        throw walletError('WalletAccountUnavailableError', `${this.name} does not offer ${address} right now`);
      }
      if (!account.features.includes(SolanaSignTransaction)) {
        throw walletError('WalletUnsupportedError', `${this.name} cannot sign transactions with ${address}`);
      }
      let outputs: readonly SolanaSignTransactionOutput[];
      try {
        outputs = await feature.signTransaction(
          // Copies: a wallet must not see (or mutate) our buffers.
          ...transactions.map((transaction) => ({ account, chain: this.chain, transaction: Uint8Array.from(transaction) })),
        );
      } catch (error) {
        throw mapWalletError(error, this.name);
      }
      const answer: unknown = outputs;
      if (!Array.isArray(answer)) throw new Error(`${this.name} returned no list of signed transactions`);
      if (answer.length !== transactions.length) {
        // Seen as a wallet that cannot sign several transactions in one approval: the site offers one at a time.
        throw walletError(
          'WalletBatchUnsupportedError',
          `${this.name} did not return one signed transaction for each of the ${String(transactions.length)} sent`,
        );
      }
      return outputs.map((output, index) => {
        const signed: unknown = (output as Partial<SolanaSignTransactionOutput> | undefined)?.signedTransaction;
        if (!isBytes(signed)) throw new Error(`${this.name} returned no bytes for transaction ${String(index + 1)}`);
        return Uint8Array.from(signed);
      });
    }, options.signal);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    if (this.stopEvents === null) {
      const events = eventsFeature(this.wallet);
      this.stopEvents =
        events?.on('change', (properties) => {
          if (properties.accounts !== undefined) this.connected = [];
          this.notify();
        }) ?? (() => undefined);
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.stopEvents !== null) {
        this.stopEvents();
        this.stopEvents = null;
      }
    };
  }

  private liveAccounts(): readonly WalletAccount[] {
    return this.wallet.accounts.length > 0 ? this.wallet.accounts : this.connected;
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/** A Uint8Array (or Buffer), also one made in another realm (an extension's frame). */
function isBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array || Object.prototype.toString.call(value) === '[object Uint8Array]';
}

function eligibleAddresses(accounts: readonly WalletAccount[]): readonly Address[] {
  const out: Address[] = [];
  for (const account of accounts) {
    const { address } = account;
    if (!account.features.includes(SolanaSignTransaction) || !isAddress(address) || out.includes(address)) continue;
    out.push(address);
  }
  return out;
}

// Wallet features are `unknown` by type and may be getters returning fresh objects: read them at each use.

function connectFeature(wallet: Wallet): ConnectFeature | null {
  const feature = wallet.features[StandardConnect] as Partial<ConnectFeature> | undefined;
  return typeof feature?.connect === 'function' ? (feature as ConnectFeature) : null;
}

function disconnectFeature(wallet: Wallet): DisconnectFeature | null {
  const feature = wallet.features[StandardDisconnect] as Partial<DisconnectFeature> | undefined;
  return typeof feature?.disconnect === 'function' ? (feature as DisconnectFeature) : null;
}

function eventsFeature(wallet: Wallet): EventsFeature | null {
  const feature = wallet.features[StandardEvents] as Partial<EventsFeature> | undefined;
  return typeof feature?.on === 'function' ? (feature as EventsFeature) : null;
}

/** solana:signTransaction that accepts legacy messages (core builds only those, DECISIONS.md D17). */
function signFeature(wallet: Wallet): SignFeature | null {
  const feature = wallet.features[SolanaSignTransaction] as Partial<SignFeature> | undefined;
  if (typeof feature?.signTransaction !== 'function') return null;
  const versions: unknown = feature.supportedTransactionVersions;
  return Array.isArray(versions) && versions.includes('legacy') ? (feature as SignFeature) : null;
}

function walletError(name: WalletPortErrorName, message: string, cause?: unknown): Error {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.name = name;
  return error;
}

/** Phantom: "Only one approve window can be open at a time" (another tab or site holds the wallet). */
const WALLET_BUSY_CODE = -32002;

function mapWalletError(error: unknown, walletName: string): unknown {
  if (translateError(error).code === 'wallet-rejected') {
    return Object.assign(new Error(`${walletName}: the request was declined`, { cause: error }), {
      name: 'WalletRejectedError',
      code: 4001,
    });
  }
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (code === WALLET_BUSY_CODE) return walletError('WalletBusyError', `${walletName} is busy with another request`, error);
  return error;
}
