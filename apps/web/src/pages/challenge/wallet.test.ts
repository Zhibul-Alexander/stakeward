import { describe, expect, it } from 'vitest';
import { CHALLENGE, DEVNET_CHALLENGE, MAINNET_CHALLENGE } from './wallet.ts';

const iso = (seconds: bigint) => new Date(Number(seconds) * 1000).toISOString();

describe('the challenge wallets (D133, D154)', () => {
  it('each names three different keys and holds no secret', () => {
    for (const wallet of [DEVNET_CHALLENGE, MAINNET_CHALLENGE]) {
      expect(new Set([wallet.mainKey, wallet.stakeAccount, wallet.secondKey]).size).toBe(3);
      expect(Object.keys(wallet).sort()).toEqual(['lockUntil', 'mainKey', 'secondKey', 'stakeAccount', 'startLamports']);
    }
    expect(new Set([...Object.values(DEVNET_CHALLENGE), ...Object.values(MAINNET_CHALLENGE)].filter((value) => typeof value === 'string')).size).toBe(6);
  });

  it('locks devnet until 12 October 2027 and mainnet until 14 April 2027, 00:00 UTC', () => {
    expect(iso(DEVNET_CHALLENGE.lockUntil)).toBe('2027-10-12T00:00:00.000Z');
    expect(iso(MAINNET_CHALLENGE.lockUntil)).toBe('2027-04-14T00:00:00.000Z');
  });

  it("is the build's cluster wallet (tests run as devnet)", () => {
    expect(CHALLENGE).toBe(DEVNET_CHALLENGE);
  });
});
