import { getAddressDecoder, type Address } from '@solana/kit';
import { U64_MAX, ZERO_ADDRESS, type StakeAccount } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { buildAccountsView } from './view.ts';

// Review (security lens, CLAUDE.md sections 5 and 11, DECISIONS.md D14): the chain cannot say whose key holds a lock.
// Section 5: "in force, custodian is someone else's -> Locked by someone else, view only". D14: "a custodian not in the
// list -> Locked by someone else". Section 11 lists the threat "a fake Stakeward site that sets the thief as
// custodian". Its victim, opening the real site on any device where they never protected (no known second key), must
// not be told that the thief's lock is "Protected" and counted as protected SOL.

const key = (n: number): Address => getAddressDecoder().decode(new Uint8Array(32).fill(n));
const DAY = 86_400n;
const SOL = 1_000_000_000n;
const clock = { unixTimestamp: 1_800_000_000n, epoch: 900n };

const MAIN = key(1);
const THIEF = key(7);

function lockedBy(custodian: Address, days: bigint): StakeAccount {
  return {
    address: key(20 + Number(days % 50n)),
    lamports: 40n * SOL,
    kind: 'delegated',
    rentExemptReserve: 1_666_240n,
    staker: MAIN,
    withdrawer: MAIN,
    lockup: { unixTimestamp: clock.unixTimestamp + days * DAY, epoch: 0n, custodian },
    delegation: { voter: key(99), stake: 40n * SOL, activationEpoch: 800n, deactivationEpoch: U64_MAX },
  };
}

describe('review: a lock held by an unknown key, viewer with no known second key', () => {
  it('is not presented as Protected or Expiring, and is not counted as protected SOL', () => {
    const thiefLock = lockedBy(THIEF, 200n);
    const thiefLockSoon = lockedBy(THIEF, 10n);
    const view = buildAccountsView({
      address: MAIN,
      accounts: [thiefLock, thiefLockSoon],
      clock,
      knownSecondKeys: [],
      rememberedProtected: [],
    });
    for (const row of view.owned) {
      expect(row.account.lockup.custodian).not.toBe(ZERO_ADDRESS);
      expect(['protected', 'expiring'], `${row.account.address} shows as ${row.protection}`).not.toContain(row.protection);
    }
    expect(view.totals.protectedLamports).toBe(0n);
  });
});
