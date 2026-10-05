import { getBase64Decoder, getBase64Encoder, type Address, type ReadonlyUint8Array } from '@solana/kit';
import { expectedFeePayer } from './actions.ts';
import type { TransactionSummary } from './inspect.ts';

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

/**
 * The only kinds Stakeward ever sends by link (DECISIONS.md D69). Extend and unlock have a single signer, and a link
 * that asks a second key to remove its lock would only serve a phisher.
 */
export const LINK_KINDS = ['protect', 'withdraw', 'rescue'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** Why a link is not one Stakeward makes; /cosign refuses it before reading the chain. */
export type CosignLinkProblem =
  /** Not protect, withdraw or rescue. */
  | 'not-linkable-kind'
  /** A blockhash transaction: it would expire within a minute. */
  | 'not-nonce'
  /** The nonce account belongs to someone other than the fee payer. */
  | 'nonce-not-fee-payer'
  /** Another wallet pays than the one the kind calls for (core `expectedFeePayer`). */
  | 'unexpected-fee-payer'
  /** The fee payer has not signed yet: Stakeward shows a link only after that. */
  | 'fee-payer-unsigned'
  /** A withdraw to a wallet other than the stake's main key. */
  | 'foreign-recipient'
  /** Every signature is already there. */
  | 'nothing-to-sign';

const LINKABLE: ReadonlySet<string> = new Set(LINK_KINDS);

/** Required signers without a present signature, in message order. */
export function missingSignatures(summary: TransactionSummary): Address[] {
  return summary.requiredSigners.filter((signer) => !summary.presentSignatures.includes(signer));
}

/**
 * The link-format rules (DECISIONS.md D69), on the inspector's summary of the link's bytes. /cosign runs them before
 * any chain read, and the first device runs them on its own partly signed bytes before it shows a link, so Stakeward
 * never shows a link that /cosign would refuse. The first failing rule wins; null means a link Stakeward makes:
 * 1. protect, withdraw or rescue;
 * 2. on a durable nonce;
 * 3. whose authority is the fee payer (the fee payer owns the nonce: a possibly stolen key never does, CLAUDE.md
 *    section 5);
 * 4. the fee payer is the one the kind calls for;
 * 5. and has signed (the transaction id is known before the link is shown);
 * 6. a withdraw goes to the stake's main key (F3.2);
 * 7. at least one signature is still missing.
 */
export function cosignLinkProblem(summary: TransactionSummary): CosignLinkProblem | null {
  const { action, lifetime, feePayer } = summary;
  if (!LINKABLE.has(action.kind)) return 'not-linkable-kind';
  if (lifetime.kind !== 'nonce') return 'not-nonce';
  if (lifetime.nonceAuthority !== feePayer) return 'nonce-not-fee-payer';
  if (feePayer !== expectedFeePayer(action)) return 'unexpected-fee-payer';
  if (!summary.presentSignatures.includes(feePayer)) return 'fee-payer-unsigned';
  if (action.kind === 'withdraw' && action.recipient !== action.mainKey) return 'foreign-recipient';
  if (missingSignatures(summary).length === 0) return 'nothing-to-sign';
  return null;
}
