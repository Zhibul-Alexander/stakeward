// encodeStakeAccountData writes what decodeStakeAccount reads, byte for byte as the stake program lays it out.
import { describe, expect, it } from 'vitest';
import { decodeStakeAccount, encodeStakeAccountData, STAKE_ACCOUNT_SIZE, type StakeAccount } from '../src/index.ts';
import { FIXTURES, rawFromFixture } from './fixtures.ts';
import { rawStakeAccount, stakeAccountOf } from './raw-stake.ts';

/** Bytes the encoder writes as zero because Stakeward never reads them: warmup rate, credits_observed, flags, padding. */
const UNREAD_FROM = 180;
/** End of Meta: an Initialized account has nothing after it. */
const META_END = 124;

describe('encodeStakeAccountData', () => {
  it.each(Object.entries(FIXTURES))('gives back the mainnet account %s when decoded', (_name, fixture) => {
    const raw = rawFromFixture(fixture);
    const decoded = decodeStakeAccount(raw);
    if (!decoded.ok) throw new Error(decoded.error);
    const data = encodeStakeAccountData(decoded.account);

    expect(data).toHaveLength(STAKE_ACCOUNT_SIZE);
    expect(decodeStakeAccount({ ...raw, data })).toEqual(decoded);
    // Every byte Stakeward reads is the chain's byte; the rest is zero.
    const read = decoded.account.delegation === null ? META_END : UNREAD_FROM;
    expect([...data.subarray(0, read)]).toEqual([...raw.data.subarray(0, read)]);
    expect(data.subarray(read).every((byte) => byte === 0)).toBe(true);
  });

  it('writes the same bytes as the test encoder, Initialized and Stake', () => {
    const initialized = stakeAccountOf();
    const delegated: StakeAccount = {
      ...initialized,
      kind: 'delegated',
      delegation: { voter: initialized.staker, stake: 4_000_000_000n, activationEpoch: 800n, deactivationEpoch: 951n },
    };
    for (const account of [initialized, delegated]) {
      expect(encodeStakeAccountData(account)).toEqual(rawStakeAccount(account).data);
    }
  });
});
