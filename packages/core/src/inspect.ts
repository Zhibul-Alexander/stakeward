import {
  AccountRole,
  createAddressWithSeed,
  isSome,
  mergeRoles,
  type Address,
  type Blockhash,
  type Nonce,
  type Option,
  type ReadonlyUint8Array,
} from '@solana/kit';
import {
  ComputeBudgetInstruction,
  getSetComputeUnitLimitInstructionDataEncoder,
  getSetComputeUnitPriceInstructionDataEncoder,
  identifyComputeBudgetInstruction,
  parseComputeBudgetInstruction,
} from '@solana-program/compute-budget';
import {
  getAuthorizeCheckedInstructionDataEncoder,
  getDeactivateInstructionDataEncoder,
  getDelegateStakeInstructionDataEncoder,
  getSetLockupCheckedInstructionDataEncoder,
  getSetLockupInstructionDataEncoder,
  getWithdrawInstructionDataEncoder,
  identifyStakeInstruction,
  parseStakeInstruction,
  StakeAuthorize,
  StakeInstruction,
} from '@solana-program/stake';
import {
  getAdvanceNonceAccountInstructionDataEncoder,
  getCreateAccountWithSeedInstructionDataEncoder,
  getInitializeNonceAccountInstructionDataEncoder,
  getWithdrawNonceAccountInstructionDataEncoder,
  identifySystemInstruction,
  parseSystemInstruction,
  SystemInstruction,
} from '@solana-program/system';
import type { Lifetime, TransactionAction } from './actions.ts';
import { compileActionMessage } from './builders.ts';
import {
  COMPUTE_BUDGET_PROGRAM_ADDRESS,
  COMPUTE_UNIT_LIMIT,
  COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
  LIGHTHOUSE_PROGRAM_ADDRESS,
  NONCE_ACCOUNT_SIZE,
  STAKE_PROGRAM_ADDRESS,
  SYSTEM_PROGRAM_ADDRESS,
  SYSVAR_RECENT_BLOCKHASHES_ADDRESS,
  SYSVAR_RENT_ADDRESS,
} from './constants.ts';
import { LEGACY_SYSVAR_SLOTS, type LegacySysvarSlot, type StakeIx } from './legacy-layout.ts';
import {
  accountRoleAt,
  checkSignatures,
  compareMessages,
  decodeWireTransaction,
  isSameMessage,
  resolveInstructions,
  signatureCheckOf,
  type LegacyMessage,
  type SignatureCheck,
  type SignatureStatus,
} from './verify.ts';

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
 *
 * How (in order; the first failing check decides the error code):
 *   1. Strict decoding (`decodeWireTransaction`): canonical bytes, legacy only, sound header, unique accounts, one
 *      signature slot per required signer.
 *   2. Every instruction calls stake, system, compute budget or Lighthouse; Lighthouse only as a trailing tail.
 *   3. Each instruction before the tail: identify, check the exact account count, check and strip the legacy sysvars,
 *      parse with the generated client, re-encode the parsed data and compare it with the raw data.
 *   4. Sequence and values: [AdvanceNonce]? [CU limit = COMPUTE_UNIT_LIMIT] [CU price = COMPUTE_UNIT_PRICE...] action.
 *   5. The action: only parameter combinations Stakeward builds (see `TransactionAction`).
 *   6. Roles: every account's signer and writable flags equal what the builder's instructions require (merged per
 *      address, fee payer writable signer); accounts only the tail uses are read-only non-signers.
 *   7. Backstop: `buildTransaction(summary.action, { feePayer, lifetime })` must compile to the same message, apart
 *      from the accepted Lighthouse tail (`compareMessages`). So the inspector accepts nothing the builder would not
 *      build, including the builder's own input checks (distinct keys, positive amounts, lockup end at most
 *      `MAX_LOCKUP_END`, the one nonce seed, a rescue paid by the new wallet and never on another key's nonce).
 *      The builder's compiled message is compared field by field (`compileActionMessage`, `isSameMessage`), which is
 *      the same as comparing the encoded bytes but skips encoding (CPU budget of the worker, DECISIONS.md D23).
 *   8. Every present signature verifies against the message bytes (`verification-unavailable` when this browser
 *      cannot run Ed25519, never `invalid-signature`).
 *
 * Decisions: the compute budget must be exactly the fixed limit and price (a different price could drain the fee
 * payer; a different limit is not our format). A Lighthouse tail may reference existing accounts with their roles
 * unchanged, but every account it adds is a read-only non-signer (Lighthouse assertions only read), and the Lighthouse
 * program itself is one of the added accounts. Apart from the rescue, the fee payer is reported, not enforced: the
 * builder accepts any fee payer (F5 lets the main key pay for the second key); the screens compare it with
 * `expectedFeePayer`.
 *
 * The summary is context-free: it says what the bytes do, not whether that makes sense for the account on chain.
 * The screens compare it with the chain: "protect" signed by the current custodian is a hand-over of the second key
 * (F7), an "extend" whose end is not later than the current one shortens or ends the lock, recipients and new keys are
 * shown in full. Unsigned and partly signed bytes pass; the RPC proxy runs `verifyAllSignatures` before
 * sendTransaction.
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
  | 'invalid-signature'
  /** Signatures are present but this browser cannot verify Ed25519 signatures. */
  | 'verification-unavailable';

/** `message` is plain English for the "Details" section; the UI picks its own wording from `code`. */
export type InspectError = { code: InspectErrorCode; message: string };

export type InspectResult = { ok: true; summary: TransactionSummary } | { ok: false; error: InspectError };

/** Network fee per signature, in lamports. */
export const LAMPORTS_PER_SIGNATURE = 5_000n;

/**
 * Inspects wire transaction bytes (signed, partly signed or unsigned). Never throws for bad input: every rejection is
 * an `InspectError`. Async because signatures are verified with Web Crypto and a nonce setup's account address is
 * re-derived from its seed.
 */
export async function inspectTransaction(bytes: ReadonlyUint8Array): Promise<InspectResult> {
  const result = await inspectWithStatuses(bytes);
  return result.ok ? { ok: true, summary: result.summary } : result;
}

/**
 * Both checks the RPC proxy runs before sending: the inspector's result and, when it accepted the bytes, the result of
 * `verifyAllSignatures`.
 */
export type InspectAndVerifyResult =
  | { ok: true; summary: TransactionSummary; signatures: SignatureCheck }
  | { ok: false; error: InspectError };

/**
 * `inspectTransaction` and `verifyAllSignatures` in one pass, for the worker's sendTransaction path: the bytes are
 * decoded once and every signature is verified once (the inspector already verifies every present signature).
 * `summary` and `error` are exactly what `inspectTransaction` returns, `signatures` exactly what `verifyAllSignatures`
 * returns; neither check is skipped. Never throws.
 */
export async function inspectAndVerifyTransaction(bytes: ReadonlyUint8Array): Promise<InspectAndVerifyResult> {
  const result = await inspectWithStatuses(bytes);
  if (!result.ok) return result;
  return { ok: true, summary: result.summary, signatures: signatureCheckOf(result.statuses) };
}

type Inspected =
  | { ok: true; summary: TransactionSummary; statuses: readonly SignatureStatus[] }
  | { ok: false; error: InspectError };

async function inspectWithStatuses(bytes: ReadonlyUint8Array): Promise<Inspected> {
  try {
    return { ok: true, ...(await inspect(bytes)) };
  } catch (error) {
    if (error instanceof Rejection) return { ok: false, error: { code: error.code, message: error.message } };
    return { ok: false, error: { code: 'malformed', message: `Could not inspect: ${describeError(error)}` } };
  }
}

/** Rejections are thrown internally and turned into an `InspectError` at the boundary. */
class Rejection extends Error {
  readonly code: InspectErrorCode;

  constructor(code: InspectErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function reject(code: InspectErrorCode, message: string): never {
  throw new Rejection(code, message);
}

/**
 * The summary, plus the status of every required signature (`checkSignatures` over all signers) for
 * `inspectAndVerifyTransaction`.
 */
async function inspect(
  bytes: ReadonlyUint8Array,
): Promise<{ summary: TransactionSummary; statuses: readonly SignatureStatus[] }> {
  const decoded = decodeWireTransaction(bytes);
  if (!decoded.ok) reject(decoded.code, decoded.message);
  const { transaction, message, signers } = decoded;
  const instructions = resolveInstructions(message);

  // 2. Programs, and the Lighthouse tail strictly at the end.
  for (const [index, ix] of instructions.entries()) {
    if (!KNOWN_PROGRAMS.has(ix.programAddress)) {
      reject('unknown-program', `Instruction ${String(index + 1)} calls ${ix.programAddress}, which Stakeward never uses`);
    }
  }
  const tailStart = instructions.findIndex((ix) => ix.programAddress === LIGHTHOUSE_PROGRAM_ADDRESS);
  const body = tailStart === -1 ? instructions : instructions.slice(0, tailStart);
  const tail = tailStart === -1 ? [] : instructions.slice(tailStart);
  if (tail.some((ix) => ix.programAddress !== LIGHTHOUSE_PROGRAM_ADDRESS)) {
    reject('bad-lighthouse-tail', 'A Lighthouse instruction comes before a Stakeward instruction');
  }

  // 3. Each instruction on its own.
  const reads = body.map(readInstruction);

  // 4. Sequence: [AdvanceNonce]? [CU limit] [CU price] action.
  const first = reads[0]?.step;
  const feePayer = message.staticAccounts[0] ?? reject('malformed', 'No fee payer');
  const lifetime: InspectedLifetime =
    first?.type === 'advance-nonce'
      ? {
          kind: 'nonce',
          nonceAccount: first.nonceAccount,
          nonceAuthority: first.nonceAuthority,
          nonceValue: message.lifetimeToken as Nonce,
        }
      : { kind: 'blockhash', blockhash: message.lifetimeToken as Blockhash };
  const prefix = lifetime.kind === 'nonce' ? 1 : 0;
  const limit = reads[prefix]?.step;
  const price = reads[prefix + 1]?.step;
  if (limit?.type !== 'cu-limit' || price?.type !== 'cu-price') {
    reject('bad-layout', 'Expected SetComputeUnitLimit then SetComputeUnitPrice right after the optional AdvanceNonceAccount');
  }
  if (limit.units !== COMPUTE_UNIT_LIMIT) {
    reject('bad-layout', `Compute unit limit ${String(limit.units)} is not the fixed ${String(COMPUTE_UNIT_LIMIT)}`);
  }
  if (price.microLamports !== COMPUTE_UNIT_PRICE_MICRO_LAMPORTS) {
    reject(
      'bad-layout',
      `Compute unit price ${String(price.microLamports)} is not the fixed ${String(COMPUTE_UNIT_PRICE_MICRO_LAMPORTS)}`,
    );
  }
  const actionSteps = reads.slice(prefix + 2).map((read) => read.step);
  for (const step of actionSteps) {
    if (step.type === 'advance-nonce' || step.type === 'cu-limit' || step.type === 'cu-price') {
      reject('bad-layout', `${STEP_NAMES[step.type]} is only allowed at the start of the transaction`);
    }
  }

  // 5. The action.
  const action = await actionFromSteps(actionSteps);

  // 6. Roles.
  checkRoles(message, feePayer, reads, tail);

  // 7. Backstop: the builder must produce this very message (apart from the accepted tail).
  const builderLifetime: Lifetime =
    lifetime.kind === 'nonce' ? lifetime : { kind: 'blockhash', blockhash: lifetime.blockhash, lastValidBlockHeight: 0n };
  let expected: LegacyMessage;
  try {
    expected = compileActionMessage(action, { feePayer, lifetime: builderLifetime });
  } catch (error) {
    reject('unknown-instruction', `Stakeward never builds this ${action.kind}: ${describeError(error)}`);
  }
  let lighthouseTail: LighthouseTail | null = null;
  // The same message is the common case; only a different one needs the full comparison (a Lighthouse tail, or not
  // our format).
  if (!isSameMessage(expected, message)) {
    const comparison = compareMessages(expected, message);
    if (comparison.kind === 'tail-escalates') reject('bad-lighthouse-tail', comparison.message);
    if (comparison.kind === 'changed') {
      reject(comparison.tail ? 'bad-lighthouse-tail' : 'bad-layout', `Not the builder's format: ${comparison.message}`);
    }
    if (comparison.kind === 'lighthouse-tail') {
      lighthouseTail = { instructionCount: comparison.instructionCount, addedAccounts: comparison.addedAccounts };
    }
  }
  if ((lighthouseTail?.instructionCount ?? 0) !== tail.length) {
    reject('bad-lighthouse-tail', 'The Lighthouse instructions do not match the accepted tail');
  }

  // 8. Signatures.
  const statuses = await checkSignatures(transaction, signers);
  if (statuses.some((status) => status.status === 'unverifiable')) {
    reject('verification-unavailable', 'This browser cannot check Ed25519 signatures (Web Crypto has no Ed25519)');
  }
  const invalid = statuses.find((status) => status.status === 'invalid');
  if (invalid !== undefined) reject('invalid-signature', `The signature of ${invalid.signer} does not match the message`);

  const summary: TransactionSummary = {
    action,
    feePayer,
    lifetime,
    computeBudget: { unitLimit: limit.units, microLamportsPerUnit: price.microLamports },
    networkFeeLamports: networkFee(signers.length, limit.units, price.microLamports),
    requiredSigners: signers,
    presentSignatures: statuses.filter((status) => status.status === 'valid').map((status) => status.signer),
    lighthouseTail,
  };
  return { summary, statuses };
}

/** 5000 lamports per signature plus the priority fee, limit x price rounded up to whole lamports. */
function networkFee(signatures: number, unitLimit: number, microLamportsPerUnit: bigint): bigint {
  const priority = (BigInt(unitLimit) * microLamportsPerUnit + 999_999n) / 1_000_000n;
  return LAMPORTS_PER_SIGNATURE * BigInt(signatures) + priority;
}

// ---------------------------------------------------------------------------------------------------------------
// Reading single instructions.

const KNOWN_PROGRAMS: ReadonlySet<Address> = new Set([
  STAKE_PROGRAM_ADDRESS,
  SYSTEM_PROGRAM_ADDRESS,
  COMPUTE_BUDGET_PROGRAM_ADDRESS,
  LIGHTHOUSE_PROGRAM_ADDRESS,
]);

const { READONLY: R, WRITABLE: W, READONLY_SIGNER: RS, WRITABLE_SIGNER: WS } = AccountRole;

/** Data encoders for the canonical re-encoding of each instruction (`requireCanonical`), built once. */
const ENCODERS = {
  cuLimit: /* @__PURE__ */ getSetComputeUnitLimitInstructionDataEncoder(),
  cuPrice: /* @__PURE__ */ getSetComputeUnitPriceInstructionDataEncoder(),
  setLockup: /* @__PURE__ */ getSetLockupInstructionDataEncoder(),
  setLockupChecked: /* @__PURE__ */ getSetLockupCheckedInstructionDataEncoder(),
  withdraw: /* @__PURE__ */ getWithdrawInstructionDataEncoder(),
  authorizeChecked: /* @__PURE__ */ getAuthorizeCheckedInstructionDataEncoder(),
  deactivate: /* @__PURE__ */ getDeactivateInstructionDataEncoder(),
  delegate: /* @__PURE__ */ getDelegateStakeInstructionDataEncoder(),
  advanceNonce: /* @__PURE__ */ getAdvanceNonceAccountInstructionDataEncoder(),
  createAccountWithSeed: /* @__PURE__ */ getCreateAccountWithSeedInstructionDataEncoder(),
  initializeNonce: /* @__PURE__ */ getInitializeNonceAccountInstructionDataEncoder(),
  withdrawNonce: /* @__PURE__ */ getWithdrawNonceAccountInstructionDataEncoder(),
};

/** One instruction as Stakeward builds it, parsed. Addresses only; roles are checked separately. */
type Step =
  | { type: 'advance-nonce'; nonceAccount: Address; nonceAuthority: Address }
  | { type: 'cu-limit'; units: number }
  | { type: 'cu-price'; microLamports: bigint }
  | {
      type: 'set-lockup';
      stake: Address;
      authority: Address;
      unixTimestamp: Option<bigint>;
      epoch: Option<bigint>;
      custodian: Option<Address>;
    }
  | {
      type: 'set-lockup-checked';
      stake: Address;
      authority: Address;
      newAuthority: Address | null;
      unixTimestamp: Option<bigint>;
      epoch: Option<bigint>;
    }
  | {
      type: 'withdraw';
      stake: Address;
      recipient: Address;
      withdrawAuthority: Address;
      custodian: Address | null;
      lamports: bigint;
    }
  | {
      type: 'authorize-checked';
      stake: Address;
      authority: Address;
      newAuthority: Address;
      custodian: Address | null;
      stakeAuthorize: StakeAuthorize;
    }
  | { type: 'deactivate'; stake: Address; staker: Address }
  | { type: 'delegate'; stake: Address; vote: Address; staker: Address }
  | {
      type: 'create-account-with-seed';
      payer: Address;
      newAccount: Address;
      base: Address;
      seed: string;
      lamports: bigint;
      space: bigint;
      owner: Address;
    }
  | { type: 'initialize-nonce'; nonceAccount: Address; nonceAuthority: Address }
  | { type: 'withdraw-nonce'; nonceAccount: Address; recipient: Address; nonceAuthority: Address; lamports: bigint };

type StakeStep = Extract<
  Step,
  { type: 'set-lockup' | 'set-lockup-checked' | 'withdraw' | 'authorize-checked' | 'deactivate' | 'delegate' }
>;

const STEP_NAMES: Record<Step['type'], string> = {
  'advance-nonce': 'AdvanceNonceAccount',
  'cu-limit': 'SetComputeUnitLimit',
  'cu-price': 'SetComputeUnitPrice',
  'set-lockup': 'SetLockup',
  'set-lockup-checked': 'SetLockupChecked',
  withdraw: 'Withdraw',
  'authorize-checked': 'AuthorizeChecked',
  deactivate: 'Deactivate',
  delegate: 'DelegateStake',
  'create-account-with-seed': 'CreateAccountWithSeed',
  'initialize-nonce': 'InitializeNonceAccount',
  'withdraw-nonce': 'WithdrawNonceAccount',
};

/** A parsed instruction plus the role the builder gives each of its accounts, position by position. */
type Read = { step: Step; program: Address; slots: readonly { address: Address; role: AccountRole }[] };

/**
 * Builder layouts: the role of each account position (legacy layout, sysvars included). `optionalLast` marks layouts
 * whose last account (the custodian, or SetLockupChecked's new authority) may be left out.
 */
type Layout = { roles: readonly AccountRole[]; optionalLast: boolean; sysvars?: Readonly<Record<number, Address>> };

const STAKE_LAYOUTS: Partial<Record<StakeInstruction, Layout>> = {
  [StakeInstruction.SetLockup]: { roles: [W, RS], optionalLast: false },
  [StakeInstruction.SetLockupChecked]: { roles: [W, RS, RS], optionalLast: true },
  [StakeInstruction.Withdraw]: { roles: [W, W, R, R, RS, RS], optionalLast: true },
  [StakeInstruction.AuthorizeChecked]: { roles: [W, R, RS, RS, RS], optionalLast: true },
  [StakeInstruction.Deactivate]: { roles: [W, R, RS], optionalLast: false },
  [StakeInstruction.DelegateStake]: { roles: [W, R, R, R, R, RS], optionalLast: false },
};

const SYSTEM_LAYOUTS: Partial<Record<SystemInstruction, Layout>> = {
  [SystemInstruction.AdvanceNonceAccount]: {
    roles: [W, R, RS],
    optionalLast: false,
    sysvars: { 1: SYSVAR_RECENT_BLOCKHASHES_ADDRESS },
  },
  // Base = payer, so no separate base account (DECISIONS.md D18).
  [SystemInstruction.CreateAccountWithSeed]: { roles: [WS, W], optionalLast: false },
  [SystemInstruction.InitializeNonceAccount]: {
    roles: [W, R, R],
    optionalLast: false,
    sysvars: { 1: SYSVAR_RECENT_BLOCKHASHES_ADDRESS, 2: SYSVAR_RENT_ADDRESS },
  },
  [SystemInstruction.WithdrawNonceAccount]: {
    roles: [W, W, R, R, RS],
    optionalLast: false,
    sysvars: { 2: SYSVAR_RECENT_BLOCKHASHES_ADDRESS, 3: SYSVAR_RENT_ADDRESS },
  },
};

function readInstruction(ix: StakeIx, index: number): Read {
  const where = `Instruction ${String(index + 1)}`;
  switch (ix.programAddress) {
    case COMPUTE_BUDGET_PROGRAM_ADDRESS:
      return readComputeBudget(ix, where);
    case STAKE_PROGRAM_ADDRESS:
      return readStake(ix, where);
    case SYSTEM_PROGRAM_ADDRESS:
      return readSystem(ix, where);
    default:
      return reject('unknown-program', `${where} calls ${ix.programAddress}, which Stakeward never uses`);
  }
}

function readComputeBudget(ix: StakeIx, where: string): Read {
  const type = identify(where, () => identifyComputeBudgetInstruction(ix));
  if (type !== ComputeBudgetInstruction.SetComputeUnitLimit && type !== ComputeBudgetInstruction.SetComputeUnitPrice) {
    reject('unknown-instruction', `${where}: compute budget ${ComputeBudgetInstruction[type]} is never used by Stakeward`);
  }
  if (ix.accounts.length !== 0) reject('bad-layout', `${where}: compute budget instructions take no accounts`);
  const parsed = parse(where, () => parseComputeBudgetInstruction(ix));
  const program = ix.programAddress;
  switch (parsed.instructionType) {
    case ComputeBudgetInstruction.SetComputeUnitLimit:
      requireCanonical(where, ENCODERS.cuLimit.encode(parsed.data), ix.data);
      return { program, slots: [], step: { type: 'cu-limit', units: parsed.data.units } };
    case ComputeBudgetInstruction.SetComputeUnitPrice:
      requireCanonical(where, ENCODERS.cuPrice.encode(parsed.data), ix.data);
      return { program, slots: [], step: { type: 'cu-price', microLamports: parsed.data.microLamports } };
    default:
      return reject('unknown-instruction', `${where}: unexpected compute budget instruction`);
  }
}

function readStake(ix: StakeIx, where: string): Read {
  const type = identify(where, () => identifyStakeInstruction(ix));
  const layout = STAKE_LAYOUTS[type];
  if (layout === undefined) {
    reject('unknown-instruction', `${where}: stake ${StakeInstruction[type]} is not an instruction Stakeward builds`);
  }
  const slots = layoutSlots(ix, layout, `${where} (stake ${StakeInstruction[type]})`);
  const legacy = LEGACY_SYSVAR_SLOTS[type];
  const normalized = legacy === undefined ? ix : stripLegacySysvars(ix, legacy, where);
  const parsed = parse(where, () => parseStakeInstruction(normalized));
  const step = ((): StakeStep => {
    switch (parsed.instructionType) {
      case StakeInstruction.SetLockup:
        requireCanonical(where, ENCODERS.setLockup.encode(parsed.data), ix.data);
        return {
          type: 'set-lockup',
          stake: parsed.accounts.stake.address,
          authority: parsed.accounts.authority.address,
          unixTimestamp: parsed.data.unixTimestamp,
          epoch: parsed.data.epoch,
          custodian: parsed.data.custodian,
        };
      case StakeInstruction.SetLockupChecked:
        requireCanonical(where, ENCODERS.setLockupChecked.encode(parsed.data), ix.data);
        return {
          type: 'set-lockup-checked',
          stake: parsed.accounts.stake.address,
          authority: parsed.accounts.authority.address,
          newAuthority: parsed.accounts.newAuthority?.address ?? null,
          unixTimestamp: parsed.data.unixTimestamp,
          epoch: parsed.data.epoch,
        };
      case StakeInstruction.Withdraw:
        requireCanonical(where, ENCODERS.withdraw.encode(parsed.data), ix.data);
        return {
          type: 'withdraw',
          stake: parsed.accounts.stake.address,
          recipient: parsed.accounts.recipient.address,
          withdrawAuthority: parsed.accounts.withdrawAuthority.address,
          custodian: parsed.accounts.lockupAuthority?.address ?? null,
          lamports: parsed.data.args,
        };
      case StakeInstruction.AuthorizeChecked:
        requireCanonical(where, ENCODERS.authorizeChecked.encode(parsed.data), ix.data);
        return {
          type: 'authorize-checked',
          stake: parsed.accounts.stake.address,
          authority: parsed.accounts.authority.address,
          newAuthority: parsed.accounts.newAuthority.address,
          custodian: parsed.accounts.lockupAuthority?.address ?? null,
          stakeAuthorize: parsed.data.stakeAuthorize,
        };
      case StakeInstruction.Deactivate:
        requireCanonical(where, ENCODERS.deactivate.encode(parsed.data), ix.data);
        return {
          type: 'deactivate',
          stake: parsed.accounts.stake.address,
          staker: parsed.accounts.stakeAuthority.address,
        };
      case StakeInstruction.DelegateStake:
        requireCanonical(where, ENCODERS.delegate.encode(parsed.data), ix.data);
        return {
          type: 'delegate',
          stake: parsed.accounts.stake.address,
          vote: parsed.accounts.vote.address,
          staker: parsed.accounts.stakeAuthority.address,
        };
      default:
        return reject('unknown-instruction', `${where}: stake instruction Stakeward never builds`);
    }
  })();
  return { program: ix.programAddress, slots, step };
}

function readSystem(ix: StakeIx, where: string): Read {
  const type = identify(where, () => identifySystemInstruction(ix));
  const layout = SYSTEM_LAYOUTS[type];
  if (layout === undefined) {
    reject('unknown-instruction', `${where}: system ${SystemInstruction[type]} is not an instruction Stakeward builds`);
  }
  const slots = layoutSlots(ix, layout, `${where} (system ${SystemInstruction[type]})`);
  const parsed = parse(where, () => parseSystemInstruction(ix));
  const step = ((): Step => {
    switch (parsed.instructionType) {
      case SystemInstruction.AdvanceNonceAccount:
        requireCanonical(where, ENCODERS.advanceNonce.encode(parsed.data), ix.data);
        return {
          type: 'advance-nonce',
          nonceAccount: parsed.accounts.nonceAccount.address,
          nonceAuthority: parsed.accounts.nonceAuthority.address,
        };
      case SystemInstruction.CreateAccountWithSeed:
        requireCanonical(where, ENCODERS.createAccountWithSeed.encode(parsed.data), ix.data);
        return {
          type: 'create-account-with-seed',
          payer: parsed.accounts.payer.address,
          newAccount: parsed.accounts.newAccount.address,
          base: parsed.data.base,
          seed: parsed.data.seed,
          lamports: parsed.data.amount,
          space: parsed.data.space,
          owner: parsed.data.programAddress,
        };
      case SystemInstruction.InitializeNonceAccount:
        requireCanonical(where, ENCODERS.initializeNonce.encode(parsed.data), ix.data);
        return {
          type: 'initialize-nonce',
          nonceAccount: parsed.accounts.nonceAccount.address,
          nonceAuthority: parsed.data.nonceAuthority,
        };
      case SystemInstruction.WithdrawNonceAccount:
        requireCanonical(where, ENCODERS.withdrawNonce.encode(parsed.data), ix.data);
        return {
          type: 'withdraw-nonce',
          nonceAccount: parsed.accounts.nonceAccount.address,
          recipient: parsed.accounts.recipientAccount.address,
          nonceAuthority: parsed.accounts.nonceAuthority.address,
          lamports: parsed.data.withdrawAmount,
        };
      default:
        return reject('unknown-instruction', `${where}: system instruction Stakeward never builds`);
    }
  })();
  return { program: ix.programAddress, slots, step };
}

/** Checks the exact account count and the fixed sysvar positions; returns each account with its builder role. */
function layoutSlots(ix: StakeIx, layout: Layout, where: string): Read['slots'] {
  const count = ix.accounts.length;
  const full = layout.roles.length;
  if (count !== full && !(layout.optionalLast && count === full - 1)) {
    const expected = layout.optionalLast ? `${String(full - 1)} or ${String(full)}` : String(full);
    reject('bad-layout', `${where} has ${String(count)} accounts, expected ${expected}`);
  }
  for (const [position, sysvar] of Object.entries(layout.sysvars ?? {})) {
    if (ix.accounts[Number(position)]?.address !== sysvar) {
      reject('bad-layout', `${where}: account ${String(Number(position) + 1)} must be ${sysvar}`);
    }
  }
  return ix.accounts.map((meta, position) => ({
    address: meta.address,
    role: layout.roles[position] ?? reject('bad-layout', `${where}: unexpected account ${String(position + 1)}`),
  }));
}

/** Legacy layout (DECISIONS.md D1): the sysvars must sit exactly at the table's positions; returns the new layout. */
function stripLegacySysvars(ix: StakeIx, slot: LegacySysvarSlot, where: string): StakeIx {
  slot.sysvars.forEach((sysvar, offset) => {
    if (ix.accounts[slot.at + offset]?.address !== sysvar) {
      reject('bad-layout', `${where}: account ${String(slot.at + offset + 1)} must be the sysvar ${sysvar} (legacy layout)`);
    }
  });
  return {
    ...ix,
    accounts: ix.accounts.filter((_, position) => position < slot.at || position >= slot.at + slot.sysvars.length),
  };
}

/** identify* throws on unknown discriminators and on data too short to hold one. */
function identify<T>(where: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    return reject('unknown-instruction', `${where}: unknown instruction (${describeError(error)})`);
  }
}

/** parse* throws when the data does not decode (too short, invalid enum or option tag...). */
function parse<T>(where: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    return reject('malformed', `${where}: instruction data does not decode (${describeError(error)})`);
  }
}

/** Decoders ignore trailing bytes and read option tag 2 as None; the canonical re-encoding must match exactly. */
function requireCanonical(where: string, reencoded: ReadonlyUint8Array, data: ReadonlyUint8Array): void {
  if (!bytesEqual(reencoded, data)) reject('malformed', `${where}: instruction data is not canonically encoded`);
}

// ---------------------------------------------------------------------------------------------------------------
// Steps to action.

function isStakeStep(step: Step): step is StakeStep {
  return (
    step.type === 'set-lockup' ||
    step.type === 'set-lockup-checked' ||
    step.type === 'withdraw' ||
    step.type === 'authorize-checked' ||
    step.type === 'deactivate' ||
    step.type === 'delegate'
  );
}

async function actionFromSteps(steps: readonly Step[]): Promise<TransactionAction> {
  const [first, second, ...rest] = steps;
  if (first === undefined) reject('bad-layout', 'The transaction has no action after the compute budget');
  const stake = steps.filter(isStakeStep);
  if (stake.length > 0) {
    if (stake.length !== steps.length) reject('bad-layout', 'Stake and system instructions are mixed');
    if (new Set(stake.map((step) => step.stake)).size > 1) {
      reject('multiple-stake-accounts', 'The transaction touches more than one stake account');
    }
    const [one, two] = stake;
    if (one !== undefined && two === undefined) return stakeAction(one);
    const rescue = one !== undefined && two !== undefined && stake.length === 2 ? rescueAction(one, two) : null;
    return rescue ?? reject('multiple-stake-accounts', 'Several stake instructions that are not the rescue pair');
  }
  if (first.type === 'create-account-with-seed' && second?.type === 'initialize-nonce' && rest.length === 0) {
    return nonceSetupAction(first, second);
  }
  if (first.type === 'withdraw-nonce' && second === undefined) {
    return {
      kind: 'nonce-close',
      nonceAccount: first.nonceAccount,
      nonceAuthority: first.nonceAuthority,
      recipient: first.recipient,
      lamports: first.lamports,
    };
  }
  return reject('bad-layout', 'System instructions in a combination Stakeward never builds');
}

/** One stake instruction: only the parameter combinations the builders emit (CLAUDE.md section 5, D19). */
function stakeAction(step: StakeStep): TransactionAction {
  switch (step.type) {
    case 'set-lockup-checked': {
      const lockUntil = someValue(step.unixTimestamp);
      if (step.newAuthority === null) notBuilt('SetLockupChecked without a new custodian');
      // F7: only the custodian changes; the end and the epoch stay. Protect always sets an end.
      if (lockUntil === null && !isSome(step.epoch)) {
        return {
          kind: 'change-second-key',
          stakeAccount: step.stake,
          secondKey: step.authority,
          newWallet: step.newAuthority,
        };
      }
      if (lockUntil === null || lockUntil <= 0n) notBuilt('SetLockupChecked without a future lockup end');
      if (isSome(step.epoch)) notBuilt('SetLockupChecked that changes the lockup epoch');
      return {
        kind: 'protect',
        stakeAccount: step.stake,
        mainKey: step.authority,
        secondKey: step.newAuthority,
        lockUntil,
      };
    }
    case 'set-lockup': {
      const lockUntil = someValue(step.unixTimestamp);
      if (isSome(step.custodian)) notBuilt('SetLockup that changes the custodian');
      if (isSome(step.epoch)) notBuilt('SetLockup that changes the lockup epoch');
      if (lockUntil === null || lockUntil < 0n) notBuilt('SetLockup without a lockup end');
      return lockUntil === 0n
        ? { kind: 'unlock', stakeAccount: step.stake, secondKey: step.authority }
        : { kind: 'extend', stakeAccount: step.stake, secondKey: step.authority, lockUntil };
    }
    case 'withdraw':
      if (step.lamports <= 0n) notBuilt('a Withdraw of 0 lamports');
      return {
        kind: 'withdraw',
        stakeAccount: step.stake,
        mainKey: step.withdrawAuthority,
        secondKey: step.custodian,
        recipient: step.recipient,
        lamports: step.lamports,
      };
    case 'deactivate':
      return { kind: 'deactivate', stakeAccount: step.stake, staker: step.staker };
    case 'delegate':
      return { kind: 'delegate', stakeAccount: step.stake, staker: step.staker, voteAccount: step.vote };
    case 'authorize-checked':
      return notBuilt('a single AuthorizeChecked (only the rescue pair)');
  }
}

/**
 * The rescue pair: AuthorizeChecked(Staker -> D) by A without a custodian, then AuthorizeChecked(Withdrawer -> D) by
 * the same A with the custodian K, over the same stake account. Anything else is not the pair.
 */
function rescueAction(staker: StakeStep, withdrawer: StakeStep): TransactionAction | null {
  if (
    staker.type !== 'authorize-checked' ||
    withdrawer.type !== 'authorize-checked' ||
    staker.stakeAuthorize !== StakeAuthorize.Staker ||
    withdrawer.stakeAuthorize !== StakeAuthorize.Withdrawer ||
    staker.stake !== withdrawer.stake ||
    staker.authority !== withdrawer.authority ||
    staker.newAuthority !== withdrawer.newAuthority ||
    staker.custodian !== null ||
    withdrawer.custodian === null
  ) {
    return null;
  }
  return {
    kind: 'rescue',
    stakeAccount: staker.stake,
    mainKey: staker.authority,
    secondKey: withdrawer.custodian,
    newWallet: staker.newAuthority,
  };
}

/**
 * Nonce setup (D18): CreateAccountWithSeed funded by and based on the nonce authority, owned by the system program,
 * 80 bytes, at the address derived from (base, seed, system program); then InitializeNonceAccount of that same
 * account with that authority.
 */
async function nonceSetupAction(
  create: Extract<Step, { type: 'create-account-with-seed' }>,
  initialize: Extract<Step, { type: 'initialize-nonce' }>,
): Promise<TransactionAction> {
  if (create.base !== create.payer) notBuilt('a nonce account whose seed base is not the funder');
  if (create.owner !== SYSTEM_PROGRAM_ADDRESS) notBuilt('a nonce account owned by another program');
  if (create.space !== BigInt(NONCE_ACCOUNT_SIZE)) notBuilt(`a nonce account of ${String(create.space)} bytes`);
  if (initialize.nonceAccount !== create.newAccount) notBuilt('InitializeNonceAccount for another account');
  if (initialize.nonceAuthority !== create.payer) notBuilt('a nonce account whose authority is not the funder');
  let derived: Address;
  try {
    derived = await createAddressWithSeed({
      baseAddress: create.base,
      programAddress: SYSTEM_PROGRAM_ADDRESS,
      seed: create.seed,
    });
  } catch (error) {
    return notBuilt(`this nonce seed (${describeError(error)})`);
  }
  if (derived !== create.newAccount) notBuilt('a nonce account that is not at the address derived from its seed');
  return {
    kind: 'nonce-setup',
    nonceAccount: create.newAccount,
    nonceAuthority: create.payer,
    seed: create.seed,
    lamports: create.lamports,
  };
}

function bytesEqual(a: ReadonlyUint8Array, b: ReadonlyUint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function notBuilt(what: string): never {
  return reject('unknown-instruction', `Stakeward never builds ${what}`);
}

function someValue<T>(option: Option<T>): T | null {
  return isSome(option) ? option.value : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Roles.

/**
 * Every account's role must be exactly what the builder gives it: the fee payer is a writable signer, programs are
 * read-only, every other account gets the merge of the roles its positions require. Accounts that only the
 * Lighthouse tail references must be read-only non-signers, and no account may be listed without being used.
 */
function checkRoles(message: LegacyMessage, feePayer: Address, reads: readonly Read[], tail: readonly StakeIx[]): void {
  const expected = new Map<Address, AccountRole>([[feePayer, WS]]);
  const require = (address: Address, role: AccountRole) => {
    expected.set(address, mergeRoles(expected.get(address) ?? R, role));
  };
  for (const read of reads) {
    require(read.program, R);
    for (const slot of read.slots) require(slot.address, slot.role);
  }
  const tailAccounts = new Set(tail.flatMap((ix) => [ix.programAddress, ...ix.accounts.map((meta) => meta.address)]));
  message.staticAccounts.forEach((account, index) => {
    const actual = accountRoleAt(message, index);
    const want = expected.get(account);
    if (want === undefined) {
      if (!tailAccounts.has(account)) reject('bad-layout', `Account ${account} is listed but not used`);
      if (actual !== R) reject('bad-lighthouse-tail', `The Lighthouse tail adds ${account} as ${ROLE_NAMES[actual]}`);
    } else if (actual !== want) {
      reject(
        tailAccounts.has(account) ? 'bad-lighthouse-tail' : 'bad-layout',
        `Account ${account} is ${ROLE_NAMES[actual]} but Stakeward makes it ${ROLE_NAMES[want]}`,
      );
    }
  });
}

const ROLE_NAMES: Record<AccountRole, string> = {
  [AccountRole.READONLY]: 'read-only',
  [AccountRole.WRITABLE]: 'writable',
  [AccountRole.READONLY_SIGNER]: 'a read-only signer',
  [AccountRole.WRITABLE_SIGNER]: 'a writable signer',
};
