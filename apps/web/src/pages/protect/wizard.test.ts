import type { Address } from '@solana/kit';
import { DEFAULT_LOCK_PERIOD, ZERO_ADDRESS, type ChainClock, type FriendlyError, type StakeAccount } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import type { JobState, JobView } from '@/signing/machine';
import {
  accountParams,
  blockers,
  candidates,
  chosenSecondKey,
  effectiveSelection,
  initialWizardState,
  leftOut,
  MAX_ACCOUNTS_PER_RUN,
  parseAccountParams,
  protectedIds,
  retryableIds,
  secondKeyProblems,
  uncertainIds,
  wizardReducer,
  type BlockerInput,
  type WizardState,
} from './wizard.ts';

const A = 'B1agBSrGRgub2jXMJEozYkRLRzFc9HLd5hHjSrCtuXu8' as Address;
const K = '9DpLwZiYboWcwYFVtSjSksfaP9EqVoSuZw7Jofet96fi' as Address;
const OTHER = '57M4tyxx6Rk1gz3uYVvfoB3KdQGQkyveqqmZzJUdw3Sz' as Address;
const S1 = 'AYA9kYsn7XVDTPARBfAuASypyyDGFJw1Xds2vHgW9DfW' as Address;
const S2 = '2Xtq6iZ2mXjxTNsv5FrYCzayG5qYRJwZ6837A1X3TjF6' as Address;
const S3 = '8EoRwu9o1xqJ68N1ECPGoGN3DG8hrFwZPN3pxpdEGNpe' as Address;
const S4 = '5RA1fUbNMm4rdu5EuQhiBMGsCFfspRzCscfojXZFWAXU' as Address;
const NOW = 1_790_812_800n;
const CLOCK: ChainClock = { slot: 1n, epoch: 1_000n, unixTimestamp: NOW };
const LOCK_END = NOW + 180n * 86_400n;

function stake(address: Address, overrides: Partial<StakeAccount> = {}): StakeAccount {
  return {
    address,
    lamports: 2_000_000_000n,
    kind: 'initialized',
    rentExemptReserve: 1_666_240n,
    staker: A,
    withdrawer: A,
    lockup: { unixTimestamp: 0n, epoch: 0n, custodian: ZERO_ADDRESS },
    delegation: null,
    ...overrides,
  };
}

const lockedBy = (custodian: Address, unixTimestamp = LOCK_END) => ({ lockup: { unixTimestamp, epoch: 0n, custodian } });

function job(id: Address, state: JobState): JobView {
  return { id, state, before: null, action: null, lifetime: null, signature: null, bytes: null };
}

const FAILED: FriendlyError = { code: 'rate-limited', title: 'Too many requests.', detail: 'HTTP 429' };

describe('URL selection', () => {
  it('keeps valid addresses once, in order, never the zero address', () => {
    const params = new URLSearchParams([
      ['account', S2],
      ['account', 'not-an-address'],
      ['account', S1],
      ['account', S2],
      ['account', ZERO_ADDRESS],
      ['other', S3],
    ]);
    expect(parseAccountParams(params)).toEqual([S2, S1]);
    expect(parseAccountParams(new URLSearchParams())).toEqual([]);
  });

  it('writes ?account= once per account and reads back the same list', () => {
    const params = accountParams([S1, S2]);
    expect(params.toString()).toBe(`account=${S1}&account=${S2}`);
    expect(parseAccountParams(params)).toEqual([S1, S2]);
    expect(accountParams([]).toString()).toBe('');
  });
});

describe('candidates and the selection', () => {
  const accounts = [
    stake(S1),
    stake(S2, lockedBy(K)),
    stake(S3, lockedBy(OTHER)),
    stake(S4, { withdrawer: OTHER }),
  ];

  it('are the main key accounts, each with its protect block', () => {
    const cands = candidates(accounts, A, [K], CLOCK);
    expect(cands.map((c) => [c.account.address, c.block])).toEqual([
      [S1, null],
      [S2, 'already-protected'],
      [S3, 'locked-by-other'],
    ]);
    // Without the second key known, its lock is someone else's.
    expect(candidates(accounts, A, [], CLOCK).find((c) => c.account.address === S2)?.block).toBe('locked-by-other');
    // A lock that ended or one the main key holds itself can be protected (D14).
    const ended = stake(S1, lockedBy(K, NOW));
    const ownLock = stake(S2, lockedBy(A));
    expect(candidates([ended, ownLock], A, [K], CLOCK).map((c) => c.block)).toEqual([null, null]);
  });

  it('effective selection is the selected and unblocked ones in the selection order; others are left out', () => {
    const cands = candidates([...accounts, stake(S4)], A, [K], CLOCK);
    expect(effectiveSelection([S4, S2, S1, S3], cands)).toEqual([S4, S1]);
    const mine = candidates(accounts, A, [K], CLOCK);
    expect(leftOut([S4, S1, S2], mine)).toEqual([S4]);
    expect(leftOut([S1], mine)).toEqual([]);
  });
});

describe('secondKeyProblems', () => {
  it('lists every account the second key cannot lock, with each rule it breaks', () => {
    const accounts = [stake(S1), stake(S2, { staker: K }), stake(S3)];
    expect(secondKeyProblems(K, A, accounts)).toEqual([{ account: S2, violations: ['staker'] }]);
    expect(secondKeyProblems(S3, A, accounts)).toEqual([{ account: S3, violations: ['stake-account'] }]);
    expect(secondKeyProblems(A, A, [stake(S1)])).toEqual([{ account: S1, violations: ['main-key', 'staker'] }]);
    expect(secondKeyProblems(ZERO_ADDRESS, A, [stake(S1)])).toEqual([{ account: S1, violations: ['zero-key'] }]);
    expect(secondKeyProblems(K, A, [])).toEqual([]);
  });
});

describe('blockers', () => {
  const ok: BlockerInput = { mainReady: true, selection: 2, secondReady: true, problems: 0, seedConfirmed: true, clockReady: true };

  it('accounts: a ready main key and 1 to MAX_ACCOUNTS_PER_RUN accounts', () => {
    expect(blockers('accounts', ok)).toEqual([]);
    expect(blockers('accounts', { ...ok, mainReady: false, selection: 0 })).toEqual(['need-main']);
    expect(blockers('accounts', { ...ok, selection: 0 })).toEqual(['need-one']);
    expect(blockers('accounts', { ...ok, selection: MAX_ACCOUNTS_PER_RUN })).toEqual([]);
    expect(blockers('accounts', { ...ok, selection: MAX_ACCOUNTS_PER_RUN + 1 })).toEqual(['too-many']);
  });

  it('second key: connected, no problem, seed phrase confirmed', () => {
    expect(blockers('second-key', ok)).toEqual([]);
    expect(blockers('second-key', { ...ok, secondReady: false, seedConfirmed: false })).toEqual(['need-second', 'need-seed-check']);
    expect(blockers('second-key', { ...ok, problems: 1 })).toEqual(['second-key-problem']);
    expect(blockers('second-key', { ...ok, seedConfirmed: false })).toEqual(['need-seed-check']);
  });

  it('period: the clock is read', () => {
    expect(blockers('period', ok)).toEqual([]);
    expect(blockers('period', { ...ok, clockReady: false })).toEqual(['need-clock']);
  });

  it('second key and period: an empty selection (every account left out) blocks, and only that is said', () => {
    expect(blockers('second-key', { ...ok, selection: 0 })).toEqual(['none-left']);
    expect(blockers('second-key', { ...ok, selection: 0, secondReady: false, seedConfirmed: false })).toEqual(['none-left']);
    expect(blockers('period', { ...ok, selection: 0 })).toEqual(['none-left']);
    expect(blockers('period', { ...ok, selection: 0, clockReady: false })).toEqual(['none-left']);
  });
});

describe('wizardReducer', () => {
  const reduce = (state: WizardState, ...actions: Parameters<typeof wizardReducer>[1][]) => actions.reduce(wizardReducer, state);

  it('starts at the accounts step with the default period and nothing else', () => {
    expect(initialWizardState()).toEqual({
      step: 'accounts',
      seedConfirmed: false,
      secondMode: 'here',
      linkKey: '',
      period: DEFAULT_LOCK_PERIOD,
      lockUntil: null,
      run: null,
      outcomes: {},
      order: [],
      clock: null,
    });
  });

  it('Back keeps what was entered', () => {
    const state = reduce(
      initialWizardState(),
      { type: 'go', step: 'second-key' },
      { type: 'confirm-seed', value: true },
      { type: 'second-mode', value: 'link' },
      { type: 'link-key', text: ` ${K} ` },
      { type: 'go', step: 'period' },
      { type: 'period', value: '12-months' },
      { type: 'go', step: 'second-key' },
      { type: 'go', step: 'accounts' },
    );
    expect(state.step).toBe('accounts');
    expect(state.seedConfirmed).toBe(true);
    expect(state.period).toBe('12-months');
    expect(state.secondMode).toBe('link');
    expect(state.linkKey).toBe(` ${K} `);
  });

  it('the second key: the slot\'s here, the typed address by link (step 7 spec 10.1)', () => {
    const here = initialWizardState();
    expect(chosenSecondKey(here, K)).toBe(K);
    expect(chosenSecondKey(here, null)).toBeNull();
    // By link the slot does not count; the typed text does, trimmed, once it is a wallet address.
    const link = reduce(here, { type: 'second-mode', value: 'link' });
    expect(chosenSecondKey(link, K)).toBeNull();
    expect(chosenSecondKey(reduce(link, { type: 'link-key', text: ` ${OTHER}\n` }), K)).toBe(OTHER);
    expect(chosenSecondKey(reduce(link, { type: 'link-key', text: 'not-an-address' }), K)).toBeNull();
    expect(chosenSecondKey(reduce(link, { type: 'link-key', text: ZERO_ADDRESS }), K)).toBeNull();
    // Back to here: the typed text is kept for later, the slot counts again.
    const back = reduce(link, { type: 'link-key', text: OTHER }, { type: 'second-mode', value: 'here' });
    expect(back.linkKey).toBe(OTHER);
    expect(chosenSecondKey(back, K)).toBe(K);
  });

  it('sign and retry start a new run key; finished merges outcomes in first-signed order', () => {
    const signing = reduce(initialWizardState(), { type: 'sign', lockUntil: LOCK_END, ids: [S1, S2] });
    expect(signing.step).toBe('sign');
    expect(signing.lockUntil).toBe(LOCK_END);
    expect(signing.run).toEqual({ key: 1, ids: [S1, S2] });

    const first = reduce(signing, {
      type: 'finished',
      jobs: [job(S1, { kind: 'failed', error: FAILED }), job(S2, { kind: 'done', after: stake(S2, lockedBy(K)) })],
      clock: CLOCK,
    });
    expect(first.step).toBe('done');
    expect(first.order).toEqual([S1, S2]);
    expect(first.clock).toEqual(CLOCK);
    expect(protectedIds(first)).toEqual([S2]);
    expect(retryableIds(first)).toEqual([S1]);

    const retry = reduce(first, { type: 'retry', ids: retryableIds(first) });
    expect(retry.step).toBe('sign');
    expect(retry.run).toEqual({ key: 2, ids: [S1] });
    expect(retry.lockUntil).toBe(LOCK_END);

    const second = reduce(retry, { type: 'finished', jobs: [job(S1, { kind: 'already-done', after: stake(S1, lockedBy(K)) })], clock: null });
    expect(second.order).toEqual([S1, S2]);
    expect(protectedIds(second)).toEqual([S1, S2]);
    expect(retryableIds(second)).toEqual([]);
    // A run without a clock keeps the earlier one.
    expect(second.clock).toEqual(CLOCK);
  });

  it('sorts outcomes into protected, retryable and uncertain; checked updates only known accounts', () => {
    const state = reduce(initialWizardState(), {
      type: 'finished',
      jobs: [
        job(S1, { kind: 'unknown', why: 'timeout' }),
        job(S2, { kind: 'expired' }),
        job(S3, { kind: 'refused', reason: 'locked-by-other' }),
        job(S4, { kind: 'not-sent' }),
      ],
      clock: CLOCK,
    });
    expect(uncertainIds(state)).toEqual([S1]);
    expect(retryableIds(state)).toEqual([S2, S4]);
    expect(protectedIds(state)).toEqual([]);

    const checked = reduce(state, {
      type: 'checked',
      states: { [S1]: { kind: 'done', after: stake(S1, lockedBy(K)) }, [OTHER]: { kind: 'expired' } },
    });
    expect(protectedIds(checked)).toEqual([S1]);
    expect(uncertainIds(checked)).toEqual([]);
    expect(checked.outcomes[OTHER]).toBeUndefined();
  });
});
