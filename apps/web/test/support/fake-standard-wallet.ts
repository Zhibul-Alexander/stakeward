// Test-only fake of a browser wallet speaking Wallet Standard, for unit tests of the adapter in jsdom. It behaves
// like the wallets we know (wallet-rpc reference, section 1.8): live account objects compared by identity, one approval
// window at a time (Phantom -32002), user rejection 4001, change events, features read from a getter.
// Never imported from src; marked so no build can carry it.
import {
  getAddressEncoder,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  type Address,
  type KeyPairSigner,
} from '@solana/kit';
import type {
  SolanaSignTransactionInput,
  SolanaSignTransactionOutput,
  SolanaTransactionVersion,
} from '@solana/wallet-standard-features';
import { getWallets } from '@wallet-standard/app';
import type { IdentifierString, Wallet, WalletAccount } from '@wallet-standard/base';
import type { StandardEventsChangeProperties, StandardEventsListeners } from '@wallet-standard/features';

export const FAKE_STANDARD_WALLET_MARKER = 'stakeward-test-only:fake-standard-wallet';

const ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiLz4=';

export type FakeWalletOptions = {
  name: string;
  signers: readonly KeyPairSigner[];
  chains?: readonly IdentifierString[];
  /** Like Phantom: only the active account is shared. Default false: every account is shared. */
  oneAccountAtATime?: boolean;
  /** Accounts are shared before connect() (an earlier authorisation the wallet restores). */
  authorized?: boolean;
  supportedTransactionVersions?: readonly SolanaTransactionVersion[];
  /** Leave out solana:signTransaction entirely. */
  noSignTransaction?: boolean;
};

export type FakeSignCall = { inputs: readonly SolanaSignTransactionInput[] };

export class FakeStandardWallet implements Wallet {
  readonly marker = FAKE_STANDARD_WALLET_MARKER;
  readonly version = '1.0.0' as const;
  readonly name: string;
  readonly icon = ICON;
  chains: readonly IdentifierString[];

  /** Behaviour knobs. */
  rejectNext = false;
  rejectConnect = false;
  /** Signing waits for this promise when set. */
  gate: Promise<void> | null = null;

  /** Every signTransaction call (one call per wallet prompt). */
  readonly signCalls: FakeSignCall[] = [];
  /** Calls to features the site must never use. */
  readonly forbiddenCalls: string[] = [];
  connectCalls = 0;
  disconnectCalls = 0;
  maxOpenRequests = 0;

  private readonly signers: readonly KeyPairSigner[];
  private readonly options: FakeWalletOptions;
  private active = 0;
  private shared: readonly WalletAccount[] = [];
  private openRequests = 0;
  private readonly listeners = new Set<StandardEventsListeners['change']>();

  constructor(options: FakeWalletOptions) {
    this.options = options;
    this.name = options.name;
    this.signers = options.signers;
    this.chains = options.chains ?? ['solana:mainnet', 'solana:devnet'];
    if (options.authorized === true) this.shared = this.freshAccounts();
  }

  get accounts(): readonly WalletAccount[] {
    return this.shared;
  }

  /** A new object on every read, as real wallets do. */
  get features(): Wallet['features'] {
    const features: Record<IdentifierString, unknown> = {
      'standard:connect': { version: '1.0.0', connect: this.connect },
      'standard:disconnect': { version: '1.0.0', disconnect: this.disconnect },
      'standard:events': { version: '1.0.0', on: this.on },
      'solana:signMessage': { version: '1.0.0', signMessage: this.forbidden('solana:signMessage') },
      'solana:signAndSendTransaction': {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0],
        signAndSendTransaction: this.forbidden('solana:signAndSendTransaction'),
      },
    };
    if (this.options.noSignTransaction !== true) {
      features['solana:signTransaction'] = {
        version: '1.0.0',
        supportedTransactionVersions: this.options.supportedTransactionVersions ?? ['legacy', 0],
        signTransaction: this.signTransaction,
      };
    }
    return features;
  }

  /** The user picks another account in the wallet: new account objects, a change event. */
  switchTo(index: number): void {
    this.active = index;
    if (this.shared.length > 0) this.setShared(this.freshAccounts());
  }

  /** The wallet re-issues its account objects (same addresses); objects kept from before are now stale. */
  reissueAccounts(): void {
    this.setShared(this.freshAccounts());
  }

  /** Registers through the real Wallet Standard registry; returns unregister. */
  register(): () => void {
    return getWallets().register(this);
  }

  addressAt(index: number): Address {
    const signer = this.signers[index];
    if (signer === undefined) throw new Error(`no account ${String(index)}`);
    return signer.address;
  }

  private readonly connect = (): Promise<{ accounts: readonly WalletAccount[] }> => {
    this.connectCalls += 1;
    if (this.rejectConnect) return Promise.reject(Object.assign(new Error('User rejected the request.'), { code: 4001 }));
    if (this.shared.length === 0) this.setShared(this.freshAccounts());
    return Promise.resolve({ accounts: this.shared });
  };

  private readonly disconnect = (): Promise<void> => {
    this.disconnectCalls += 1;
    this.setShared([]);
    return Promise.resolve();
  };

  private readonly on = (_event: 'change', listener: StandardEventsListeners['change']): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private readonly signTransaction = async (
    ...inputs: readonly SolanaSignTransactionInput[]
  ): Promise<readonly SolanaSignTransactionOutput[]> => {
    if (this.openRequests > 0) {
      throw Object.assign(new Error('Only one approve window can be open at a time'), { code: -32002 });
    }
    this.openRequests += 1;
    this.maxOpenRequests = Math.max(this.maxOpenRequests, this.openRequests);
    try {
      this.signCalls.push({ inputs });
      if (this.gate !== null) await this.gate;
      if (this.rejectNext) {
        this.rejectNext = false;
        throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
      }
      return await Promise.all(
        inputs.map(async (input) => {
          // Like the reference implementation: the account must be one of the live objects, by identity.
          if (!this.shared.includes(input.account)) throw new Error('invalid account');
          const signer = this.signers.find((candidate) => candidate.address === input.account.address);
          if (signer === undefined) throw new Error('invalid account');
          const signed = await partiallySignTransaction([signer.keyPair], getTransactionDecoder().decode(input.transaction));
          return { signedTransaction: new Uint8Array(getTransactionEncoder().encode(signed)) };
        }),
      );
    } finally {
      this.openRequests -= 1;
    }
  };

  private forbidden(feature: string) {
    return () => {
      this.forbiddenCalls.push(feature);
      return Promise.reject(new Error(`${feature} must never be used`));
    };
  }

  private freshAccounts(): readonly WalletAccount[] {
    const signers = this.options.oneAccountAtATime === true ? this.signers.slice(this.active, this.active + 1) : this.signers;
    // New frozen objects each time, like ReadonlyWalletAccount: identity is what makes an old object stale.
    return signers.map((signer) =>
      Object.freeze({
        address: signer.address,
        publicKey: new Uint8Array(getAddressEncoder().encode(signer.address)),
        chains: [...this.chains],
        features: ['solana:signTransaction', 'solana:signAndSendTransaction', 'solana:signMessage'] as const,
      }),
    );
  }

  private setShared(accounts: readonly WalletAccount[]): void {
    this.shared = accounts;
    const change: StandardEventsChangeProperties = { accounts };
    for (const listener of [...this.listeners]) listener(change);
  }
}
