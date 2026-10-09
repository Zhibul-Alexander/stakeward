// Review (step 3, HttpChain.send retries): the browser resends the same bytes when the worker's answer never arrived.
// For a blockhash transaction that already landed the cluster answers AlreadyProcessed, which send() maps to success.
// For a durable-nonce transaction it does not: landing advanced the nonce, so the resend fails its age check first and
// preflight answers BlockhashNotFound (the status cache is consulted only after the age check). send() then rejects,
// and translateError calls a transaction that went through "nonce-advanced" ("This signing link is no longer valid").
import {
  generateKeyPairSigner,
  getAddressDecoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  type Address,
  type Nonce,
} from '@solana/kit';
import { buildTransaction, translateError } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { HttpChain } from './http-chain.ts';

const key = (n: number): Address => getAddressDecoder().decode(new Uint8Array(32).fill(n));

describe('review: HttpChain.send resend of a durable-nonce transaction', () => {
  it('resolves with the signature when the first attempt landed but its answer was lost', async () => {
    const [A, K, D] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner(), generateKeyPairSigner()]);
    const built = buildTransaction(
      { kind: 'rescue', stakeAccount: key(9), mainKey: A.address, secondKey: K.address, newWallet: D.address },
      {
        feePayer: D.address,
        lifetime: { kind: 'nonce', nonceAccount: key(7), nonceAuthority: D.address, nonceValue: key(8) as string as Nonce },
      },
    );
    const transaction = await partiallySignTransaction([A.keyPair, K.keyPair, D.keyPair], getTransactionDecoder().decode(built.bytes));
    const signed = new Uint8Array(getTransactionEncoder().encode(transaction));
    const signature = getSignatureFromTransaction(transaction);

    // The cluster's view: the first attempt landed (status known), the resend fails preflight with BlockhashNotFound.
    let sends = 0;
    const fetch: typeof globalThis.fetch = (_input, init) => {
      const { method } = JSON.parse(init?.body as string) as { method: string };
      if (method === 'sendTransaction') {
        sends += 1;
        if (sends === 1) return Promise.reject(new TypeError('Failed to fetch')); // reached the cluster, answer lost
        return Promise.resolve(
          new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              error: {
                code: -32002,
                message: 'Transaction simulation failed: Blockhash not found',
                data: { err: 'BlockhashNotFound', logs: [], accounts: null, unitsConsumed: 0 },
              },
            }),
          ),
        );
      }
      // getSignatureStatuses: the transaction is in.
      return Promise.resolve(
        new Response(
          `{"jsonrpc":"2.0","id":3,"result":{"context":{"slot":5},"value":[{"slot":4,"confirmations":null,"err":null,"confirmationStatus":"confirmed"}]}}`,
        ),
      );
    };
    const chain = new HttpChain({ fetch, sleep: () => Promise.resolve() });

    const outcome = await chain.send(signed).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, code: translateError(error, { transaction: signed }).code }),
    );
    expect(sends).toBe(2);
    expect(outcome).toEqual({ ok: true, value: signature });
  });
});
