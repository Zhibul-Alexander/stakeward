// isAddressText must answer exactly like kit's isAddress, which it replaces where the worker checks many addresses.
import { getAddressDecoder, isAddress } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { isAddressText } from '../src/address.ts';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Deterministic pseudo-random numbers (xorshift32), so a failure always reproduces. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

describe('isAddressText', () => {
  it('agrees with kit isAddress on edge cases', () => {
    const decode = (bytes: Uint8Array) => getAddressDecoder().decode(bytes);
    const cases = [
      '',
      '1'.repeat(31),
      '1'.repeat(32),
      '1'.repeat(33),
      '1'.repeat(44),
      `${'1'.repeat(31)}2`,
      decode(new Uint8Array(32)),
      decode(new Uint8Array(32).fill(0xff)), // the largest address
      `${decode(new Uint8Array(32).fill(0xff))}1`,
      'JEKNVnkbo3jma5nREBBJCDoXFVeKkD56V3xKrvRmWxFH', // largest + 1: 33 bytes
      'Stake11111111111111111111111111111111111111',
      'SysvarC1ock11111111111111111111111111111111',
      'Stake11111111111111111111111111111111111110', // '0' is not base58
      'StakeO1111111111111111111111111111111111111', // 'O' neither
      'Stakel1111111111111111111111111111111111111', // nor 'l'
      'Stake1111111111111111111111111111111111111é',
      'Stake11111111111111111111111111111111111111 ',
      ...[1, 2, 3, 30, 31].map((zeros) => decode(Uint8Array.from({ length: 32 }, (_, i) => (i < zeros ? 0 : 7 + i)))),
    ];
    for (const text of cases) expect(isAddressText(text), JSON.stringify(text)).toBe(isAddress(text));
  });

  it('agrees with kit isAddress on 20 000 random strings around address length', () => {
    const next = random(0x5eed);
    let valid = 0;
    for (let n = 0; n < 20_000; n++) {
      const length = 30 + Math.floor(next() * 17);
      const leading = next() < 0.2 ? Math.floor(next() * 4) : 0;
      let text = '1'.repeat(Math.min(leading, length));
      while (text.length < length) text += ALPHABET.charAt(Math.floor(next() * ALPHABET.length));
      if (next() < 0.05) {
        const at = Math.floor(next() * length);
        text = `${text.slice(0, at)}${'0OIl+/'.charAt(Math.floor(next() * 6))}${text.slice(at + 1)}`;
      }
      const expected = isAddress(text);
      if (expected) valid += 1;
      expect(isAddressText(text), text).toBe(expected);
    }
    expect(valid).toBeGreaterThan(1000);
  });

  it('accepts every address of random bytes, with leading zero bytes too', () => {
    const next = random(42);
    for (let n = 0; n < 2_000; n++) {
      const zeros = next() < 0.3 ? Math.floor(next() * 5) : 0;
      const bytes = Uint8Array.from({ length: 32 }, (_, i) => (i < zeros ? 0 : Math.floor(next() * 256)));
      expect(isAddressText(getAddressDecoder().decode(bytes))).toBe(true);
    }
  });
});
