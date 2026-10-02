import { blockhash, generateKeyPairSigner, type KeyPairSigner } from '@solana/kit';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildTransaction, checkSigningStep, translateError, type BuiltTransaction } from '../src/index.ts';
import { key } from './craft.ts';
import { createTestWalletPort, TEST_WALLET_PORT_MARKER, type TestWalletPort } from './test-wallet-port.ts';

const LIFETIME = {
  kind: 'blockhash',
  blockhash: blockhash('EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N'),
  lastValidBlockHeight: 150n,
} as const;

describe('test wallet port', () => {
  let A: KeyPairSigner;
  let K: KeyPairSigner;
  let main: TestWalletPort;
  let second: TestWalletPort;
  let protect: BuiltTransaction;

  beforeEach(async () => {
    [A, K] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    main = await createTestWalletPort({ name: 'Main', signers: [A], connected: true });
    second = await createTestWalletPort({ name: 'Second', signers: [K], connected: true });
    protect = buildTransaction(
      { kind: 'protect', stakeAccount: key(9), mainKey: A.address, secondKey: K.address, lockUntil: 1_800_000_000n },
      { feePayer: A.address, lifetime: LIFETIME },
    );
  });

  it('carries the test-only marker (no build may contain it)', () => {
    expect(main.marker).toBe(TEST_WALLET_PORT_MARKER);
    expect(TEST_WALLET_PORT_MARKER.startsWith('stakeward-test-only:')).toBe(true);
  });

  it('adds exactly its own signature; each signing step passes checkSigningStep', async () => {
    const [byMain] = await main.signTransactions(A.address, [protect.bytes]);
    if (byMain === undefined) throw new Error('no answer');
    expect(await checkSigningStep(protect.bytes, byMain)).toEqual({ ok: true, lighthouseInstructions: 0 });
    const [byBoth] = await second.signTransactions(K.address, [byMain]);
    if (byBoth === undefined) throw new Error('no answer');
    expect(await checkSigningStep(byMain, byBoth)).toEqual({ ok: true, lighthouseInstructions: 0 });
    expect(main.requests).toEqual([{ address: A.address, transactions: [protect.bytes] }]);
    expect(second.responses).toEqual([[byBoth]]);
  });

  it('signs several transactions in one request, in order', async () => {
    const other = buildTransaction(
      { kind: 'protect', stakeAccount: key(8), mainKey: A.address, secondKey: K.address, lockUntil: 1_800_000_000n },
      { feePayer: A.address, lifetime: LIFETIME },
    );
    const signed = await main.signTransactions(A.address, [protect.bytes, other.bytes]);
    expect(signed).toHaveLength(2);
    expect((await checkSigningStep(protect.bytes, signed[0] ?? new Uint8Array())).ok).toBe(true);
    expect((await checkSigningStep(other.bytes, signed[1] ?? new Uint8Array())).ok).toBe(true);
    expect(main.requests).toHaveLength(1);
    expect(await main.signTransactions(A.address, [])).toEqual([]);
  });

  it('declines like a user (translateError: wallet-rejected), once or until changed', async () => {
    main.once({ reject: true });
    const error: unknown = await main.signTransactions(A.address, [protect.bytes]).catch((e: unknown) => e);
    expect(translateError(error).code).toBe('wallet-rejected');
    await expect(main.signTransactions(A.address, [protect.bytes])).resolves.toHaveLength(1);

    main.behaviour = { reject: true };
    await expect(main.signTransactions(A.address, [protect.bytes])).rejects.toMatchObject({ code: 4001 });
    await expect(main.signTransactions(A.address, [protect.bytes])).rejects.toMatchObject({ code: 4001 });
  });

  it('can change the message before signing (checkSigningStep: message-changed)', async () => {
    main.once({ modifyMessage: true });
    const [modified] = await main.signTransactions(A.address, [protect.bytes]);
    expect(await checkSigningStep(protect.bytes, modified ?? new Uint8Array())).toMatchObject({
      ok: false,
      error: { code: 'message-changed' },
    });
  });

  it('can append a Lighthouse tail: accepted from the first signer, refused after another signature', async () => {
    main.once({ lighthouseTail: true });
    const [tailed] = await main.signTransactions(A.address, [protect.bytes]);
    expect(await checkSigningStep(protect.bytes, tailed ?? new Uint8Array())).toEqual({ ok: true, lighthouseInstructions: 1 });

    const [byMain] = await main.signTransactions(A.address, [protect.bytes]);
    second.once({ lighthouseTail: true });
    const [late] = await second.signTransactions(K.address, [byMain ?? new Uint8Array()]);
    expect(await checkSigningStep(byMain ?? new Uint8Array(), late ?? new Uint8Array())).toMatchObject({
      ok: false,
      error: { code: 'tail-not-first-signer' },
    });
  });

  it('can return the bytes unsigned or fail with a given error', async () => {
    main.once({ skipSignature: true });
    expect(await main.signTransactions(A.address, [protect.bytes])).toEqual([protect.bytes]);
    const busy = Object.assign(new Error('Only one approve window can be open at a time'), { code: -32002 });
    main.once({ fail: busy });
    await expect(main.signTransactions(A.address, [protect.bytes])).rejects.toBe(busy);
  });

  it('serialises requests: a delayed request finishes before the next one starts', async () => {
    let release: () => void = () => undefined;
    main.once({ delay: new Promise<void>((resolve) => (release = resolve)) });
    const first = main.signTransactions(A.address, [protect.bytes]);
    const secondRequest = main.signTransactions(A.address, [protect.bytes]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(main.requests).toHaveLength(1);
    release();
    await Promise.all([first, secondRequest]);
    expect(main.requests).toHaveLength(2);
    expect(main.maxConcurrent).toBe(1);

    main.once({ delay: 5 });
    await expect(main.signTransactions(A.address, [protect.bytes])).resolves.toHaveLength(1);
  });

  it('connects, switches the exposed account and refuses addresses it does not expose', async () => {
    const other = await generateKeyPairSigner();
    const wallet = await createTestWalletPort({ signers: [A, other], exposed: [A.address] });
    expect(wallet.accounts).toEqual([]);
    const snapshot = wallet.accounts;
    expect(wallet.accounts).toBe(snapshot); // stable until a change

    let changes = 0;
    const off = wallet.onChange(() => (changes += 1));
    expect(await wallet.connect()).toEqual([A.address]);
    expect(changes).toBe(1);

    await expect(wallet.signTransactions(other.address, [protect.bytes])).rejects.toMatchObject({
      name: 'WalletAccountUnavailableError',
    });
    wallet.setExposedAccounts([other.address]);
    expect(wallet.accounts).toEqual([other.address]);
    expect(changes).toBe(2);
    await expect(wallet.signTransactions(A.address, [protect.bytes])).rejects.toMatchObject({
      name: 'WalletAccountUnavailableError',
    });

    off();
    await wallet.disconnect();
    expect(wallet.accounts).toEqual([]);
    expect(changes).toBe(2);

    wallet.rejectConnect = true;
    const error: unknown = await wallet.connect().catch((e: unknown) => e);
    expect(translateError(error).code).toBe('wallet-rejected');
  });
});
