// The CPU shortcuts of verify.ts and inspect.ts (the worker runs them on every sendTransaction; DECISIONS.md D23)
// against the checks they replace, which stay here as oracles:
//   - canonical encoding by size (decodeLegacyMessage) against kit's re-encoding compared byte for byte;
//   - isSameMessage against comparing the encoded messages;
//   - the builder's compiled message (compileActionMessage) against the bytes buildTransaction returns;
//   - inspectAndVerifyTransaction against inspectTransaction + verifyAllSignatures.
import {
  blockhash,
  getCompiledTransactionMessageDecoder,
  getCompiledTransactionMessageEncoder,
  getTransactionDecoder,
  getTransactionEncoder,
  type Address,
  type Nonce,
  type ReadonlyUint8Array,
  type Transaction,
  type TransactionMessageBytes,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { describe, expect, it } from 'vitest';
import {
  appendLighthouseTail,
  build,
  craft,
  decodeMessage,
  editMessage,
  key,
  lifetimeToken,
  prefixInstructions,
  replaceSignature,
  signatureOf,
} from '../test/craft.ts';
import { newTestWallet, type TestWallet } from '../test/wallet.ts';
import { createNoopSigner } from '@solana/kit';
import type { BlockhashLifetime, Lifetime, NonceLifetime, TransactionAction } from './actions.ts';
import { compileActionMessage, deriveNonceAccountAddress } from './builders.ts';
import { NONCE_ACCOUNT_SEED } from './constants.ts';
import { inspectAndVerifyTransaction, inspectTransaction } from './inspect.ts';
import { decodeLegacyMessage, isSameMessage, verifyAllSignatures, type LegacyMessage } from './verify.ts';

const messageDecoder = getCompiledTransactionMessageDecoder();
const messageEncoder = getCompiledTransactionMessageEncoder();
const NOT_CANONICAL = 'The message is not canonically encoded (trailing or altered bytes)';

const [A, K, D, S, VOTE, NONCE] = [1, 2, 3, 4, 5, 6].map(key) as [Address, Address, Address, Address, Address, Address];
const T = 1_825_545_600n;
const BLOCKHASH: BlockhashLifetime = { kind: 'blockhash', blockhash: blockhash(key(20)), lastValidBlockHeight: 100n };
const NONCE_LIFETIME: NonceLifetime = { kind: 'nonce', nonceAccount: NONCE, nonceAuthority: D, nonceValue: key(21) as string as Nonce };
const SETUP_NONCE = await deriveNonceAccountAddress(D);

const ACTIONS: readonly TransactionAction[] = [
  { kind: 'protect', stakeAccount: S, mainKey: A, secondKey: K, lockUntil: T },
  { kind: 'extend', stakeAccount: S, secondKey: K, lockUntil: T },
  { kind: 'unlock', stakeAccount: S, secondKey: K },
  { kind: 'withdraw', stakeAccount: S, mainKey: A, secondKey: K, recipient: A, lamports: 5_000_000_000n },
  { kind: 'withdraw', stakeAccount: S, mainKey: A, secondKey: null, recipient: A, lamports: 1n },
  { kind: 'deactivate', stakeAccount: S, staker: A },
  { kind: 'delegate', stakeAccount: S, staker: A, voteAccount: VOTE },
  { kind: 'rescue', stakeAccount: S, mainKey: A, secondKey: K, newWallet: D },
  { kind: 'nonce-setup', nonceAccount: SETUP_NONCE, nonceAuthority: D, seed: NONCE_ACCOUNT_SEED, lamports: 1_056_640n },
  { kind: 'nonce-close', nonceAccount: SETUP_NONCE, nonceAuthority: D, recipient: D, lamports: 1_056_640n },
];
const LIFETIMES: readonly Lifetime[] = [BLOCKHASH, NONCE_LIFETIME];

function bytesEqual(a: ReadonlyUint8Array, b: ReadonlyUint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function messageBytesOf(wire: Uint8Array): Uint8Array {
  return Uint8Array.from(getTransactionDecoder().decode(wire).messageBytes);
}

/** What decodeLegacyMessage checked before: kit re-encodes the message to the very same bytes. Null: not legacy. */
function canonicalByReencoding(bytes: Uint8Array): boolean | null {
  let message;
  try {
    message = messageDecoder.decode(bytes);
  } catch {
    return null;
  }
  if (message.version !== 'legacy') return null;
  try {
    return bytesEqual(messageEncoder.encode(message), bytes);
  } catch {
    return false;
  }
}

/** Every message the builder makes. */
function builtMessages(): Uint8Array[] {
  return ACTIONS.flatMap((action) =>
    LIFETIMES.filter((lifetime) => action.kind !== 'rescue' || lifetime.kind === 'blockhash' || lifetime.nonceAuthority === D)
      .filter((lifetime) => !action.kind.startsWith('nonce-') || lifetime.kind === 'blockhash')
      .map((lifetime) => messageBytesOf(build(action, lifetime).bytes)),
  );
}

/**
 * Messages to edit byte by byte: protect, the rescue on a nonce (most instructions), the nonce setup (a string seed in
 * the data), a Lighthouse tail, and a tail whose data length needs a two-byte compact-u16.
 */
function editedCorpus(): Uint8Array[] {
  const protect = build(ACTIONS[0] as TransactionAction, BLOCKHASH).bytes;
  const tail = appendLighthouseTail(protect, [S, key(30)], 2);
  const longTail = editMessage(tail, (message) => ({
    ...message,
    instructions: message.instructions.map((ix, index) =>
      index === message.instructions.length - 1 ? { ...ix, data: Uint8Array.from({ length: 200 }, (_, i) => i) } : ix,
    ),
  }));
  const rescue = build(ACTIONS[7] as TransactionAction, NONCE_LIFETIME).bytes;
  const setup = build(ACTIONS[8] as TransactionAction, BLOCKHASH).bytes;
  return [protect, rescue, setup, tail, longTail].map(messageBytesOf);
}

/** Positions of every compact-u16 in a legacy message (they are the only fields with a longer, non-minimal form). */
function compactPositions(bytes: Uint8Array): number[] {
  const message = messageDecoder.decode(bytes);
  if (message.version !== 'legacy') throw new Error('legacy only');
  const compact = (value: number) => (value < 0x80 ? 1 : value < 0x4000 ? 2 : 3);
  const positions = [3];
  let offset = 3 + compact(message.staticAccounts.length) + 32 * message.staticAccounts.length + 32;
  positions.push(offset);
  offset += compact(message.instructions.length);
  for (const ix of message.instructions) {
    const indices = ix.accountIndices?.length ?? 0;
    const data = ix.data?.length ?? 0;
    offset += 1;
    positions.push(offset);
    offset += compact(indices) + indices;
    positions.push(offset);
    offset += compact(data) + data;
  }
  return positions;
}

/** The same value at `position` in a longer form: one more byte, or two more. */
function lengthen(bytes: Uint8Array, position: number, extra: 1 | 2): Uint8Array {
  let end = position;
  while ((bytes[end] ?? 0) & 0x80) end += 1;
  const last = bytes[end] ?? 0;
  const longer = [...bytes.slice(position, end), last | 0x80, ...(extra === 2 ? [0x80, 0x00] : [0x00])];
  return Uint8Array.from([...bytes.slice(0, position), ...longer, ...bytes.slice(end + 1)]);
}

function mutations(bytes: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  bytes.forEach((byte, index) => {
    for (const value of [byte ^ 0x01, byte ^ 0x80]) {
      const copy = bytes.slice();
      copy[index] = value;
      out.push(copy);
    }
  });
  for (const position of compactPositions(bytes)) out.push(lengthen(bytes, position, 1), lengthen(bytes, position, 2));
  for (const trailing of [[0], [0x80], [0xff, 0xff], [...bytes.slice(0, 5)]]) out.push(Uint8Array.from([...bytes, ...trailing]));
  for (const cut of [1, 3, 4, 36, 68, bytes.length - 33, bytes.length - 1]) out.push(bytes.slice(0, cut));
  for (let index = 0; index < bytes.length; index += 11) out.push(Uint8Array.from([...bytes.slice(0, index), 0, ...bytes.slice(index)]));
  return out;
}

describe('canonical encoding by size', () => {
  it('agrees with re-encoding on every message the builder makes and on thousands of edits of them', { timeout: 60_000 }, () => {
    for (const original of builtMessages()) {
      expect(canonicalByReencoding(original)).toBe(true);
      expect(decodeLegacyMessage(original).ok).toBe(true);
    }
    let canonical = 0;
    let altered = 0;
    for (const original of editedCorpus()) {
      expect(canonicalByReencoding(original)).toBe(true);
      expect(decodeLegacyMessage(original).ok).toBe(true);
      for (const bytes of mutations(original)) {
        const expected = canonicalByReencoding(bytes);
        const result = decodeLegacyMessage(bytes);
        if (expected === null) {
          expect(result.ok).toBe(false);
          continue;
        }
        // No instructions: rejected before the size check, which is exact only with at least one instruction (kit
        // reads a missing instruction count at the end of the bytes as zero; verify-size.review.test.ts).
        const decoded = messageDecoder.decode(bytes);
        if (decoded.version === 'legacy' && decoded.instructions.length === 0) {
          expect(result, hex(bytes)).toMatchObject({ ok: false, message: 'The message has no instructions' });
          continue;
        }
        const bySize = result.ok || result.message !== NOT_CANONICAL;
        expect(bySize, hex(bytes)).toBe(expected);
        if (expected) canonical += 1;
        else altered += 1;
      }
    }
    // Both outcomes were exercised many times.
    expect(canonical).toBeGreaterThan(500);
    expect(altered).toBeGreaterThan(200);
  });

  it('rejects a longer compact-u16 anywhere in the message, and trailing bytes', () => {
    for (const original of [...builtMessages(), ...editedCorpus()]) {
      for (const position of compactPositions(original)) {
        for (const extra of [1, 2] as const) {
          expect(decodeLegacyMessage(lengthen(original, position, extra))).toMatchObject({ ok: false, code: 'malformed' });
        }
      }
      expect(decodeLegacyMessage(Uint8Array.from([...original, 0]))).toMatchObject({ ok: false, message: NOT_CANONICAL });
    }
  });
});

describe('isSameMessage', () => {
  it('is true exactly when the encoded messages are the same bytes', { timeout: 60_000 }, () => {
    const checked: { bytes: Uint8Array; message: LegacyMessage }[] = [];
    const originals = [...builtMessages(), ...editedCorpus()];
    for (const original of editedCorpus()) {
      for (const bytes of [original, ...mutations(original)]) {
        const result = decodeLegacyMessage(bytes);
        if (result.ok) checked.push({ bytes, message: result.message });
      }
    }
    for (const original of originals) {
      const result = decodeLegacyMessage(original);
      if (result.ok) checked.push({ bytes: original, message: result.message });
    }
    expect(checked.length).toBeGreaterThan(500);
    for (const original of originals) {
      const base = decodeLegacyMessage(original);
      if (!base.ok) throw new Error('corpus message does not decode');
      for (const other of checked) {
        expect(isSameMessage(base.message, other.message)).toBe(bytesEqual(original, other.bytes));
        expect(isSameMessage(other.message, base.message)).toBe(bytesEqual(original, other.bytes));
      }
    }
  });
});

describe('compileActionMessage', () => {
  it('is the message buildTransaction encodes, for every action and lifetime', () => {
    for (const action of ACTIONS) {
      for (const lifetime of LIFETIMES) {
        if (action.kind === 'rescue' && lifetime.kind === 'nonce' && lifetime.nonceAuthority !== D) continue;
        for (const feePayer of [build(action, lifetime).meta.feePayer, A]) {
          let compiled;
          try {
            compiled = compileActionMessage(action, { feePayer, lifetime });
          } catch (error) {
            // The builder refuses it too (a rescue paid by the main key).
            expect(() => build(action, lifetime, feePayer)).toThrow((error as Error).message);
            continue;
          }
          const wire = build(action, lifetime, feePayer).bytes;
          expect(new Uint8Array(messageEncoder.encode(compiled))).toEqual(messageBytesOf(wire));
          const decoded = decodeLegacyMessage(messageBytesOf(wire));
          if (!decoded.ok) throw new Error(decoded.message);
          expect(isSameMessage(compiled, decoded.message)).toBe(true);
        }
      }
    }
  });
});

describe('inspectAndVerifyTransaction', () => {
  async function sign(wallets: readonly TestWallet[], bytes: Uint8Array): Promise<Uint8Array> {
    let out = bytes;
    for (const wallet of wallets) {
      const [signed] = await wallet.signTransactions([out]);
      if (signed === undefined) throw new Error('wallet returned nothing');
      out = signed;
    }
    return out;
  }

  it('returns what inspectTransaction and verifyAllSignatures return, on accepted and refused bytes', async () => {
    const [main, second, fresh] = await Promise.all([newTestWallet(), newTestWallet(), newTestWallet()]);
    const protect = build({ kind: 'protect', stakeAccount: S, mainKey: main.address, secondKey: second.address, lockUntil: T }, BLOCKHASH).bytes;
    const nonce: NonceLifetime = { ...NONCE_LIFETIME, nonceAuthority: fresh.address };
    const rescue = build(
      { kind: 'rescue', stakeAccount: S, mainKey: main.address, secondKey: second.address, newWallet: fresh.address },
      nonce,
    ).bytes;
    const both = await sign([main, second], protect);
    const tailed = await sign([main, second], appendLighthouseTail(protect, [S], 1));
    const flipped = signatureOf(both, second.address);
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    const transfer = craft(
      [
        ...prefixInstructions(BLOCKHASH),
        getTransferSolInstruction({ source: createNoopSigner(main.address), destination: K, amount: 1n }),
      ],
      main.address,
      lifetimeToken(BLOCKHASH),
    );
    const foreign = craft(
      [...prefixInstructions(BLOCKHASH), { programAddress: key(40), accounts: [], data: new Uint8Array([1]) }],
      main.address,
      lifetimeToken(BLOCKHASH),
    );
    const message = decodeMessage(protect);
    const v0Bytes = messageEncoder.encode({ ...message, version: 0, addressTableLookups: [] }) as TransactionMessageBytes;
    const v0: Transaction = { messageBytes: v0Bytes, signatures: { [main.address]: null, [second.address]: null } };
    const cases: Uint8Array[] = [
      protect,
      await sign([main], protect),
      both,
      tailed,
      replaceSignature(both, second.address, flipped),
      replaceSignature(both, second.address, signatureOf(both, main.address)),
      rescue,
      await sign([fresh, main], rescue),
      await sign([fresh, main, second], rescue),
      ...ACTIONS.map((action) => build(action, BLOCKHASH).bytes),
      transfer,
      foreign,
      new Uint8Array(getTransactionEncoder().encode(v0)),
      new Uint8Array(),
      Uint8Array.from({ length: 300 }, (_, i) => (i * 37 + 11) % 256),
      Uint8Array.from([...both, 0]),
    ];
    const verdicts = new Set<string>();
    for (const bytes of cases) {
      const combined = await inspectAndVerifyTransaction(bytes);
      const inspection = await inspectTransaction(bytes);
      if (!inspection.ok) {
        expect(combined).toStrictEqual(inspection);
        verdicts.add(inspection.error.code);
        continue;
      }
      const signatures = await verifyAllSignatures(bytes);
      expect(combined).toStrictEqual({ ok: true, summary: inspection.summary, signatures });
      verdicts.add(signatures.ok ? 'ok' : signatures.error.code);
    }
    expect([...verdicts].sort()).toEqual(
      [
        'ok',
        'missing-signatures',
        'invalid-signature',
        'malformed',
        'unknown-program',
        'unknown-instruction',
        'unsupported-version',
      ].sort(),
    );
  });
});
