import type { Address, Blockhash, Nonce, ReadonlyUint8Array } from '@solana/kit';
import type { TransactionAction } from './actions.ts';

/**
 * Transaction inspector: the security core (CLAUDE.md section 3). It reads a transaction only from its bytes and
 * says what it does. It runs on every signing screen (the summary is built from the bytes about to be signed, never
 * from app state), on /cosign (which trusts only bytes and the chain) and in the worker's RPC proxy
 * (sendTransaction / simulateTransaction pass only when the inspector accepts the bytes).
 *
 * It accepts exactly the format `buildTransaction` produces and nothing else:
 *   - a legacy message (no v0, no address lookup tables), canonically encoded (re-encoding gives the same bytes);
 *   - [System AdvanceNonceAccount]? [ComputeBudget SetComputeUnitLimit] [ComputeBudget SetComputeUnitPrice]
 *     then one action: one stake instruction over one stake account, the rescue pair (AuthorizeChecked Staker then
 *     Withdrawer on the same account), or the nonce setup pair (CreateAccountWithSeed + InitializeNonceAccount) or
 *     WithdrawNonceAccount;
 *   - Withdraw, AuthorizeChecked, Deactivate and DelegateStake only in the legacy account layout
 *     (`LEGACY_SYSVAR_SLOTS`), with the exact account count and roles the builder emits;
 *   - optionally, Lighthouse instructions (`LIGHTHOUSE_PROGRAM_ADDRESS`) at the very end that add no signer.
 * Anything else is rejected: another program, an unknown instruction (System transfer, stake Split, ...), two stake
 * instructions over different accounts, a Lighthouse instruction that is not at the end. Parse with the generated
 * clients (parseStakeInstruction etc.) after normalising the legacy layout; never decode instruction bytes by hand.
 */

/** Lifetime as the bytes show it. A blockhash transaction does not carry its last valid block height. */
export type InspectedLifetime =
  | { kind: 'blockhash'; blockhash: Blockhash }
  | { kind: 'nonce'; nonceAccount: Address; nonceAuthority: Address; nonceValue: Nonce };

/** Lighthouse assertions a wallet (Phantom) appended to the end of the message. */
export type LighthouseTail = {
  /** Number of trailing Lighthouse instructions. */
  instructionCount: number;
  /** Accounts only the tail references (read-only, never signers). */
  addedAccounts: readonly Address[];
};

export type TransactionSummary = {
  /** What the transaction does. For bytes from `buildTransaction(action)` this equals `action`. */
  action: TransactionAction;
  feePayer: Address;
  lifetime: InspectedLifetime;
  computeBudget: { unitLimit: number; microLamportsPerUnit: bigint };
  /** Upper bound of the network fee in lamports: 5000 per signature plus limit x price. Shown before signing. */
  networkFeeLamports: bigint;
  /** Every address that must sign, in message order (fee payer first). */
  requiredSigners: readonly Address[];
  /** Required signers whose signature is present and verifies against the message bytes. */
  presentSignatures: readonly Address[];
  lighthouseTail: LighthouseTail | null;
};

export type InspectErrorCode =
  /** Not a transaction, or not canonically encoded (trailing bytes, non-canonical option tags, ...). */
  | 'malformed'
  /** Not a legacy message. */
  | 'unsupported-version'
  /** The message uses address lookup tables. */
  | 'address-lookup-table'
  /** An instruction for a program other than stake, system (nonce), compute budget or a Lighthouse tail. */
  | 'unknown-program'
  /** A known program but an instruction Stakeward never builds (System transfer, stake Split, Merge, ...). */
  | 'unknown-instruction'
  /** Instruction order, account count, roles, sysvar positions or compute budget differ from the builder's format. */
  | 'bad-layout'
  /** More than one stake account, or two stake instructions that are not the rescue pair. */
  | 'multiple-stake-accounts'
  /** A Lighthouse instruction before a Stakeward instruction, or one that adds a signer. */
  | 'bad-lighthouse-tail'
  /** A signature is present but does not verify against the message. */
  | 'invalid-signature';

/** `message` is plain English for the "Details" section; the UI picks its own wording from `code`. */
export type InspectError = { code: InspectErrorCode; message: string };

export type InspectResult = { ok: true; summary: TransactionSummary } | { ok: false; error: InspectError };

/**
 * Inspects wire transaction bytes (signed, partly signed or unsigned). Never throws for bad input: every rejection is
 * an `InspectError`. Async because signatures are verified with Web Crypto and a nonce setup's account address is
 * re-derived from its seed.
 */
export function inspectTransaction(bytes: ReadonlyUint8Array): Promise<InspectResult> {
  return notImplemented(bytes);
}

/** Placeholder body until this module is implemented; takes the parameters so they count as used. */
function notImplemented(..._args: unknown[]): never {
  throw new Error('not implemented');
}
