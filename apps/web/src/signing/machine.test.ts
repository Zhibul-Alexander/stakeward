import type { Address, Blockhash, Nonce, Signature } from '@solana/kit';
import type { ChainClock, FriendlyError, TransactionSummary } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import {
  initialSigningState,
  retryableIds,
  signingReducer,
  type JobState,
  type JobView,
  type RoundTx,
  type SignStep,
  type SigningEvent,
  type SigningState,
  type StopReason,
} from './machine.ts';

const MAIN = 'B1agBSrGRgub2jXMJEozYkRLRzFc9HLd5hHjSrCtuXu8' as Address;
const SECOND = '9DpLwZiYboWcwYFVtSjSksfaP9EqVoSuZw7Jofet96fi' as Address;
const S1 = 'AYA9kYsn7XVDTPARBfAuASypyyDGFJw1Xds2vHgW9DfW';
const S2 = '2Xtq6iZ2mXjxTNsv5FrYCzayG5qYRJwZ6837A1X3TjF6';
const S3 = '8EoRwu9o1xqJ68N1ECPGoGN3DG8hrFwZPN3pxpdEGNpe';
const BLOCKHASH = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N' as Blockhash;
const CLOCK: ChainClock = { slot: 64_000n, epochStartTimestamp: 1_790_800_000n, epoch: 1_000n, unixTimestamp: 1_790_812_800n };
const ERROR: FriendlyError = { code: 'network', title: 'The network did not respond.', detail: 'fetch failed' };

function summary(stakeAccount: string, present: readonly Address[] = []): TransactionSummary {
  return {
    action: { kind: 'protect', stakeAccount: stakeAccount as Address, mainKey: MAIN, secondKey: SECOND, lockUntil: 1_807_488_000n },
    feePayer: MAIN,
    lifetime: { kind: 'blockhash', blockhash: BLOCKHASH },
    computeBudget: { unitLimit: 1_400, microLamportsPerUnit: 1n },
    networkFeeLamports: 10_001n,
    requiredSigners: [MAIN, SECOND],
    presentSignatures: present,
    lighthouseTail: null,
  };
}

function tx(id: string, present: readonly Address[] = []): RoundTx {
  return {
    id,
    bytes: Uint8Array.of(present.length),
    summary: summary(id, present),
    lifetime: { kind: 'blockhash', blockhash: BLOCKHASH, lastValidBlockHeight: 1_150n },
  };
}

const STEPS: readonly SignStep[] = [
  { address: MAIN, role: 'main', walletName: 'Main Wallet', count: 2, status: 'pending', local: true },
  { address: SECOND, role: 'second', walletName: 'Second Wallet', count: 2, status: 'pending', local: true },
];

function view(id: string, state: JobState): JobView {
  return { id, state, before: null, action: summary(id).action, lifetime: tx(id).lifetime, signature: null, bytes: null };
}

const reduce = (state: SigningState, ...events: SigningEvent[]): SigningState => events.reduce(signingReducer, state);

const walletStop = (portError: Extract<StopReason, { kind: 'wallet' }>['portError']): StopReason => ({
  kind: 'wallet',
  walletName: 'Second Wallet',
  error: ERROR,
  portError,
});
const CHECK_STOP: StopReason = {
  kind: 'check',
  walletName: 'Second Wallet',
  code: 'tail-not-first-signer',
  detail: 'tail',
  startWith: SECOND,
  bothWays: false,
};

// Fixtures: one state per phase, reached through the reducer itself.
const idle = initialSigningState([S1, S2], 2);
const preparing = reduce(idle, { type: 'start' });
const prepared: SigningEvent = {
  type: 'prepared',
  clock: CLOCK,
  jobs: { [S1]: view(S1, { kind: 'ready' }), [S2]: view(S2, { kind: 'ready' }) },
  txs: [tx(S1), tx(S2)],
  steps: STEPS,
};
const ready0 = reduce(preparing, prepared);
const signing0 = reduce(ready0, { type: 'asking', step: 0 });
const ready1 = reduce(signing0, { type: 'signed', step: 0, txs: [tx(S1, [MAIN]), tx(S2, [MAIN])] });
const signing1 = reduce(ready1, { type: 'asking', step: 1 });
const sending = reduce(signing1, { type: 'signed', step: 1, txs: [tx(S1, [MAIN, SECOND]), tx(S2, [MAIN, SECOND])] });
const confirming = reduce(
  sending,
  { type: 'job', id: S1, state: { kind: 'confirming', indefinite: false } },
  { type: 'job', id: S2, state: { kind: 'failed', error: ERROR } },
  { type: 'send-done' },
);
const checking = reduce(confirming, { type: 'job', id: S1, state: { kind: 'checking' } }, { type: 'confirm-done' });
const finished = reduce(checking, { type: 'job', id: S1, state: { kind: 'done', after: null } }, { type: 'check-done' });
const prepareFailed = reduce(preparing, { type: 'prepare-failed', problem: { kind: 'read', error: ERROR } });
const needsWallet0 = reduce(ready0, { type: 'needs-wallet', step: 0 });
const switch1 = reduce(ready1, { type: 'switch-account', step: 1, again: false });
const stoppedWallet1 = reduce(signing1, { type: 'stopped', step: 1, reason: walletStop(null) });
const stoppedBatch0 = reduce(signing0, { type: 'stopped', step: 0, reason: walletStop('WalletBatchUnsupportedError') });
const stoppedCheck1 = reduce(signing1, { type: 'stopped', step: 1, reason: CHECK_STOP });
const expired = reduce(ready1, { type: 'expired' });
const starting0 = reduce(ready0, { type: 'starting', step: 0, waitFor: 'network' });

// Signing by link: rounds of one on the main key's durable nonce; the main key signs here, the second key by link.
const NONCE_ACCOUNT = '5xot9PVkphiX2adznghwrAuxGs2zeWisNSxMW6hU6Hkj' as Address;
const NONCE_VALUE = 'GfnhkAa2bfg4dTjLfwhLSWg1b8zrJw9u8jCmVSUJhy9Y' as Nonce;
const TX_ID = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW' as Signature;
function nonceTx(id: string, present: readonly Address[] = []): RoundTx {
  return {
    ...tx(id, present),
    lifetime: { kind: 'nonce', nonceAccount: NONCE_ACCOUNT, nonceAuthority: MAIN, nonceValue: NONCE_VALUE },
  };
}
const LINK_STEPS: readonly SignStep[] = [
  { address: MAIN, role: 'main', walletName: 'Main Wallet', count: 1, status: 'pending', local: true },
  { address: SECOND, role: 'second', walletName: null, count: 1, status: 'pending', local: false },
];
const linkPreparing = reduce(initialSigningState([S1, S2], 1), { type: 'start' });
const linkReady0 = reduce(linkPreparing, {
  type: 'prepared',
  clock: CLOCK,
  jobs: { [S1]: { ...view(S1, { kind: 'ready' }), lifetime: nonceTx(S1).lifetime } },
  txs: [nonceTx(S1)],
  steps: LINK_STEPS,
});
const linkSigning0 = reduce(linkReady0, { type: 'asking', step: 0 });
const linkWatching = reduce(linkSigning0, { type: 'signed', step: 0, txs: [nonceTx(S1, [MAIN])], signature: TX_ID });
const linkPaused = reduce(linkWatching, { type: 'link-paused' });

const PHASES: Record<string, SigningState> = {
  idle,
  preparing,
  prepareFailed,
  ready0,
  starting0,
  needsWallet0,
  switch1,
  signing0,
  stoppedWallet1,
  stoppedCheck1,
  expired,
  sending,
  confirming,
  checking,
  finished,
  linkWatching,
  linkPaused,
};

function jobKinds(state: SigningState): Record<string, string> {
  return Object.fromEntries(state.ids.map((id) => [id, state.jobs[id]?.state.kind ?? 'none']));
}

describe('initialSigningState', () => {
  it('starts idle with every job queued, duplicates once, a round size of at least 1', () => {
    const state = initialSigningState([S1, S2, S1], 0);
    expect(state.phase).toEqual({ kind: 'idle' });
    expect(state.ids).toEqual([S1, S2]);
    expect(jobKinds(state)).toEqual({ [S1]: 'queued', [S2]: 'queued' });
    expect(state.roundSize).toBe(1);
    expect(state.round).toBeNull();
  });
});

describe('the fixtures reach every phase', () => {
  const KINDS: Record<string, SigningState['phase']['kind']> = {
    idle: 'idle',
    preparing: 'preparing',
    prepareFailed: 'prepare-failed',
    ready0: 'ready',
    starting0: 'starting',
    needsWallet0: 'needs-wallet',
    switch1: 'switch-account',
    signing0: 'signing',
    stoppedWallet1: 'stopped',
    stoppedCheck1: 'stopped',
    expired: 'expired',
    sending: 'sending',
    confirming: 'confirming',
    checking: 'checking',
    finished: 'finished',
    linkWatching: 'link',
    linkPaused: 'link',
  };
  it.each(Object.entries(PHASES))('%s', (name, state) => {
    expect(state.phase.kind).toBe(KINDS[name]);
  });
});

describe('signingReducer: the transition table', () => {
  it('start: idle -> preparing the first round (first roundSize queued ids, in order)', () => {
    const state = reduce(initialSigningState([S1, S2, S3], 2), { type: 'start' });
    expect(state.phase).toEqual({ kind: 'preparing' });
    expect(state.round).toEqual({ ids: [S1, S2], txs: [], steps: [] });
    expect(state.roundNumber).toBe(1);
    expect(jobKinds(state)).toEqual({ [S1]: 'preparing', [S2]: 'preparing', [S3]: 'queued' });
  });

  it('start with no jobs: finished at once', () => {
    expect(reduce(initialSigningState([], 1), { type: 'start' }).phase).toEqual({ kind: 'finished' });
  });

  it('prepared: merges jobs, stores the clock, sets txs and steps, ready(0)', () => {
    expect(ready0.phase).toEqual({ kind: 'ready', step: 0, refreshed: false });
    expect(ready0.clock).toBe(CLOCK);
    expect(ready0.round?.txs.map((t) => t.id)).toEqual([S1, S2]);
    expect(ready0.round?.steps).toBe(STEPS);
    expect(jobKinds(ready0)).toEqual({ [S1]: 'ready', [S2]: 'ready' });
  });

  it('prepared with no transactions: advances (next round, or finished)', () => {
    const three = reduce(initialSigningState([S1, S2, S3], 2), { type: 'start' });
    const next = reduce(three, {
      type: 'prepared',
      clock: CLOCK,
      jobs: { [S1]: view(S1, { kind: 'refused', reason: 'not-found' }), [S2]: view(S2, { kind: 'refused', reason: 'x' }) },
      txs: [],
      steps: [],
    });
    expect(next.phase).toEqual({ kind: 'preparing' });
    expect(next.round?.ids).toEqual([S3]);
    expect(next.roundNumber).toBe(2);
    const done = reduce(preparing, { ...prepared, txs: [], steps: [], jobs: { [S1]: view(S1, { kind: 'not-sent' }) } });
    expect(done.phase).toEqual({ kind: 'finished' });
  });

  it('prepare-failed: preparing -> prepare-failed', () => {
    expect(prepareFailed.phase).toEqual({ kind: 'prepare-failed', problem: { kind: 'read', error: ERROR } });
  });

  it('retry-prepare: prepare-failed -> preparing, the round jobs preparing', () => {
    const state = reduce(prepareFailed, { type: 'retry-prepare' });
    expect(state.phase).toEqual({ kind: 'preparing' });
    expect(jobKinds(state)).toEqual({ [S1]: 'preparing', [S2]: 'preparing' });
  });

  it('refresh: ready(0) with no signature -> preparing, refreshing; the next ready(0) says refreshed', () => {
    const state = reduce(ready0, { type: 'refresh' });
    expect(state.phase).toEqual({ kind: 'preparing' });
    expect(state.refreshing).toBe(true);
    expect(jobKinds(state)).toEqual({ [S1]: 'preparing', [S2]: 'preparing' });
    const again = reduce(state, prepared);
    expect(again.phase).toEqual({ kind: 'ready', step: 0, refreshed: true });
    expect(again.refreshing).toBe(false);
  });

  it('refresh: also from switch-account(0) and stopped(wallet) at 0 (sign() runs from both), never once signed', () => {
    const switch0 = reduce(ready0, { type: 'switch-account', step: 0, again: false });
    expect(reduce(switch0, { type: 'refresh' }).phase.kind).toBe('preparing');
    const stopped0 = reduce(signing0, { type: 'stopped', step: 0, reason: walletStop(null) });
    expect(reduce(stopped0, { type: 'refresh' }).phase.kind).toBe('preparing');
    expect(reduce(ready1, { type: 'refresh' })).toBe(ready1);
    const presigned = reduce(preparing, { ...prepared, txs: [tx(S1, [MAIN]), tx(S2)] });
    expect(reduce(presigned, { type: 'refresh' })).toBe(presigned);
  });

  it('needs-wallet: ready, switch-account, stopped(wallet) at that step', () => {
    expect(needsWallet0.phase).toEqual({ kind: 'needs-wallet', step: 0 });
    expect(reduce(switch1, { type: 'needs-wallet', step: 1 }).phase).toEqual({ kind: 'needs-wallet', step: 1 });
    expect(reduce(stoppedWallet1, { type: 'needs-wallet', step: 1 }).phase).toEqual({ kind: 'needs-wallet', step: 1 });
    expect(reduce(ready0, { type: 'needs-wallet', step: 1 })).toBe(ready0);
    expect(reduce(stoppedCheck1, { type: 'needs-wallet', step: 1 })).toBe(stoppedCheck1);
  });

  it('wallet-ready: needs-wallet(k) -> ready(k) with the steps read again', () => {
    const steps = STEPS.map((step) => ({ ...step, walletName: 'Other Wallet' }));
    const state = reduce(needsWallet0, { type: 'wallet-ready', step: 0, steps });
    expect(state.phase).toEqual({ kind: 'ready', step: 0, refreshed: false });
    expect(state.round?.steps).toBe(steps);
    expect(reduce(needsWallet0, { type: 'wallet-ready', step: 1, steps })).toBe(needsWallet0);
  });

  it('switch-account: ready, needs-wallet, switch-account (again), signing, stopped(wallet) at that step', () => {
    expect(switch1.phase).toEqual({ kind: 'switch-account', step: 1, again: false });
    expect(reduce(needsWallet0, { type: 'switch-account', step: 0, again: false }).phase.kind).toBe('switch-account');
    expect(reduce(switch1, { type: 'switch-account', step: 1, again: true }).phase).toEqual({
      kind: 'switch-account',
      step: 1,
      again: true,
    });
    expect(reduce(signing1, { type: 'switch-account', step: 1, again: false }).phase.kind).toBe('switch-account');
    expect(reduce(stoppedWallet1, { type: 'switch-account', step: 1, again: false }).phase.kind).toBe('switch-account');
    expect(reduce(stoppedCheck1, { type: 'switch-account', step: 1, again: false })).toBe(stoppedCheck1);
  });

  it('asking: ready, needs-wallet, switch-account, stopped(wallet) at that step -> signing', () => {
    expect(signing0.phase).toEqual({ kind: 'signing', step: 0 });
    expect(reduce(needsWallet0, { type: 'asking', step: 0 }).phase).toEqual({ kind: 'signing', step: 0 });
    expect(reduce(switch1, { type: 'asking', step: 1 }).phase).toEqual({ kind: 'signing', step: 1 });
    expect(reduce(stoppedWallet1, { type: 'asking', step: 1 }).phase).toEqual({ kind: 'signing', step: 1 });
    expect(reduce(signing0, { type: 'asking', step: 0 })).toBe(signing0);
    expect(reduce(stoppedCheck1, { type: 'asking', step: 1 })).toBe(stoppedCheck1);
  });

  it('signed: the step is signed and the txs replaced; ready(k + 1), or sending after the last step', () => {
    expect(ready1.phase).toEqual({ kind: 'ready', step: 1, refreshed: false });
    expect(ready1.round?.steps.map((step) => step.status)).toEqual(['signed', 'pending']);
    expect(ready1.round?.txs.map((t) => t.summary.presentSignatures)).toEqual([[MAIN], [MAIN]]);
    expect(sending.phase).toEqual({ kind: 'sending' });
    expect(sending.round?.steps.map((step) => step.status)).toEqual(['signed', 'signed']);
    expect(reduce(signing0, { type: 'signed', step: 1, txs: [] })).toBe(signing0);
  });

  it('stopped: signing, ready, needs-wallet, switch-account at that step', () => {
    expect(stoppedCheck1.phase).toEqual({ kind: 'stopped', step: 1, reason: CHECK_STOP });
    for (const state of [ready0, needsWallet0]) {
      expect(reduce(state, { type: 'stopped', step: 0, reason: CHECK_STOP }).phase.kind).toBe('stopped');
    }
    expect(reduce(switch1, { type: 'stopped', step: 1, reason: CHECK_STOP }).phase.kind).toBe('stopped');
    expect(reduce(sending, { type: 'stopped', step: 1, reason: CHECK_STOP })).toBe(sending);
    expect(reduce(stoppedCheck1, { type: 'stopped', step: 1, reason: CHECK_STOP })).toBe(stoppedCheck1);
  });

  it('expired: ready, switch-account, stopped(wallet), sending before any send; ready jobs become not-sent', () => {
    expect(expired.phase).toEqual({ kind: 'expired' });
    expect(jobKinds(expired)).toEqual({ [S1]: 'not-sent', [S2]: 'not-sent' });
    expect(reduce(switch1, { type: 'expired' }).phase.kind).toBe('expired');
    expect(reduce(stoppedWallet1, { type: 'expired' }).phase.kind).toBe('expired');
    expect(reduce(sending, { type: 'expired' }).phase.kind).toBe('expired');
    const oneSent = reduce(sending, { type: 'job', id: S1, state: { kind: 'sending' } });
    expect(reduce(oneSent, { type: 'expired' })).toBe(oneSent);
    expect(reduce(stoppedCheck1, { type: 'expired' })).toBe(stoppedCheck1);
    expect(reduce(signing1, { type: 'expired' })).toBe(signing1);
  });

  it('starting: the wait before a wallet request (connect, then the block height) at that step', () => {
    expect(starting0.phase).toEqual({ kind: 'starting', step: 0, waitFor: 'network' });
    const connecting = reduce(switch1, { type: 'starting', step: 1, waitFor: 'wallet' });
    expect(connecting.phase).toEqual({ kind: 'starting', step: 1, waitFor: 'wallet' });
    expect(reduce(connecting, { type: 'starting', step: 1, waitFor: 'network' }).phase).toEqual({
      kind: 'starting',
      step: 1,
      waitFor: 'network',
    });
    expect(reduce(connecting, { type: 'switch-account', step: 1, again: true }).phase).toEqual({
      kind: 'switch-account',
      step: 1,
      again: true,
    });
    expect(reduce(stoppedWallet1, { type: 'starting', step: 1, waitFor: 'network' }).phase.kind).toBe('starting');
    expect(reduce(starting0, { type: 'asking', step: 0 }).phase).toEqual({ kind: 'signing', step: 0 });
    expect(reduce(starting0, { type: 'refresh' }).phase).toEqual({ kind: 'preparing' });
    const late = reduce(ready1, { type: 'starting', step: 1, waitFor: 'network' }, { type: 'expired' });
    expect(late.phase).toEqual({ kind: 'expired' });
    expect(reduce(ready0, { type: 'starting', step: 1, waitFor: 'network' })).toBe(ready0);
    expect(reduce(stoppedCheck1, { type: 'starting', step: 1, waitFor: 'network' })).toBe(stoppedCheck1);
  });

  it('stop-waiting while starting: back to where the click came from, nothing asked', () => {
    expect(reduce(starting0, { type: 'stop-waiting' }).phase).toEqual({ kind: 'ready', step: 0, refreshed: false });
    const connecting = reduce(switch1, { type: 'starting', step: 1, waitFor: 'wallet' });
    expect(reduce(connecting, { type: 'stop-waiting' }).phase).toEqual({ kind: 'switch-account', step: 1, again: false });
    expect(jobKinds(reduce(starting0, { type: 'stop-waiting' }))).toEqual({ [S1]: 'ready', [S2]: 'ready' });
  });

  it('finish: ends the run where it stands; what landed stays, nothing unsent is left waiting', () => {
    const one = (id: string): SigningEvent => ({
      type: 'prepared',
      clock: CLOCK,
      jobs: { [id]: view(id, { kind: 'ready' }) },
      txs: [tx(id)],
      steps: STEPS.map((step) => ({ ...step, count: 1 })),
    });
    // A run in rounds of one; round 1 (S1) landed, round 2 (S2) is being signed, S3 waits for round 3.
    const roundTwo = reduce(
      initialSigningState([S1, S2, S3], 1),
      { type: 'start' },
      one(S1),
      { type: 'asking', step: 0 },
      { type: 'signed', step: 0, txs: [tx(S1, [MAIN])] },
      { type: 'asking', step: 1 },
      { type: 'signed', step: 1, txs: [tx(S1, [MAIN, SECOND])] },
      { type: 'job', id: S1, state: { kind: 'confirming', indefinite: false } },
      { type: 'send-done' },
      { type: 'job', id: S1, state: { kind: 'checking' } },
      { type: 'confirm-done' },
      { type: 'job', id: S1, state: { kind: 'done', after: null } },
      { type: 'check-done' },
    );
    expect(roundTwo.phase).toEqual({ kind: 'preparing' });
    const fromPreparing = reduce(roundTwo, { type: 'finish' });
    expect(fromPreparing.phase).toEqual({ kind: 'finished' });
    expect(jobKinds(fromPreparing)).toEqual({ [S1]: 'done', [S2]: 'not-sent', [S3]: 'not-sent' });
    const stopped = reduce(roundTwo, one(S2), { type: 'asking', step: 0 }, { type: 'stopped', step: 0, reason: walletStop(null) });
    const fromStopped = reduce(stopped, { type: 'finish' });
    expect(fromStopped.phase).toEqual({ kind: 'finished' });
    expect(jobKinds(fromStopped)).toEqual({ [S1]: 'done', [S2]: 'not-sent', [S3]: 'not-sent' });
    expect(reduce(signing0, { type: 'finish' })).toBe(signing0);
    expect(reduce(sending, { type: 'finish' })).toBe(sending);
  });

  it('restart-round: stopped(check, inspect, verify) or expired -> preparing; first is remembered once', () => {
    const state = reduce(stoppedCheck1, { type: 'restart-round', first: SECOND });
    expect(state.phase).toEqual({ kind: 'preparing' });
    expect(state.first).toBe(SECOND);
    expect(state.triedFirst).toEqual([SECOND]);
    expect(jobKinds(state)).toEqual({ [S1]: 'preparing', [S2]: 'preparing' });
    // Tried again: no duplicate. Plain "Start again": first is null and nothing is added.
    const again = reduce(state, prepared, { type: 'asking', step: 0 }, { type: 'stopped', step: 0, reason: CHECK_STOP });
    const second = reduce(again, { type: 'restart-round', first: SECOND });
    expect(second.triedFirst).toEqual([SECOND]);
    const plain = reduce(stoppedCheck1, { type: 'restart-round', first: null });
    expect(plain.first).toBeNull();
    expect(plain.triedFirst).toEqual([]);
    for (const reason of [
      { kind: 'inspect', walletName: 'W', error: { code: 'malformed', message: 'm' } },
      { kind: 'verify', code: 'missing-signatures', detail: 'd' },
    ] satisfies StopReason[]) {
      const stopped = reduce(signing1, { type: 'stopped', step: 1, reason });
      expect(reduce(stopped, { type: 'restart-round', first: null }).phase.kind).toBe('preparing');
    }
    const fromExpired = reduce(expired, { type: 'restart-round', first: null });
    expect(jobKinds(fromExpired)).toEqual({ [S1]: 'preparing', [S2]: 'preparing' });
    expect(reduce(stoppedWallet1, { type: 'restart-round', first: null })).toBe(stoppedWallet1);
  });

  it('the chosen first signer holds: Sign again, plain Start again and the next round keep it', () => {
    const chosen = reduce(stoppedCheck1, { type: 'restart-round', first: SECOND }, prepared);
    const fromExpired = reduce(chosen, { type: 'expired' }, { type: 'restart-round', first: null });
    expect(fromExpired.first).toBe(SECOND);
    const verifyStop: StopReason = { kind: 'verify', code: 'missing-signatures', detail: 'd' };
    const plain = reduce(chosen, { type: 'asking', step: 0 }, { type: 'stopped', step: 0, reason: verifyStop }, {
      type: 'restart-round',
      first: null,
    });
    expect(plain.first).toBe(SECOND);
    expect(plain.triedFirst).toEqual([SECOND]);

    const three = reduce(initialSigningState([S1, S2, S3], 2), { type: 'start' }, prepared, { type: 'asking', step: 0 }, {
      type: 'stopped',
      step: 0,
      reason: CHECK_STOP,
    });
    const next = reduce(
      three,
      { type: 'restart-round', first: SECOND },
      prepared,
      { type: 'asking', step: 0 },
      { type: 'signed', step: 0, txs: [tx(S1, [SECOND]), tx(S2, [SECOND])] },
      { type: 'asking', step: 1 },
      { type: 'signed', step: 1, txs: [tx(S1, [MAIN, SECOND]), tx(S2, [MAIN, SECOND])] },
      { type: 'job', id: S1, state: { kind: 'confirming', indefinite: false } },
      { type: 'job', id: S2, state: { kind: 'confirming', indefinite: false } },
      { type: 'send-done' },
      { type: 'job', id: S1, state: { kind: 'checking' } },
      { type: 'job', id: S2, state: { kind: 'checking' } },
      { type: 'confirm-done' },
      { type: 'job', id: S1, state: { kind: 'done', after: null } },
      { type: 'job', id: S2, state: { kind: 'done', after: null } },
      { type: 'check-done' },
    );
    expect(next.round?.ids).toEqual([S3]);
    expect(next.first).toBe(SECOND);
  });

  it('restart-round keeps the jobs the round already settled (refused, already done)', () => {
    const mixed = reduce(preparing, {
      ...prepared,
      jobs: { [S1]: view(S1, { kind: 'ready' }), [S2]: view(S2, { kind: 'refused', reason: 'not-found' }) },
      txs: [tx(S1)],
    });
    const state = reduce(mixed, { type: 'asking', step: 0 }, { type: 'stopped', step: 0, reason: CHECK_STOP }, {
      type: 'restart-round',
      first: null,
    });
    expect(jobKinds(state)).toEqual({ [S1]: 'preparing', [S2]: 'refused' });
  });

  it('one-at-a-time: expired or stopped(wallet, batch) -> rounds of one; the split round does not count', () => {
    for (const from of [expired, stoppedBatch0]) {
      const state = reduce(from, { type: 'one-at-a-time' });
      expect(state.roundSize).toBe(1);
      expect(state.phase).toEqual({ kind: 'preparing' });
      expect(state.round?.ids).toEqual([S1]);
      expect(state.roundNumber).toBe(1);
      expect(jobKinds(state)).toEqual({ [S1]: 'preparing', [S2]: 'queued' });
    }
    expect(reduce(stoppedWallet1, { type: 'one-at-a-time' })).toBe(stoppedWallet1);
    const busy = reduce(signing0, { type: 'stopped', step: 0, reason: walletStop('WalletBusyError') });
    expect(reduce(busy, { type: 'one-at-a-time' })).toBe(busy);
  });

  it('job: sending, confirming, checking update one job (state, signature, bytes)', () => {
    const signature = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW' as never;
    const bytes = Uint8Array.of(9);
    const state = reduce(sending, { type: 'job', id: S1, state: { kind: 'sending' }, signature, bytes });
    expect(state.jobs[S1]).toMatchObject({ state: { kind: 'sending' }, signature, bytes });
    expect(state.jobs[S2]).toBe(sending.jobs[S2]);
    expect(reduce(state, { type: 'job', id: S1, state: { kind: 'expired' } }).jobs[S1]).toMatchObject({ signature, bytes });
    expect(reduce(sending, { type: 'job', id: 'nope', state: { kind: 'expired' } })).toBe(sending);
    expect(reduce(confirming, { type: 'job', id: S1, state: { kind: 'checking' } }).jobs[S1]?.state.kind).toBe('checking');
    expect(reduce(checking, { type: 'job', id: S1, state: { kind: 'done', after: null } }).jobs[S1]?.state.kind).toBe('done');
    expect(reduce(ready0, { type: 'job', id: S1, state: { kind: 'expired' } })).toBe(ready0);
  });

  it('send-done: confirming when a job is confirming, else advance', () => {
    expect(confirming.phase).toEqual({ kind: 'confirming' });
    const none = reduce(sending, { type: 'job', id: S1, state: { kind: 'expired' } }, { type: 'job', id: S2, state: { kind: 'expired' } }, {
      type: 'send-done',
    });
    expect(none.phase).toEqual({ kind: 'finished' });
  });

  it('confirm-done: checking when a job is checking, else advance', () => {
    expect(checking.phase).toEqual({ kind: 'checking' });
    const none = reduce(confirming, { type: 'job', id: S1, state: { kind: 'expired' } }, { type: 'confirm-done' });
    expect(none.phase).toEqual({ kind: 'finished' });
  });

  it('check-done: advance to the next round, or finished', () => {
    expect(finished.phase).toEqual({ kind: 'finished' });
    const three = reduce(initialSigningState([S1, S2, S3], 2), { type: 'start' }, prepared);
    const next = reduce(
      three,
      { type: 'asking', step: 0 },
      { type: 'signed', step: 0, txs: [tx(S1, [MAIN]), tx(S2, [MAIN])] },
      { type: 'asking', step: 1 },
      { type: 'signed', step: 1, txs: [tx(S1, [MAIN, SECOND]), tx(S2, [MAIN, SECOND])] },
      { type: 'job', id: S1, state: { kind: 'confirming', indefinite: false } },
      { type: 'job', id: S2, state: { kind: 'failed', error: ERROR } },
      { type: 'send-done' },
      { type: 'job', id: S1, state: { kind: 'checking' } },
      { type: 'confirm-done' },
    );
    expect(next.phase).toEqual({ kind: 'checking' });
    expect(reduce(next, { type: 'check-done' }).phase).toEqual({ kind: 'preparing' });
    const after = reduce(next, { type: 'job', id: S1, state: { kind: 'done', after: null } }, { type: 'check-done' });
    expect(after.round?.ids).toEqual([S3]);
    expect(after.roundNumber).toBe(2);
    expect(after.first).toBeNull();
    expect(jobKinds(after)).toEqual({ [S1]: 'done', [S2]: 'failed', [S3]: 'preparing' });
  });

  it('signed, the next step signs by link: link (watching); the job gets the transaction id and the link bytes, stays ready', () => {
    expect(linkWatching.phase).toEqual({ kind: 'link', watching: true, lastCheckFailed: false });
    expect(linkWatching.round?.steps.map((step) => step.status)).toEqual(['signed', 'pending']);
    expect(linkWatching.round?.txs[0]?.summary.presentSignatures).toEqual([MAIN]);
    const job = linkWatching.jobs[S1];
    expect(job?.state).toEqual({ kind: 'ready' });
    expect(job?.signature).toBe(TX_ID);
    expect(job?.bytes).toBe(linkWatching.round?.txs[0]?.bytes);
    expect(jobKinds(linkWatching)).toEqual({ [S1]: 'ready', [S2]: 'queued' });
  });

  it('link-checked: records whether the last check reached the network; the same object when nothing changes', () => {
    const failed = reduce(linkWatching, { type: 'link-checked', ok: false });
    expect(failed.phase).toEqual({ kind: 'link', watching: true, lastCheckFailed: true });
    expect(reduce(failed, { type: 'link-checked', ok: false })).toBe(failed);
    expect(reduce(failed, { type: 'link-checked', ok: true }).phase).toEqual(linkWatching.phase);
    expect(reduce(linkWatching, { type: 'link-checked', ok: true })).toBe(linkWatching);
  });

  it('link-paused, then link-resume: a new watching phase object (the driver starts a new watch)', () => {
    expect(linkPaused.phase).toEqual({ kind: 'link', watching: false, lastCheckFailed: false });
    const failedPaused = reduce(linkWatching, { type: 'link-checked', ok: false }, { type: 'link-paused' });
    const resumed = reduce(failedPaused, { type: 'link-resume' });
    expect(resumed.phase).toEqual({ kind: 'link', watching: true, lastCheckFailed: false });
    expect(resumed.phase).not.toBe(linkWatching.phase);
    expect(reduce(linkWatching, { type: 'link-resume' })).toBe(linkWatching);
    expect(reduce(linkPaused, { type: 'link-paused' })).toBe(linkPaused);
  });

  it('link-result: the job takes the outcome, then the next round (or finished)', () => {
    const next = reduce(linkWatching, { type: 'link-result', id: S1, state: { kind: 'done', after: null } });
    expect(jobKinds(next)).toEqual({ [S1]: 'done', [S2]: 'preparing' });
    expect(next.jobs[S1]?.signature).toBe(TX_ID);
    expect(next.phase).toEqual({ kind: 'preparing' });
    expect(next.round?.ids).toEqual([S2]);
    expect(next.roundNumber).toBe(2);
    const fromPaused = reduce(linkPaused, { type: 'link-result', id: S1, state: { kind: 'expired' } });
    expect(jobKinds(fromPaused)).toEqual({ [S1]: 'expired', [S2]: 'preparing' });
    const last = reduce(
      linkWatching,
      { type: 'link-result', id: S1, state: { kind: 'failed', error: ERROR } },
      { type: 'prepared', clock: CLOCK, jobs: { [S2]: view(S2, { kind: 'refused', reason: 'not-found' }) }, txs: [], steps: [] },
    );
    expect(last.phase).toEqual({ kind: 'finished' });
    expect(reduce(linkWatching, { type: 'link-result', id: S2, state: { kind: 'done', after: null } })).toBe(linkWatching);
  });

  it('stop-waiting while a link is open: the signed job is unknown(link-open), later jobs not sent; finished', () => {
    for (const open of [linkWatching, linkPaused]) {
      const stopped = reduce(open, { type: 'stop-waiting' });
      expect(stopped.phase).toEqual({ kind: 'finished' });
      expect(stopped.jobs[S1]?.state).toEqual({ kind: 'unknown', why: 'link-open' });
      expect(stopped.jobs[S1]?.signature).toBe(TX_ID);
      expect(stopped.jobs[S2]?.state).toEqual({ kind: 'not-sent' });
    }
  });

  it('stop-waiting: maps every job and finishes', () => {
    const three = reduce(initialSigningState([S1, S2, S3], 2), { type: 'start' }, prepared, { type: 'asking', step: 0 }, {
      type: 'signed',
      step: 0,
      txs: [tx(S1, [MAIN]), tx(S2, [MAIN])],
    }, { type: 'asking', step: 1 }, { type: 'signed', step: 1, txs: [tx(S1, [MAIN, SECOND]), tx(S2, [MAIN, SECOND])] });
    // S1 sending, S2 still ready, S3 queued.
    const inFlight = reduce(three, { type: 'job', id: S1, state: { kind: 'sending' } });
    expect(jobKinds(reduce(inFlight, { type: 'stop-waiting' }))).toEqual({
      [S1]: 'unknown',
      [S2]: 'not-sent',
      [S3]: 'not-sent',
    });
    const stopped = reduce(inFlight, { type: 'stop-waiting' });
    expect(stopped.phase).toEqual({ kind: 'finished' });
    expect(stopped.jobs[S1]?.state).toEqual({ kind: 'unknown', why: 'stopped' });

    const waiting = reduce(confirming, { type: 'stop-waiting' });
    expect(waiting.jobs[S1]?.state).toEqual({ kind: 'unknown', why: 'stopped' });
    expect(waiting.jobs[S2]?.state).toEqual({ kind: 'failed', error: ERROR });
    expect(reduce(checking, { type: 'stop-waiting' }).jobs[S1]?.state).toEqual({ kind: 'unknown', why: 'unverified' });
    expect(reduce(signing0, { type: 'stop-waiting' })).toBe(signing0);
  });
});

describe('signingReducer: an event that does not fit the phase returns the same object', () => {
  const EVENTS: SigningEvent[] = [
    { type: 'start' },
    prepared,
    { type: 'prepare-failed', problem: { kind: 'read', error: ERROR } },
    { type: 'retry-prepare' },
    { type: 'refresh' },
    { type: 'needs-wallet', step: 0 },
    { type: 'wallet-ready', step: 0, steps: STEPS },
    { type: 'switch-account', step: 0, again: false },
    { type: 'asking', step: 0 },
    { type: 'signed', step: 0, txs: [] },
    { type: 'stopped', step: 0, reason: CHECK_STOP },
    { type: 'expired' },
    { type: 'restart-round', first: null },
    { type: 'one-at-a-time' },
    { type: 'job', id: S1, state: { kind: 'expired' } },
    { type: 'send-done' },
    { type: 'confirm-done' },
    { type: 'check-done' },
    { type: 'stop-waiting' },
    { type: 'starting', step: 0, waitFor: 'network' },
    { type: 'finish' },
    { type: 'link-checked', ok: false },
    { type: 'link-paused' },
    { type: 'link-resume' },
    { type: 'link-result', id: S1, state: { kind: 'done', after: null } },
  ];
  /** Which events each phase fixture accepts (at step 0 where a step matters). */
  const ACCEPTS: Record<string, readonly SigningEvent['type'][]> = {
    idle: ['start'],
    preparing: ['prepared', 'prepare-failed', 'finish'],
    prepareFailed: ['retry-prepare', 'finish'],
    ready0: ['refresh', 'needs-wallet', 'switch-account', 'asking', 'stopped', 'expired', 'starting', 'finish'],
    starting0: ['refresh', 'needs-wallet', 'switch-account', 'asking', 'expired', 'stop-waiting'],
    needsWallet0: ['wallet-ready', 'switch-account', 'asking', 'stopped', 'finish'],
    switch1: ['expired', 'finish'],
    signing0: ['switch-account', 'signed', 'stopped'],
    stoppedWallet1: ['expired', 'finish'],
    stoppedCheck1: ['restart-round', 'finish'],
    expired: ['restart-round', 'one-at-a-time', 'finish'],
    sending: ['expired', 'job', 'send-done', 'stop-waiting'],
    confirming: ['job', 'confirm-done', 'stop-waiting'],
    checking: ['job', 'check-done', 'stop-waiting'],
    finished: [],
    // Never expired, restart-round, refresh, one-at-a-time or finish while a link is open: the other device may sign.
    linkWatching: ['stop-waiting', 'link-checked', 'link-paused', 'link-result'],
    linkPaused: ['stop-waiting', 'link-checked', 'link-resume', 'link-result'],
  };

  it.each(Object.entries(PHASES))('%s', (name, state) => {
    const accepted = EVENTS.filter((event) => signingReducer(state, event) !== state).map((event) => event.type);
    expect(accepted).toEqual(ACCEPTS[name]);
  });
});

describe('retryableIds', () => {
  it('lists sim-failed, failed, expired and not-sent jobs in run order', () => {
    const state = initialSigningState(['a', 'b', 'c', 'd', 'e', 'f'], 6);
    const jobs: Record<string, JobView> = {
      a: view('a', { kind: 'sim-failed', error: ERROR }),
      b: view('b', { kind: 'done', after: null }),
      c: view('c', { kind: 'failed', error: ERROR }),
      d: view('d', { kind: 'expired' }),
      e: view('e', { kind: 'unknown', why: 'timeout' }),
      f: view('f', { kind: 'not-sent' }),
    };
    expect(retryableIds({ ...state, jobs })).toEqual(['a', 'c', 'd', 'f']);
  });
});
