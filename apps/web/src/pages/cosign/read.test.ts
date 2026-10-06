import {
  generateKeyPairSigner,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  type KeyPairSigner,
  type Nonce,
} from '@solana/kit';
import {
  buildTransaction,
  cosignFragment,
  deriveNonceAccountAddress,
  type NonceLifetime,
  type TransactionAction,
} from '@stakeward/core';
import { craft, instructionsOf, key } from '@stakeward/core/test/craft';
import { act, renderHook } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { readLink, useLocationHash } from './read.ts';

// readLink: the fragment alone decides whether /cosign may go on to the chain (step 7 spec 8.1).

const NONCE_VALUE = 'BZFufDqppShyDDC1njm4fMpRbfnLwrpzzwG6WGgcmsxb' as Nonce;
const S = key(11);

let A: KeyPairSigner;
let K: KeyPairSigner;
let nonceA: NonceLifetime;

beforeAll(async () => {
  [A, K] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
  nonceA = { kind: 'nonce', nonceAccount: await deriveNonceAccountAddress(A.address), nonceAuthority: A.address, nonceValue: NONCE_VALUE };
});

function protect(): TransactionAction {
  return { kind: 'protect', stakeAccount: S, mainKey: A.address, secondKey: K.address, lockUntil: 1_900_000_000n };
}

async function signed(bytes: Uint8Array, signers: readonly KeyPairSigner[]): Promise<Uint8Array> {
  const transaction = await partiallySignTransaction(
    signers.map((signer) => signer.keyPair),
    getTransactionDecoder().decode(bytes),
  );
  return new Uint8Array(getTransactionEncoder().encode(transaction));
}

describe('readLink', () => {
  it.each(['', '#', '#foo=x', '#tx=', '#tx=@@', 'tx=AAAA=', '#tx=AA&tx=AA'])('bad: %j', async (fragment) => {
    expect(await readLink(fragment)).toEqual({ kind: 'bad' });
  });

  it('rejected: bytes the inspector refuses (another program), with its code', async () => {
    const [advance, limit, price] = instructionsOf(buildTransaction(protect(), { feePayer: A.address, lifetime: nonceA }).bytes);
    if (advance === undefined || limit === undefined || price === undefined) throw new Error('no prefix');
    const foreign = { programAddress: key(9), accounts: [], data: Uint8Array.of(1) };
    const read = await readLink(`#${cosignFragment(craft([advance, limit, price, foreign], A.address, NONCE_VALUE))}`);
    expect(read).toMatchObject({ kind: 'rejected', error: { code: 'unknown-program' } });
  });

  it('bad: a valid link cut off by a messenger (the bytes still decode as base64url, not as a transaction)', async () => {
    const bytes = await signed(buildTransaction(protect(), { feePayer: A.address, lifetime: nonceA }).bytes, [A]);
    for (const keep of [bytes.length - 1, Math.floor(bytes.length / 2), 10]) {
      expect(await readLink(`#${cosignFragment(bytes.slice(0, keep))}`), String(keep)).toEqual({ kind: 'bad' });
    }
  });

  it('problem: a Stakeward transaction that is not a link Stakeward makes (the fee payer has not signed)', async () => {
    const { bytes } = buildTransaction(protect(), { feePayer: A.address, lifetime: nonceA });
    const read = await readLink(`#${cosignFragment(bytes)}`);
    expect(read).toMatchObject({ kind: 'problem', problem: 'fee-payer-unsigned', summary: { action: protect() } });
  });

  it('ok: the bytes and their summary, with or without the leading #', async () => {
    const bytes = await signed(buildTransaction(protect(), { feePayer: A.address, lifetime: nonceA }).bytes, [A]);
    for (const fragment of [`#${cosignFragment(bytes)}`, cosignFragment(bytes)]) {
      const read = await readLink(fragment);
      if (read.kind !== 'ok') throw new Error(`expected ok, got ${read.kind}`);
      expect(read.bytes).toEqual(bytes);
      expect(read.summary.action).toEqual(protect());
      expect(read.summary.presentSignatures).toEqual([A.address]);
    }
  });
});

describe('useLocationHash', () => {
  it('follows the page fragment', async () => {
    window.location.hash = '#tx=first';
    const { result } = renderHook(() => useLocationHash());
    expect(result.current).toBe('#tx=first');
    await act(async () => {
      window.location.hash = '#tx=second';
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(result.current).toBe('#tx=second');
    window.location.hash = '';
  });
});
