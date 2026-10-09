import {
  generateKeyPairSigner,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  type Address,
  type Blockhash,
  type KeyPairSigner,
  type Nonce,
} from '@solana/kit';
import {
  buildTransaction,
  deriveNonceAccountAddress,
  inspectTransaction,
  MAX_TRANSACTION_BYTES,
  parseCosignFragment,
  type NonceLifetime,
  type TransactionAction,
} from '@stakeward/core';
import { appendLighthouseTail } from '@stakeward/core/test/craft';
import { describe, expect, it } from 'vitest';
import { qrModules } from '@/components/product/qr-code';
import { cosignUrl, transactionIdOf } from './link.ts';

const [main, second, newWallet] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner(), generateKeyPairSigner()]);
const ACTION: TransactionAction = {
  kind: 'protect',
  stakeAccount: 'AYA9kYsn7XVDTPARBfAuASypyyDGFJw1Xds2vHgW9DfW' as Address,
  mainKey: main.address,
  secondKey: second.address,
  lockUntil: 1_807_488_000n,
};
const LIFETIME = {
  kind: 'blockhash',
  blockhash: 'BZFufDqppShyDDC1njm4fMpRbfnLwrpzzwG6WGgcmsxb' as Blockhash,
  lastValidBlockHeight: 1_150n,
} as const;

describe('cosignUrl', () => {
  it('puts the bytes in the fragment of /cosign on this origin; parseCosignFragment reads them back', () => {
    const { bytes } = buildTransaction(ACTION, { feePayer: main.address, lifetime: LIFETIME });
    const url = new URL(cosignUrl(bytes, 'https://stakeward-prod.example-domain.com'));
    expect(url.origin).toBe('https://stakeward-prod.example-domain.com');
    expect(url.pathname).toBe('/cosign');
    expect(url.search).toBe('');
    expect(parseCosignFragment(url.hash)).toEqual(bytes);
  });
});

describe('transactionIdOf', () => {
  it("is the fee payer's signature once it signed; null before that and for bytes that are not a transaction", async () => {
    const { bytes } = buildTransaction(ACTION, { feePayer: main.address, lifetime: LIFETIME });
    expect(transactionIdOf(bytes)).toBeNull();
    const bySecond = await partiallySignTransaction([second.keyPair], getTransactionDecoder().decode(bytes));
    expect(transactionIdOf(new Uint8Array(getTransactionEncoder().encode(bySecond)))).toBeNull();
    const byMain = await partiallySignTransaction([main.keyPair], bySecond);
    const id = transactionIdOf(new Uint8Array(getTransactionEncoder().encode(byMain)));
    expect(id).not.toBeNull();
    expect(id).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
    expect(transactionIdOf(Uint8Array.of(1, 2, 3))).toBeNull();
  });
});

/**
 * The link must fit a QR code a phone camera reads (step 7 "Done when" 4). Measured on the longest links Stakeward
 * makes: on a durable nonce, every signature in place and Phantom's Lighthouse tail (two assertions on the accounts the
 * transaction writes), under a long production origin (41 characters). Version 25 (117 modules) is the limit set by
 * the spec; the measured versions are 18 (protect), 19 (withdraw) and 21 (rescue) at correction level L.
 */
describe('the signing link fits a QR code', () => {
  const PROD_ORIGIN = 'https://stakeward-prod.example-domain.com';
  const VERSION_25_MODULES = 117;
  const NONCE_VALUE = 'BZFufDqppShyDDC1njm4fMpRbfnLwrpzzwG6WGgcmsxb' as Nonce;

  async function nonceOf(authority: Address): Promise<NonceLifetime> {
    return { kind: 'nonce', nonceAccount: await deriveNonceAccountAddress(authority), nonceAuthority: authority, nonceValue: NONCE_VALUE };
  }

  /** The bytes as the other device sends them: tail first (Phantom signs first), then every signature. */
  async function linkBytes(action: TransactionAction, feePayer: KeyPairSigner, signers: readonly KeyPairSigner[]): Promise<Uint8Array> {
    const lifetime = await nonceOf(feePayer.address);
    const { bytes } = buildTransaction(action, { feePayer: feePayer.address, lifetime });
    const stake = 'stakeAccount' in action ? action.stakeAccount : feePayer.address;
    const tailed = appendLighthouseTail(bytes, [stake, feePayer.address, lifetime.nonceAccount], 2);
    const signed = await partiallySignTransaction(
      signers.map((signer) => signer.keyPair),
      getTransactionDecoder().decode(tailed),
    );
    const out = new Uint8Array(getTransactionEncoder().encode(signed));
    // A real Stakeward transaction: the inspector accepts it, nonce lifetime, every signature present.
    const inspected = await inspectTransaction(out);
    if (!inspected.ok) throw new Error(`inspector refused the sample: ${inspected.error.code}`);
    expect(inspected.summary.lifetime.kind).toBe('nonce');
    expect(inspected.summary.presentSignatures).toHaveLength(signers.length);
    return out;
  }

  const [mainKey, secondKey] = [main, second];
  const stakeAccount = 'AYA9kYsn7XVDTPARBfAuASypyyDGFJw1Xds2vHgW9DfW' as Address;

  it.each([
    [
      'rescue',
      { kind: 'rescue', stakeAccount, mainKey: mainKey.address, secondKey: secondKey.address, newWallet: newWallet.address },
      newWallet,
      [newWallet, mainKey, secondKey],
    ],
    [
      'withdraw',
      {
        kind: 'withdraw',
        stakeAccount,
        mainKey: mainKey.address,
        secondKey: secondKey.address,
        recipient: mainKey.address,
        lamports: 1_250_500_000_000n,
      },
      mainKey,
      [mainKey, secondKey],
    ],
    ['protect', { ...ACTION, stakeAccount }, mainKey, [mainKey, secondKey]],
  ] as const)('%s: at most version 25 at level L, under 1100 characters', async (_kind, action, feePayer, signers) => {
    const url = cosignUrl(await linkBytes(action, feePayer, signers), PROD_ORIGIN);
    const modules = qrModules(url);
    expect(modules).not.toBeNull();
    expect(modules).toBeLessThanOrEqual(VERSION_25_MODULES);
    expect(url.length).toBeLessThan(1100);
    expect(parseCosignFragment(new URL(url).hash)).not.toBeNull();
  });

  it('even the largest transaction the network takes (1232 bytes) still gives a QR code', () => {
    const url = cosignUrl(new Uint8Array(MAX_TRANSACTION_BYTES).fill(7), PROD_ORIGIN);
    const modules = qrModules(url);
    expect(modules).not.toBeNull();
    expect(modules).toBeLessThanOrEqual(177);
  });
});
