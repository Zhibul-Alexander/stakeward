import {
  decompileTransactionMessage,
  getCompiledTransactionMessageDecoder,
  getSolanaErrorFromTransactionError,
  getTransactionDecoder,
  isSolanaError,
  isTransactionMessageWithDurableNonceLifetime,
  SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED,
  SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
  SOLANA_ERROR__INSTRUCTION_ERROR__INSUFFICIENT_FUNDS,
  SOLANA_ERROR__INSTRUCTION_ERROR__MISSING_REQUIRED_SIGNATURE,
  SOLANA_ERROR__INVALID_NONCE,
  SOLANA_ERROR__JSON_RPC__INTERNAL_ERROR,
  SOLANA_ERROR__JSON_RPC__INVALID_PARAMS,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_TRANSACTION_SIGNATURE_VERIFICATION_FAILURE,
  SOLANA_ERROR__NONCE_ACCOUNT_NOT_FOUND,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  SOLANA_ERROR__TRANSACTION__FEE_PAYER_SIGNATURE_MISSING,
  SOLANA_ERROR__TRANSACTION__SIGNATURES_MISSING,
  SOLANA_ERROR__TRANSACTION_ERROR__ACCOUNT_NOT_FOUND,
  SOLANA_ERROR__TRANSACTION_ERROR__ALREADY_PROCESSED,
  SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND,
  SOLANA_ERROR__TRANSACTION_ERROR__INSUFFICIENT_FUNDS_FOR_FEE,
  SOLANA_ERROR__TRANSACTION_ERROR__INSUFFICIENT_FUNDS_FOR_RENT,
  SOLANA_ERROR__TRANSACTION_ERROR__MISSING_SIGNATURE_FOR_FEE,
  SOLANA_ERROR__TRANSACTION_ERROR__SIGNATURE_FAILURE,
  SOLANA_ERROR__TRANSACTION_ERROR__UNKNOWN,
  type Address,
  type ReadonlyUint8Array,
  type SolanaError,
} from '@solana/kit';
import {
  isStakeError,
  STAKE_ERROR__ALREADY_DEACTIVATED,
  STAKE_ERROR__CUSTODIAN_MISSING,
  STAKE_ERROR__CUSTODIAN_SIGNATURE_MISSING,
  STAKE_ERROR__INSUFFICIENT_DELEGATION,
  STAKE_ERROR__LOCKUP_IN_FORCE,
  STAKE_ERROR__MERGE_MISMATCH,
  STAKE_ERROR__TOO_SOON_TO_REDELEGATE,
} from '@solana-program/stake';
import {
  isSystemError,
  SYSTEM_ERROR__NONCE_BLOCKHASH_NOT_EXPIRED,
  SYSTEM_ERROR__NONCE_UNEXPECTED_BLOCKHASH_VALUE,
  SYSTEM_ERROR__RESULT_WITH_NEGATIVE_LAMPORTS,
} from '@solana-program/system';
import { LIGHTHOUSE_PROGRAM_ADDRESS } from './constants.ts';
import { formatUtcDate } from './format.ts';

/**
 * Error translation (CLAUDE.md section 9, UX rule 8): an error says what happened and what to do next; the raw text
 * goes under "Details". Program errors are translated, e.g. LockupInForce -> "Locked until <date>: your second key
 * must co-sign". Do not use `getStakeErrorMessage`: production bundles replace its text with a placeholder.
 */

/**
 * Every code `translateError` returns, in a fixed order. The site needs a text for each (en.json `errors.*`; a test
 * walks this list).
 */
export const ERROR_CODES = [
  /** Stake error 1: the lock is in force and the custodian did not sign (or a wrong key signed as custodian). */
  'lockup-in-force',
  /** Stake error 7: changing the withdrawer while locked, without a custodian. */
  'custodian-missing',
  /** Stake error 8: the custodian account is there but did not sign. */
  'custodian-signature-missing',
  /** Stake error 2: Deactivate on a stake that is already deactivated (the page showed an old state). */
  'already-deactivated',
  /** Stake error 3: delegating to another validator while the stake is still deactivating. */
  'too-soon-to-redelegate',
  /** Stake error 12: the stake is below the minimum delegation (1 SOL, DECISIONS.md D7). */
  'insufficient-delegation',
  /** Stake error 6: Merge, MoveStake or MoveLamports between accounts whose authorities or lockups differ. */
  'merge-mismatch',
  /**
   * MissingRequiredSignature, e.g. the main key tried to change a lock that is in force; also the worker refusing to
   * send a transaction with a signature missing.
   */
  'missing-signature',
  /**
   * A signature does not match the transaction: the worker's inspector or signature check refused it (JSON-RPC
   * -32003), or the network did (SignatureFailure).
   */
  'invalid-signature',
  /** InsufficientFunds: more than the free balance (stake still deactivating), or the fee payer has no SOL. */
  'insufficient-funds',
  /** BlockhashNotFound on a blockhash transaction: it expired; rebuild and sign again. */
  'blockhash-expired',
  /** BlockhashNotFound on a nonce transaction: the nonce moved on (the link was used or cancelled). */
  'nonce-advanced',
  /** The same transaction already landed. */
  'already-processed',
  /** The worker's inspector refused the bytes (JSON-RPC -32602 "Transaction rejected by inspector: <code>"). */
  'rejected-by-inspector',
  /** The user declined in the wallet. */
  'wallet-rejected',
  /** HTTP 429: the worker's per-IP rate limit (or any server) says too many requests. */
  'rate-limited',
  /** The RPC could not be reached, timed out, or answered 408 or 5xx (other HTTP statuses are `unknown`). */
  'network',
  'unknown',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Message prefixes of the worker's refusals on POST /api/rpc (apps/worker/src/rpc.ts), followed by the inspector's or
 * the signature check's code. The worker writes them, `translateError` reads them: kit keeps only the message of a
 * -32602 error.
 */
export const INSPECTOR_REFUSAL_PREFIX = 'Transaction rejected by inspector: ';
export const SIGNATURE_REFUSAL_PREFIX = 'Transaction rejected: ';

export type FriendlyError = {
  code: ErrorCode;
  /** One English sentence: what happened and what to do next. The site may map `code` to its i18n strings. */
  title: string;
  /** The original error text, for "Details". */
  detail: string;
};

export type TranslateContext = {
  /**
   * The transaction the error belongs to (wire bytes). It maps the failing instruction index to its program, so a
   * custom error code is read as a stake or System error (code 7 is CustodianMissing for the stake program but
   * NonceBlockhashNotExpired for System), and it tells a nonce transaction from a blockhash one. Without it a custom
   * code stays `unknown` and BlockhashNotFound reads as `blockhash-expired`.
   */
  transaction?: ReadonlyUint8Array;
  /** Lockup end of the account involved (unix seconds), for "Locked until <date>". */
  lockUntil?: bigint;
};

const TITLES = {
  'custodian-missing': 'This change needs your second key too: it must co-sign before you send.',
  'custodian-signature-missing': 'Your second key is part of this transaction but did not sign. Ask it to sign, then send again.',
  'already-deactivated': 'This stake is already deactivated. Refresh to see its current state.',
  'too-soon-to-redelegate': 'This stake is still deactivating. Delegate it again after the current epoch ends.',
  'insufficient-delegation': 'This stake holds less than the 1 SOL minimum the network allows to delegate.',
  'merge-mismatch': 'These stake accounts cannot be combined: their keys or locks differ.',
  'missing-signature':
    'A key that must sign did not, or it no longer controls this stake. Check the connected wallets and try again.',
  'blockhash-expired': 'This transaction expired before it reached the network. Sign it again.',
  'nonce-advanced': 'This signing link is no longer valid: it was used or cancelled. Start again to get a new one.',
  'invalid-signature': 'A signature does not match this transaction. Start signing again from the first wallet.',
  'already-processed': 'This transaction already went through. Refresh to see the current state.',
  'rejected-by-inspector':
    'Stakeward refused to send this transaction: it is not in the format Stakeward builds. Nothing was sent; start again.',
  'wallet-rejected': 'The request was declined in the wallet. Nothing was sent; you can try again.',
  'rate-limited': 'Too many requests. Wait a minute and try again.',
  network: 'The Solana network did not respond. Check your connection and try again.',
  unknown: 'Something went wrong. Refresh to see the current state, then try again.',
} as const;

const INSUFFICIENT_STAKE_BALANCE =
  'There is not enough free SOL in this stake. If it is still deactivating, wait until the epoch ends, then try again.';
const INSUFFICIENT_FEE_BALANCE =
  'The wallet paying the network fee does not have enough SOL. Add a little SOL to it and try again.';

type Translation = { code: ErrorCode; title: string };

/** Turns anything thrown or returned by RPC, LiteSVM or a wallet into a {@link FriendlyError}. Never throws. */
export function translateError(error: unknown, context: TranslateContext = {}): FriendlyError {
  let detail = '';
  try {
    detail = describe(error, 0);
  } catch {
    // An object whose getters or toString throw; keep the empty detail.
  }
  try {
    return { ...classify(error, new TransactionInfo(context.transaction), context, 0), detail };
  } catch {
    return { code: 'unknown', title: TITLES.unknown, detail };
  }
}

/** Nested errors (`cause`, a wallet adapter's `error`) are followed this deep. */
const MAX_DEPTH = 4;

function classify(error: unknown, transaction: TransactionInfo, context: TranslateContext, depth: number): Translation {
  if (isSolanaError(error)) {
    const own = classifySolanaError(error, transaction, context);
    if (own.code !== 'unknown') return own;
    const inner = nested(error, transaction, context, depth);
    return inner.code === 'unknown' ? own : inner;
  }
  const chainError = fromRawTransactionError(error);
  if (chainError !== null) return classifySolanaError(chainError, transaction, context);
  if (isWalletRejection(error)) return translation('wallet-rejected');
  if (isNetworkFailure(error)) return translation('network');
  return nested(error, transaction, context, depth);
}

function nested(error: unknown, transaction: TransactionInfo, context: TranslateContext, depth: number): Translation {
  if (depth >= MAX_DEPTH || typeof error !== 'object' || error === null) return translation('unknown');
  for (const key of ['cause', 'error'] as const) {
    if (!(key in error)) continue;
    const inner: unknown = (error as Record<string, unknown>)[key];
    if (inner === undefined || inner === null || inner === error) continue;
    const result = classify(inner, transaction, context, depth + 1);
    if (result.code !== 'unknown') return result;
  }
  return translation('unknown');
}

function classifySolanaError(error: SolanaError, transaction: TransactionInfo, context: TranslateContext): Translation {
  if (isSolanaError(error, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM)) return classifyCustom(error, transaction, context);
  switch (error.context.__code) {
    case SOLANA_ERROR__INSTRUCTION_ERROR__MISSING_REQUIRED_SIGNATURE:
    case SOLANA_ERROR__TRANSACTION__SIGNATURES_MISSING:
    case SOLANA_ERROR__TRANSACTION__FEE_PAYER_SIGNATURE_MISSING:
    case SOLANA_ERROR__TRANSACTION_ERROR__MISSING_SIGNATURE_FOR_FEE:
      return translation('missing-signature');
    case SOLANA_ERROR__INSTRUCTION_ERROR__INSUFFICIENT_FUNDS:
      return { code: 'insufficient-funds', title: INSUFFICIENT_STAKE_BALANCE };
    // AccountNotFound: the fee payer has never held SOL ("no record of a prior credit").
    case SOLANA_ERROR__TRANSACTION_ERROR__ACCOUNT_NOT_FOUND:
    case SOLANA_ERROR__TRANSACTION_ERROR__INSUFFICIENT_FUNDS_FOR_FEE:
    case SOLANA_ERROR__TRANSACTION_ERROR__INSUFFICIENT_FUNDS_FOR_RENT:
      return { code: 'insufficient-funds', title: INSUFFICIENT_FEE_BALANCE };
    case SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND:
      return translation(transaction.usesNonce() ? 'nonce-advanced' : 'blockhash-expired');
    // Kit's confirmation helpers: the blockhash ran out, or the nonce account no longer holds this value.
    case SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED:
      return translation('blockhash-expired');
    case SOLANA_ERROR__INVALID_NONCE:
    case SOLANA_ERROR__NONCE_ACCOUNT_NOT_FOUND:
      return translation('nonce-advanced');
    case SOLANA_ERROR__TRANSACTION_ERROR__ALREADY_PROCESSED:
      return translation('already-processed');
    case SOLANA_ERROR__TRANSACTION_ERROR__SIGNATURE_FAILURE:
      return translation('invalid-signature');
    case SOLANA_ERROR__JSON_RPC__SERVER_ERROR_TRANSACTION_SIGNATURE_VERIFICATION_FAILURE:
      return classifySignatureRefusal(error.context);
    case SOLANA_ERROR__JSON_RPC__INVALID_PARAMS: {
      // The worker's inspector refused the bytes; any other invalid parameter is our bug, not the user's.
      const message: unknown = error.context.__serverMessage;
      const refused = typeof message === 'string' && message.startsWith(INSPECTOR_REFUSAL_PREFIX);
      return translation(refused ? 'rejected-by-inspector' : 'unknown');
    }
    case SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR: {
      // Rate limits, timeouts and server errors; any other status (the proxy refused the request) is unknown.
      const status = error.context.statusCode;
      if (status === 429) return translation('rate-limited');
      return translation(status === 408 || status >= 500 ? 'network' : 'unknown');
    }
    case SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY:
    case SOLANA_ERROR__JSON_RPC__INTERNAL_ERROR:
      return translation('network');
    default:
      return translation('unknown');
  }
}

function classifyCustom(
  error: SolanaError<typeof SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM>,
  transaction: TransactionInfo,
  context: TranslateContext,
): Translation {
  const message = transaction.message();
  if (message !== null && isStakeError(error, message)) {
    switch (error.context.code) {
      case STAKE_ERROR__LOCKUP_IN_FORCE: {
        const date = context.lockUntil !== undefined && context.lockUntil > 0n ? formatUtcDate(context.lockUntil) : null;
        return {
          code: 'lockup-in-force',
          title:
            date === null
              ? 'This stake is locked: your second key must co-sign.'
              : `Locked until ${date}: your second key must co-sign.`,
        };
      }
      case STAKE_ERROR__CUSTODIAN_MISSING:
        return translation('custodian-missing');
      case STAKE_ERROR__CUSTODIAN_SIGNATURE_MISSING:
        return translation('custodian-signature-missing');
      case STAKE_ERROR__ALREADY_DEACTIVATED:
        return translation('already-deactivated');
      case STAKE_ERROR__TOO_SOON_TO_REDELEGATE:
        return translation('too-soon-to-redelegate');
      case STAKE_ERROR__INSUFFICIENT_DELEGATION:
        return translation('insufficient-delegation');
      case STAKE_ERROR__MERGE_MISMATCH:
        return translation('merge-mismatch');
      default:
        return {
          code: 'unknown',
          title: `The stake program refused this transaction (error ${String(error.context.code)}). Refresh and try again.`,
        };
    }
  }
  if (message !== null && isSystemError(error, message)) {
    switch (error.context.code) {
      case SYSTEM_ERROR__RESULT_WITH_NEGATIVE_LAMPORTS:
        return { code: 'insufficient-funds', title: INSUFFICIENT_FEE_BALANCE };
      case SYSTEM_ERROR__NONCE_UNEXPECTED_BLOCKHASH_VALUE:
        return translation('nonce-advanced');
      case SYSTEM_ERROR__NONCE_BLOCKHASH_NOT_EXPIRED:
        return { code: 'unknown', title: 'The nonce account was updated moments ago. Wait a few seconds and send again.' };
      default:
        return translation('unknown');
    }
  }
  if (transaction.programAt(error.context.index) === LIGHTHOUSE_PROGRAM_ADDRESS) {
    return {
      code: 'unknown',
      title: "The wallet's own safety check stopped this transaction. Refresh, then sign again.",
    };
  }
  return translation('unknown');
}

/**
 * JSON-RPC -32003. From the worker, `data` (kit's error context) says which check refused and why: the inspector
 * (`{ check: 'inspector', code: 'invalid-signature' }`) or the signature check before sending (`{ check: 'signatures',
 * code: 'missing-signatures' | 'invalid-signatures' | ... }`). From a node it is a bad signature.
 */
function classifySignatureRefusal(context: object): Translation {
  const { check, code } = context as { check?: unknown; code?: unknown };
  if (check === 'signatures' && code === 'missing-signatures') return translation('missing-signature');
  if (check === 'signatures' && code === 'malformed') return translation('rejected-by-inspector');
  if (code === 'verification-unavailable') return translation('unknown');
  return translation('invalid-signature');
}

function translation(code: keyof typeof TITLES): Translation {
  return { code, title: TITLES[code] };
}

/** Program addresses and lifetime of the transaction from the context, decoded once and only when needed. */
class TransactionInfo {
  private decoded: { instructions: readonly { programAddress: Address }[]; usesNonce: boolean } | null | undefined;
  private readonly bytes: ReadonlyUint8Array | undefined;

  constructor(bytes: ReadonlyUint8Array | undefined) {
    this.bytes = bytes;
  }

  /** The shape `isStakeError` / `isSystemError` read: the program of each instruction by index. */
  message(): { instructions: readonly { programAddress: Address }[] } | null {
    return this.decode();
  }

  programAt(index: number): Address | undefined {
    return this.decode()?.instructions[index]?.programAddress;
  }

  usesNonce(): boolean {
    return this.decode()?.usesNonce ?? false;
  }

  private decode() {
    if (this.decoded !== undefined) return this.decoded;
    this.decoded = null;
    if (this.bytes === undefined) return null;
    try {
      const { messageBytes } = getTransactionDecoder().decode(this.bytes);
      const message = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(messageBytes));
      this.decoded = {
        instructions: message.instructions,
        usesNonce: isTransactionMessageWithDurableNonceLifetime(message),
      };
    } catch {
      // Not a transaction we can read: errors are translated without it.
    }
    return this.decoded;
  }
}

/**
 * A TransactionError as RPC returns it (simulateTransaction / getSignatureStatuses `err`, numbers as bigint):
 * `'BlockhashNotFound'`, `{ InstructionError: [2n, { Custom: 1n }] }`, `{ InsufficientFundsForRent: {...} }`.
 * Null for anything that is not one of the runtime's error names.
 */
function fromRawTransactionError(value: unknown): SolanaError | null {
  if (typeof value !== 'string' && !(isPlainObject(value) && Object.keys(value).length === 1)) return null;
  try {
    const error = getSolanaErrorFromTransactionError(value);
    return isSolanaError(error, SOLANA_ERROR__TRANSACTION_ERROR__UNKNOWN) ? null : error;
  } catch {
    return null;
  }
}

/**
 * Wallet Standard leaves errors to each wallet. Phantom and wallets following EIP-1193 use code 4001 for "user
 * rejected"; others throw an Error whose message says so. Any other numeric code is a different wallet error
 * (e.g. Phantom -32003 "Transaction rejected" means the wallet refused the transaction, not the user). A TypeError is
 * never the user's decision: it is a failed fetch (WebKit reports a cancelled one as "TypeError: cancelled") or a bug.
 */
const REJECTION_MESSAGE = /\b(reject|denied|declin|cancel)/i;

function isWalletRejection(value: unknown): boolean {
  if (typeof value === 'string') return REJECTION_MESSAGE.test(value);
  if (typeof value !== 'object' || value === null) return false;
  const { code, message, name } = value as { code?: unknown; message?: unknown; name?: unknown };
  if (code === 4001 || code === '4001') return true;
  if (typeof code === 'number' || name === 'TypeError') return false;
  return typeof message === 'string' && REJECTION_MESSAGE.test(message);
}

/**
 * fetch() failures: Node/undici, Chrome, Firefox, Safari (including "cancelled" for a fetch the page cancelled),
 * React Native wording; aborts and timeouts.
 */
const FETCH_FAILURE_MESSAGE = /fetch failed|failed to fetch|networkerror|load failed|network request failed|^cancelled$/i;

function isNetworkFailure(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const { name, message } = value as { name?: unknown; message?: unknown };
  if (name === 'AbortError' || name === 'TimeoutError') return true;
  return name === 'TypeError' && typeof message === 'string' && FETCH_FAILURE_MESSAGE.test(message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * The original error as text for "Details": name and message, the plain values of a kit error's context, simulation
 * logs, and the chain of causes. The context matters in the built site: kit's production build replaces every
 * SolanaError message with "Solana error #<code>; Decode this error...", and the server's own words survive only in the
 * context (`__serverMessage`, the worker's refusal `code`/`message`, an HTTP `statusCode`).
 */
function describe(error: unknown, depth: number): string {
  if (error instanceof Error) {
    const lines = [`${error.name}: ${error.message}`];
    if (isSolanaError(error)) {
      const context = error.context as Record<string, unknown>;
      for (const [key, value] of Object.entries(context)) {
        if (key === '__code' || key === 'logs') continue;
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
          lines.push(`${key === '__serverMessage' ? 'Server message' : key}: ${String(value)}`);
        }
      }
      const logs = context['logs'];
      if (Array.isArray(logs)) lines.push(...logs.filter((line): line is string => typeof line === 'string').slice(-10));
    }
    if (error.cause !== undefined && depth < MAX_DEPTH) lines.push(`Caused by ${describe(error.cause, depth + 1)}`);
    return lines.join('\n');
  }
  if (typeof error === 'string') return error;
  try {
    const json = JSON.stringify(error, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value));
    if (typeof json === 'string') return json;
  } catch {
    // Circular or otherwise not serializable.
  }
  return String(error);
}
