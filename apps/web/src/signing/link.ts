import { getSignatureFromTransaction, getTransactionDecoder, type ReadonlyUint8Array, type Signature } from '@solana/kit';
import { cosignFragment } from '@stakeward/core';

/**
 * The /cosign link for a partly signed transaction (CLAUDE.md section 6): the bytes travel in the URL fragment, which
 * never reaches the server. `origin` is this site's (window.location.origin).
 */
export function cosignUrl(bytes: ReadonlyUint8Array, origin: string): string {
  return new URL(`/cosign#${cosignFragment(bytes)}`, origin).href;
}

/** The transaction id: the fee payer's signature, once it signed; null when it has not or the bytes do not decode. */
export function transactionIdOf(bytes: ReadonlyUint8Array): Signature | null {
  try {
    return getSignatureFromTransaction(getTransactionDecoder().decode(bytes));
  } catch {
    return null;
  }
}
