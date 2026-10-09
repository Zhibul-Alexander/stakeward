// Headless test wallets for the QA suite (.claude/skills/qa-e2e/SKILL.md, "Wallets").
//
// Each QaWallet is a real Wallet Standard wallet registered in the page (the same discovery path Phantom, Solflare
// and Backpack use: `wallet-standard:register-wallet` / `wallet-standard:app-ready`), with one account and the
// features the site needs: standard:connect, standard:disconnect, standard:events and solana:signTransaction
// (legacy and v0). It claims solana:devnet only, so a mainnet build never lists it.
//
// The key never enters the page: the page asks Node through a Playwright binding, Node signs with kit's
// partiallySignTransaction (adds exactly its own signature) and returns the bytes. Behaviour per wallet mirrors core's
// TestWalletPort, so negative scenarios can make a wallet decline, tamper with the message, sign nothing or be slow.
// Test-only code: the keys are throwaway devnet keys generated in memory (CLAUDE.md section 2, rule 1).
import type { BrowserContext } from '@playwright/test';
import {
  getAddressEncoder,
  getBase64Decoder,
  getBase64Encoder,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  type KeyPairSigner,
} from '@solana/kit';
import { editMessage } from '@stakeward/core/test/craft';

export type WalletBehaviour = {
  /** Decline like a user pressing Reject (code 4001). */
  reject?: boolean;
  /** Decline the connect request (code 4001). */
  rejectConnect?: boolean;
  /** Flip the last byte of the last instruction's data before signing: the site must notice and stop. */
  tamper?: boolean;
  /** Return the bytes without this wallet's signature. */
  skipSignature?: boolean;
  /** Answer after this many milliseconds. */
  delayMs?: number;
  /** Run before answering (e.g. expire the local blockhash while the "user" is approving). */
  beforeAnswer?: () => Promise<void>;
};

export type SignRequest = { transactions: Uint8Array[] };

export class QaWallet {
  readonly name: string;
  readonly signer: KeyPairSigner;
  /** Applies to every request until changed. */
  behaviour: WalletBehaviour = {};
  private nextOnly: WalletBehaviour | null = null;
  /** Every signing request as received, in order. */
  readonly requests: SignRequest[] = [];
  connects = 0;

  constructor(name: string, signer: KeyPairSigner) {
    this.name = name;
    this.signer = signer;
  }

  get address(): string {
    return this.signer.address;
  }

  /** Behaviour for the next signing request only, on top of {@link behaviour}. */
  once(behaviour: WalletBehaviour): void {
    this.nextOnly = behaviour;
  }

  private take(): WalletBehaviour {
    const behaviour = { ...this.behaviour, ...this.nextOnly };
    this.nextOnly = null;
    return behaviour;
  }

  async connect(): Promise<WireAnswer> {
    this.connects += 1;
    const behaviour = this.behaviour;
    if (behaviour.delayMs !== undefined) await sleep(behaviour.delayMs);
    if (behaviour.rejectConnect === true) return { error: { code: 4001, message: 'User rejected the request.' } };
    return { ok: true };
  }

  async sign(base64: readonly string[]): Promise<WireAnswer> {
    const behaviour = this.take();
    const transactions = base64.map((b64) => Uint8Array.from(getBase64Encoder().encode(b64)));
    this.requests.push({ transactions: transactions.map((bytes) => Uint8Array.from(bytes)) });
    if (behaviour.delayMs !== undefined) await sleep(behaviour.delayMs);
    if (behaviour.beforeAnswer !== undefined) await behaviour.beforeAnswer();
    if (behaviour.reject === true) return { error: { code: 4001, message: 'User rejected the request.' } };
    const signed: string[] = [];
    for (const bytes of transactions) {
      let edited: Uint8Array = bytes;
      if (behaviour.tamper === true) edited = flipLastInstructionByte(edited);
      if (behaviour.skipSignature === true) {
        signed.push(getBase64Decoder().decode(edited));
        continue;
      }
      const transaction = getTransactionDecoder().decode(edited);
      const out = await partiallySignTransaction([this.signer.keyPair], transaction);
      signed.push(getBase64Decoder().decode(getTransactionEncoder().encode(out)));
    }
    return { transactions: signed };
  }
}

type WireAnswer = { ok: true } | { transactions: string[] } | { error: { code: number; message: string } };

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const BINDING = '__stakewardQaWallet';

/**
 * Registers the wallets in every page of `context` (call before the first navigation). Several calls add more
 * wallets; a wallet is found by name.
 */
export async function installWallets(context: BrowserContext, wallets: readonly QaWallet[], chain = 'solana:devnet'): Promise<void> {
  const registry = registries.get(context) ?? new Map<string, QaWallet>();
  if (!registries.has(context)) {
    registries.set(context, registry);
    await context.exposeBinding(BINDING, async (_source, request: { op: 'connect' | 'sign'; wallet: string; transactions?: string[] }) => {
      const wallet = registry.get(request.wallet);
      if (wallet === undefined) return { error: { code: -32603, message: `No QA wallet named ${request.wallet}` } };
      return request.op === 'connect' ? wallet.connect() : wallet.sign(request.transactions ?? []);
    });
  }
  for (const wallet of wallets) registry.set(wallet.name, wallet);
  await context.addInitScript(registerInPage, {
    binding: BINDING,
    chain,
    wallets: wallets.map((wallet) => ({
      name: wallet.name,
      address: wallet.address,
      publicKey: [...getAddressEncoder().encode(wallet.signer.address)],
    })),
  });
}

const registries = new WeakMap<BrowserContext, Map<string, QaWallet>>();

type PageConfig = { binding: string; chain: string; wallets: { name: string; address: string; publicKey: number[] }[] };

/** Runs in the page before any of its scripts. Self-contained: Playwright serialises it. */
function registerInPage(config: PageConfig): void {
  const call = (window as unknown as Record<string, (request: unknown) => Promise<Record<string, unknown>>>)[config.binding] as (
    request: unknown,
  ) => Promise<Record<string, unknown>>;
  const toBase64 = (bytes: Uint8Array) => {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  };
  const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  const icon =
    'data:image/svg+xml;base64,' +
    btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#444"/></svg>');
  const fail = (error: { code: number; message: string }) => Object.assign(new Error(error.message), { code: error.code });

  for (const spec of config.wallets) {
    const listeners = new Set<(properties: Record<string, unknown>) => void>();
    let connected = false;
    const account = Object.freeze({
      address: spec.address,
      publicKey: new Uint8Array(spec.publicKey),
      chains: [config.chain],
      features: ['solana:signTransaction'],
      label: spec.name,
    });
    const emit = () => {
      for (const listener of [...listeners]) listener({ accounts: wallet.accounts });
    };
    const wallet = {
      version: '1.0.0',
      name: spec.name,
      icon,
      chains: [config.chain],
      get accounts() {
        return connected ? [account] : [];
      },
      features: {
        'standard:connect': {
          version: '1.0.0',
          connect: async () => {
            const answer = await call({ op: 'connect', wallet: spec.name });
            if (answer['error'] !== undefined) throw fail(answer['error'] as { code: number; message: string });
            connected = true;
            emit();
            return { accounts: wallet.accounts };
          },
        },
        'standard:disconnect': {
          version: '1.0.0',
          disconnect: () => {
            connected = false;
            emit();
            return Promise.resolve();
          },
        },
        'standard:events': {
          version: '1.0.0',
          on: (event: string, listener: (properties: Record<string, unknown>) => void) => {
            if (event !== 'change') return () => undefined;
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
        'solana:signTransaction': {
          version: '1.0.0',
          supportedTransactionVersions: ['legacy', 0],
          signTransaction: async (...inputs: { transaction: Uint8Array }[]) => {
            const answer = await call({
              op: 'sign',
              wallet: spec.name,
              transactions: inputs.map((input) => toBase64(input.transaction)),
            });
            if (answer['error'] !== undefined) throw fail(answer['error'] as { code: number; message: string });
            return (answer['transactions'] as string[]).map((text) => ({ signedTransaction: fromBase64(text) }));
          },
        },
      },
    };
    const register = (api: { register: (w: unknown) => unknown }) => api.register(wallet);
    try {
      window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }));
    } catch {
      // the app is not listening yet: it announces app-ready below
    }
    window.addEventListener('wallet-standard:app-ready', (event) => {
      register((event as CustomEvent<{ register: (w: unknown) => unknown }>).detail);
    });
  }
}
