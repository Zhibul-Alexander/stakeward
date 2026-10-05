import { describe, expect, it } from 'vitest';
import { decodeBase64, encodeBase64, isCanonicalBase64 } from '../src/base64.ts';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

describe('isCanonicalBase64', () => {
  it('agrees with decodeBase64 on edge cases', () => {
    const cases = ['', 'AA==', 'AQ==', 'AR==', 'AAE=', 'AAF=', 'AAA=', 'AAAA', 'A===', '====', 'AA=A', 'AA', 'AAA', 'AA-A', 'AA_A', 'AA A', 'AAAA\n'];
    for (const text of cases) expect([text, isCanonicalBase64(text)]).toEqual([text, decodeBase64(text) !== null]);
    expect(isCanonicalBase64(encodeBase64(new Uint8Array(200).fill(0xff)))).toBe(true);
  });

  it('agrees with decodeBase64 on every last character before one or two "=" and on random text', () => {
    for (const char of ALPHABET) {
      for (const text of [`AA${char}=`, `A${char}==`, `AAAAAA${char}=`]) {
        expect([text, isCanonicalBase64(text)]).toEqual([text, decodeBase64(text) !== null]);
      }
    }
    const symbols = `${ALPHABET}=-_ `;
    for (let i = 0; i < 5_000; i++) {
      const bytes = crypto.getRandomValues(new Uint8Array(1 + (i % 12)));
      const text = Array.from(bytes, (b) => symbols[b % symbols.length]).join('');
      expect([text, isCanonicalBase64(text)]).toEqual([text, decodeBase64(text) !== null]);
      const encoded = encodeBase64(bytes);
      expect(isCanonicalBase64(encoded)).toBe(true);
    }
  });
});
