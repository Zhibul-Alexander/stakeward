import { blockhash, getTransactionDecoder, getTransactionEncoder, type Address, type Nonce, type SignatureBytes } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { build, craft, editMessage, instructionsOf, key } from '../test/craft.ts';
import { newTestWallet, type TestWallet } from '../test/wallet.ts';
import type { Lifetime, TransactionAction, TransactionKind } from './actions.ts';
import { deriveNonceAccountAddress } from './builders.ts';
import { NONCE_ACCOUNT_SEED } from './constants.ts';
import { inspectTransaction, type TransactionSummary } from './inspect.ts';
import {
  cosignFragment,
  cosignLinkProblem,
  decodeBase64Url,
  encodeBase64Url,
  isTruncatedTransaction,
  LINK_KINDS,
  MAX_TRANSACTION_BYTES,
  missingSignatures,
  parseCosignFragment,
  type CosignLinkProblem,
} from './link.ts';

const bytes = (length: number): Uint8Array => Uint8Array.from({ length }, (_, i) => (i * 37 + 11) % 256);

describe('base64url', () => {
  it('round-trips every length without padding or + and /', () => {
    for (let length = 0; length <= 70; length++) {
      const text = encodeBase64Url(bytes(length));
      expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(decodeBase64Url(text)).toEqual(bytes(length));
    }
  });

  it('uses the url-safe alphabet', () => {
    expect(encodeBase64Url(Uint8Array.of(0xfb, 0xff, 0xbf))).toBe('-_-_');
  });

  it.each([
    ['standard alphabet', '+/+/'],
    ['padding', 'AA=='],
    ['impossible length', 'AAAAA'],
    ['non-canonical trailing bits', 'AB'],
    ['other characters', 'AA AA'],
  ])('rejects %s', (_name, text) => {
    expect(decodeBase64Url(text)).toBeNull();
  });
});

describe('cosign fragment', () => {
  it('round-trips a transaction through #tx=', () => {
    const tx = bytes(600);
    expect(parseCosignFragment(`#${cosignFragment(tx)}`)).toEqual(tx);
    expect(parseCosignFragment(cosignFragment(tx))).toEqual(tx);
  });

  it.each([
    ['empty', ''],
    ['no tx parameter', '#foo=AAAA'],
    ['extra parameter', `#${cosignFragment(bytes(10))}&x=1`],
    ['empty transaction', '#tx='],
    ['garbage', '#tx=%%%'],
    ['too long', `#${cosignFragment(bytes(MAX_TRANSACTION_BYTES + 1))}`],
  ])('rejects %s', (_name, fragment) => {
    expect(parseCosignFragment(fragment)).toBeNull();
  });

  it('accepts the largest transaction', () => {
    expect(parseCosignFragment(cosignFragment(bytes(MAX_TRANSACTION_BYTES)))).toHaveLength(MAX_TRANSACTION_BYTES);
  });
});

const [mainKey, secondKey, newWallet] = await Promise.all([newTestWallet(), newTestWallet(), newTestWallet()]);

describe('cosign link rules', () => {
  const A = mainKey.address;
  const K = secondKey.address;
  const D = newWallet.address;
  const S = key(4);
  const X = key(9);
  const T = 1_825_545_600n;
  const VALUE = key(21) as string as Nonce;
  const nonceOf = (authority: Address): Lifetime => ({ kind: 'nonce', nonceAccount: key(6), nonceAuthority: authority, nonceValue: VALUE });
  const BLOCKHASH: Lifetime = { kind: 'blockhash', blockhash: blockhash(key(20)), lastValidBlockHeight: 100n };

  const protect: TransactionAction = { kind: 'protect', stakeAccount: S, mainKey: A, secondKey: K, lockUntil: T };
  const withdraw = (recipient: Address): TransactionAction => ({
    kind: 'withdraw',
    stakeAccount: S,
    mainKey: A,
    secondKey: K,
    recipient,
    lamports: 2_000_000_000n,
  });
  const rescue: TransactionAction = { kind: 'rescue', stakeAccount: S, mainKey: A, secondKey: K, newWallet: D };

  /** The inspector's summary of `action` built on `lifetime`, signed by `signers`. */
  async function summaryOf(
    action: TransactionAction,
    lifetime: Lifetime,
    signers: readonly TestWallet[],
    feePayer?: Address,
  ): Promise<TransactionSummary> {
    let bytes = build(action, lifetime, feePayer).bytes;
    for (const signer of signers) [bytes = bytes] = await signer.signTransactions([bytes]);
    const inspected = await inspectTransaction(bytes);
    if (!inspected.ok) throw new Error(`${action.kind}: ${inspected.error.code} ${inspected.error.message}`);
    return inspected.summary;
  }

  it('links only protect, withdraw and rescue', () => {
    expect(LINK_KINDS).toEqual(['protect', 'withdraw', 'rescue']);
  });

  it.each([
    ['protect on the main key\'s nonce, signed by the main key', () => summaryOf(protect, nonceOf(A), [mainKey])],
    ['withdraw to the main key, signed by the main key', () => summaryOf(withdraw(A), nonceOf(A), [mainKey])],
    ['rescue on the new wallet\'s nonce, signed by the new wallet', () => summaryOf(rescue, nonceOf(D), [newWallet])],
    ['rescue signed by the new wallet and the main key', () => summaryOf(rescue, nonceOf(D), [newWallet, mainKey])],
  ])('accepts a link Stakeward makes: %s', async (_name, make) => {
    expect(cosignLinkProblem(await make())).toBeNull();
  });

  // Every kind outside LINK_KINDS, on a blockhash: rule 1 comes before rule 2.
  const otherKinds: { [Kind in Exclude<TransactionKind, (typeof LINK_KINDS)[number]>]: () => Promise<TransactionAction> } = {
    extend: () => Promise.resolve({ kind: 'extend', stakeAccount: S, secondKey: K, lockUntil: T }),
    unlock: () => Promise.resolve({ kind: 'unlock', stakeAccount: S, secondKey: K }),
    deactivate: () => Promise.resolve({ kind: 'deactivate', stakeAccount: S, staker: A }),
    delegate: () => Promise.resolve({ kind: 'delegate', stakeAccount: S, staker: A, voteAccount: key(5) }),
    'nonce-setup': async () => ({
      kind: 'nonce-setup',
      nonceAccount: await deriveNonceAccountAddress(A),
      nonceAuthority: A,
      seed: NONCE_ACCOUNT_SEED,
      lamports: 1_056_640n,
    }),
    'nonce-close': () =>
      Promise.resolve({ kind: 'nonce-close', nonceAccount: key(6), nonceAuthority: A, recipient: A, lamports: 1_056_640n }),
  };
  it.each(Object.entries(otherKinds))('refuses %s: not-linkable-kind', async (_kind, make) => {
    expect(cosignLinkProblem(await summaryOf(await make(), BLOCKHASH, []))).toBe('not-linkable-kind');
  });

  it.each<[string, () => Promise<TransactionSummary>, CosignLinkProblem]>([
    ['unlock on the second key\'s nonce, signed by it', () => summaryOf({ kind: 'unlock', stakeAccount: S, secondKey: K }, nonceOf(K), [secondKey]), 'not-linkable-kind'],
    ['protect on a blockhash, signed by the main key', () => summaryOf(protect, BLOCKHASH, [mainKey]), 'not-nonce'],
    ['protect paid by the second key on the main key\'s nonce', () => summaryOf(protect, nonceOf(A), [secondKey, mainKey], K), 'nonce-not-fee-payer'],
    ['protect paid by the second key on its own nonce, signed by it', () => summaryOf(protect, nonceOf(K), [secondKey], K), 'unexpected-fee-payer'],
    ['protect on the main key\'s nonce, unsigned', () => summaryOf(protect, nonceOf(A), []), 'fee-payer-unsigned'],
    ['protect signed by the second key only', () => summaryOf(protect, nonceOf(A), [secondKey]), 'fee-payer-unsigned'],
    ['withdraw to another wallet, unsigned (the signature rule comes first)', () => summaryOf(withdraw(X), nonceOf(A), []), 'fee-payer-unsigned'],
    ['withdraw to another wallet, signed by the main key', () => summaryOf(withdraw(X), nonceOf(A), [mainKey]), 'foreign-recipient'],
    ['protect signed by both keys', () => summaryOf(protect, nonceOf(A), [mainKey, secondKey]), 'nothing-to-sign'],
    ['rescue signed by all three', () => summaryOf(rescue, nonceOf(D), [newWallet, mainKey, secondKey]), 'nothing-to-sign'],
  ])('refuses %s: %s', async (_name, make, problem) => {
    expect(cosignLinkProblem(await make())).toBe(problem);
  });

  it('missingSignatures: required signers without a signature, in message order', async () => {
    expect(missingSignatures(await summaryOf(protect, nonceOf(A), []))).toEqual([A, K]);
    expect(missingSignatures(await summaryOf(protect, nonceOf(A), [secondKey]))).toEqual([A]);
    expect(missingSignatures(await summaryOf(rescue, nonceOf(D), [newWallet]))).toEqual(
      (await summaryOf(rescue, nonceOf(D), [])).requiredSigners.filter((signer) => signer !== D),
    );
    expect(missingSignatures(await summaryOf(protect, nonceOf(A), [mainKey, secondKey]))).toEqual([]);
  });
});

describe('isTruncatedTransaction: what a cut-off link leaves', () => {
  const A = mainKey.address;
  const VALUE = key(21) as string as Nonce;
  const nonce: Lifetime = { kind: 'nonce', nonceAccount: key(6), nonceAuthority: A, nonceValue: VALUE };
  const protect: TransactionAction = { kind: 'protect', stakeAccount: key(4), mainKey: A, secondKey: secondKey.address, lockUntil: 1_825_545_600n };
  const rescue: TransactionAction = { kind: 'rescue', stakeAccount: key(4), mainKey: A, secondKey: secondKey.address, newWallet: newWallet.address };
  const signedBy = async (wallet: TestWallet, bytes: Uint8Array) => (await wallet.signTransactions([bytes]))[0] ?? bytes;

  it('every shorter start of a signed transaction, and nothing else of it', async () => {
    for (const [action, payer] of [[protect, mainKey], [rescue, newWallet]] as const) {
      const lifetime: Lifetime = { ...nonce, nonceAuthority: payer.address };
      const whole = await signedBy(payer, build(action, lifetime, payer.address).bytes);
      expect(isTruncatedTransaction(whole)).toBe(false);
      for (let length = 0; length < whole.length; length += 1) {
        expect(isTruncatedTransaction(whole.slice(0, length)), `${action.kind}, ${String(length)} bytes`).toBe(true);
      }
    }
  });

  it('not bytes that read as a whole transaction but were altered: the inspector refuses those', async () => {
    const built = build(protect, nonce).bytes;
    const instructions = instructionsOf(built);
    const longerData = craft(
      instructions.map((ix, i) => (i === instructions.length - 1 ? { ...ix, data: Uint8Array.from([...(ix.data ?? []), 0]) } : ix)),
      A,
      VALUE,
    );
    const { messageBytes } = getTransactionDecoder().decode(built);
    const signatures: Record<Address, SignatureBytes | null> = { [A]: null };
    const oneSlotShort = new Uint8Array(getTransactionEncoder().encode({ messageBytes, signatures }));
    const listedTwice = editMessage(built, (message) => ({
      ...message,
      staticAccounts: message.staticAccounts.map((a, i) => (i === message.staticAccounts.length - 1 ? key(4) : a)),
    }));
    const trailing = Uint8Array.from([...built, 0]);
    for (const altered of [longerData, oneSlotShort, listedTwice, trailing]) {
      expect((await inspectTransaction(altered)).ok).toBe(false);
      expect(isTruncatedTransaction(altered)).toBe(false);
    }
  });

  it('bytes that are no transaction at all', () => {
    expect(isTruncatedTransaction(new Uint8Array())).toBe(true);
    expect(isTruncatedTransaction(new Uint8Array(300).fill(0xff))).toBe(true);
  });
});
