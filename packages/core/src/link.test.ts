import { describe, expect, it } from 'vitest';
import {
  cosignFragment,
  decodeBase64Url,
  encodeBase64Url,
  MAX_TRANSACTION_BYTES,
  parseCosignFragment,
} from './link.ts';

const bytes = (length: number): Uint8Array => Uint8Array.from({ length }, (_, i) => (i * 37 + 11) % 256);

describe('base64url', () => {
  it('round-trips every length without padding or + and /', () => {
    for (let length = 0; length <= 70; length++) {
      const text = encodeBase64Url(bytes(length));
      expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(decodeBase64Url(text)).toEqual(bytes(length));
    }
  });

  it('uses the url-safe alphabet', () => {
    expect(encodeBase64Url(Uint8Array.of(0xfb, 0xff, 0xbf))).toBe('-_-_');
  });

  it.each([
    ['standard alphabet', '+/+/'],
    ['padding', 'AA=='],
    ['impossible length', 'AAAAA'],
    ['non-canonical trailing bits', 'AB'],
    ['other characters', 'AA AA'],
  ])('rejects %s', (_name, text) => {
    expect(decodeBase64Url(text)).toBeNull();
  });
});

describe('cosign fragment', () => {
  it('round-trips a transaction through #tx=', () => {
    const tx = bytes(600);
    expect(parseCosignFragment(`#${cosignFragment(tx)}`)).toEqual(tx);
    expect(parseCosignFragment(cosignFragment(tx))).toEqual(tx);
  });

  it.each([
    ['empty', ''],
    ['no tx parameter', '#foo=AAAA'],
    ['extra parameter', `#${cosignFragment(bytes(10))}&x=1`],
    ['empty transaction', '#tx='],
    ['garbage', '#tx=%%%'],
    ['too long', `#${cosignFragment(bytes(MAX_TRANSACTION_BYTES + 1))}`],
  ])('rejects %s', (_name, fragment) => {
    expect(parseCosignFragment(fragment)).toBeNull();
  });

  it('accepts the largest transaction', () => {
    expect(parseCosignFragment(cosignFragment(bytes(MAX_TRANSACTION_BYTES)))).toHaveLength(MAX_TRANSACTION_BYTES);
  });
});
