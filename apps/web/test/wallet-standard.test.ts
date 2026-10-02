import { blockhash, generateKeyPairSigner, getAddressDecoder, type KeyPairSigner } from '@solana/kit';
import { buildTransaction, checkSigningStep, translateError, type BuiltTransaction } from '@stakeward/core';
import { getWallets } from '@wallet-standard/app';
import { registerWallet } from '@wallet-standard/wallet';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StandardWalletRegistry } from '@/ports/wallet-registry';
import { StandardWalletPort } from '@/ports/wallet-standard';
import { FakeStandardWallet } from './support/fake-standard-wallet.ts';

const CHAIN = 'solana:devnet';
const LIFETIME = {
  kind: 'blockhash',
  blockhash: blockhash('EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N'),
  lastValidBlockHeight: 150n,
} as const;
const stakeAccount = (n: number) => getAddressDecoder().decode(new Uint8Array(32).fill(n));

function protect(main: KeyPairSigner, second: KeyPairSigner, n = 7): BuiltTransaction {
  return buildTransaction(
    { kind: 'protect', stakeAccount: stakeAccount(n), mainKey: main.address, secondKey: second.address, lockUntil: 1_800_000_000n },
    { feePayer: main.address, lifetime: LIFETIME },
  );
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function registered(wallet: FakeStandardWallet): FakeStandardWallet {
  cleanups.push(wallet.register());
  return wallet;
}

describe('StandardWalletRegistry (discovery through the real Wallet Standard registry)', () => {
  it('lists wallets that connect, sign legacy transactions and claim the chain; follows register and unregister', async () => {
    const signer = await generateKeyPairSigner();
    const registry = new StandardWalletRegistry(CHAIN);
    cleanups.push(() => {
      registry.dispose();
    });
    let notified = 0;
    registry.subscribe(() => (notified += 1));

    const good = new FakeStandardWallet({ name: 'Good', signers: [signer] });
    const unregisterGood = good.register();
    registered(new FakeStandardWallet({ name: 'Mainnet only', signers: [signer], chains: ['solana:mainnet'] }));
    registered(new FakeStandardWallet({ name: 'No legacy', signers: [signer], supportedTransactionVersions: [0] }));
    registered(new FakeStandardWallet({ name: 'Cannot sign', signers: [signer], noSignTransaction: true }));

    expect(registry.getSnapshot().map((port) => port.name)).toEqual(['Good']);
    expect(notified).toBeGreaterThan(0);
    const snapshot = registry.getSnapshot();
    expect(registry.getSnapshot()).toBe(snapshot); // stable for useSyncExternalStore

    unregisterGood();
    expect(registry.getSnapshot()).toEqual([]);
  });

  it('re-checks a wallet when it starts supporting the chain', async () => {
    const wallet = registered(
      new FakeStandardWallet({ name: 'Switches chain', signers: [await generateKeyPairSigner()], chains: ['solana:mainnet'] }),
    );
    const registry = new StandardWalletRegistry(CHAIN);
    cleanups.push(() => {
      registry.dispose();
    });
    expect(registry.getSnapshot()).toEqual([]);
    wallet.chains = ['solana:mainnet', 'solana:devnet'];
    wallet.reissueAccounts(); // any change event
    expect(registry.getSnapshot().map((port) => port.name)).toEqual(['Switches chain']);
  });

  it('gives a new snapshot when a listed wallet connects, so screens re-render', async () => {
    const wallet = registered(new FakeStandardWallet({ name: 'Connects', signers: [await generateKeyPairSigner()] }));
    const registry = new StandardWalletRegistry(CHAIN);
    cleanups.push(() => {
      registry.dispose();
    });
    const before = registry.getSnapshot();
    expect(before[0]?.accounts).toEqual([]);
    await before[0]?.connect();
    const after = registry.getSnapshot();
    expect(after).not.toBe(before);
    expect(after[0]?.accounts).toEqual([wallet.addressAt(0)]);
  });
});

describe('StandardWalletPort', () => {
  let A: KeyPairSigner;
  let K: KeyPairSigner;

  beforeEach(async () => {
    [A, K] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
  });

  it('connects on request (never silently) and lists the shared accounts', async () => {
    const wallet = registered(new FakeStandardWallet({ name: 'Two accounts', signers: [A, K] }));
    const port = new StandardWalletPort(wallet, CHAIN);
    expect(port.id).toBe('Two accounts');
    expect(port.icon.startsWith('data:image/')).toBe(true);
    expect(port.accounts).toEqual([]);
    expect(wallet.connectCalls).toBe(0);

    let changes = 0;
    port.onChange(() => (changes += 1));
    expect(await port.connect()).toEqual([A.address, K.address]);
    expect(port.accounts).toBe(port.accounts);
    expect(changes).toBeGreaterThan(0);

    await port.disconnect();
    expect(wallet.disconnectCalls).toBe(1);
    expect(port.accounts).toEqual([]);
  });

  it('shows accounts a wallet restores before connect()', () => {
    const wallet = registered(new FakeStandardWallet({ name: 'Restored', signers: [A], authorized: true }));
    expect(new StandardWalletPort(wallet, CHAIN).accounts).toEqual([A.address]);
  });

  it('signs all transactions in ONE variadic solana:signTransaction call, with the chain and the account', async () => {
    const wallet = registered(new FakeStandardWallet({ name: 'Signer', signers: [A] }));
    const port = new StandardWalletPort(wallet, CHAIN);
    await port.connect();
    const first = protect(A, K, 1);
    const second = protect(A, K, 2);

    const signed = await port.signTransactions(A.address, [first.bytes, second.bytes]);
    expect(wallet.signCalls).toHaveLength(1);
    const inputs = wallet.signCalls[0]?.inputs ?? [];
    expect(inputs.map((input) => [input.account.address, input.chain])).toEqual([
      [A.address, CHAIN],
      [A.address, CHAIN],
    ]);
    expect(inputs[0]?.transaction).not.toBe(first.bytes); // a copy: the wallet never holds our buffer
    expect(await checkSigningStep(first.bytes, signed[0] ?? new Uint8Array())).toEqual({ ok: true, lighthouseInstructions: 0 });
    expect(await checkSigningStep(second.bytes, signed[1] ?? new Uint8Array())).toEqual({ ok: true, lighthouseInstructions: 0 });
    expect(await port.signTransactions(A.address, [])).toEqual([]);
    expect(wallet.signCalls).toHaveLength(1);
    expect(wallet.forbiddenCalls).toEqual([]);
  });

  it('looks the account object up right before signing: re-issued objects never go stale', async () => {
    const wallet = registered(new FakeStandardWallet({ name: 'Reissues', signers: [A] }));
    const port = new StandardWalletPort(wallet, CHAIN);
    await port.connect();
    const staleObject = wallet.accounts[0];
    wallet.reissueAccounts();
    expect(wallet.accounts[0]).not.toBe(staleObject);
    await expect(port.signTransactions(A.address, [protect(A, K).bytes])).resolves.toHaveLength(1);
  });

  it('follows account switching (one account at a time, like Phantom) and refuses an account not offered now', async () => {
    const wallet = registered(new FakeStandardWallet({ name: 'Phantom-like', signers: [A, K], oneAccountAtATime: true }));
    const port = new StandardWalletPort(wallet, CHAIN);
    let changes = 0;
    port.onChange(() => (changes += 1));
    expect(await port.connect()).toEqual([A.address]);

    wallet.switchTo(1);
    expect(changes).toBeGreaterThanOrEqual(2);
    expect(port.accounts).toEqual([K.address]);
    const error: unknown = await port.signTransactions(A.address, [protect(A, K).bytes]).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'WalletAccountUnavailableError' });

    const signedByK = await port.signTransactions(K.address, [protect(A, K).bytes]);
    expect(signedByK).toHaveLength(1);
    wallet.switchTo(0);
    await expect(port.signTransactions(A.address, [protect(A, K).bytes])).resolves.toHaveLength(1);
  });

  it('turns a user rejection into code 4001 (translateError: wallet-rejected), also on connect', async () => {
    const wallet = registered(new FakeStandardWallet({ name: 'Declines', signers: [A] }));
    const port = new StandardWalletPort(wallet, CHAIN);
    await port.connect();
    wallet.rejectNext = true;
    const error: unknown = await port.signTransactions(A.address, [protect(A, K).bytes]).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 4001 });
    expect(translateError(error).code).toBe('wallet-rejected');

    wallet.rejectConnect = true;
    const refused: unknown = await port.connect().catch((e: unknown) => e);
    expect(translateError(refused).code).toBe('wallet-rejected');
  });

  it('serialises requests to one wallet: no second approval window while one is open (Phantom -32002)', async () => {
    const wallet = registered(new FakeStandardWallet({ name: 'One window', signers: [A, K] }));
    const port = new StandardWalletPort(wallet, CHAIN);
    const otherPortOverSameWallet = new StandardWalletPort(wallet, CHAIN);
    await port.connect();
    let open: () => void = () => undefined;
    wallet.gate = new Promise<void>((resolve) => (open = resolve));

    const byA = port.signTransactions(A.address, [protect(A, K, 1).bytes]);
    const byK = otherPortOverSameWallet.signTransactions(K.address, [protect(A, K, 2).bytes]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(wallet.signCalls).toHaveLength(1);
    open();
    await expect(Promise.all([byA, byK])).resolves.toHaveLength(2);
    expect(wallet.signCalls).toHaveLength(2);
    expect(wallet.maxOpenRequests).toBe(1);
  });

  it('reports a wallet busy elsewhere as WalletBusyError, and a wallet without signing as WalletUnsupportedError', async () => {
    const wallet = registered(new FakeStandardWallet({ name: 'Busy', signers: [A] }));
    const port = new StandardWalletPort(wallet, CHAIN);
    await port.connect();
    let open: () => void = () => undefined;
    wallet.gate = new Promise<void>((resolve) => (open = resolve));
    // Another tab holds the approval window: call the wallet directly, outside our queue.
    const signFeature = wallet.features['solana:signTransaction'] as {
      signTransaction: (...inputs: unknown[]) => Promise<unknown>;
    };
    const elsewhere = signFeature.signTransaction({ account: wallet.accounts[0], transaction: protect(A, K).bytes });
    const error: unknown = await port.signTransactions(A.address, [protect(A, K).bytes]).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'WalletBusyError' });
    open();
    await elsewhere;

    const legacyless = registered(new FakeStandardWallet({ name: 'v0 only', signers: [A], supportedTransactionVersions: [0] }));
    const unsupported = new StandardWalletPort(legacyless, CHAIN);
    await unsupported.connect();
    await expect(unsupported.signTransactions(A.address, [protect(A, K).bytes])).rejects.toMatchObject({
      name: 'WalletUnsupportedError',
    });
  });
});

// Last: registerWallet offers no way to unregister, so this wallet stays for the rest of the file.
describe('Wallet Standard window protocol', () => {
  it('picks up a wallet that registers itself with registerWallet', async () => {
    const registry = new StandardWalletRegistry(CHAIN);
    cleanups.push(() => {
      registry.dispose();
    });
    const wallet = new FakeStandardWallet({ name: 'Late wallet', signers: [await generateKeyPairSigner()] });
    registerWallet(wallet);
    expect(registry.getSnapshot().map((port) => port.name)).toEqual(['Late wallet']);
    expect(getWallets().get()).toContain(wallet);
  });
});

describe('StandardWalletPort with a misbehaving wallet', () => {
  it('an answer that is not one signed transaction per input is an error, not a crash', async () => {
    const [A, K] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    const wallet = new FakeStandardWallet({ name: 'Odd answers', signers: [A], authorized: true });
    const answers: unknown[] = [undefined, [], [{ signedTransaction: 'not bytes' }]];
    // This wallet's signTransaction answers garbage.
    Object.defineProperty(wallet, 'features', {
      get: () => ({
        'standard:connect': { version: '1.0.0', connect: () => Promise.resolve({ accounts: wallet.accounts }) },
        'solana:signTransaction': {
          version: '1.0.0',
          supportedTransactionVersions: ['legacy'],
          signTransaction: () => Promise.resolve(answers.shift()),
        },
      }),
    });
    const port = new StandardWalletPort(wallet, CHAIN);
    for (let i = 0; i < 3; i += 1) {
      await expect(port.signTransactions(A.address, [protect(A, K).bytes])).rejects.toThrow(/Odd answers/);
    }
  });
});
