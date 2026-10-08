import { getAddressDecoder, type Address } from '@solana/kit';
import { U64_MAX, ZERO_ADDRESS, type StakeAccount } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { appLinks, buildAccountsView } from './view.ts';

const key = (n: number): Address => getAddressDecoder().decode(new Uint8Array(32).fill(n));
const DAY = 86_400n;
const SOL = 1_000_000_000n;
const clock = { unixTimestamp: 1_800_000_000n, epoch: 900n };

const A = key(1);
const K = key(2);
const OTHER = key(3);
const OWNER = key(4);

function stake(n: number, options: { sol: bigint; withdrawer?: Address; staker?: Address; lockDays?: bigint; custodian?: Address }): StakeAccount {
  const withdrawer = options.withdrawer ?? A;
  return {
    address: key(n),
    lamports: options.sol * SOL,
    kind: 'delegated',
    rentExemptReserve: 1_666_240n,
    staker: options.staker ?? withdrawer,
    withdrawer,
    lockup: {
      unixTimestamp: options.lockDays === undefined ? 0n : clock.unixTimestamp + options.lockDays * DAY,
      epoch: 0n,
      custodian: options.custodian ?? ZERO_ADDRESS,
    },
    delegation: { voter: key(99), stake: options.sol * SOL, activationEpoch: 800n, deactivationEpoch: U64_MAX },
  };
}

const open = stake(10, { sol: 3n });
const openBig = stake(11, { sol: 30n });
const locked = stake(12, { sol: 40n, lockDays: 100n, custodian: K });
const expiring = stake(13, { sol: 5n, lockDays: 10n, custodian: K });
const foreign = stake(14, { sol: 2n, lockDays: 100n, custodian: OTHER });
const ended = stake(15, { sol: 8n, lockDays: -1n, custodian: K });
const asSecondKey = stake(16, { sol: 7n, withdrawer: OWNER, lockDays: 50n, custodian: A });
const asSecondKeyEnded = stake(17, { sol: 6n, withdrawer: OWNER, lockDays: -3n, custodian: A });
const selfLocked = stake(18, { sol: 1n, lockDays: 100n, custodian: A });

describe('buildAccountsView', () => {
  const base = { address: A, clock, knownSecondKeys: [K], rememberedProtected: [] as Address[] };

  it('splits main-key and second-key accounts, once each, most urgent first', () => {
    const view = buildAccountsView({
      ...base,
      // Found by both searches: a self-locked account matches withdrawer and custodian.
      accounts: [locked, open, foreign, expiring, openBig, selfLocked, asSecondKey, asSecondKeyEnded, selfLocked],
    });
    expect(view.owned.map((row) => row.account.address)).toEqual(
      [expiring, openBig, open, selfLocked, locked, foreign].map((a) => a.address),
    );
    expect(view.owned.map((row) => row.protection)).toEqual([
      'expiring',
      'unprotected',
      'unprotected',
      'unprotected',
      'protected',
      'locked-by-other',
    ]);
    // A lock that ended gives the second key no say: only the account it still locks is listed.
    expect(view.secondKeyFor.map((row) => [row.account.address, row.protection])).toEqual([[asSecondKey.address, 'protected']]);
  });

  it('totals the main list and the SOL under a lock', () => {
    const view = buildAccountsView({ ...base, accounts: [open, locked, expiring, foreign, asSecondKey] });
    expect(view.totals).toEqual({ count: 4, lamports: 50n * SOL, protectedLamports: 45n * SOL });
  });

  it('with no second key known, calls no lock protected, counts none and asks for the second key (D14)', () => {
    const view = buildAccountsView({ ...base, knownSecondKeys: [], accounts: [locked, foreign] });
    expect(view.owned.map((row) => row.protection)).toEqual(['locked-by-other', 'locked-by-other']);
    expect(view.totals.protectedLamports).toBe(0n);
    expect(view.unconfirmedLock).toBe(true);
    expect(view.confirmedProtected).toEqual([]);
  });

  // D35: the row words a lock none of the known keys holds by whether this browser knows any (the fake-site case).
  it('marks each row with whether this browser knows a second key for the main key', () => {
    const accounts = [locked, foreign, open, asSecondKey];
    const known = buildAccountsView({ ...base, accounts });
    expect(known.owned.map((row) => row.secondKeyKnown)).toEqual([true, true, true]);
    const none = buildAccountsView({ ...base, knownSecondKeys: [], accounts });
    expect(none.owned.map((row) => row.secondKeyKnown)).toEqual([false, false, false]);
    // The address holds these locks itself.
    expect([...known.secondKeyFor, ...none.secondKeyFor].map((row) => row.secondKeyKnown)).toEqual([true, true]);
  });

  it('asks for the second key when a lock is someone else’s, not when all locks are confirmed', () => {
    expect(buildAccountsView({ ...base, accounts: [locked, foreign] }).unconfirmedLock).toBe(true);
    expect(buildAccountsView({ ...base, accounts: [locked, expiring, open] }).unconfirmedLock).toBe(false);
  });

  it('remembers confirmed locks and flags remembered accounts that lost theirs (F6)', () => {
    const view = buildAccountsView({
      ...base,
      accounts: [locked, expiring, ended, open, foreign],
      rememberedProtected: [ended.address, locked.address, key(77)],
    });
    expect(view.confirmedProtected.sort()).toEqual([locked.address, expiring.address].sort());
    expect(view.noLongerProtected).toEqual([ended.address]);
    const endedRow = view.owned.find((row) => row.account.address === ended.address);
    expect(endedRow).toMatchObject({ protection: 'unprotected', wasProtected: true });
    // First in the list: it needs attention most.
    expect(view.owned[0]?.account.address).toBe(ended.address);
    expect(view.owned.filter((row) => row.wasProtected)).toHaveLength(1);
  });

  it('flags a managed stake and reads its staking state from the epochs', () => {
    const managed = stake(20, { sol: 4n, staker: key(50) });
    const [row] = buildAccountsView({ ...base, accounts: [managed] }).owned;
    expect(row).toMatchObject({ managedByService: true, activation: 'active' });
  });
});

describe('groups and the one filled button (D109)', () => {
  const base = { address: A, clock, knownSecondKeys: [K], rememberedProtected: [] as Address[] };
  const addresses = (rows: readonly { account: StakeAccount }[]) => rows.map((row) => row.account.address);
  const managed = stake(20, { sol: 4n, staker: key(50) });
  // A thief with the main key changed the stake key under the viewer's own lock (SECURITY-CHECK П6).
  const stolenStakeKey = stake(21, { sol: 9n, staker: key(51), lockDays: 100n, custodian: K });

  it('puts every owned row in one group: attention, protected or locked, most urgent first', () => {
    const view = buildAccountsView({
      ...base,
      accounts: [locked, open, foreign, expiring, openBig, ended, managed, stolenStakeKey, asSecondKey],
      rememberedProtected: [ended.address],
    });
    expect(addresses(view.groups.attention)).toEqual(
      [ended, expiring, openBig, managed, open, stolenStakeKey].map((a) => a.address),
    );
    expect(addresses(view.groups.protected)).toEqual([locked.address]);
    expect(addresses(view.groups.locked)).toEqual([foreign.address]);
    expect(addresses(view.groups.secondKeyFor)).toEqual([asSecondKey.address]);
    const grouped = [...view.groups.attention, ...view.groups.protected, ...view.groups.locked];
    expect(addresses(grouped).sort()).toEqual(addresses(view.owned).sort());
  });

  it('F6 first: the banner\'s Protect again is the one filled button', () => {
    const view = buildAccountsView({ ...base, accounts: [ended, open, expiring], rememberedProtected: [ended.address] });
    expect(view.primaryAction).toEqual({ kind: 'protect-again', accounts: [ended.address] });
  });

  it('then Rescue when a stake key changed under the viewer\'s own lock, before any Protect or Extend', () => {
    const view = buildAccountsView({ ...base, accounts: [open, expiring, stolenStakeKey] });
    expect(view.primaryAction).toEqual({ kind: 'rescue', account: stolenStakeKey.address });
    // Never another wallet's Extend while the viewer's own stake shows the warning.
    const holdsSoon = stake(23, { sol: 1n, withdrawer: OWNER, lockDays: 3n, custodian: A });
    expect(buildAccountsView({ ...base, accounts: [stolenStakeKey, holdsSoon] }).primaryAction).toEqual({
      kind: 'rescue',
      account: stolenStakeKey.address,
    });
    // A lock that ended (F6) still comes first: anyone with the main key can withdraw that one now.
    expect(
      buildAccountsView({ ...base, accounts: [ended, stolenStakeKey], rememberedProtected: [ended.address] }).primaryAction,
    ).toEqual({ kind: 'protect-again', accounts: [ended.address] });
  });

  it('then protecting Needs attention in one go, without accounts a staking service may manage', () => {
    const view = buildAccountsView({ ...base, accounts: [open, openBig, managed, expiring] });
    expect(view.primaryAction).toEqual({ kind: 'protect-group', accounts: [openBig.address, open.address] });
    // Only a managed account open: it keeps its own Protect, and the earliest lock to extend leads.
    expect(buildAccountsView({ ...base, accounts: [managed, expiring, locked] }).primaryAction).toEqual({
      kind: 'extend',
      account: expiring.address,
    });
  });

  it('then extending the lock that ends first, the viewer\'s own or one it holds as second key', () => {
    const holdsSoon = stake(22, { sol: 1n, withdrawer: OWNER, lockDays: 3n, custodian: A });
    const view = buildAccountsView({ ...base, accounts: [locked, expiring, holdsSoon] });
    expect(view.primaryAction).toEqual({ kind: 'extend', account: holdsSoon.address });
  });

  it('none when nothing needs doing: the page stays quiet', () => {
    expect(buildAccountsView({ ...base, accounts: [locked, foreign, asSecondKey] }).primaryAction).toBeNull();
    expect(buildAccountsView({ ...base, accounts: [] }).primaryAction).toBeNull();
  });

  it('counts SOL under locks of a second key this browser does not know apart, never as protected (D14)', () => {
    const none = buildAccountsView({ ...base, knownSecondKeys: [], accounts: [locked, foreign, open] });
    expect(none.lockedUnconfirmedLamports).toBe(42n * SOL);
    expect(none.totals.protectedLamports).toBe(0n);
    expect(addresses(none.groups.locked).sort()).toEqual([locked.address, foreign.address].sort());
    // With a second key known, a lock none of them holds is someone else's, not an unconfirmed own one (D35, D102).
    const known = buildAccountsView({ ...base, accounts: [locked, foreign, open] });
    expect(known.lockedUnconfirmedLamports).toBe(0n);
  });
});

describe('appLinks', () => {
  it('builds the action routes of section 9', () => {
    expect(appLinks.protect([locked.address])).toBe(`/protect?account=${locked.address}`);
    expect(appLinks.protect([locked.address, open.address])).toBe(`/protect?account=${locked.address}&account=${open.address}`);
    expect(appLinks.extend(locked.address)).toBe(`/extend/${locked.address}`);
    expect(appLinks.withdraw(locked.address)).toBe(`/withdraw/${locked.address}`);
    expect(appLinks.rescue(A)).toBe(`/rescue?address=${A}`);
    expect(appLinks.recovery(locked.address)).toBe(`/recovery/${locked.address}`);
  });
});
