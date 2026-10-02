import {
  AccountRole,
  getCompiledTransactionMessageDecoder,
  getCompiledTransactionMessageEncoder,
  getPublicKeyFromAddress,
  getTransactionDecoder,
  getTransactionEncoder,
  isSignerRole,
  isWritableRole,
  verifySignature,
  type AccountMeta,
  type Address,
  type CompiledTransactionMessage,
  type CompiledTransactionMessageWithLifetime,
  type LegacyCompiledTransactionMessage,
  type ReadonlyUint8Array,
  type SignatureBytes,
  type Transaction,
} from '@solana/kit';
import { LIGHTHOUSE_PROGRAM_ADDRESS } from './constants.ts';
import type { StakeIx } from './legacy-layout.ts';
import { MAX_TRANSACTION_BYTES } from './link.ts';

/**
 * Checks after each wallet signature (CLAUDE.md section 6).
 *
 * Signing order: Phantom first if it takes part (on the still unsigned transaction), then the fee payer, then the
 * rest; each signer signs exactly the bytes the previous one returned. After every signature `checkSigningStep`
 * compares the transaction the wallet returned with the one that went in:
 *   - The message. The only difference allowed: the first signer appended Lighthouse instructions at the end that add
 *     no signer. "First signer" is read from the bytes, not trusted from the caller: the transaction that went in
 *     carried no signature yet. A tail changes the message, so after any signature it would void that signature (with a
 *     /cosign link, the wallet on the second device is the first on that device but not the first signer).
 *   - The signatures. Every signature that went in comes back byte-identical, and every signature the wallet added
 *     verifies against the returned message.
 * Anything else stops the flow with a clear error that offers to start signing with that wallet. Before sending,
 * `verifyAllSignatures` checks every required signature against the final message (it also catches a wallet that
 * returned without signing).
 *
 * The accepted Lighthouse tail, exactly (`compareMessages`): in a legacy message, appending instructions whose new
 * accounts are read-only non-signers appends those accounts at the END of the static accounts and raises only
 * `header.numReadonlyNonSignerAccounts`; every original account keeps its index and role, every original instruction
 * stays byte-identical, the lifetime stays the same. Every appended instruction calls Lighthouse, the Lighthouse program
 * is one of the appended accounts (or the program of a tail the original already ends with, never an account the
 * original uses otherwise), and every appended account is referenced by the tail. A wallet that recompiles the
 * message and reorders accounts is rejected.
 *
 * Signatures are verified with Ed25519 in Web Crypto. Where it is missing, the result says so
 * (`verification-unavailable`) instead of calling the signatures invalid.
 *
 * This module also holds the strict wire decoding the inspector shares (`decodeWireTransaction`,
 * `checkSignatures`, `compareMessages`).
 */

export type SigningStepErrorCode =
  /** The wallet returned bytes that are not a transaction (or the transaction that went in was not one). */
  | 'malformed'
  /** Any change other than an appended Lighthouse tail (instructions, accounts, header, lifetime, fee payer...). */
  | 'message-changed'
  /** A Lighthouse tail appended to a transaction that already carried a signature. */
  | 'tail-not-first-signer'
  /** The appended tail adds a signer (or makes an existing account a signer or writable). */
  | 'tail-adds-signer'
  /** A signature that was in the transaction before this wallet signed is gone or different. */
  | 'signature-changed'
  /** A signature the wallet added does not verify against the returned message (it signed other bytes). */
  | 'invalid-signature'
  /** This browser cannot verify Ed25519 signatures (no Ed25519 in Web Crypto). */
  | 'verification-unavailable';

export type SigningStepError = { code: SigningStepErrorCode; message: string };

export type SigningStepResult =
  /** `lighthouseInstructions` is 0 when the message is byte-identical. */
  | { ok: true; lighthouseInstructions: number }
  | { ok: false; error: SigningStepError };

/**
 * Checks one signing step: `sentBytes` is the wire transaction handed to the wallet, `returnedBytes` what the wallet
 * gave back (see the module comment for the rules). Never throws.
 */
export async function checkSigningStep(
  sentBytes: ReadonlyUint8Array,
  returnedBytes: ReadonlyUint8Array,
): Promise<SigningStepResult> {
  try {
    const sent = decodeWireTransaction(sentBytes);
    if (!sent.ok) return stepError('malformed', `The transaction given to the wallet is not valid: ${sent.message}`);
    const returned = decodeWireTransaction(returnedBytes);
    if (!returned.ok) {
      // A wallet that turned our legacy message into a versioned one changed it; anything else is not a transaction.
      return returned.code === 'malformed'
        ? stepError('malformed', `The wallet returned bytes that are not a valid transaction: ${returned.message}`)
        : stepError('message-changed', `The wallet changed the message: ${returned.message}`);
    }

    const comparison = compareMessages(sent.message, returned.message);
    switch (comparison.kind) {
      case 'identical':
        break;
      case 'lighthouse-tail':
        if (sent.signers.some((signer) => signatureIn(sent.transaction, signer) !== null)) {
          return stepError(
            'tail-not-first-signer',
            'The wallet appended Lighthouse instructions to a transaction that was already signed; only the first wallet to sign may do that',
          );
        }
        break;
      case 'tail-escalates':
        return stepError('tail-adds-signer', comparison.message);
      case 'changed':
        return stepError('message-changed', comparison.message);
    }

    // The message is the same or carries the accepted tail, so both list the same signers in the same order.
    const added: Address[] = [];
    for (const signer of returned.signers) {
      const before = signatureIn(sent.transaction, signer);
      const after = signatureIn(returned.transaction, signer);
      if (before === null) {
        if (after !== null) added.push(signer);
      } else if (after === null || !bytesEqual(before, after)) {
        return stepError('signature-changed', `The wallet removed or replaced the signature of ${signer}`);
      }
    }
    const statuses = await checkSignatures(returned.transaction, added);
    if (statuses.some((status) => status.status === 'unverifiable')) {
      return stepError('verification-unavailable', VERIFICATION_UNAVAILABLE);
    }
    const invalid = statuses.find((status) => status.status === 'invalid');
    if (invalid !== undefined) {
      return stepError('invalid-signature', `The signature the wallet added for ${invalid.signer} does not match the message`);
    }
    return { ok: true, lighthouseInstructions: comparison.kind === 'lighthouse-tail' ? comparison.instructionCount : 0 };
  } catch (error) {
    return stepError('malformed', `Unexpected error while checking the signature: ${describeError(error)}`);
  }
}

export type SignatureCheckError = {
  code: 'malformed' | 'missing-signatures' | 'invalid-signatures' | 'verification-unavailable';
  /** The signers whose signature is missing, does not verify, or cannot be verified here. */
  signers: readonly Address[];
  message: string;
};

export type SignatureCheck = { ok: true } | { ok: false; error: SignatureCheckError };

/**
 * Verifies that every required signature is present and valid for the final message. Run before sending.
 * A browser that cannot verify Ed25519 is reported first, then invalid signatures, then missing ones. Never throws.
 */
export async function verifyAllSignatures(transactionBytes: ReadonlyUint8Array): Promise<SignatureCheck> {
  try {
    const decoded = decodeWireTransaction(transactionBytes);
    if (!decoded.ok) {
      return { ok: false, error: { code: 'malformed', signers: [], message: decoded.message } };
    }
    const statuses = await checkSignatures(decoded.transaction, decoded.signers);
    const unverifiable = statuses.filter((s) => s.status === 'unverifiable').map((s) => s.signer);
    if (unverifiable.length > 0) {
      return { ok: false, error: { code: 'verification-unavailable', signers: unverifiable, message: VERIFICATION_UNAVAILABLE } };
    }
    const invalid = statuses.filter((s) => s.status === 'invalid').map((s) => s.signer);
    if (invalid.length > 0) {
      return {
        ok: false,
        error: { code: 'invalid-signatures', signers: invalid, message: `Invalid signature from ${invalid.join(', ')}` },
      };
    }
    const missing = statuses.filter((s) => s.status === 'missing').map((s) => s.signer);
    if (missing.length > 0) {
      return {
        ok: false,
        error: { code: 'missing-signatures', signers: missing, message: `Missing signature from ${missing.join(', ')}` },
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: { code: 'malformed', signers: [], message: `Unexpected error while verifying: ${describeError(error)}` },
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Strict wire decoding, shared with the inspector.

/** A legacy compiled message that passed the structural checks of `decodeLegacyMessage`. */
export type LegacyMessage = LegacyCompiledTransactionMessage & CompiledTransactionMessageWithLifetime;

export type WireDecodeErrorCode = 'malformed' | 'unsupported-version' | 'address-lookup-table';

export type DecodedTransaction = {
  ok: true;
  transaction: Transaction;
  message: LegacyMessage;
  /** Required signers in message order: the first `header.numSignerAccounts` static accounts, fee payer first. */
  signers: readonly Address[];
};

export type WireDecodeResult = DecodedTransaction | { ok: false; code: WireDecodeErrorCode; message: string };

export type MessageDecodeResult =
  | { ok: true; message: LegacyMessage }
  | { ok: false; code: WireDecodeErrorCode; message: string };

/**
 * Decodes wire transaction bytes strictly. Accepts only a canonically encoded legacy transaction of at most
 * `MAX_TRANSACTION_BYTES`: re-encoding the transaction and its message must give the same bytes (kit's decoders
 * accept trailing bytes and fold them into the message). The message must be structurally sound (see
 * `decodeLegacyMessage`) and carry exactly one signature slot per required signer. Never throws.
 */
export function decodeWireTransaction(bytes: ReadonlyUint8Array): WireDecodeResult {
  if (bytes.length === 0) return { ok: false, code: 'malformed', message: 'No transaction bytes' };
  if (bytes.length > MAX_TRANSACTION_BYTES) {
    return { ok: false, code: 'malformed', message: `Longer than ${String(MAX_TRANSACTION_BYTES)} bytes` };
  }
  let transaction: Transaction;
  try {
    transaction = getTransactionDecoder().decode(bytes);
  } catch (error) {
    return { ok: false, code: 'malformed', message: `Not a transaction: ${describeError(error)}` };
  }
  const decoded = decodeLegacyMessage(transaction.messageBytes);
  if (!decoded.ok) return decoded;
  if (!bytesEqual(getTransactionEncoder().encode(transaction), bytes)) {
    return { ok: false, code: 'malformed', message: 'The transaction is not canonically encoded' };
  }
  const { message } = decoded;
  const signers = message.staticAccounts.slice(0, message.header.numSignerAccounts);
  const slots = Object.keys(transaction.signatures);
  if (slots.length !== signers.length || slots.some((slot, i) => slot !== signers[i])) {
    return { ok: false, code: 'malformed', message: 'Signature slots do not match the required signers' };
  }
  return { ok: true, transaction, message, signers };
}

/**
 * Decodes compiled message bytes strictly: legacy only (a v0 message with address lookup tables is reported as such),
 * canonical encoding, a sound header (at least one signer, a writable fee payer, counts within the account list),
 * no duplicate static accounts and every instruction index within the account list. Never throws.
 */
export function decodeLegacyMessage(messageBytes: ReadonlyUint8Array): MessageDecodeResult {
  let compiled: CompiledTransactionMessage & CompiledTransactionMessageWithLifetime;
  try {
    compiled = getCompiledTransactionMessageDecoder().decode(messageBytes);
  } catch (error) {
    return { ok: false, code: 'malformed', message: `Not a transaction message: ${describeError(error)}` };
  }
  if (compiled.version !== 'legacy') {
    if (compiled.version === 0 && (compiled.addressTableLookups?.length ?? 0) > 0) {
      return { ok: false, code: 'address-lookup-table', message: 'The message uses address lookup tables' };
    }
    return { ok: false, code: 'unsupported-version', message: `Message version ${String(compiled.version)} is not legacy` };
  }
  let reencoded: ReadonlyUint8Array;
  try {
    reencoded = getCompiledTransactionMessageEncoder().encode(compiled);
  } catch (error) {
    return { ok: false, code: 'malformed', message: `The message cannot be re-encoded: ${describeError(error)}` };
  }
  if (!bytesEqual(reencoded, messageBytes)) {
    return { ok: false, code: 'malformed', message: 'The message is not canonically encoded (trailing or altered bytes)' };
  }
  const { header, staticAccounts, instructions } = compiled;
  const count = staticAccounts.length;
  if (
    header.numSignerAccounts < 1 ||
    header.numReadonlySignerAccounts >= header.numSignerAccounts ||
    header.numSignerAccounts + header.numReadonlyNonSignerAccounts > count
  ) {
    return { ok: false, code: 'malformed', message: 'The message header does not fit its account list' };
  }
  if (new Set(staticAccounts).size !== count) {
    return { ok: false, code: 'malformed', message: 'The message lists an account twice' };
  }
  const inRange = (index: number) => index < count;
  if (!instructions.every((ix) => inRange(ix.programAddressIndex) && (ix.accountIndices ?? []).every(inRange))) {
    return { ok: false, code: 'malformed', message: 'An instruction refers to an account outside the message' };
  }
  return { ok: true, message: compiled };
}

/** Role of static account `index` as the header defines it (signers first, writable before read-only). */
export function accountRoleAt(message: LegacyMessage, index: number): AccountRole {
  const { numSignerAccounts, numReadonlySignerAccounts, numReadonlyNonSignerAccounts } = message.header;
  if (index < numSignerAccounts) {
    return index < numSignerAccounts - numReadonlySignerAccounts ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER;
  }
  return index < message.staticAccounts.length - numReadonlyNonSignerAccounts ? AccountRole.WRITABLE : AccountRole.READONLY;
}

/** Every static account with its role. */
export function accountRoles(message: LegacyMessage): Map<Address, AccountRole> {
  return new Map(message.staticAccounts.map((address, index) => [address, accountRoleAt(message, index)]));
}

/**
 * The instructions of a checked message with addresses and roles resolved. Unlike kit's decompiler this always sets
 * `accounts` and `data` (possibly empty), and it relies on `decodeLegacyMessage` having checked every index.
 */
export function resolveInstructions(message: LegacyMessage): StakeIx[] {
  const metas: AccountMeta[] = message.staticAccounts.map((address, index) => ({
    address,
    role: accountRoleAt(message, index),
  }));
  const at = (index: number): AccountMeta => {
    const meta = metas[index];
    if (meta === undefined) throw new Error(`Account index ${String(index)} out of range`);
    return meta;
  };
  return message.instructions.map((ix) => ({
    programAddress: at(ix.programAddressIndex).address,
    accounts: (ix.accountIndices ?? []).map(at),
    data: ix.data ?? new Uint8Array(),
  }));
}

export type SignatureStatus = { signer: Address; status: 'missing' | 'valid' | 'invalid' | 'unverifiable' };

/**
 * Status of every required signature: an all-zero slot is missing (not signed yet); a present signature must verify
 * against the message bytes with the signer's Ed25519 public key. `unverifiable`: Web Crypto could not run the check
 * (no Ed25519 in this browser); that says nothing about the signature.
 */
export async function checkSignatures(
  transaction: Transaction,
  signers: readonly Address[],
): Promise<SignatureStatus[]> {
  return Promise.all(
    signers.map(async (signer): Promise<SignatureStatus> => {
      const signature = signatureIn(transaction, signer);
      if (signature === null) return { signer, status: 'missing' };
      return { signer, status: await verifyOne(signer, signature, transaction.messageBytes) };
    }),
  );
}

const VERIFICATION_UNAVAILABLE =
  'This browser cannot check Ed25519 signatures (Web Crypto has no Ed25519). Update the browser or use another one.';

async function verifyOne(
  signer: Address,
  signature: SignatureBytes,
  messageBytes: ReadonlyUint8Array,
): Promise<'valid' | 'invalid' | 'unverifiable'> {
  try {
    return (await verifySignature(await getPublicKeyFromAddress(signer), signature, messageBytes)) ? 'valid' : 'invalid';
  } catch (error) {
    // DataError: Web Crypto refuses the bytes as an Ed25519 public key, so nothing can sign for this address.
    // Anything else (NotSupportedError, no crypto.subtle) means the check cannot run here.
    return errorName(error) === 'DataError' ? 'invalid' : 'unverifiable';
  }
}

/** The signature in `signer`'s slot, or null when the slot is empty (all zeros on the wire) or absent. */
function signatureIn(transaction: Transaction, signer: Address): SignatureBytes | null {
  return transaction.signatures[signer] ?? null;
}

function errorName(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'name' in error ? error.name : undefined;
}

export type MessageComparison =
  | { kind: 'identical' }
  /** The accepted tail: Lighthouse instructions and read-only non-signer accounts appended at the end. */
  | { kind: 'lighthouse-tail'; instructionCount: number; addedAccounts: readonly Address[] }
  /** Lighthouse instructions appended, but they add a signer or make an account a signer or writable. */
  | { kind: 'tail-escalates'; message: string }
  /**
   * Any other change. `tail` is true when the original instructions are intact and only Lighthouse instructions were
   * appended, but the account layout is not the accepted one.
   */
  | { kind: 'changed'; tail: boolean; message: string };

/**
 * Compares two checked legacy messages: `candidate` must equal `original` or be `original` with the accepted
 * Lighthouse tail (see the module comment).
 */
export function compareMessages(original: LegacyMessage, candidate: LegacyMessage): MessageComparison {
  const encoder = getCompiledTransactionMessageEncoder();
  if (bytesEqual(encoder.encode(original), encoder.encode(candidate))) return { kind: 'identical' };
  const changed = (message: string, tail = false): MessageComparison => ({ kind: 'changed', tail, message });

  if (candidate.lifetimeToken !== original.lifetimeToken) return changed('The blockhash or nonce changed');
  if (candidate.staticAccounts[0] !== original.staticAccounts[0]) return changed('The fee payer changed');
  const before = resolveInstructions(original);
  const after = resolveInstructions(candidate);
  for (const [index, ix] of before.entries()) {
    const other = after[index];
    if (other === undefined) return changed('Instructions were removed');
    if (!sameInstruction(ix, other)) {
      return changed(`Instruction ${String(index + 1)} was changed or a new instruction was inserted before it`);
    }
  }
  if (after.length === before.length) return changed('The account list or the message header changed');
  const tail = after.slice(before.length);
  if (tail.some((ix) => ix.programAddress !== LIGHTHOUSE_PROGRAM_ADDRESS)) {
    return changed('An appended instruction is not a Lighthouse assertion');
  }

  // Privileges: no new signer, no new writable account, no existing account gaining either.
  const was = accountRoles(original);
  for (const [address, role] of accountRoles(candidate)) {
    const previous = was.get(address) ?? AccountRole.READONLY;
    if ((isSignerRole(role) && !isSignerRole(previous)) || (isWritableRole(role) && !isWritableRole(previous))) {
      return {
        kind: 'tail-escalates',
        message: `The appended instructions make ${address} a ${isSignerRole(role) ? 'signer' : 'writable account'}`,
      };
    }
  }

  // Exact layout: original accounts keep their positions, new read-only accounts come last.
  const originalCount = original.staticAccounts.length;
  if (original.staticAccounts.some((address, index) => candidate.staticAccounts[index] !== address)) {
    return changed('The account list was reordered', true);
  }
  const added = candidate.staticAccounts.slice(originalCount);
  const { header } = candidate;
  if (
    header.numSignerAccounts !== original.header.numSignerAccounts ||
    header.numReadonlySignerAccounts !== original.header.numReadonlySignerAccounts ||
    header.numReadonlyNonSignerAccounts !== original.header.numReadonlyNonSignerAccounts + added.length
  ) {
    return changed('The message header changed beyond the appended read-only accounts', true);
  }
  // The Lighthouse program is an account the tail appended, or the program of a tail the original already ends with.
  // Never an account the original uses otherwise (fee payer, signer, recipient...): no real tail does that, and with
  // the fee payer the runtime refuses the message.
  const earlierTail = before.some((ix) => ix.programAddress === LIGHTHOUSE_PROGRAM_ADDRESS);
  if (!earlierTail && !added.includes(LIGHTHOUSE_PROGRAM_ADDRESS)) {
    return changed('The appended instructions call a Lighthouse account the original message already lists', true);
  }
  const referenced = new Set(tail.flatMap((ix) => [ix.programAddress, ...ix.accounts.map((meta) => meta.address)]));
  const unused = added.find((address) => !referenced.has(address));
  if (unused !== undefined) return changed(`Account ${unused} was added but no appended instruction uses it`, true);
  return { kind: 'lighthouse-tail', instructionCount: tail.length, addedAccounts: added };
}

function sameInstruction(a: StakeIx, b: StakeIx): boolean {
  return (
    a.programAddress === b.programAddress &&
    a.accounts.length === b.accounts.length &&
    a.accounts.every((meta, index) => meta.address === b.accounts[index]?.address) &&
    bytesEqual(a.data, b.data)
  );
}

function bytesEqual(a: ReadonlyUint8Array, b: ReadonlyUint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stepError(code: SigningStepErrorCode, message: string): SigningStepResult {
  return { ok: false, error: { code, message } };
}
