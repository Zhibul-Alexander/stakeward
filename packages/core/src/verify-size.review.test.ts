// Review (step 3, CPU changes): decodeLegacyMessage now checks canonical encoding by size instead of re-encoding.
// The size argument assumes kit's decoder never reads FEWER bytes than the canonical encoding. It can: kit's array
// decoder returns [] without reading the compact-u16 count when the bytes end right before it (getArrayDecoder,
// `offset >= bytes.length`). A message that ends after its lifetime token (instruction count missing, -1 byte) and
// carries a 2-byte non-minimal account count (+1 byte) has exactly the canonical size, so it passes as canonical.
import {
  getAddressEncoder,
  getCompiledTransactionMessageDecoder,
  getCompiledTransactionMessageEncoder,
  getTransactionDecoder,
  type Address,
} from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { build, key } from '../test/craft.ts';
import type { BlockhashLifetime } from './actions.ts';
import { decodeLegacyMessage, decodeWireTransaction } from './verify.ts';

const [A, K, S] = [1, 2, 3].map(key) as [Address, Address, Address];

function craftedMessage(): Uint8Array {
  const protect = build(
    { kind: 'protect', stakeAccount: S, mainKey: A, secondKey: K, lockUntil: 1_825_545_600n },
    { kind: 'blockhash', blockhash: key(20), lastValidBlockHeight: 1n } as unknown as BlockhashLifetime,
  ).bytes;
  const message = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(protect).messageBytes);
  if (message.version !== 'legacy') throw new Error('legacy expected');
  const addressEncoder = getAddressEncoder();
  const header = [message.header.numSignerAccounts, message.header.numReadonlySignerAccounts, message.header.numReadonlyNonSignerAccounts];
  const count = message.staticAccounts.length; // < 128: minimal form is one byte
  const parts: number[] = [...header, count | 0x80, 0x00]; // the same count in a non-minimal 2-byte form
  for (const address of message.staticAccounts) parts.push(...addressEncoder.encode(address));
  parts.push(...addressEncoder.encode(message.lifetimeToken as Address));
  // No instruction count and no instructions: the bytes end here.
  return Uint8Array.from(parts);
}

describe('review: canonical-size check of decodeLegacyMessage', () => {
  it('rejects a message whose re-encoding differs (non-minimal count + missing instruction count)', () => {
    const bytes = craftedMessage();
    // The old check: kit re-encodes it to other bytes (one-byte count, explicit zero instruction count).
    const decoded = getCompiledTransactionMessageDecoder().decode(bytes);
    const reencoded = getCompiledTransactionMessageEncoder().encode(decoded);
    expect(Array.from(reencoded)).not.toEqual(Array.from(bytes));
    // The new check must say the same: not canonical.
    const result = decodeLegacyMessage(bytes);
    expect(result.ok).toBe(false);
  });

  it('decodeWireTransaction rejects the same message inside a wire transaction', () => {
    const message = craftedMessage();
    const signers = message[0] ?? 0;
    const wire = Uint8Array.from([signers, ...new Uint8Array(64 * signers), ...message]);
    expect(decodeWireTransaction(wire).ok).toBe(false);
  });
});
