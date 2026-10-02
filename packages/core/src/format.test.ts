import { describe, expect, it } from 'vitest';
import { I64_MAX } from './constants.ts';
import { formatSol, formatUtcDate, shortAddress } from './format.ts';

describe('formatUtcDate', () => {
  it.each([
    [1_807_488_000n, '12 April 2027'], // 2027-04-12T00:00:00Z
    [1_807_487_999n, '11 April 2027'], // one second earlier, still 11 April in UTC
    [0n, '1 January 1970'],
    [1_790_812_800n, '1 October 2026'],
  ])('%s -> %s', (seconds, expected) => {
    expect(formatUtcDate(seconds)).toBe(expected);
  });

  it('returns null outside the Date range (a lockup can hold any i64)', () => {
    expect(formatUtcDate(I64_MAX)).toBeNull();
    expect(formatUtcDate(-I64_MAX)).toBeNull();
  });
});

describe('shortAddress', () => {
  it('keeps the first and last three characters', () => {
    expect(shortAddress('7xKTg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgA9fQ')).toBe('7xK...9fQ');
  });

  it('leaves short strings as they are', () => {
    expect(shortAddress('123456789')).toBe('123456789');
  });
});

describe('formatSol', () => {
  it.each([
    [0n, '0 SOL'],
    [1n, '0.000000001 SOL'],
    [1_500_000_000n, '1.5 SOL'],
    [1_234_500_000_000n, '1,234.5 SOL'],
    [551_122_033_849_780n, '551,122.03384978 SOL'],
    [-2_000_000_000n, '-2 SOL'],
  ])('%s lamports -> %s', (lamports, expected) => {
    expect(formatSol(lamports)).toBe(expected);
  });
});
