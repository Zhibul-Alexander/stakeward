// @vitest-environment node
import { generateKeyPairSigner, type Address, type KeyPairSigner } from '@solana/kit';
import { decodeStakeAccount, STAKE_PROGRAM_ADDRESS, type ChainPort, type RawAccount, type TransactionAction } from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { createTestWalletPort, type TestWalletPort } from '@stakeward/core/test/test-wallet-port';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSlotStore, StaticWalletRegistry, type SlotStore } from '@/ports';
import { HttpChain } from '@/ports/http-chain';
import { checkLanded, type LandedItem } from '@/signing/check';
import type { SigningState } from '@/signing/machine';
import { REREAD_ATTEMPTS, appendsTail } from '@/signing/rules';
import { slotSignerResolver } from '@/signing/resolve';
import { SigningSession, type SessionOptions } from '@/signing/session';
import type { JobPlan, SigningPlan } from '@/signing/types';

// The signing engine's driver without React, on the real stake program (LiteSvmChain) with in-memory test wallets.

const DAY = 86_400n;
const T = START_UNIX_TIMESTAMP + 30n * DAY;

/** A minimal page plan: protect each account with (A, K, T) unless the chain already shows it. */
function protectPlan(mainKey: Address, secondKey: Address, lockUntil: bigint): SigningPlan {
  return planOf((id, account) => {
    if (account.lockup.custodian === secondKey && account.lockup.unixTimestamp === lockUntil) return { kind: 'done', after: account };
    return {
      kind: 'build',
      action: { kind: 'protect', stakeAccount: id, mainKey, secondKey, lockUntil },
      feePayer: mainKey,
      before: account,
    };
  });
}

function planOf(decide: (id: Address, account: NonNullable<ReturnType<typeof decoded>>) => JobPlan): SigningPlan {
  return {
    async prepare(chain, ids) {
      const [{ accounts }, clock] = await Promise.all([chain.getAccounts(ids as Address[]), chain.getClock()]);
      const jobs: Record<string, JobPlan> = {};
      ids.forEach((id, index) => {
        const account = decoded(accounts[index] ?? null);
        jobs[id] = account === null ? { kind: 'refused', reason: 'not-found', before: null } : decide(id as Address, account);
      });
      return { clock, jobs };
    },
  };
}

function decoded(raw: RawAccount | null) {
  if (raw === null) return null;
  const result = decodeStakeAccount(raw);
  return result.ok ? result.account : null;
}

/** Resolves once the session's state matches (or rejects after a while, naming the phase it is stuck in). */
function until(session: SigningSession, predicate: (state: SigningState) => boolean, timeoutMs = 30_000): Promise<SigningState> {
  const now = session.getSnapshot();
  if (predicate(now)) return Promise.resolve(now);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stop();
      reject(new Error(`Timed out in phase ${JSON.stringify(session.getSnapshot().phase, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))}`));
    }, timeoutMs);
    const stop = session.subscribe(() => {
      const state = session.getSnapshot();
      if (!predicate(state)) return;
      clearTimeout(timer);
      stop();
      resolve(state);
    });
  });
}

const phaseIs =
  (kind: SigningState['phase']['kind'], step?: number) =>
  (state: SigningState): boolean =>
    state.phase.kind === kind && (step === undefined || ('step' in state.phase && state.phase.step === step));

function jobKinds(state: SigningState): Record<string, string> {
  return Object.fromEntries(state.ids.map((id) => [id, state.jobs[id]?.state.kind ?? 'none']));
}

function walletError(name: string): Error {
  const error = new Error(`${name} from the test wallet`);
  error.name = name;
  return error;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('SigningSession on LiteSvmChain', { timeout: 60_000 }, () => {
  let testChain: TestChain;
  let chain: LiteSvmChain;
  let mainKey: KeyPairSigner;
  let secondKey: KeyPairSigner;
  let main: TestWalletPort;
  let second: TestWalletPort;
  let A: Address;
  let K: Address;
  let S1: Address;
  let S2: Address;
  let slots: SlotStore;
  let wallets: StaticWalletRegistry;

  beforeEach(async () => {
    testChain = await TestChain.create();
    chain = new LiteSvmChain(testChain);
    [mainKey, secondKey] = await Promise.all([testChain.fundedKey(), testChain.fundedKey()]);
    A = mainKey.address;
    K = secondKey.address;
    main = await createTestWalletPort({ name: 'Main Wallet', signers: [mainKey], connected: true });
    second = await createTestWalletPort({ name: 'Second Wallet', signers: [secondKey], connected: true });
    S1 = await testChain.createStakeAccount({ staker: A, withdrawer: A });
    S2 = await testChain.createStakeAccount({ staker: A, withdrawer: A });
    wallets = new StaticWalletRegistry([main, second]);
    slots = createSlotStore(null);
    slots.assign('main', { walletId: main.id, address: A });
    slots.assign('second', { walletId: second.id, address: K });
  });

  function session(options: Partial<SessionOptions> = {}): SigningSession {
    return new SigningSession({
      chain,
      plan: protectPlan(A, K, T),
      ids: [S1, S2],
      resolveSigner: slotSignerResolver({ slots, wallets }),
      appendsTail,
      confirm: { pollIntervalMs: 1 },
      rereadDelayMs: 1,
      ...options,
    });
  }

  /** Main key, then second key, each once; resolves at the end of the run. */
  async function signBoth(s: SigningSession): Promise<SigningState> {
    await until(s, phaseIs('ready', 0));
    s.sign();
    await until(s, phaseIs('ready', 1));
    s.sign();
    return until(s, phaseIs('finished'));
  }

  it('asks each signer once for all transactions of the round, sends, confirms and checks on the chain', async () => {
    const onFinished = vi.fn();
    const s = session({ onFinished });
    s.start();
    const ready = await until(s, phaseIs('ready', 0));
    expect(ready.round?.steps.map((step) => [step.address, step.role, step.walletName, step.count])).toEqual([
      [A, 'main', 'Main Wallet', 2],
      [K, 'second', 'Second Wallet', 2],
    ]);
    const end = await signBoth(s);
    expect(main.requests).toHaveLength(1);
    expect(main.requests[0]?.transactions).toHaveLength(2);
    expect(second.requests).toHaveLength(1);
    expect(second.requests[0]?.transactions).toHaveLength(2);
    expect(jobKinds(end)).toEqual({ [S1]: 'done', [S2]: 'done' });
    for (const id of [S1, S2]) {
      expect(testChain.stakeAccount(id)?.lockup).toEqual({ unixTimestamp: T, epoch: 0n, custodian: K });
      expect(end.jobs[id]?.signature).not.toBeNull();
    }
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(onFinished).toHaveBeenCalledWith(end);
  });

  it('a double sign() asks the wallet once', async () => {
    const s = session();
    s.start();
    await until(s, phaseIs('ready', 0));
    s.sign();
    s.sign();
    await until(s, phaseIs('signing', 0));
    s.sign();
    await until(s, phaseIs('ready', 1));
    expect(main.requests).toHaveLength(1);
    s.dispose();
  });

  it('shows switch-account before asking a wallet that does not offer the key, then signs after Continue', async () => {
    const s = session();
    s.start();
    await until(s, phaseIs('ready', 0));
    main.setExposedAccounts([]);
    s.sign();
    const switched = await until(s, phaseIs('switch-account', 0));
    expect(switched.phase).toEqual({ kind: 'switch-account', step: 0, again: false });
    expect(main.requests).toHaveLength(0);
    main.setExposedAccounts([A]);
    s.continueAfterSwitch();
    await until(s, phaseIs('ready', 1));
    expect(main.requests).toHaveLength(1);
    s.dispose();
  });

  it('WalletAccountUnavailableError from the wallet -> switch-account', async () => {
    const s = session();
    s.start();
    await until(s, phaseIs('ready', 0));
    main.once({ fail: walletError('WalletAccountUnavailableError') });
    s.sign();
    await until(s, phaseIs('switch-account', 0));
    s.continueAfterSwitch();
    const end = await until(s, phaseIs('ready', 1));
    expect(main.requests).toHaveLength(2);
    expect(end.round?.steps[0]?.status).toBe('signed');
    s.dispose();
  });

  it('Stop waiting frees the wallet queue: Try again is served while the first request hangs', async () => {
    const hang = deferred();
    const s = session();
    s.start();
    await until(s, phaseIs('ready', 0));
    s.sign();
    await until(s, phaseIs('ready', 1));
    second.once({ delay: hang.promise });
    s.sign();
    await until(s, phaseIs('signing', 1));
    await vi.waitFor(() => {
      expect(second.requests).toHaveLength(1); // the wallet holds the request (its window is open)
    });
    s.stopWaiting();
    const stopped = await until(s, phaseIs('stopped', 1));
    expect(stopped.phase).toMatchObject({ reason: { kind: 'wallet', walletName: 'Second Wallet', portError: 'cancelled' } });
    s.sign();
    const end = await until(s, phaseIs('finished'));
    expect(second.requests).toHaveLength(2);
    expect(jobKinds(end)).toEqual({ [S1]: 'done', [S2]: 'done' });
    hang.resolve();
  });

  it('WalletBatchUnsupportedError stops the round; one at a time then signs in 2 rounds', async () => {
    const s = session();
    s.start();
    await until(s, phaseIs('ready', 0));
    main.once({ fail: walletError('WalletBatchUnsupportedError') });
    s.sign();
    const stopped = await until(s, phaseIs('stopped', 0));
    expect(stopped.phase).toMatchObject({ reason: { kind: 'wallet', portError: 'WalletBatchUnsupportedError' } });
    s.oneAtATime();
    const first = await until(s, phaseIs('ready', 0));
    expect(first.roundSize).toBe(1);
    expect(first.roundNumber).toBe(1);
    expect(first.round?.ids).toEqual([S1]);
    s.sign();
    await until(s, phaseIs('ready', 1));
    s.sign();
    const next = await until(s, (state) => state.roundNumber === 2 && phaseIs('ready', 0)(state));
    expect(next.round?.ids).toEqual([S2]);
    expect(next.jobs[S1]?.state.kind).toBe('done');
    const end = await signBoth(s);
    expect(jobKinds(end)).toEqual({ [S1]: 'done', [S2]: 'done' });
    expect(main.requests.map((request) => request.transactions.length)).toEqual([2, 1, 1]);
    expect(second.requests.map((request) => request.transactions.length)).toEqual([1, 1]);
  });

  it('the signing order the user chose holds: Sign again after an expiry keeps the second key first', async () => {
    const s = session({ ids: [S1] });
    s.start();
    await until(s, phaseIs('ready', 0));
    s.sign();
    await until(s, phaseIs('ready', 1));
    second.once({ lighthouseTail: true });
    s.sign();
    const stopped = await until(s, phaseIs('stopped', 1));
    expect(stopped.phase).toMatchObject({ reason: { kind: 'check', code: 'tail-not-first-signer', startWith: K, bothWays: false } });
    s.restartRound(K);
    const secondFirst = await until(s, phaseIs('ready', 0));
    expect(secondFirst.round?.steps.map((step) => step.address)).toEqual([K, A]);
    s.sign();
    await until(s, phaseIs('ready', 1));
    chain.expireBlockhash();
    s.sign();
    await until(s, phaseIs('expired'));

    s.restartRound(); // "Sign again"
    const again = await until(s, phaseIs('ready', 0));
    expect(again.round?.steps.map((step) => step.address)).toEqual([K, A]);
    s.sign();
    await until(s, phaseIs('ready', 1));
    s.sign();
    const end = await until(s, phaseIs('finished'));
    expect(jobKinds(end)).toEqual({ [S1]: 'done' });
  });

  it('the signing order the user chose holds in the next rounds', async () => {
    const s = session({ roundSize: 1 });
    s.start();
    await until(s, phaseIs('ready', 0));
    s.sign();
    await until(s, phaseIs('ready', 1));
    second.once({ lighthouseTail: true });
    s.sign();
    await until(s, phaseIs('stopped', 1));
    s.restartRound(K);
    await until(s, phaseIs('ready', 0));
    s.sign();
    await until(s, phaseIs('ready', 1));
    s.sign();
    const next = await until(s, (state) => state.roundNumber === 2 && phaseIs('ready', 0)(state));
    expect(next.jobs[S1]?.state.kind).toBe('done');
    expect(next.round?.steps.map((step) => step.address)).toEqual([K, A]);
    s.sign();
    await until(s, phaseIs('ready', 1));
    s.sign();
    const end = await until(s, phaseIs('finished'));
    expect(jobKinds(end)).toEqual({ [S1]: 'done', [S2]: 'done' });
  });

  it('finish in a later round: reports what earlier rounds landed (onFinished), the rest is not sent', async () => {
    const onFinished = vi.fn();
    const s = session({ roundSize: 1, onFinished });
    s.start();
    await until(s, phaseIs('ready', 0));
    s.sign();
    await until(s, phaseIs('ready', 1));
    s.sign();
    await until(s, (state) => state.roundNumber === 2 && phaseIs('ready', 0)(state));
    expect(testChain.stakeAccount(S1)?.lockup.custodian).toBe(K);
    s.sign();
    await until(s, phaseIs('ready', 1));
    second.once({ reject: true });
    s.sign();
    await until(s, phaseIs('stopped', 1));

    s.finish();
    const end = s.getSnapshot();
    expect(end.phase).toEqual({ kind: 'finished' });
    expect(jobKinds(end)).toEqual({ [S1]: 'done', [S2]: 'not-sent' });
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(onFinished).toHaveBeenCalledWith(end);
    expect(testChain.stakeAccount(S2)?.lockup.unixTimestamp).toBe(0n);
  });

  it('the block height read after Sign is a wait the screen shows (starting), and Stop waiting ends it', async () => {
    const s = session();
    s.start();
    await until(s, phaseIs('ready', 0));
    const height = vi.spyOn(chain, 'getBlockHeight').mockImplementationOnce(() => new Promise<bigint>(() => undefined));
    s.sign();
    const starting = await until(s, phaseIs('starting', 0));
    expect(starting.phase).toEqual({ kind: 'starting', step: 0, waitFor: 'network' });
    s.sign(); // a second click does nothing while the first one waits
    expect(height).toHaveBeenCalledTimes(1);
    s.stopWaiting();
    expect(s.getSnapshot().phase).toEqual({ kind: 'ready', step: 0, refreshed: false });
    expect(main.requests).toHaveLength(0);

    s.sign(); // the next read answers: the wallet is asked
    await until(s, phaseIs('ready', 1));
    expect(main.requests).toHaveLength(1);
    s.dispose();
  });

  it('Continue after switching accounts waits for the wallet (starting) with Stop waiting; a second press asks nothing', async () => {
    const both = await createTestWalletPort({ name: 'Both Wallet', signers: [mainKey, secondKey], connected: true });
    wallets.add(both);
    slots.clear('main');
    slots.clear('second');
    slots.assign('main', { walletId: both.id, address: A });
    slots.assign('second', { walletId: both.id, address: K });
    const s = session();
    s.start();
    await until(s, phaseIs('ready', 0));
    both.setExposedAccounts([A]);
    s.sign();
    await until(s, phaseIs('ready', 1));
    s.sign();
    await until(s, phaseIs('switch-account', 1));

    const connect = vi.spyOn(both, 'connect').mockImplementation(
      (options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            reject(walletError('AbortError'));
          });
        }),
    );
    s.continueAfterSwitch();
    const waiting = await until(s, phaseIs('starting', 1));
    expect(waiting.phase).toEqual({ kind: 'starting', step: 1, waitFor: 'wallet' });
    s.continueAfterSwitch();
    expect(connect).toHaveBeenCalledTimes(1);
    s.stopWaiting();
    expect(s.getSnapshot().phase).toEqual({ kind: 'switch-account', step: 1, again: false });
    expect(both.requests).toHaveLength(1);
    s.dispose();
  });

  it('a wallet that returns its transactions unsigned: stopped by verify, nothing sent', async () => {
    const send = vi.spyOn(chain, 'send');
    const s = session();
    s.start();
    await until(s, phaseIs('ready', 0));
    s.sign();
    await until(s, phaseIs('ready', 1));
    second.once({ skipSignature: true });
    s.sign();
    const stopped = await until(s, phaseIs('stopped', 1));
    expect(stopped.phase).toMatchObject({ reason: { kind: 'verify', code: 'missing-signatures' } });
    expect(send).not.toHaveBeenCalled();
    expect(testChain.stakeAccount(S1)?.lockup.unixTimestamp).toBe(0n);
    s.dispose();
  });

  it('fewer than 60 blocks left before the first signature: builds and simulates again, asks no wallet', async () => {
    const simulate = vi.spyOn(chain, 'simulate');
    const s = session();
    s.start();
    await until(s, phaseIs('ready', 0));
    expect(simulate).toHaveBeenCalledTimes(2);
    chain.advanceBlocks(100n); // 150 - 100 = 50 blocks left
    s.sign();
    const refreshed = await until(s, (state) => state.phase.kind === 'ready' && state.phase.refreshed);
    expect(refreshed.phase).toEqual({ kind: 'ready', step: 0, refreshed: true });
    expect(simulate).toHaveBeenCalledTimes(4);
    expect(main.requests).toHaveLength(0);
    s.dispose();
  });

  it('a send whose answer is lost is polled until its blockhash expires', async () => {
    const s = session();
    s.start();
    await until(s, phaseIs('ready', 0));
    s.sign();
    await until(s, phaseIs('ready', 1));
    chain.failNext('send', new TypeError('fetch failed'));
    s.sign();
    const waiting = await until(s, (state) => {
      const job = state.jobs[S1]?.state;
      return job?.kind === 'confirming' && job.indefinite && state.phase.kind === 'confirming';
    });
    expect(waiting.jobs[S1]?.state).toEqual({ kind: 'confirming', indefinite: true });
    chain.advanceBlocks(200n);
    const end = await until(s, phaseIs('finished'));
    expect(end.jobs[S1]?.state).toEqual({ kind: 'expired' });
    expect(end.jobs[S2]?.state.kind).toBe('done');
  });

  it('a rate limit on the resend after a lost answer: still polled (the first attempt may land), never rebuilt', async () => {
    // What HttpChain throws when the first send got no answer and the resend of the same bytes got HTTP 429.
    const answers: (() => Promise<Response>)[] = [
      () => Promise.reject(new TypeError('Failed to fetch')),
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32005, message: 'Too many requests' } }), { status: 429 }),
        ),
    ];
    const fetch: typeof globalThis.fetch = (_input, init) => {
      const { method } = JSON.parse(init?.body as string) as { method: string };
      if (method === 'sendTransaction') return (answers.shift() ?? (() => Promise.reject(new Error('unexpected send'))))();
      return Promise.resolve(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: [null] } })));
    };
    const http = new HttpChain({ fetch, sleep: () => Promise.resolve() });

    const s = session();
    s.start();
    await until(s, phaseIs('ready', 0));
    s.sign();
    await until(s, phaseIs('ready', 1));
    const { round } = s.getSnapshot();
    const lost: unknown = await http.send(round?.txs[0]?.bytes ?? new Uint8Array()).catch((e: unknown) => e);
    chain.failNext('send', lost as Error);
    s.sign();
    const waiting = await until(s, (state) => state.phase.kind === 'confirming');
    expect(waiting.jobs[S1]?.state).toEqual({ kind: 'confirming', indefinite: true });
    chain.advanceBlocks(200n);
    const end = await until(s, phaseIs('finished'));
    expect(end.jobs[S1]?.state).toEqual({ kind: 'expired' });
    expect(end.jobs[S2]?.state.kind).toBe('done');
  });

  it('Stop waiting while confirming leaves unknown(stopped); checkLanded later finds them landed', async () => {
    const s = session();
    s.start();
    await until(s, phaseIs('ready', 0));
    s.sign();
    await until(s, phaseIs('ready', 1));
    chain.holdTransactions();
    s.sign();
    await until(s, phaseIs('confirming'));
    s.stopWaiting();
    const end = await until(s, phaseIs('finished'));
    expect(end.jobs[S1]?.state).toEqual({ kind: 'unknown', why: 'stopped' });
    expect(end.jobs[S2]?.state).toEqual({ kind: 'unknown', why: 'stopped' });

    chain.landHeld();
    const items: LandedItem[] = [S1, S2].map((id) => {
      const job = end.jobs[id];
      if (job?.action === undefined || job.action === null) throw new Error('no action');
      return { id, action: job.action, signature: job.signature, lifetime: job.lifetime, bytes: job.bytes, before: job.before, confirmed: false, why: 'stopped' };
    });
    const results = await checkLanded(chain, items);
    expect(results[S1]).toMatchObject({ kind: 'done', after: { lockup: { custodian: K, unixTimestamp: T } } });
    expect(results[S2]?.kind).toBe('done');
  });

  it('confirmed but the account does not show the change: reads again, then unknown(not-applied)', async () => {
    const lagging = new LaggingChain(chain);
    const s = session({ chain: lagging });
    s.start();
    const end = await signBoth(s);
    expect(end.jobs[S1]?.state).toEqual({ kind: 'unknown', why: 'not-applied' });
    expect(end.jobs[S2]?.state).toEqual({ kind: 'unknown', why: 'not-applied' });
    // One read after the confirmation, then REREAD_ATTEMPTS more.
    expect(lagging.frozenReads).toBe(1 + REREAD_ATTEMPTS);
    expect(testChain.stakeAccount(S1)?.lockup.custodian).toBe(K);
  });

  it('a stake account that fails simulation leaves the round; the other one goes on', async () => {
    const other = await generateKeyPairSigner();
    const locked = await testChain.createStakeAccount({
      staker: A,
      withdrawer: A,
      lockup: { unixTimestamp: T + DAY, epoch: 0n, custodian: other.address },
    });
    const s = session({ ids: [S1, locked] });
    s.start();
    const ready = await until(s, phaseIs('ready', 0));
    expect(ready.jobs[locked]?.state).toMatchObject({ kind: 'sim-failed', error: { code: 'missing-signature' } });
    expect(ready.round?.txs.map((tx) => tx.id)).toEqual([S1]);
    expect(ready.round?.steps.map((step) => step.count)).toEqual([1, 1]);
    s.sign();
    await until(s, phaseIs('ready', 1));
    s.sign();
    const end = await until(s, phaseIs('finished'));
    expect(jobKinds(end)).toEqual({ [S1]: 'done', [locked]: 'sim-failed' });
    expect(main.requests[0]?.transactions).toHaveLength(1);
  });

  it('a fee payer that cannot pay the round and stay rent-exempt: prepare-failed fee-balance', async () => {
    const poorKey = await generateKeyPairSigner();
    const rent = await chain.getMinimumBalanceForRentExemption(0);
    testChain.airdrop(poorKey.address, rent + 15_000n); // one protect fits, two do not
    const poor = await createTestWalletPort({ name: 'Poor Wallet', signers: [poorKey], connected: true });
    wallets.add(poor);
    slots.clear('main');
    slots.assign('main', { walletId: poor.id, address: poorKey.address });
    const P1 = await testChain.createStakeAccount({ staker: poorKey.address, withdrawer: poorKey.address });
    const P2 = await testChain.createStakeAccount({ staker: poorKey.address, withdrawer: poorKey.address });
    const s = session({ ids: [P1, P2], plan: protectPlan(poorKey.address, K, T) });
    s.start();
    const failed = await until(s, phaseIs('prepare-failed'));
    expect(failed.phase).toMatchObject({
      problem: { kind: 'fee-balance', payer: poorKey.address, role: 'main', balance: rent + 15_000n },
    });
    const { problem } = failed.phase as Extract<SigningState['phase'], { kind: 'prepare-failed' }>;
    if (problem.kind !== 'fee-balance') throw new Error(problem.kind);
    expect(problem.needed).toBeGreaterThan(problem.balance);
    expect(poor.requests).toHaveLength(0);
    s.dispose();
  });

  it('a plan that finds the change already on the chain: no transaction, no wallet request', async () => {
    const lockup = { unixTimestamp: T, epoch: 0n, custodian: K };
    const done1 = await testChain.createStakeAccount({ staker: A, withdrawer: A, lockup });
    const done2 = await testChain.createStakeAccount({ staker: A, withdrawer: A, lockup });
    const simulate = vi.spyOn(chain, 'simulate');
    const onFinished = vi.fn();
    const s = session({ ids: [done1, done2], onFinished });
    s.start();
    const end = await until(s, phaseIs('finished'));
    expect(jobKinds(end)).toEqual({ [done1]: 'already-done', [done2]: 'already-done' });
    expect(simulate).not.toHaveBeenCalled();
    expect(main.requests).toHaveLength(0);
    expect(second.requests).toHaveLength(0);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('dispose: no onFinished, and a late wallet answer changes nothing', async () => {
    const late = deferred();
    const send = vi.spyOn(chain, 'send');
    const onFinished = vi.fn();
    const s = session({ onFinished });
    s.start();
    await until(s, phaseIs('ready', 0));
    s.sign();
    await until(s, phaseIs('ready', 1));
    second.once({ delay: late.promise });
    s.sign();
    const signing = await until(s, phaseIs('signing', 1));
    await vi.waitFor(() => {
      expect(second.requests).toHaveLength(1);
    });
    s.dispose();
    late.resolve();
    await vi.waitFor(() => {
      expect(second.responses).toHaveLength(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(s.getSnapshot()).toBe(signing);
    expect(send).not.toHaveBeenCalled();
    expect(onFinished).not.toHaveBeenCalled();
  });

  it('F5 shape: an extend paid by the main key adds a Main key step, needs-wallet while its slot is empty', async () => {
    const T2 = T + 90n * DAY;
    const stake = await testChain.createStakeAccount({
      staker: A,
      withdrawer: A,
      lockup: { unixTimestamp: T, epoch: 0n, custodian: K },
    });
    const extend: TransactionAction = { kind: 'extend', stakeAccount: stake, secondKey: K, lockUntil: T2 };
    const plan = planOf((_id, account) => ({ kind: 'build', action: extend, feePayer: A, before: account }));
    slots.clear('main');
    const s = session({ ids: [stake], plan });
    s.start();
    const needs = await until(s, phaseIs('needs-wallet', 0));
    expect(needs.round?.steps.map((step) => [step.address, step.role, step.walletName])).toEqual([
      [A, 'main', null],
      [K, 'second', 'Second Wallet'],
    ]);
    s.continueWithWallet(); // still not connected: stays
    expect(s.getSnapshot()).toBe(needs);
    slots.assign('main', { walletId: main.id, address: A });
    s.continueWithWallet();
    const ready = await until(s, phaseIs('ready', 0));
    expect(ready.round?.steps[0]).toMatchObject({ role: 'main', walletName: 'Main Wallet' });
    s.sign();
    await until(s, phaseIs('ready', 1));
    s.sign();
    const end = await until(s, phaseIs('finished'));
    expect(jobKinds(end)).toEqual({ [stake]: 'done' });
    expect(testChain.stakeAccount(stake)?.lockup.unixTimestamp).toBe(T2);
  });
});

/**
 * A node that lags behind: from the first send on, getAccounts answers with the accounts as they were before it.
 * Counts those stale reads.
 */
class LaggingChain implements ChainPort {
  frozenReads = 0;
  private frozen: Map<Address, RawAccount | null> | null = null;
  private readonly inner: LiteSvmChain;

  constructor(inner: LiteSvmChain) {
    this.inner = inner;
  }

  async getAccounts(addresses: readonly Address[]) {
    const fresh = await this.inner.getAccounts(addresses);
    const frozen = this.frozen;
    if (frozen === null) return fresh;
    this.frozenReads += 1;
    return { slot: fresh.slot, accounts: addresses.map((address, index) => (frozen.has(address) ? (frozen.get(address) ?? null) : (fresh.accounts[index] ?? null))) };
  }

  async send(transaction: Parameters<ChainPort['send']>[0]) {
    if (this.frozen === null) {
      const stakes = this.inner.testChain.svm
        .getProgramAccounts(STAKE_PROGRAM_ADDRESS)
        .map((account) => account.address);
      const { accounts } = await this.inner.getAccounts(stakes);
      this.frozen = new Map(stakes.map((address, index) => [address, accounts[index] ?? null]));
    }
    return this.inner.send(transaction);
  }

  getClock: ChainPort['getClock'] = () => this.inner.getClock();
  getLatestBlockhash: ChainPort['getLatestBlockhash'] = () => this.inner.getLatestBlockhash();
  getBlockHeight: ChainPort['getBlockHeight'] = () => this.inner.getBlockHeight();
  getEpochInfo: ChainPort['getEpochInfo'] = () => this.inner.getEpochInfo();
  getBalance: ChainPort['getBalance'] = (address) => this.inner.getBalance(address);
  getMinimumBalanceForRentExemption: ChainPort['getMinimumBalanceForRentExemption'] = (size) =>
    this.inner.getMinimumBalanceForRentExemption(size);
  simulate: ChainPort['simulate'] = (transaction) => this.inner.simulate(transaction);
  getSignatureStatuses: ChainPort['getSignatureStatuses'] = (signatures) => this.inner.getSignatureStatuses(signatures);
  findStakeAccounts: ChainPort['findStakeAccounts'] = (filter) => this.inner.findStakeAccounts(filter);
}
