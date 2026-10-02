// Test-only helpers that craft transactions the builders never produce. Malicious messages are built with kit's own
// APIs (instructions -> transaction message -> compileTransaction -> encode), or edited at the compiled-message level
// and re-encoded with kit's codecs, so every input is well-formed on the wire unless a test says otherwise.
// No Node or DOM APIs: src tests import this file too.
import {
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createNoopSigner,
  createTransactionMessage,
  decompileTransactionMessage,
  getAddressDecoder,
  getCompiledTransactionMessageDecoder,
  getCompiledTransactionMessageEncoder,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type CompiledTransactionMessage,
  type CompiledTransactionMessageWithLifetime,
  type Instruction,
  type LegacyCompiledTransactionMessage,
  type SignatureBytes,
  type Transaction,
  type TransactionMessageBytes,
} from '@solana/kit';
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from '@solana-program/compute-budget';
import { getAdvanceNonceAccountInstruction } from '@solana-program/system';
import {
  buildTransaction,
  COMPUTE_UNIT_LIMIT,
  COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
  expectedFeePayer,
  LIGHTHOUSE_PROGRAM_ADDRESS,
  type Lifetime,
  type TransactionAction,
} from '../src/index.ts';

type CompiledMessage = LegacyCompiledTransactionMessage & CompiledTransactionMessageWithLifetime;

/** A deterministic address: 32 bytes of `n`. Fine for unsigned transactions (nothing has to sign for it). */
export function key(n: number): Address {
  return getAddressDecoder().decode(new Uint8Array(32).fill(n));
}

/** The lifetime token a transaction carries: the blockhash, or the nonce value for a durable nonce. */
export function lifetimeToken(lifetime: Lifetime): string {
  return lifetime.kind === 'blockhash' ? lifetime.blockhash : lifetime.nonceValue;
}

/**
 * Compiles exactly these instructions (nothing prepended) into an unsigned legacy wire transaction with
 * `token` as its lifetime token. With an AdvanceNonceAccount first and the nonce value as token this is a durable
 * nonce transaction, but nothing stops a test from putting AdvanceNonceAccount elsewhere.
 */
export function craft(instructions: readonly Instruction[], feePayer: Address, token: string): Uint8Array {
  const message = pipe(
    createTransactionMessage({ version: 'legacy' }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(token), lastValidBlockHeight: 0n }, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
}

/** The same instructions as a v0 message, optionally compressed with an address lookup table. */
export function craftV0(
  instructions: readonly Instruction[],
  feePayer: Address,
  token: string,
  lookupTable?: { address: Address; addresses: Address[] },
): Uint8Array {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(token), lastValidBlockHeight: 0n }, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const compressed =
    lookupTable === undefined
      ? message
      : compressTransactionMessageUsingAddressLookupTables(message, { [lookupTable.address]: lookupTable.addresses });
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(compressed)));
}

/** The builder's prefix for a lifetime: [AdvanceNonceAccount]? [CU limit] [CU price]. */
export function prefixInstructions(lifetime: Lifetime): Instruction[] {
  const budget = [
    getSetComputeUnitLimitInstruction({ units: COMPUTE_UNIT_LIMIT }),
    getSetComputeUnitPriceInstruction({ microLamports: COMPUTE_UNIT_PRICE_MICRO_LAMPORTS }),
  ];
  if (lifetime.kind === 'blockhash') return budget;
  const advance = getAdvanceNonceAccountInstruction({
    nonceAccount: lifetime.nonceAccount,
    nonceAuthority: createNoopSigner(lifetime.nonceAuthority),
  });
  return [advance, ...budget];
}

/** `buildTransaction(action)` with the fee payer from `expectedFeePayer`, unless one is given. */
export function build(action: TransactionAction, lifetime: Lifetime, feePayer: Address = expectedFeePayer(action)) {
  return buildTransaction(action, { feePayer, lifetime });
}

/**
 * The instructions of a built (or any legacy) wire transaction, decompiled by kit with merged roles. Re-crafting
 * them with the same fee payer and token gives the same bytes, so a test can change exactly one thing.
 */
export function instructionsOf(bytes: Uint8Array): Instruction[] {
  const message = decompileTransactionMessage(decodeMessage(bytes));
  return [...message.instructions];
}

export function decodeMessage(bytes: Uint8Array): CompiledMessage {
  const compiled = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(bytes).messageBytes);
  if (compiled.version !== 'legacy') throw new Error('expected a legacy message');
  return compiled;
}

/** Wire bytes for a compiled message, with one empty signature slot per required signer. */
export function wireFromMessage(message: CompiledTransactionMessage): Uint8Array {
  const messageBytes = getCompiledTransactionMessageEncoder().encode(message) as TransactionMessageBytes;
  const signers = message.staticAccounts.slice(0, message.header.numSignerAccounts);
  const transaction: Transaction = {
    messageBytes,
    signatures: Object.fromEntries(signers.map((signer) => [signer, null])),
  };
  return new Uint8Array(getTransactionEncoder().encode(transaction));
}

/** Decodes `bytes`, lets `edit` change the compiled message, re-encodes with empty signature slots. */
export function editMessage(bytes: Uint8Array, edit: (message: CompiledMessage) => CompiledMessage): Uint8Array {
  return wireFromMessage(edit(decodeMessage(bytes)));
}

/**
 * Re-lists the static accounts (new order, new or dropped entries) and header, keeping every instruction pointing at
 * the same addresses.
 */
export function relist(
  message: CompiledMessage,
  staticAccounts: Address[],
  header: CompiledMessage['header'] = message.header,
): CompiledMessage {
  const at = (index: number): number => {
    const address = message.staticAccounts[index];
    const moved = address === undefined ? -1 : staticAccounts.indexOf(address);
    if (moved === -1) throw new Error(`account ${String(index)} dropped`);
    return moved;
  };
  return {
    ...message,
    header,
    staticAccounts,
    instructions: message.instructions.map((ix) => ({
      ...ix,
      programAddressIndex: at(ix.programAddressIndex),
      ...(ix.accountIndices === undefined ? {} : { accountIndices: ix.accountIndices.map(at) }),
    })),
  };
}

/** Lighthouse assertion data: opaque bytes for these tests (the inspector never parses Lighthouse data). */
export const LIGHTHOUSE_DATA = Uint8Array.of(0x0b, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07);

/**
 * What Phantom does (CLAUDE.md section 6): appends `count` Lighthouse instructions reading `accounts`. New accounts
 * (the Lighthouse program and any account not yet in the message) are appended as read-only non-signers at the end
 * of the static accounts; nothing else in the message moves. Signature slots are empty again.
 */
export function appendLighthouseTail(bytes: Uint8Array, accounts: readonly Address[] = [], count = 1): Uint8Array {
  return editMessage(bytes, (message) => {
    const added = [LIGHTHOUSE_PROGRAM_ADDRESS, ...accounts].filter(
      (address, index, all) => !message.staticAccounts.includes(address) && all.indexOf(address) === index,
    );
    const staticAccounts = [...message.staticAccounts, ...added];
    const instruction = {
      programAddressIndex: staticAccounts.indexOf(LIGHTHOUSE_PROGRAM_ADDRESS),
      ...(accounts.length === 0 ? {} : { accountIndices: accounts.map((address) => staticAccounts.indexOf(address)) }),
      data: LIGHTHOUSE_DATA,
    };
    return {
      ...message,
      header: { ...message.header, numReadonlyNonSignerAccounts: message.header.numReadonlyNonSignerAccounts + added.length },
      staticAccounts,
      instructions: [...message.instructions, ...Array.from({ length: count }, () => instruction)],
    };
  });
}

/** A Lighthouse instruction as a kit instruction (for tails compiled by kit, which may reorder accounts). */
export function lighthouseInstruction(accounts: Instruction['accounts'] = []): Instruction {
  return { programAddress: LIGHTHOUSE_PROGRAM_ADDRESS, accounts, data: LIGHTHOUSE_DATA };
}

/** Re-encodes a wire transaction with `signer`'s signature slot replaced (e.g. by a corrupted signature). */
export function replaceSignature(bytes: Uint8Array, signer: Address, signature: Uint8Array | null): Uint8Array {
  const transaction = getTransactionDecoder().decode(bytes);
  if (!(signer in transaction.signatures)) throw new Error(`${signer} is not a signer`);
  return new Uint8Array(
    getTransactionEncoder().encode({
      ...transaction,
      signatures: { ...transaction.signatures, [signer]: signature as SignatureBytes | null },
    }),
  );
}

/** The signature `signer` put on `bytes` (throws when there is none). */
export function signatureOf(bytes: Uint8Array, signer: Address): Uint8Array {
  const signature = getTransactionDecoder().decode(bytes).signatures[signer];
  if (signature === undefined || signature === null) throw new Error(`no signature from ${signer}`);
  return Uint8Array.from(signature);
}
