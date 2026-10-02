import { getBase64Decoder, getBase64Encoder, type ReadonlyUint8Array } from '@solana/kit';

/**
 * Signing by link (CLAUDE.md section 6): a partially signed transaction travels in the URL fragment,
 * `/cosign#tx=<wire bytes in base64url>`. The fragment never reaches the server.
 */

/** Largest legacy or v0 wire transaction. */
export const MAX_TRANSACTION_BYTES = 1232;

/** Unpadded base64url (RFC 4648 section 5) of `bytes`. */
export function encodeBase64Url(bytes: ReadonlyUint8Array): string {
  return getBase64Decoder().decode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Strict inverse of {@link encodeBase64Url}: only the base64url alphabet, no padding, and the canonical encoding of
 * the result (so one byte string has exactly one link text). Returns null for anything else.
 */
export function decodeBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(getBase64Encoder().encode(padded));
  } catch {
    return null;
  }
  return encodeBase64Url(bytes) === text ? bytes : null;
}

/** The fragment (without `#`) for a /cosign link carrying `transaction`. */
export function cosignFragment(transaction: ReadonlyUint8Array): string {
  return `tx=${encodeBase64Url(transaction)}`;
}

/**
 * Reads the transaction bytes from a /cosign fragment (`#tx=...` or `tx=...`). Returns null when the fragment is
 * not exactly one `tx` parameter with valid base64url of 1 to {@link MAX_TRANSACTION_BYTES} bytes. The bytes are
 * untrusted: run them through the inspector before showing or signing anything.
 */
export function parseCosignFragment(fragment: string): Uint8Array | null {
  const body = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  if (!body.startsWith('tx=')) return null;
  const bytes = decodeBase64Url(body.slice('tx='.length));
  if (bytes === null || bytes.length === 0 || bytes.length > MAX_TRANSACTION_BYTES) return null;
  return bytes;
}
