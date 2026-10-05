import { getAddressDecoder, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { signingOrder } from './signing-order.ts';

const key = (n: number): Address => getAddressDecoder().decode(new Uint8Array(32).fill(n));
const A = key(1); // main key, fee payer of a protect
const K = key(2); // second key
const D = key(3); // new wallet, fee payer of a rescue

const noTail = () => false;
const tailFor =
  (...signers: Address[]) =>
  (signer: Address) =>
    signers.includes(signer);

describe('signingOrder (CLAUDE.md section 6)', () => {
  it('puts the fee payer first, then the rest in message order', () => {
    expect(signingOrder({ required: [A, K], present: [], feePayer: A, appendsTail: noTail })).toEqual([A, K]);
    expect(signingOrder({ required: [D, A, K], present: [], feePayer: D, appendsTail: noTail })).toEqual([D, A, K]);
  });

  it('puts the fee payer first even when the list does not start with it', () => {
    expect(signingOrder({ required: [K, A], present: [], feePayer: A, appendsTail: noTail })).toEqual([A, K]);
  });

  it('lets a wallet that appends a Lighthouse tail sign first while nothing is signed', () => {
    expect(signingOrder({ required: [A, K], present: [], feePayer: A, appendsTail: tailFor(K) })).toEqual([K, A]);
    expect(signingOrder({ required: [D, A, K], present: [], feePayer: D, appendsTail: tailFor(K) })).toEqual([K, D, A]);
  });

  it('never moves a tail wallet ahead once a signature is present', () => {
    expect(signingOrder({ required: [D, A, K], present: [D], feePayer: D, appendsTail: tailFor(K) })).toEqual([A, K]);
  });

  it('puts the fee payer first among several tail wallets, then message order', () => {
    expect(signingOrder({ required: [D, A, K], present: [], feePayer: D, appendsTail: tailFor(A, K, D) })).toEqual([
      D,
      A,
      K,
    ]);
    expect(signingOrder({ required: [D, A, K], present: [], feePayer: D, appendsTail: tailFor(K, A) })).toEqual([A, K, D]);
  });

  it('honours `first` ("Start again with this wallet signing first") before every other rule', () => {
    expect(signingOrder({ required: [A, K], present: [], feePayer: A, appendsTail: noTail, first: K })).toEqual([K, A]);
    expect(signingOrder({ required: [D, A, K], present: [], feePayer: D, appendsTail: tailFor(K), first: A })).toEqual([
      A,
      K,
      D,
    ]);
    expect(signingOrder({ required: [A, K], present: [], feePayer: A, appendsTail: noTail, first: null })).toEqual([A, K]);
  });

  it('ignores a `first` that is not missing', () => {
    expect(signingOrder({ required: [A, K], present: [], feePayer: A, appendsTail: noTail, first: D })).toEqual([A, K]);
    expect(signingOrder({ required: [A, K], present: [K], feePayer: A, appendsTail: noTail, first: K })).toEqual([A]);
  });

  it('drops signers already present', () => {
    expect(signingOrder({ required: [A, K], present: [A], feePayer: A, appendsTail: noTail })).toEqual([K]);
    expect(signingOrder({ required: [A, K], present: [A, K], feePayer: A, appendsTail: noTail })).toEqual([]);
  });

  it('never lists an address twice', () => {
    const order = signingOrder({ required: [A, K, A, K], present: [], feePayer: A, appendsTail: tailFor(A, K), first: A });
    expect(order).toEqual([A, K]);
  });
});
