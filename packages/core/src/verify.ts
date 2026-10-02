import type { Address, ReadonlyUint8Array } from '@solana/kit';

/**
 * Checks after each wallet signature (CLAUDE.md section 6).
 *
 * Signing order: Phantom first if it takes part (on the still unsigned transaction), then the fee payer, then the
 * rest; each signer signs exactly the bytes the previous one returned. After every signature the message is compared
 * with the one that went in. The only difference allowed: the first signer appended Lighthouse instructions at the end
 * that add no signer. Anything else stops the flow with a clear error that offers to start signing with that wallet.
 * Before sending, every signature is verified against the final message.
 */

export type CompareOptions = {
  /** True for the first wallet to sign; only it may append a Lighthouse tail. */
  isFirstSigner: boolean;
};

export type CompareErrorCode =
  /** The wallet returned bytes that are not a transaction. */
  | 'malformed'
  /** Any change other than an appended Lighthouse tail (instructions, accounts, header, lifetime, fee payer...). */
  | 'message-changed'
  /** A Lighthouse tail appended by a wallet that was not the first to sign. */
  | 'tail-not-first-signer'
  /** The appended tail adds a signer (or makes an existing account a signer or writable). */
  | 'tail-adds-signer';

export type CompareError = { code: CompareErrorCode; message: string };

export type CompareResult =
  /** `lighthouseInstructions` is 0 when the message is byte-identical. */
  | { ok: true; lighthouseInstructions: number }
  | { ok: false; error: CompareError };

/**
 * Compares the message inside `signedTransactionBytes` (what the wallet returned) with `originalMessageBytes`
 * (the message the wallet was asked to sign).
 */
export function compareSignedMessage(
  originalMessageBytes: ReadonlyUint8Array,
  signedTransactionBytes: ReadonlyUint8Array,
  options: CompareOptions,
): CompareResult {
  return notImplemented(originalMessageBytes, signedTransactionBytes, options);
}

export type SignatureCheckError = {
  code: 'malformed' | 'missing-signatures' | 'invalid-signatures';
  /** The signers whose signature is missing or does not verify. */
  signers: readonly Address[];
  message: string;
};

export type SignatureCheck = { ok: true } | { ok: false; error: SignatureCheckError };

/** Verifies that every required signature is present and valid for the final message. Run before sending. */
export function verifyAllSignatures(transactionBytes: ReadonlyUint8Array): Promise<SignatureCheck> {
  return notImplemented(transactionBytes);
}

/** Placeholder body until this module is implemented; takes the parameters so they count as used. */
function notImplemented(..._args: unknown[]): never {
  throw new Error('not implemented');
}
