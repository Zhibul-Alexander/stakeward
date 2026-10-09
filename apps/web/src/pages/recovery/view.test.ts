import { getAddressDecoder, type Address } from '@solana/kit';
import { EXPIRING_THRESHOLD_SECONDS, U64_MAX, ZERO_ADDRESS, type Lockup, type StakeAccount } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { accountsPath, buildRecoveryCard, cardLock } from './view.ts';

const key = (n: number): Address => getAddressDecoder().decode(new Uint8Array(32).fill(n));
const DAY = 86_400n;
const SOL = 1_000_000_000n;
const clock = { unixTimestamp: 1_800_000_000n, epoch: 900n };

const A = key(1);
const K = key(2);
const OTHER_SECOND = key(3);
const OTHER_MAIN = key(4);
const SERVICE = key(5);

type StakeOptions = { sol?: bigint; withdrawer?: Address; staker?: Address; lockup?: Partial<Lockup>; delegated?: boolean };

function stake(n: number, options: StakeOptions = {}): StakeAccount {
  const withdrawer = options.withdrawer ?? A;
  const sol = options.sol ?? 2n;
  return {
    address: key(n),
    lamports: sol * SOL,
    kind: options.delegated === false ? 'initialized' : 'delegated',
    rentExemptReserve: 1_666_240n,
    staker: options.staker ?? withdrawer,
    withdrawer,
    lockup: { unixTimestamp: 0n, epoch: 0n, custodian: ZERO_ADDRESS, ...options.lockup },
    delegation:
      options.delegated === false ? null : { voter: key(99), stake: sol * SOL, activationEpoch: 800n, deactivationEpoch: U64_MAX },
  };
}

/** A date lock held by `custodian` (default K), ending `days` days after the clock. */
const lockedFor = (days: bigint, custodian: Address = K): Partial<Lockup> => ({ unixTimestamp: clock.unixTimestamp + days * DAY, custodian });

describe('cardLock', () => {
  it('tells a lock a second key holds from every lock the card cannot speak for', () => {
    expect(cardLock(stake(10), clock)).toBe('not-protected');
    expect(cardLock(stake(11, { lockup: lockedFor(-1n) }), clock)).toBe('not-protected');
    // Exactly at its end a lock is over (core isLockupInForce).
    expect(cardLock(stake(12, { lockup: lockedFor(0n) }), clock)).toBe('not-protected');
    // The main key's own lock: it can lift it alone (D14).
    expect(cardLock(stake(13, { lockup: lockedFor(100n, A) }), clock)).toBe('not-protected');
    // An epoch holds it, now or past its date; Stakeward never sets one.
    expect(cardLock(stake(14, { lockup: { epoch: clock.epoch + 1n, custodian: K } }), clock)).toBe('unsupported-lock');
    expect(cardLock(stake(15, { lockup: { ...lockedFor(100n), epoch: clock.epoch + 1n } }), clock)).toBe('unsupported-lock');
    // Held by no key.
    expect(cardLock(stake(16, { lockup: lockedFor(100n, ZERO_ADDRESS) }), clock)).toBe('unsupported-lock');
    // A date lock held by another key; a past epoch does not change that.
    expect(cardLock(stake(17, { lockup: lockedFor(100n) }), clock)).toBe('protected');
    expect(cardLock(stake(18, { lockup: { ...lockedFor(100n), epoch: clock.epoch } }), clock)).toBe('protected');
  });
});

describe('buildRecoveryCard', () => {
  const route = stake(20, { sol: 1n, lockup: lockedFor(200n) });
  const later = stake(21, { sol: 3n, lockup: lockedFor(150n) });
  const earliestSmall = stake(22, { sol: 1n, lockup: lockedFor(100n) });
  const earliestBig = stake(23, { sol: 9n, lockup: lockedFor(100n) });
  const managed = stake(24, { sol: 4n, staker: SERVICE, lockup: lockedFor(120n) });
  const otherSecond = stake(25, { lockup: lockedFor(100n, OTHER_SECOND) });
  const open = stake(26);
  const ended = stake(27, { lockup: lockedFor(-2n) });
  const selfLocked = stake(28, { lockup: lockedFor(100n, A) });
  const epochLocked = stake(29, { lockup: { epoch: clock.epoch + 5n, custodian: K } });
  const otherMain = stake(30, { withdrawer: OTHER_MAIN, lockup: lockedFor(100n) });

  it('lists the accounts of this main key that this second key locks: the route first, then by end, balance, address', () => {
    const card = buildRecoveryCard(
      route,
      [open, later, otherSecond, earliestSmall, ended, managed, earliestBig, selfLocked, epochLocked, otherMain],
      clock,
    );
    expect(card.accounts.map((row) => row.account.address)).toEqual(
      [route, earliestBig, earliestSmall, managed, later].map((account) => account.address),
    );
    expect(card).toMatchObject({ route: route.address, mainKey: A, secondKey: K, readAt: clock.unixTimestamp });
    // Of the main key's other accounts (not the other main key's): no lock, another second key, an ended lock, the
    // main key's own lock and an epoch lock.
    expect(card.others).toBe(5);
    expect(card.earliestEnd).toBe(clock.unixTimestamp + 100n * DAY);
    expect(card.expiringSoon).toBe(false);
  });

  it('gives each row its staking state, its lock end, and the stake authority only when it is not the main key', () => {
    const inactive = stake(31, { delegated: false, lockup: lockedFor(90n) });
    const card = buildRecoveryCard(route, [managed, inactive], clock);
    const rows = Object.fromEntries(card.accounts.map((row) => [row.account.address, row]));
    expect(rows[route.address]).toMatchObject({ activation: 'active', lockUntil: route.lockup.unixTimestamp, staker: null });
    expect(rows[managed.address]).toMatchObject({ staker: SERVICE, lockUntil: managed.lockup.unixTimestamp });
    expect(rows[inactive.address]).toMatchObject({ activation: 'inactive', staker: null });
  });

  it("lists each account once; the route's own read wins over the search's", () => {
    const stale = { ...route, lamports: 77n * SOL, lockup: { ...route.lockup, custodian: OTHER_SECOND } };
    const card = buildRecoveryCard(route, [stale, later, later], clock);
    expect(card.accounts.map((row) => row.account.address)).toEqual([route.address, later.address]);
    expect(card.accounts[0]?.account).toBe(route);
    expect(card.others).toBe(0);
  });

  it('works with an empty search (the route alone)', () => {
    const card = buildRecoveryCard(route, [], clock);
    expect(card.accounts).toHaveLength(1);
    expect(card.others).toBe(0);
    expect(card.earliestEnd).toBe(route.lockup.unixTimestamp);
  });

  it('refuses a route whose lock no second key holds', () => {
    expect(() => buildRecoveryCard(open, [], clock)).toThrow();
    expect(() => buildRecoveryCard(epochLocked, [], clock)).toThrow();
  });

  it('says the first lock ends soon from 30 days before it, as the accounts page does', () => {
    const at = (seconds: bigint) =>
      buildRecoveryCard(stake(40, { lockup: { unixTimestamp: clock.unixTimestamp + seconds, custodian: K } }), [], clock).expiringSoon;
    expect(at(EXPIRING_THRESHOLD_SECONDS)).toBe(false);
    expect(at(EXPIRING_THRESHOLD_SECONDS - 1n)).toBe(true);
    // The earliest lock counts, not the route's.
    const soon = stake(41, { lockup: lockedFor(3n) });
    expect(buildRecoveryCard(route, [soon], clock)).toMatchObject({ expiringSoon: true, earliestEnd: soon.lockup.unixTimestamp });
  });
});

describe('accountsPath', () => {
  it('opens the accounts page on the main key', () => {
    expect(accountsPath(A)).toBe(`/app?address=${A}`);
  });
});
