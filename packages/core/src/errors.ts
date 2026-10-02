import type { ReadonlyUint8Array } from '@solana/kit';

/**
 * Error translation (CLAUDE.md section 9, UX rule 8): an error says what happened and what to do next; the raw text
 * goes under "Details". Program errors are translated, e.g. LockupInForce -> "Locked until <date>: your second key
 * must co-sign". Do not use `getStakeErrorMessage`: production bundles replace its text with a placeholder.
 */

export type ErrorCode =
  /** Stake error 1: the lock is in force and the custodian did not sign (or a wrong key signed as custodian). */
  | 'lockup-in-force'
  /** Stake error 7: changing the withdrawer while locked, without a custodian. */
  | 'custodian-missing'
  /** Stake error 8: the custodian account is there but did not sign. */
  | 'custodian-signature-missing'
  /** MissingRequiredSignature, e.g. the main key tried to change a lock that is in force. */
  | 'missing-signature'
  /** InsufficientFunds: more than the free balance (stake still deactivating), or the fee payer has no SOL. */
  | 'insufficient-funds'
  /** BlockhashNotFound on a blockhash transaction: it expired; rebuild and sign again. */
  | 'blockhash-expired'
  /** BlockhashNotFound on a nonce transaction: the nonce moved on (the link was used or cancelled). */
  | 'nonce-advanced'
  /** The same transaction already landed. */
  | 'already-processed'
  /** The user declined in the wallet. */
  | 'wallet-rejected'
  /** The RPC could not be reached or timed out. */
  | 'network'
  | 'unknown';

export type FriendlyError = {
  code: ErrorCode;
  /** One English sentence: what happened and what to do next. The site may map `code` to its i18n strings. */
  title: string;
  /** The original error text, for "Details". */
  detail: string;
};

export type TranslateContext = {
  /** The transaction the error belongs to; maps an instruction index to its program (stake vs system errors). */
  transaction?: ReadonlyUint8Array;
  /** Lockup end of the account involved (unix seconds), for "Locked until <date>". */
  lockUntil?: bigint;
};

/** Turns anything thrown or returned by RPC, LiteSVM or a wallet into a {@link FriendlyError}. Never throws. */
export function translateError(error: unknown, context: TranslateContext): FriendlyError {
  return notImplemented(error, context);
}

/** Placeholder body until this module is implemented; takes the parameters so they count as used. */
function notImplemented(..._args: unknown[]): never {
  throw new Error('not implemented');
}
