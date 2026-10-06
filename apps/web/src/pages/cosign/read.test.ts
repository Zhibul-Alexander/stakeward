import {
  generateKeyPairSigner,
  getTransactionDecoder,
  type Address,
  type SignatureBytes,
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
import { craft, editMessage, instructionsOf, key } from '@stakeward/core/test/craft';
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

  it('bad, not rejected: a whole link cut off at any point, as a messenger or a copy may leave it', async () => {
    const bytes = await signed(buildTransaction(protect(), { feePayer: A.address, lifetime: nonceA }).bytes, [A]);
    const whole = `#${cosignFragment(bytes)}`;
    expect(await readLink(whole)).toMatchObject({ kind: 'ok' });
    // Every shorter text of the link: still base64url (or not), never a whole transaction, never "do not sign".
    for (let cut = 1; cut < whole.length; cut += 1) {
      expect(await readLink(whole.slice(0, cut)), `cut at ${String(cut)}`).toEqual({ kind: 'bad' });
    }
  });

  // Bytes that read as a whole transaction but were altered are not a cut: the inspector's reason, under Details, and
  // "do not sign". A crafted /cosign link (CLAUDE.md section 11) must never be told apart as merely broken.
  describe('rejected, not bad: a whole transaction with altered bytes', () => {
    const built = () => buildTransaction(protect(), { feePayer: A.address, lifetime: nonceA }).bytes;

    it('stake instruction data with one byte more', async () => {
      const instructions = instructionsOf(built());
      const tampered = instructions.map((ix, i) =>
        i === instructions.length - 1 ? { ...ix, data: Uint8Array.from([...(ix.data ?? []), 0]) } : ix,
      );
      const bytes = await signed(craft(tampered, A.address, NONCE_VALUE), [A]);
      expect(await readLink(`#${cosignFragment(bytes)}`)).toEqual({
        kind: 'rejected',
        error: { code: 'malformed', message: 'Instruction 4: instruction data is not canonically encoded' },
      });
    });

    it('one signature slot fewer than the message has signers', async () => {
      const { messageBytes } = getTransactionDecoder().decode(await signed(built(), [A]));
      const signatures: Record<Address, SignatureBytes | null> = { [A.address]: null };
      const bytes = new Uint8Array(getTransactionEncoder().encode({ messageBytes, signatures }));
      expect(await readLink(`#${cosignFragment(bytes)}`)).toMatchObject({ kind: 'rejected', error: { code: 'malformed' } });
    });

    it('an account listed twice', async () => {
      const bytes = editMessage(built(), (message) => {
        const last = message.staticAccounts.length - 1;
        return { ...message, staticAccounts: message.staticAccounts.map((a, i) => (i === last ? S : a)) };
      });
      expect(await readLink(`#${cosignFragment(bytes)}`)).toEqual({
        kind: 'rejected',
        error: { code: 'malformed', message: 'The message lists an account twice' },
      });
    });

    it('a byte after the end of the transaction', async () => {
      const bytes = Uint8Array.from([...(await signed(built(), [A])), 0]);
      expect(await readLink(`#${cosignFragment(bytes)}`)).toMatchObject({ kind: 'rejected', error: { code: 'malformed' } });
    });
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
