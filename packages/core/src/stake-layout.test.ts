import { address, getAddressEncoder, type Address } from '@solana/kit';
import { getStakeStateAccountEncoder } from '@solana-program/stake';
import { describe, expect, it } from 'vitest';
import { STAKE_ACCOUNT_OFFSETS, STAKE_ACCOUNT_SIZE } from './index.ts';

const STAKER = address('8NDkBUK5EJnSjyKtyNCWy4oyQTHnLuqTnBYoqnTbNJpE');
const WITHDRAWER = address('57RQ3ocAibVdC3n3S9i4gT39EpF4DhRCbqAivyg6wtQ6');
const CUSTODIAN = address('3XdBZcURF5nKg3oTZAcfQZg8XEc5eKsx6vK8r3BdGGxg');

describe('stake account layout', () => {
  it('has the size of StakeStateV2', () => {
    expect(STAKE_ACCOUNT_SIZE).toBe(200);
  });

  it('filter offsets match the generated stake client encoding', () => {
    const data = getStakeStateAccountEncoder().encode({
      state: {
        __kind: 'Initialized',
        fields: [
          {
            rentExemptReserve: 2_282_880n,
            authorized: { staker: STAKER, withdrawer: WITHDRAWER },
            lockup: { unixTimestamp: 1_825_545_600n, epoch: 0n, custodian: CUSTODIAN },
          },
        ],
      },
    });
    const bytesAt = (offset: number) => Array.from(data.slice(offset, offset + 32));
    const encodeAddress = (value: Address) => Array.from(getAddressEncoder().encode(value));

    expect(bytesAt(STAKE_ACCOUNT_OFFSETS.staker)).toEqual(encodeAddress(STAKER));
    expect(bytesAt(STAKE_ACCOUNT_OFFSETS.withdrawer)).toEqual(encodeAddress(WITHDRAWER));
    expect(bytesAt(STAKE_ACCOUNT_OFFSETS.custodian)).toEqual(encodeAddress(CUSTODIAN));
  });
});
