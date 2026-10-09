import { address, getAddressEncoder, type Address } from '@solana/kit';
import { getStakeStateAccountEncoder } from '@solana-program/stake';
import { describe, expect, it } from 'vitest';
import { NONCE_ACCOUNT_SIZE, STAKE_ACCOUNT_OFFSETS, STAKE_ACCOUNT_SIZE, U64_MAX, ZERO_ADDRESS } from './constants.ts';

const STAKER = address('8NDkBUK5EJnSjyKtyNCWy4oyQTHnLuqTnBYoqnTbNJpE');
const WITHDRAWER = address('57RQ3ocAibVdC3n3S9i4gT39EpF4DhRCbqAivyg6wtQ6');
const CUSTODIAN = address('3XdBZcURF5nKg3oTZAcfQZg8XEc5eKsx6vK8r3BdGGxg');

describe('constants', () => {
  it('match the account sizes of the stake and nonce programs', () => {
    expect(STAKE_ACCOUNT_SIZE).toBe(200);
    expect(NONCE_ACCOUNT_SIZE).toBe(80);
  });

  it('has u64::MAX and the all-zero key', () => {
    expect(U64_MAX).toBe(18_446_744_073_709_551_615n);
    expect(Array.from(getAddressEncoder().encode(ZERO_ADDRESS))).toEqual(new Array(32).fill(0));
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
