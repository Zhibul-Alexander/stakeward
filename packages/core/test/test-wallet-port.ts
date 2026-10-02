// Test-only WalletPort with in-memory keys (CLAUDE.md section 3: "in tests, a test wallet with keys in memory").
// Product code never imports it; no build may contain TEST_WALLET_PORT_MARKER (apps/web/test/test-code-guard.test.ts).
// No Node or DOM APIs beyond Web Crypto, so jsdom scenario tests in apps/web can use it.
import {
  generateKeyPairSigner,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  type Address,
  type KeyPairSigner,
  type ReadonlyUint8Array,
} from '@solana/kit';
import { createWalletRequestQueue, type WalletPort, type WalletPortErrorName } from '../src/index.ts';
import { appendLighthouseTail, editMessage } from './craft.ts';

/** Present in every test wallet; a build that contains this string shipped test code (CLAUDE.md section 11). */
export const TEST_WALLET_PORT_MARKER = 'stakeward-test-only:test-wallet-port';

/** A 1x1 SVG, enough for <img src>. */
const TEST_ICON = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiLz4=';

/** What the wallet does with the next signing requests. Every field is optional; the default signs as asked. */
export type TestWalletBehaviour = {
  /** Decline like a user pressing Reject (an error with code 4001, as Phantom and EIP-1193 wallets throw). */
  reject?: boolean;
  /** Change the message before signing it: `true` flips the last byte of the last instruction's data. */
  modifyMessage?: boolean | ((transaction: Uint8Array) => Uint8Array);
  /** Append a Lighthouse assertion instruction before signing, as Phantom does (DECISIONS.md D24). */
  lighthouseTail?: boolean;
  /** Answer after this many milliseconds, or once this promise settles. */
  delay?: number | Promise<unknown>;
  /** Return the bytes unchanged, without this wallet's signature. */
  skipSignature?: boolean;
  /** Fail with this error instead (e.g. an Error named WalletBusyError, or a wallet-specific error). */
  fail?: Error;
};

export type TestWalletRequest = { address: Address; transactions: Uint8Array[] };

export type TestWalletPort = WalletPort & {
  readonly marker: typeof TEST_WALLET_PORT_MARKER;
  /** Every key this wallet holds, exposed or not. */
  readonly signers: readonly KeyPairSigner[];
  /** Behaviour for every following request until changed. */
  behaviour: TestWalletBehaviour;
  /** Behaviour for the next request only (applied on top of `behaviour`), then cleared. */
  once(behaviour: TestWalletBehaviour): void;
  /** Every signTransactions call as received (copies of the bytes), in order. */
  readonly requests: readonly TestWalletRequest[];
  /** Every signTransactions answer (the returned bytes), in order; failed requests are not listed. */
  readonly responses: readonly Uint8Array[][];
  /** Most requests that were being answered at the same time; 1 means the wallet served them one by one. */
  readonly maxConcurrent: number;
  /** The wallet now exposes these of its keys (the user switched accounts); listeners are told. */
  setExposedAccounts(addresses: readonly Address[]): void;
  /** When true, connect() is declined (code 4001). */
  rejectConnect: boolean;
};

export type TestWalletOptions = {
  /** Wallet name, also its id. Default "Test Wallet". */
  name?: string;
  /** Keys the wallet holds. Default: one new key. */
  signers?: readonly KeyPairSigner[];
  /** Keys exposed after connect(). Default: all of them (a wallet that shares several accounts). */
  exposed?: readonly Address[];
  /** Already authorised on load: accounts are exposed before connect(). Default false. */
  connected?: boolean;
};

/**
 * A WalletPort whose keys live in test memory. Signs with kit's partiallySignTransaction, so it adds exactly its own
 * signature and keeps the others; requests are serialised like the Wallet Standard adapter's.
 */
export async function createTestWalletPort(options: TestWalletOptions = {}): Promise<TestWalletPort> {
  const signers = options.signers ?? [await generateKeyPairSigner()];
  const name = options.name ?? 'Test Wallet';
  const exposedOnConnect = options.exposed ?? signers.map((signer) => signer.address);
  const listeners = new Set<() => void>();
  const requests: TestWalletRequest[] = [];
  const responses: Uint8Array[][] = [];
  let accounts: readonly Address[] = options.connected === true ? [...exposedOnConnect] : [];
  const serialised = createWalletRequestQueue();
  let open = 0;
  let maxConcurrent = 0;
  let nextOnly: TestWalletBehaviour | null = null;

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const setAccounts = (next: readonly Address[]) => {
    if (next.length === accounts.length && next.every((address, i) => address === accounts[i])) return;
    accounts = [...next];
    notify();
  };
  async function sign(address: Address, transactions: readonly ReadonlyUint8Array[]): Promise<Uint8Array[]> {
    const behaviour = { ...port.behaviour, ...nextOnly };
    nextOnly = null;
    const copies = transactions.map((bytes) => Uint8Array.from(bytes));
    requests.push({ address, transactions: copies });
    open += 1;
    maxConcurrent = Math.max(maxConcurrent, open);
    try {
      const { delay } = behaviour;
      if (typeof delay === 'number') await new Promise((resolve) => setTimeout(resolve, delay));
      else if (delay !== undefined) await delay.catch(() => undefined);
      if (!accounts.includes(address)) {
        throw walletError('WalletAccountUnavailableError', `${name} does not expose ${address} right now`);
      }
      if (behaviour.fail !== undefined) throw behaviour.fail;
      if (behaviour.reject === true) throw rejection(name);
      const signer = signers.find((candidate) => candidate.address === address);
      if (signer === undefined) throw walletError('WalletAccountUnavailableError', `${name} holds no key for ${address}`);
      const signed = await Promise.all(
        copies.map(async (bytes) => {
          let edited: Uint8Array = bytes;
          if (behaviour.lighthouseTail === true) edited = appendLighthouseTail(edited);
          if (behaviour.modifyMessage === true) edited = flipLastInstructionByte(edited);
          else if (typeof behaviour.modifyMessage === 'function') edited = behaviour.modifyMessage(edited);
          if (behaviour.skipSignature === true) return edited;
          const transaction = await partiallySignTransaction([signer.keyPair], getTransactionDecoder().decode(edited));
          return new Uint8Array(getTransactionEncoder().encode(transaction));
        }),
      );
      responses.push(signed.map((bytes) => Uint8Array.from(bytes)));
      return signed;
    } finally {
      open -= 1;
    }
  }

  const port: TestWalletPort = {
    marker: TEST_WALLET_PORT_MARKER,
    id: name,
    name,
    icon: TEST_ICON,
    get accounts() {
      return accounts;
    },
    signers,
    behaviour: {},
    rejectConnect: false,
    requests,
    responses,
    get maxConcurrent() {
      return maxConcurrent;
    },
    once(behaviour) {
      nextOnly = behaviour;
    },
    connect(requestOptions) {
      return serialised(() => {
        if (port.rejectConnect) return Promise.reject(rejection(name));
        setAccounts(accounts.length > 0 ? accounts : exposedOnConnect);
        return Promise.resolve(accounts);
      }, requestOptions?.signal);
    },
    disconnect() {
      setAccounts([]);
      return Promise.resolve();
    },
    signTransactions(address, transactions, requestOptions) {
      if (transactions.length === 0) return Promise.resolve([]);
      return serialised(() => sign(address, transactions), requestOptions?.signal);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setExposedAccounts(addresses) {
      setAccounts(addresses);
    },
  };
  return port;
}

/** A user rejection as wallets report it: code 4001 (translateError reads it as `wallet-rejected`). */
export function rejection(walletName: string): Error {
  return Object.assign(new Error(`${walletName}: User rejected the request.`), { code: 4001 });
}

function walletError(name: WalletPortErrorName, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function flipLastInstructionByte(bytes: Uint8Array): Uint8Array {
  return editMessage(bytes, (message) => {
    const last = message.instructions.length - 1;
    return {
      ...message,
      instructions: message.instructions.map((instruction, index) => {
        if (index !== last || instruction.data === undefined || instruction.data.length === 0) return instruction;
        const data = Uint8Array.from(instruction.data);
        data[data.length - 1] = (data[data.length - 1] ?? 0) ^ 0xff;
        return { ...instruction, data };
      }),
    };
  });
}
