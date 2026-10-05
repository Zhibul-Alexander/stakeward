import {
  generateKeyPairSigner,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  type Address,
  type Blockhash,
} from '@solana/kit';
import { buildTransaction, parseCosignFragment, type TransactionAction } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { cosignUrl, transactionIdOf } from './link.ts';

const [main, second] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
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
