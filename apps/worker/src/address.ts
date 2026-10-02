import type { Address } from '@solana/kit';

/**
 * Base58 address check for the stake account search, which checks one address per account it returns (up to
 * hundreds per request, 10 ms of CPU on the free plan; test/cpu.test.ts). Same answer as kit's `isAddress` for every
 * string (test/address.test.ts compares them): 32 to 44 characters of the base58 alphabet whose value is exactly
 * 32 bytes (each leading '1' is a zero byte). Kit converts through a bigint, three times; this converts once, with
 * small integers.
 */

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const DIGITS = /* @__PURE__ */ (() => {
  const digits = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) digits[ALPHABET.charCodeAt(i)] = i;
  return digits;
})();
const ONE = 49; // '1', the digit 0

export function isAddressText(text: string): text is Address {
  if (text.length < 32 || text.length > 44) return false;
  let leading = 0;
  while (leading < text.length && text.charCodeAt(leading) === ONE) leading += 1;
  // The value after the leading '1's, as little-endian base-256 digits without leading zeros.
  const bytes: number[] = [];
  for (let i = leading; i < text.length; i++) {
    const code = text.charCodeAt(i);
    let carry = code < 128 ? (DIGITS[code] ?? -1) : -1;
    if (carry < 0) return false;
    for (let j = 0; j < bytes.length; j++) {
      carry += (bytes[j] ?? 0) * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
    // The value only grows with each digit: once longer than 32 bytes it stays so.
    if (leading + bytes.length > 32) return false;
  }
  return leading + bytes.length === 32;
}
