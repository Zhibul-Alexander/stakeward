import type { Address } from '@solana/kit';
import { networkFeeFor, ZERO_ADDRESS, type StakeAccount } from '@stakeward/core';
import { key } from '@stakeward/core/test/craft';
import { describe, expect, it } from 'vitest';
import type { JobView } from '@/signing/machine';
import {
  initialRescueState,
  movedIds,
  newWalletProblems,
  rescueBlockers,
  rescueGroups,
  rescueMinimum,
  rescueReducer,
  retryableRescueIds,
  secondKeyChoices,
  uncertainRescueIds,
  type RescueBlockerInput,
} from './wizard.ts';

const NOW = 1_800_000_000n;
const CLOCK = { unixTimestamp: NOW, epoch: 900n };
const DAY = 86_400n;
const A = key(1);
const K = key(2);
const K2 = key(3);
const D = key(4);

function account(n: number, options: { lamports?: bigint; until?: bigint; custodian?: Address; epoch?: bigint } = {}): StakeAccount {
  return {
    address: key(100 + n),
    lamports: options.lamports ?? 2_000_000_000n,
    kind: 'initialized',
    rentExemptReserve: 2_282_880n,
    staker: A,
    withdrawer: A,
    lockup: { unixTimestamp: options.until ?? 0n, epoch: options.epoch ?? 0n, custodian: options.custodian ?? ZERO_ADDRESS },
    delegation: null,
  };
}

const addresses = (accounts: readonly StakeAccount[]) => accounts.map((item) => item.address);

describe('rescueGroups', () => {
  const unlockedSmall = account(1, { lamports: 1_000_000_000n });
  const unlockedBig = account(2, { lamports: 5_000_000_000n });
  const lockedLate = account(3, { until: NOW + 90n * DAY, custodian: K });
  const lockedSoon = account(4, { until: NOW + 3n * DAY, custodian: K });
  const otherKey = account(5, { until: NOW + 30n * DAY, custodian: K2 });
  const selfLocked = account(6, { until: NOW + 30n * DAY, custodian: A });
  const zeroLocked = account(7, { until: NOW + 30n * DAY, custodian: ZERO_ADDRESS });
  const ended = account(8, { until: NOW - DAY, custodian: K2 });
  const all = [lockedLate, otherKey, unlockedSmall, selfLocked, lockedSoon, zeroLocked, unlockedBig, ended];

  it('moves unlocked accounts first (larger first), then the second key\'s by lock end; the rest by reason', () => {
    const groups = rescueGroups(all, A, K, CLOCK);
    expect(addresses(groups.movable)).toEqual(addresses([unlockedBig, ended, unlockedSmall, lockedSoon, lockedLate]));
    expect(addresses(groups.otherKey)).toEqual(addresses([otherKey]));
    expect(addresses(groups.unsupported)).toEqual(addresses([selfLocked, zeroLocked]));
  });

  it('with no second key, only unlocked accounts move; a lock by epoch counts as in force', () => {
    const byEpoch = account(9, { epoch: 950n, custodian: K });
    const groups = rescueGroups([...all, byEpoch], A, null, CLOCK);
    expect(addresses(groups.movable)).toEqual(addresses([unlockedBig, ended, unlockedSmall]));
    expect(addresses(groups.otherKey)).toEqual(addresses([lockedLate, otherKey, lockedSoon, byEpoch]));
  });

  it('secondKeyChoices: the keys of locks in force, most locked SOL first, never the main key or the zero key', () => {
    const big = account(10, { lamports: 9_000_000_000n, until: NOW + DAY, custodian: K2 });
    expect(secondKeyChoices(all, A, CLOCK)).toEqual([K, K2]);
    expect(secondKeyChoices([...all, big], A, CLOCK)).toEqual([K2, K]);
    expect(secondKeyChoices([unlockedBig, selfLocked, zeroLocked, ended], A, CLOCK)).toEqual([]);
  });
});

describe('rescueMinimum', () => {
  it('counts the nonce setup unless it is ready, two transactions per account, the close and the minimum balance', () => {
    const base = { count: 2, nonceDeposit: 1_447_680n, rentExempt0: 890_880n };
    const perAccount = networkFeeFor(3) + networkFeeFor(1);
    expect(rescueMinimum({ ...base, nonceReady: true })).toBe(2n * perAccount + networkFeeFor(1) + 890_880n);
    expect(rescueMinimum({ ...base, nonceReady: false })).toBe(1_447_680n + networkFeeFor(1) + 2n * perAccount + networkFeeFor(1) + 890_880n);
  });
});

describe('newWalletProblems', () => {
  it('names every reason the address cannot be the new wallet', () => {
    const stake = account(1);
    expect(newWalletProblems(D, A, [K], [stake])).toEqual([]);
    expect(newWalletProblems(ZERO_ADDRESS, A, [K], [stake])).toEqual(['zero-key']);
    expect(newWalletProblems(A, A, [K], [stake])).toEqual(['main-key']);
    expect(newWalletProblems(K, A, [K2, K], [stake])).toEqual(['second-key']);
    expect(newWalletProblems(stake.address, A, [K], [stake])).toEqual(['stake-account']);
  });
});

describe('rescueBlockers', () => {
  const input: RescueBlockerInput = {
    mainKey: A,
    movable: 2,
    choices: 1,
    newWallet: D,
    newProblems: 0,
    seedConfirmed: true,
    balance: 20_000_000n,
    needed: 3_000_000n,
    secondKey: K,
  };

  it('stake: a main key, then something to move (or a second key to choose)', () => {
    expect(rescueBlockers('stake', input)).toEqual([]);
    expect(rescueBlockers('stake', { ...input, mainKey: null })).toEqual(['need-main']);
    expect(rescueBlockers('stake', { ...input, movable: 0, choices: 0 })).toEqual(['need-movable']);
    expect(rescueBlockers('stake', { ...input, movable: 0, choices: 1 })).toEqual([]);
  });

  it('new wallet: connected, not a key of this stake, a new seed phrase, enough SOL', () => {
    expect(rescueBlockers('new-wallet', input)).toEqual([]);
    expect(rescueBlockers('new-wallet', { ...input, newWallet: null, seedConfirmed: false })).toEqual(['need-new', 'need-seed-check']);
    expect(rescueBlockers('new-wallet', { ...input, newProblems: 1 })).toEqual(['new-problem']);
    expect(rescueBlockers('new-wallet', { ...input, balance: null })).toEqual(['balance-loading']);
    expect(rescueBlockers('new-wallet', { ...input, balance: 2_999_999n })).toEqual(['low-balance']);
  });

  it('keys: a second key that is neither the main key nor the new wallet', () => {
    expect(rescueBlockers('keys', input)).toEqual([]);
    expect(rescueBlockers('keys', { ...input, secondKey: null })).toEqual(['need-second']);
    expect(rescueBlockers('keys', { ...input, secondKey: D })).toEqual(['second-problem']);
    expect(rescueBlockers('keys', { ...input, secondKey: A })).toEqual(['second-problem']);
  });
});

function job(id: Address, kind: JobView['state']['kind']): JobView {
  const state = (
    kind === 'done' || kind === 'already-done'
      ? { kind, after: null }
      : kind === 'unknown'
        ? { kind, why: 'timeout' }
        : kind === 'refused'
          ? { kind, reason: 'not-found' }
          : kind === 'failed' || kind === 'sim-failed'
            ? { kind, error: { code: 'unknown', detail: '' } }
            : { kind }
  ) as JobView['state'];
  return { id, state, before: null, action: null, lifetime: null, signature: null, bytes: null };
}

describe('rescueReducer', () => {
  it('starts on the first step with the address as the main key; Back and forth keep what was entered', () => {
    let state = initialRescueState(A);
    expect(state).toMatchObject({ step: 'stake', mainKey: A, typed: A, mainMode: null, secondMode: null, run: null });
    state = rescueReducer(state, { type: 'confirm-seed', value: true });
    state = rescueReducer(state, { type: 'second-choice', address: K2 });
    state = rescueReducer(state, { type: 'main-mode', value: 'link' });
    state = rescueReducer(state, { type: 'go', step: 'keys' });
    state = rescueReducer(state, { type: 'go', step: 'stake' });
    expect(state).toMatchObject({ step: 'stake', seedConfirmed: true, secondChoice: K2, mainMode: 'link' });
    expect(initialRescueState(null)).toMatchObject({ mainKey: null, typed: '' });
  });

  it('a run, its outcomes in first-signed order across runs, Check again, and Look again', () => {
    const [S1, S2, S3] = [key(11), key(12), key(13)];
    let state = rescueReducer(initialRescueState(A), { type: 'move', ids: [S1, S2, S3], secondKey: K, newWallet: D });
    expect(state.step).toBe('move');
    expect(state.run).toEqual({ key: 1, ids: [S1, S2, S3], secondKey: K, newWallet: D });
    const clock = { ...CLOCK, slot: 5n };
    state = rescueReducer(state, { type: 'finished', jobs: [job(S1, 'done'), job(S2, 'expired'), job(S3, 'unknown')], clock });
    expect(state).toMatchObject({ step: 'done', order: [S1, S2, S3], clock });
    expect(movedIds(state)).toEqual([S1]);
    expect(retryableRescueIds(state)).toEqual([S2]);
    expect(uncertainRescueIds(state)).toEqual([S3]);

    state = rescueReducer(state, { type: 'checked', states: { [S3]: { kind: 'done', after: null } } });
    expect(movedIds(state)).toEqual([S1, S3]);

    state = rescueReducer(state, { type: 'move', ids: retryableRescueIds(state), secondKey: K, newWallet: D });
    expect(state.run).toEqual({ key: 2, ids: [S2], secondKey: K, newWallet: D });
    state = rescueReducer(state, { type: 'finished', jobs: [job(S2, 'done')], clock });
    expect(movedIds(state)).toEqual([S1, S2, S3]);

    const again = rescueReducer({ ...state, mainMode: 'here', secondChoice: K }, { type: 'look-again' });
    expect(again).toMatchObject({ step: 'stake', attempt: state.attempt + 1, mainMode: 'here', secondChoice: K });
    expect(again.run).toEqual(state.run);
    expect(again.order).toEqual(state.order);
  });

  it('nothing to retry while a link is still open (Stop waiting during a link): Check again first', () => {
    const [S1, S2] = [key(11), key(12)];
    let state = rescueReducer(initialRescueState(A), { type: 'move', ids: [S1, S2], secondKey: K, newWallet: D });
    const open: JobView = { ...job(S1, 'unknown'), state: { kind: 'unknown', why: 'link-open' } };
    state = rescueReducer(state, { type: 'finished', jobs: [open, job(S2, 'not-sent')], clock: { ...CLOCK, slot: 5n } });
    expect(uncertainRescueIds(state)).toEqual([S1]);
    expect(retryableRescueIds(state)).toEqual([]);
    state = rescueReducer(state, { type: 'checked', states: { [S1]: { kind: 'expired' } } });
    expect(retryableRescueIds(state)).toEqual([S1, S2]);
  });
});

