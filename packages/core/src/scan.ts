import {
  AccountRole,
  createAddressWithSeed,
  getBase58Encoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getCompiledTransactionMessageEncoder,
  getTransactionDecoder,
  getTransactionEncoder,
  isSome,
  type AccountMeta,
  type Address,
  type CompiledTransactionMessage,
  type Option,
  type ReadonlyUint8Array,
  type Transaction,
  type TransactionMessageBytes,
} from '@solana/kit';
import { ComputeBudgetInstruction, identifyComputeBudgetInstruction } from '@solana-program/compute-budget';
import { identifyStakeInstruction, parseStakeInstruction, StakeAuthorize, StakeInstruction } from '@solana-program/stake';
import { identifySystemInstruction, SystemInstruction } from '@solana-program/system';
import {
  COMPUTE_BUDGET_PROGRAM_ADDRESS,
  LIGHTHOUSE_PROGRAM_ADDRESS,
  STAKE_CONFIG_ADDRESS,
  STAKE_PROGRAM_ADDRESS,
  SYSTEM_PROGRAM_ADDRESS,
  SYSVAR_CLOCK_ADDRESS,
  SYSVAR_RENT_ADDRESS,
  SYSVAR_STAKE_HISTORY_ADDRESS,
} from './constants.ts';
import { inspectTransaction, type TransactionSummary } from './inspect.ts';
import { decodeBase64Url, parseCosignFragment } from './link.ts';

/**
 * Lenient transaction scanner for /check (DECISIONS.md D126): "is this transaction from another site about to touch my
 * stake?". Unlike the inspector (`inspectTransaction`, the strict gate for what Stakeward itself signs and sends), it
 * accepts any legacy, v0 or v1 message with any programs, and says what each instruction does to stake accounts. It
 * never signs or sends and reads nothing from the network: accounts behind an address lookup table stay unknown and
 * the result says so.
 *
 * Stake instructions are identified and parsed with the generated client (`identifyStakeInstruction`,
 * `parseStakeInstruction`); bytes are never decoded by hand. The program accepts the legacy account layout (read-only
 * sysvars at fixed positions, what most wallets and web3.js emit) and the new one (no sysvars, what the generated client
 * emits); the scanner strips the legacy sysvars when they sit exactly where the legacy layout puts them.
 *
 * Risk: `danger` for what moves SOL or control of a stake account (Authorize in every form, SetLockup in both forms,
 * Withdraw, Merge, and a stake instruction the scanner cannot read); `caution` for Deactivate, Delegate, Split,
 * MoveStake, MoveLamports, Initialize, DeactivateDelinquent, programs the scanner does not know and lookup tables;
 * `ok` otherwise. System, Compute Budget and Lighthouse instructions are listed but not judged.
 */

export type ScanRisk = 'ok' | 'caution' | 'danger';

/** An account address, or null when it sits behind an address lookup table (unknown offline). */
export type ScannedAddress = Address | null;

export type ScannedLockupChange = {
  /** New lock end (Unix seconds); null = unchanged. 0 removes the date lock. */
  unixTimestamp: bigint | null;
  /** New lock epoch; null = unchanged. */
  epoch: bigint | null;
  /** New second key (lockup custodian); null = unchanged. */
  newCustodian: ScannedAddress;
  /** True when a new custodian is set (SetLockup with a custodian, or SetLockupChecked with a new authority). */
  custodianChanges: boolean;
};

/** What one instruction does, as far as the bytes tell. */
export type ScanEffect =
  | {
      kind: 'authorize';
      /** The generated client's name: Authorize, AuthorizeChecked, AuthorizeWithSeed, AuthorizeCheckedWithSeed. */
      variant: 'Authorize' | 'AuthorizeChecked' | 'AuthorizeWithSeed' | 'AuthorizeCheckedWithSeed';
      role: 'staker' | 'withdrawer';
      stake: ScannedAddress;
      /** The signing authority (for the seed variants, the address derived from base, seed and owner). */
      authority: ScannedAddress;
      newAuthority: ScannedAddress;
      /** Lockup custodian co-signing, if any. */
      custodian: ScannedAddress;
    }
  | ({ kind: 'set-lockup'; variant: 'SetLockup' | 'SetLockupChecked'; stake: ScannedAddress; authority: ScannedAddress } & ScannedLockupChange)
  | { kind: 'withdraw'; stake: ScannedAddress; recipient: ScannedAddress; authority: ScannedAddress; custodian: ScannedAddress; lamports: bigint }
  | { kind: 'merge'; destination: ScannedAddress; source: ScannedAddress; authority: ScannedAddress }
  | { kind: 'deactivate'; stake: ScannedAddress; authority: ScannedAddress }
  | { kind: 'delegate'; stake: ScannedAddress; vote: ScannedAddress; authority: ScannedAddress }
  | { kind: 'split'; stake: ScannedAddress; newStake: ScannedAddress; authority: ScannedAddress; lamports: bigint }
  | {
      kind: 'move';
      variant: 'MoveStake' | 'MoveLamports';
      source: ScannedAddress;
      destination: ScannedAddress;
      authority: ScannedAddress;
      lamports: bigint;
    }
  | {
      kind: 'initialize';
      variant: 'Initialize' | 'InitializeChecked';
      stake: ScannedAddress;
      staker: ScannedAddress;
      withdrawer: ScannedAddress;
      /** Initialize only: the lock it sets (null when it sets none). */
      lockup: { unixTimestamp: bigint; epoch: bigint; custodian: Address } | null;
    }
  | { kind: 'deactivate-delinquent'; stake: ScannedAddress }
  | { kind: 'stake-info'; name: string }
  /** A stake instruction the generated client cannot read: unknown effect on a stake account. */
  | { kind: 'stake-unreadable'; reason: string }
  /** Any other program. `name` is the instruction name for System and Compute Budget, when known. */
  | { kind: 'program'; program: 'system' | 'compute-budget' | 'lighthouse' | 'unknown'; name: string | null };

export type ScannedInstruction = {
  /** 0-based position in the message. */
  index: number;
  /** Null when the program index points into a lookup table (the network refuses that, but the bytes may say so). */
  programAddress: ScannedAddress;
  effect: ScanEffect;
  risk: ScanRisk;
  /** The instruction uses at least one account behind a lookup table. */
  usesLookupTable: boolean;
  /**
   * How the given wallet takes part: `replaced` when it is the authority this instruction replaces (or the authority
   * whose SOL goes to another address), `authority` when it signs this stake instruction otherwise, null when not given
   * or not involved.
   */
  wallet: 'replaced' | 'authority' | null;
};

export type ScanReport = {
  version: 'legacy' | 0 | 1;
  feePayer: Address;
  /** Every address that must sign, fee payer first. */
  requiredSigners: readonly Address[];
  instructions: readonly ScannedInstruction[];
  /** Address lookup tables the message uses; their accounts are unknown offline. */
  lookupTables: readonly Address[];
  /** The input was a bare message (no signature section). */
  messageOnly: boolean;
  /** Highest risk of any instruction; at least `caution` with a lookup table. */
  risk: ScanRisk;
  /** At least one stake program instruction. */
  touchesStake: boolean;
  /** The strict inspector's summary when it accepts the bytes: a transaction in Stakeward's own format. */
  stakeward: TransactionSummary | null;
};

export type ScanErrorCode =
  /** Nothing pasted. */
  | 'empty'
  /** One address (32 bytes): not a transaction. */
  | 'address'
  /** 64 bytes (a signature, or a private key), a word list or a keypair file: never paste those. */
  | 'secret'
  /** Not a transaction in any encoding the scanner knows. */
  | 'malformed';

export type ScanResult = { ok: true; report: ScanReport; encoding: ScanEncoding } | { ok: false; code: ScanErrorCode; message: string };

export type ScanEncoding = 'link' | 'base64' | 'base58' | 'bytes';

/** Longest input scanned: a v1 transaction may be up to 4096 bytes. */
const MAX_SCAN_BYTES = 4096;

const transactionDecoder = /* @__PURE__ */ getTransactionDecoder();
const transactionEncoder = /* @__PURE__ */ getTransactionEncoder();
const messageDecoder = /* @__PURE__ */ getCompiledTransactionMessageDecoder();
const messageEncoder = /* @__PURE__ */ getCompiledTransactionMessageEncoder();

const RISK_ORDER: Record<ScanRisk, number> = { ok: 0, caution: 1, danger: 2 };

/** The higher of two risks. */
export function maxRisk(a: ScanRisk, b: ScanRisk): ScanRisk {
  return RISK_ORDER[b] > RISK_ORDER[a] ? b : a;
}

/**
 * Scans pasted text: a /cosign link (or its `#tx=` fragment), base64, base64url, base58 or a JSON byte array, of a
 * wire transaction or a bare message. Tries the encodings in that order and keeps the first that reads as a
 * transaction. Text that looks like a secret (64 bytes, a list of 12 or more words) is reported as `secret` and never
 * scanned further. Never throws.
 */
export async function scanTransactionText(text: string, options: { wallet?: Address | null | undefined } = {}): Promise<ScanResult> {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, code: 'empty', message: 'Nothing to check' };
  if (/^[a-z]+(\s+[a-z]+){11,}$/i.test(trimmed)) {
    return { ok: false, code: 'secret', message: 'The text is a list of words, like a recovery phrase' };
  }
  const candidates = candidateBytes(trimmed);
  let firstError: string | null = null;
  for (const { bytes, encoding } of candidates) {
    const result = await scanTransaction(bytes, options);
    if (result.ok) return { ok: true, report: result.report, encoding };
    firstError ??= result.message;
  }
  if (candidates.some((candidate) => candidate.bytes.length === 64)) {
    return { ok: false, code: 'secret', message: '64 bytes: a signature or a private key, not a transaction' };
  }
  if (candidates.some((candidate) => candidate.encoding === 'base58' && candidate.bytes.length === 32)) {
    return { ok: false, code: 'address', message: '32 bytes: an address, not a transaction' };
  }
  return { ok: false, code: 'malformed', message: firstError ?? 'Not base64, base58 or a Stakeward link' };
}

function candidateBytes(text: string): { bytes: Uint8Array; encoding: ScanEncoding }[] {
  const out: { bytes: Uint8Array; encoding: ScanEncoding }[] = [];
  const hash = text.indexOf('#');
  const fragment = hash === -1 ? (text.startsWith('tx=') ? text : null) : text.slice(hash + 1);
  if (fragment !== null) {
    const bytes = parseCosignFragment(fragment);
    if (bytes !== null) out.push({ bytes, encoding: 'link' });
    return out;
  }
  if (text.startsWith('[')) {
    const bytes = jsonBytes(text);
    if (bytes !== null) out.push({ bytes, encoding: 'bytes' });
    return out;
  }
  const compact = text.replace(/\s+/g, '');
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(compact) && compact.replace(/=+$/, '').length % 4 !== 1) {
    const bare = compact.replace(/=+$/, '');
    const padded = bare + '='.repeat((4 - (bare.length % 4)) % 4);
    try {
      out.push({ bytes: new Uint8Array(getBase64Encoder().encode(padded)), encoding: 'base64' });
    } catch {
      // Not base64.
    }
  }
  const url = decodeBase64Url(compact);
  if (url !== null && /[-_]/.test(compact)) out.push({ bytes: url, encoding: 'base64' });
  if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(compact)) {
    try {
      out.push({ bytes: new Uint8Array(getBase58Encoder().encode(compact)), encoding: 'base58' });
    } catch {
      // Not base58.
    }
  }
  return out.filter((candidate) => candidate.bytes.length > 0 && candidate.bytes.length <= MAX_SCAN_BYTES);
}

function jsonBytes(text: string): Uint8Array | null {
  try {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SCAN_BYTES) return null;
    if (!value.every((item) => Number.isInteger(item) && (item as number) >= 0 && (item as number) <= 255)) return null;
    return Uint8Array.from(value as number[]);
  } catch {
    return null;
  }
}

/** A message read leniently: any version, canonical encoding only (so garbage does not pass as a transaction). */
type Read = {
  message: CompiledTransactionMessage;
  messageBytes: ReadonlyUint8Array;
  /** The input bytes. */
  wire: ReadonlyUint8Array;
  messageOnly: boolean;
};

function readBytes(bytes: ReadonlyUint8Array): Read | string {
  let transactionError: string;
  try {
    const transaction = transactionDecoder.decode(bytes);
    if (bytesEqual(transactionEncoder.encode(transaction), bytes)) {
      const message = readMessage(transaction.messageBytes);
      if (typeof message !== 'string') return { message, messageBytes: transaction.messageBytes, wire: bytes, messageOnly: false };
      transactionError = message;
    } else {
      transactionError = 'The transaction is not canonically encoded';
    }
  } catch (error) {
    transactionError = `Not a transaction: ${describeError(error)}`;
  }
  const message = readMessage(bytes);
  if (typeof message !== 'string') return { message, messageBytes: bytes, wire: bytes, messageOnly: true };
  return transactionError;
}

function readMessage(bytes: ReadonlyUint8Array): CompiledTransactionMessage | string {
  let message: CompiledTransactionMessage;
  try {
    message = messageDecoder.decode(bytes);
  } catch (error) {
    return `Not a transaction message: ${describeError(error)}`;
  }
  try {
    if (!bytesEqual(messageEncoder.encode(message), bytes)) return 'The message is not canonically encoded';
  } catch (error) {
    return `Not a transaction message: ${describeError(error)}`;
  }
  if (message.staticAccounts.length === 0 || message.header.numSignerAccounts < 1) return 'The message has no fee payer';
  if (instructionsOf(message).length === 0) return 'The message has no instructions';
  return message;
}

/** Instructions as (program index, account indices, data), whatever the message version. */
function instructionsOf(message: CompiledTransactionMessage): { program: number; accounts: readonly number[]; data: ReadonlyUint8Array }[] {
  if (message.version === 1) {
    return message.instructionHeaders.map((header, i) => {
      const payload = message.instructionPayloads[i];
      return {
        program: header.programAccountIndex,
        accounts: payload?.instructionAccountIndices ?? [],
        data: payload?.instructionData ?? new Uint8Array(),
      };
    });
  }
  return message.instructions.map((ix) => ({
    program: ix.programAddressIndex,
    accounts: ix.accountIndices ?? [],
    data: ix.data ?? new Uint8Array(),
  }));
}

/**
 * Scans wire transaction bytes (or bare message bytes). `wallet` marks the instructions where that address is the
 * authority being replaced or signing. Never throws.
 */
export async function scanTransaction(
  bytes: ReadonlyUint8Array,
  options: { wallet?: Address | null | undefined } = {},
): Promise<{ ok: true; report: ScanReport } | { ok: false; message: string }> {
  try {
    if (bytes.length === 0) return { ok: false, message: 'No bytes' };
    if (bytes.length > MAX_SCAN_BYTES) return { ok: false, message: `Longer than ${String(MAX_SCAN_BYTES)} bytes` };
    const read = readBytes(bytes);
    if (typeof read === 'string') return { ok: false, message: read };
    return { ok: true, report: await report(read, options.wallet ?? null) };
  } catch (error) {
    return { ok: false, message: `Could not read: ${describeError(error)}` };
  }
}

async function report(read: Read, wallet: Address | null): Promise<ScanReport> {
  const { message } = read;
  const lookups = message.version === 0 ? (message.addressTableLookups ?? []) : [];
  const hiddenCount = lookups.reduce((sum, lookup) => sum + lookup.writableIndexes.length + lookup.readonlyIndexes.length, 0);
  const staticCount = message.staticAccounts.length;
  const total = staticCount + hiddenCount;
  const signers = message.staticAccounts.slice(0, message.header.numSignerAccounts);

  const instructions: ScannedInstruction[] = [];
  for (const [index, ix] of instructionsOf(message).entries()) {
    if (ix.program >= total || ix.accounts.some((at) => at >= total)) {
      throw new Error(`Instruction ${String(index + 1)} refers to an account outside the message`);
    }
    const metas = ix.accounts.map((at) => metaAt(message, at, staticCount));
    const programAddress = ix.program < staticCount ? (message.staticAccounts[ix.program] ?? null) : null;
    const usesLookupTable = ix.accounts.some((at) => at >= staticCount) || programAddress === null;
    const effect = await describe(programAddress, metas, ix.data);
    instructions.push({
      index,
      programAddress,
      effect,
      risk: riskOf(effect),
      usesLookupTable,
      wallet: wallet === null ? null : walletPart(effect, wallet),
    });
  }

  let risk: ScanRisk = lookups.length > 0 ? 'caution' : 'ok';
  for (const ix of instructions) risk = maxRisk(risk, ix.risk);

  const inspected = await inspectTransaction(read.messageOnly ? wireOf(read.messageBytes, signers) : read.wire);
  const stakeward: TransactionSummary | null = inspected.ok ? inspected.summary : null;

  return {
    version: message.version,
    feePayer: message.staticAccounts[0] as Address,
    requiredSigners: signers,
    instructions,
    lookupTables: lookups.map((lookup) => lookup.lookupTableAddress),
    messageOnly: read.messageOnly,
    risk,
    touchesStake: instructions.some((ix) => ix.programAddress === STAKE_PROGRAM_ADDRESS),
    stakeward,
  };
}

/** Wire bytes for a bare message, with an empty signature slot per signer, so the strict inspector can read it. */
function wireOf(messageBytes: ReadonlyUint8Array, signers: readonly Address[]): ReadonlyUint8Array {
  const transaction: Transaction = {
    messageBytes: messageBytes as TransactionMessageBytes,
    signatures: Object.fromEntries(signers.map((signer) => [signer, null])),
  };
  return transactionEncoder.encode(transaction);
}

// ---------------------------------------------------------------------------------------------------------------

/** Placeholder addresses for lookup-table accounts: they only flow through the parser and come back as null. */
const HIDDEN_PREFIX = 'lookup-table-account-';

function metaAt(message: CompiledTransactionMessage, index: number, staticCount: number): AccountMeta {
  if (index < staticCount) {
    const address = message.staticAccounts[index] as Address;
    return { address, role: roleAt(message, index) };
  }
  return { address: `${HIDDEN_PREFIX}${String(index)}` as Address, role: AccountRole.READONLY };
}

function roleAt(message: CompiledTransactionMessage, index: number): AccountRole {
  const { numSignerAccounts, numReadonlySignerAccounts, numReadonlyNonSignerAccounts } = message.header;
  if (index < numSignerAccounts) {
    return index < numSignerAccounts - numReadonlySignerAccounts ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER;
  }
  return index < message.staticAccounts.length - numReadonlyNonSignerAccounts ? AccountRole.WRITABLE : AccountRole.READONLY;
}

function shown(meta: AccountMeta | undefined): ScannedAddress {
  if (meta === undefined) return null;
  return meta.address.startsWith(HIDDEN_PREFIX) ? null : meta.address;
}

/**
 * Where the legacy layout (DECISIONS.md D1, stake program instruction.rs) puts read-only sysvars that the generated
 * client's layout leaves out. Stripped only when exactly these addresses sit exactly there.
 */
const LEGACY_SYSVARS: Partial<Record<StakeInstruction, { at: number; sysvars: readonly Address[] }>> = {
  [StakeInstruction.Initialize]: { at: 1, sysvars: [SYSVAR_RENT_ADDRESS] },
  [StakeInstruction.InitializeChecked]: { at: 1, sysvars: [SYSVAR_RENT_ADDRESS] },
  [StakeInstruction.Authorize]: { at: 1, sysvars: [SYSVAR_CLOCK_ADDRESS] },
  [StakeInstruction.AuthorizeChecked]: { at: 1, sysvars: [SYSVAR_CLOCK_ADDRESS] },
  [StakeInstruction.AuthorizeWithSeed]: { at: 2, sysvars: [SYSVAR_CLOCK_ADDRESS] },
  [StakeInstruction.AuthorizeCheckedWithSeed]: { at: 2, sysvars: [SYSVAR_CLOCK_ADDRESS] },
  [StakeInstruction.Deactivate]: { at: 1, sysvars: [SYSVAR_CLOCK_ADDRESS] },
  [StakeInstruction.Withdraw]: { at: 2, sysvars: [SYSVAR_CLOCK_ADDRESS, SYSVAR_STAKE_HISTORY_ADDRESS] },
  [StakeInstruction.Merge]: { at: 2, sysvars: [SYSVAR_CLOCK_ADDRESS, SYSVAR_STAKE_HISTORY_ADDRESS] },
  [StakeInstruction.DelegateStake]: {
    at: 2,
    sysvars: [SYSVAR_CLOCK_ADDRESS, SYSVAR_STAKE_HISTORY_ADDRESS, STAKE_CONFIG_ADDRESS],
  },
};

function stripLegacySysvars(type: StakeInstruction, metas: readonly AccountMeta[]): AccountMeta[] {
  const slot = LEGACY_SYSVARS[type];
  if (slot === undefined) return [...metas];
  const there = metas.slice(slot.at, slot.at + slot.sysvars.length).map((meta) => meta.address);
  if (there.length !== slot.sysvars.length || there.some((address, i) => address !== slot.sysvars[i])) return [...metas];
  return [...metas.slice(0, slot.at), ...metas.slice(slot.at + slot.sysvars.length)];
}

async function describe(program: ScannedAddress, metas: readonly AccountMeta[], data: ReadonlyUint8Array): Promise<ScanEffect> {
  switch (program) {
    case STAKE_PROGRAM_ADDRESS:
      return describeStake(metas, data);
    case SYSTEM_PROGRAM_ADDRESS:
      return { kind: 'program', program: 'system', name: nameOf(() => SystemInstruction[identifySystemInstruction(data)]) };
    case COMPUTE_BUDGET_PROGRAM_ADDRESS:
      return {
        kind: 'program',
        program: 'compute-budget',
        name: nameOf(() => ComputeBudgetInstruction[identifyComputeBudgetInstruction(data)]),
      };
    case LIGHTHOUSE_PROGRAM_ADDRESS:
      return { kind: 'program', program: 'lighthouse', name: null };
    default:
      return { kind: 'program', program: 'unknown', name: null };
  }
}

function nameOf(read: () => string | undefined): string | null {
  try {
    return read() ?? null;
  } catch {
    return null;
  }
}

function optional<T>(value: Option<T>): T | null {
  return isSome(value) ? value.value : null;
}

async function describeStake(metas: readonly AccountMeta[], data: ReadonlyUint8Array): Promise<ScanEffect> {
  let type: StakeInstruction;
  try {
    type = identifyStakeInstruction(data);
  } catch (error) {
    return { kind: 'stake-unreadable', reason: describeError(error) };
  }
  const accounts = stripLegacySysvars(type, metas);
  let parsed: ReturnType<typeof parseStakeInstruction>;
  try {
    parsed = parseStakeInstruction({ programAddress: STAKE_PROGRAM_ADDRESS, accounts, data });
  } catch (error) {
    return { kind: 'stake-unreadable', reason: `${StakeInstruction[type]}: ${describeError(error)}` };
  }
  const role = (value: StakeAuthorize) => (value === StakeAuthorize.Withdrawer ? 'withdrawer' : 'staker');
  switch (parsed.instructionType) {
    case StakeInstruction.Authorize:
      return {
        kind: 'authorize',
        variant: 'Authorize',
        role: role(parsed.data.arg1),
        stake: shown(parsed.accounts.stake),
        authority: shown(parsed.accounts.authority),
        newAuthority: parsed.data.arg0,
        custodian: shown(parsed.accounts.lockupAuthority),
      };
    case StakeInstruction.AuthorizeChecked:
      return {
        kind: 'authorize',
        variant: 'AuthorizeChecked',
        role: role(parsed.data.stakeAuthorize),
        stake: shown(parsed.accounts.stake),
        authority: shown(parsed.accounts.authority),
        newAuthority: shown(parsed.accounts.newAuthority),
        custodian: shown(parsed.accounts.lockupAuthority),
      };
    case StakeInstruction.AuthorizeWithSeed:
      return {
        kind: 'authorize',
        variant: 'AuthorizeWithSeed',
        role: role(parsed.data.stakeAuthorize),
        stake: shown(parsed.accounts.stake),
        authority: await seeded(shown(parsed.accounts.base), parsed.data.authoritySeed, parsed.data.authorityOwner),
        newAuthority: parsed.data.newAuthorizedPubkey,
        custodian: shown(parsed.accounts.lockupAuthority),
      };
    case StakeInstruction.AuthorizeCheckedWithSeed:
      return {
        kind: 'authorize',
        variant: 'AuthorizeCheckedWithSeed',
        role: role(parsed.data.stakeAuthorize),
        stake: shown(parsed.accounts.stake),
        authority: await seeded(shown(parsed.accounts.base), parsed.data.authoritySeed, parsed.data.authorityOwner),
        newAuthority: shown(parsed.accounts.newAuthority),
        custodian: shown(parsed.accounts.lockupAuthority),
      };
    case StakeInstruction.SetLockup: {
      const newCustodian = optional(parsed.data.custodian);
      return {
        kind: 'set-lockup',
        variant: 'SetLockup',
        stake: shown(parsed.accounts.stake),
        authority: shown(parsed.accounts.authority),
        unixTimestamp: optional(parsed.data.unixTimestamp),
        epoch: optional(parsed.data.epoch),
        newCustodian,
        custodianChanges: newCustodian !== null,
      };
    }
    case StakeInstruction.SetLockupChecked: {
      const meta = parsed.accounts.newAuthority;
      return {
        kind: 'set-lockup',
        variant: 'SetLockupChecked',
        stake: shown(parsed.accounts.stake),
        authority: shown(parsed.accounts.authority),
        unixTimestamp: optional(parsed.data.unixTimestamp),
        epoch: optional(parsed.data.epoch),
        newCustodian: shown(meta),
        custodianChanges: meta !== undefined,
      };
    }
    case StakeInstruction.Withdraw:
      return {
        kind: 'withdraw',
        stake: shown(parsed.accounts.stake),
        recipient: shown(parsed.accounts.recipient),
        authority: shown(parsed.accounts.withdrawAuthority),
        custodian: shown(parsed.accounts.lockupAuthority),
        lamports: parsed.data.args,
      };
    case StakeInstruction.Merge:
      return {
        kind: 'merge',
        destination: shown(parsed.accounts.destinationStake),
        source: shown(parsed.accounts.sourceStake),
        authority: shown(parsed.accounts.stakeAuthority),
      };
    case StakeInstruction.Deactivate:
      return { kind: 'deactivate', stake: shown(parsed.accounts.stake), authority: shown(parsed.accounts.stakeAuthority) };
    case StakeInstruction.DelegateStake:
      return {
        kind: 'delegate',
        stake: shown(parsed.accounts.stake),
        vote: shown(parsed.accounts.vote),
        authority: shown(parsed.accounts.stakeAuthority),
      };
    case StakeInstruction.Split:
      return {
        kind: 'split',
        stake: shown(parsed.accounts.stake),
        newStake: shown(parsed.accounts.splitStake),
        authority: shown(parsed.accounts.stakeAuthority),
        lamports: parsed.data.args,
      };
    case StakeInstruction.MoveStake:
    case StakeInstruction.MoveLamports:
      return {
        kind: 'move',
        variant: parsed.instructionType === StakeInstruction.MoveStake ? 'MoveStake' : 'MoveLamports',
        source: shown(parsed.accounts.sourceStake),
        destination: shown(parsed.accounts.destinationStake),
        authority: shown(parsed.accounts.stakeAuthority),
        lamports: parsed.data.args,
      };
    case StakeInstruction.Initialize: {
      const { unixTimestamp, epoch, custodian } = parsed.data.arg1;
      const hasLock = unixTimestamp !== 0n || epoch !== 0n;
      return {
        kind: 'initialize',
        variant: 'Initialize',
        stake: shown(parsed.accounts.stake),
        staker: parsed.data.arg0.staker,
        withdrawer: parsed.data.arg0.withdrawer,
        lockup: hasLock ? { unixTimestamp, epoch, custodian } : null,
      };
    }
    case StakeInstruction.InitializeChecked:
      return {
        kind: 'initialize',
        variant: 'InitializeChecked',
        stake: shown(parsed.accounts.stake),
        staker: shown(parsed.accounts.stakeAuthority),
        withdrawer: shown(parsed.accounts.withdrawAuthority),
        lockup: null,
      };
    case StakeInstruction.DeactivateDelinquent:
      return { kind: 'deactivate-delinquent', stake: shown(parsed.accounts.stake) };
    case StakeInstruction.GetMinimumDelegation:
      return { kind: 'stake-info', name: 'GetMinimumDelegation' };
  }
}

async function seeded(base: ScannedAddress, seed: string, owner: Address): Promise<ScannedAddress> {
  if (base === null) return null;
  try {
    return await createAddressWithSeed({ baseAddress: base, seed, programAddress: owner });
  } catch {
    return null;
  }
}

function riskOf(effect: ScanEffect): ScanRisk {
  switch (effect.kind) {
    case 'authorize':
    case 'set-lockup':
    case 'withdraw':
    case 'merge':
    case 'stake-unreadable':
      return 'danger';
    case 'deactivate':
    case 'delegate':
    case 'split':
    case 'move':
    case 'initialize':
    case 'deactivate-delinquent':
      return 'caution';
    case 'stake-info':
      return 'ok';
    case 'program':
      return effect.program === 'unknown' ? 'caution' : 'ok';
  }
}

function walletPart(effect: ScanEffect, wallet: Address): ScannedInstruction['wallet'] {
  switch (effect.kind) {
    case 'authorize':
      if (effect.authority !== wallet) return null;
      return effect.newAuthority === wallet ? 'authority' : 'replaced';
    case 'withdraw':
      if (effect.authority !== wallet) return null;
      return effect.recipient === wallet ? 'authority' : 'replaced';
    case 'set-lockup':
    case 'merge':
    case 'deactivate':
    case 'delegate':
    case 'split':
    case 'move':
      return effect.authority === wallet ? 'authority' : null;
    default:
      return null;
  }
}

function bytesEqual(a: ReadonlyUint8Array, b: ReadonlyUint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
