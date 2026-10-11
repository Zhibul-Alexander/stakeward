import { describe, expect, it } from 'vitest';
import { I64_MAX } from './constants.ts';
import { formatSol, formatUtcDate, formatUtcDateTime, rfc3339Utc, shortAddress } from './format.ts';

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

describe('formatUtcDateTime', () => {
  it.each([
    [1_807_488_000n, '12 April 2027, 00:00 UTC'],
    [1_807_488_000n + 600n, '12 April 2027, 00:10 UTC'],
    [1_807_487_999n, '11 April 2027, 23:59 UTC'], // seconds are dropped, not rounded
    [1_807_488_000n + 9n * 3_600n + 5n * 60n, '12 April 2027, 09:05 UTC'],
    [0n, '1 January 1970, 00:00 UTC'],
    [-1n, '31 December 1969, 23:59 UTC'],
  ])('%s -> %s', (seconds, expected) => {
    expect(formatUtcDateTime(seconds)).toBe(expected);
  });

  it('returns null outside the Date range', () => {
    expect(formatUtcDateTime(I64_MAX)).toBeNull();
    expect(formatUtcDateTime(-I64_MAX)).toBeNull();
    expect(formatUtcDateTime(8_640_000_000_001n)).toBeNull();
  });
});

describe('rfc3339Utc', () => {
  it.each([
    [0n, '1970-01-01T00:00:00Z'],
    [1_807_488_000n, '2027-04-12T00:00:00Z'],
    [1_807_488_000n + 3_723n, '2027-04-12T01:02:03Z'],
    [-1n, '1969-12-31T23:59:59Z'],
    [253_402_300_799n, '9999-12-31T23:59:59Z'],
    [-62_167_219_200n, '0000-01-01T00:00:00Z'],
  ])('%s -> %s', (seconds, expected) => {
    expect(rfc3339Utc(seconds)).toBe(expected);
    expect(Date.parse(expected)).toBe(Number(seconds) * 1000);
  });

  it('returns null outside the Date range', () => {
    expect(rfc3339Utc(I64_MAX)).toBeNull();
    expect(rfc3339Utc(-I64_MAX)).toBeNull();
  });

  it('returns null for years RFC 3339 cannot write (outside 0000-9999)', () => {
    expect(rfc3339Utc(253_402_300_800n)).toBeNull(); // 10000-01-01T00:00:00Z
    expect(rfc3339Utc(-62_167_219_201n)).toBeNull(); // one second before year 0
  });
});

describe('shortAddress', () => {
  it('keeps the first and last four characters, as Phantom shows them', () => {
    expect(shortAddress('7xKTg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgA9fQ')).toBe('7xKT...A9fQ');
  });

  it('leaves short strings as they are', () => {
    expect(shortAddress('12345678901')).toBe('12345678901');
    expect(shortAddress('123456789012')).toBe('1234...9012');
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
