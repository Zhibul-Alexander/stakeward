import { describe, expect, it } from 'vitest';
import { CHALLENGE } from './wallet.ts';

describe('the challenge wallet (D133)', () => {
  it('names three different keys and holds no secret', () => {
    expect(new Set([CHALLENGE.mainKey, CHALLENGE.stakeAccount, CHALLENGE.secondKey]).size).toBe(3);
    expect(Object.keys(CHALLENGE).sort()).toEqual(['lockUntil', 'mainKey', 'secondKey', 'stakeAccount']);
  });

  it('locks until 12 October 2027, 00:00 UTC', () => {
    expect(new Date(Number(CHALLENGE.lockUntil) * 1000).toISOString()).toBe('2027-10-12T00:00:00.000Z');
  });
});
