// @vitest-environment node
import { generateKeyPairSigner, type Address, type KeyPairSigner, type Signature } from '@solana/kit';
import {
  buildTransaction,
  decodeStakeAccount,
  deriveNonceAccountAddress,
  inspectTransaction,
  NONCE_ACCOUNT_SEED,
  NONCE_ACCOUNT_SIZE,
  STAKE_PROGRAM_ADDRESS,
  type ChainPort,
  type RawAccount,
  type SimulationResult,
  type TransactionAction,
} from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { createTestWalletPort, type TestWalletPort } from '@stakeward/core/test/test-wallet-port';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSlotStore, StaticWalletRegistry, type SlotStore } from '@/ports';
import { checkLanded, type LandedItem } from '@/signing/check';
import { transactionIdOf } from '@/signing/link';
import type { SigningState } from '@/signing/machine';
import { slotSignerResolver } from '@/signing/resolve';
import { appendsTail, REREAD_ATTEMPTS } from '@/signing/rules';
import { SigningSession, type SessionOptions } from '@/signing/session';
import type { JobPlan, SigningPlan } from '@/signing/types';

// The signing engine on a durable nonce (DECISIONS.md D67): rounds of one, signing by link (phase `link` and its
// watch), the usedNonces guard, bytes jobs (/cosign) and checkLanded's nonce rule, on the real stake program.

const DAY = 86_400n;
const T = START_UNIX_TIMESTAMP + 30n * DAY;
const FAST = { firstPollMs: 1, maxPollMs: 1 };

type PlanInput = {
  mainKey: Address;
  secondKey: Address;
  feePayer?: Address;
  nonce?: SigningPlan['nonce'];
  remote?: readonly Address[];
};

/** Protect each account with (A, K, T) unless the chain already shows it; the main key pays unless told otherwise. */
function protectPlan(input: PlanInput): SigningPlan {
  return {
    nonce: input.nonce,
    remote: input.remote,
    async prepare(chain, ids) {
      const [{ accounts }, clock] = await Promise.all([chain.getAccounts(ids as Address[]), chain.getClock()]);
      const jobs: Record<string, JobPlan> = {};
      ids.forEach((id, index) => {
        const raw = accounts[index] ?? null;
        const decoded = raw === null ? null : decodeStakeAccount(raw);
        if (decoded === null || !decoded.ok) {
          jobs[id] = { kind: 'refused', reason: 'not-found', before: null };
          return;
        }
        const account = decoded.account;
        if (account.lockup.custodian === input.secondKey && account.lockup.unixTimestamp === T) {
          jobs[id] = { kind: 'done', after: account };
          return;
        }
        jobs[id] = {
          kind: 'build',
          action: { kind: 'protect', stakeAccount: id as Address, mainKey: input.mainKey, secondKey: input.secondKey, lockUntil: T },
          feePayer: input.feePayer ?? input.mainKey,
          before: account,
        };
      });
      return { clock, jobs };
    },
  };
}

/** A plan whose one job is the given bytes (what /cosign plans). */
function bytesPlan(bytes: Uint8Array): SigningPlan {
  return {
    async prepare(chain, ids) {
      const [{ accounts }, clock] = await Promise.all([chain.getAccounts(ids as Address[]), chain.getClock()]);
      const raw = accounts[0] ?? null;
      const decoded = raw === null ? null : decodeStakeAccount(raw);
      const before = decoded?.ok === true ? decoded.account : null;
      return { clock, jobs: Object.fromEntries(ids.map((id) => [id, { kind: 'bytes', bytes, before } as const])) };
    },
  };
}

/**
 * The page's chain over LiteSvmChain, recording every call. It can answer a lagging node's nonce account for the next
 * reads (`lag`), replace an account (`replace`), and pass every simulation (`simulateOk`).
 */
class TestPort implements ChainPort {
  readonly calls: { method: keyof ChainPort; args: readonly unknown[] }[] = [];
  lag: { address: Address; raw: RawAccount | null; reads: number } | null = null;
  readonly replace = new Map<Address, RawAccount | null>();
  simulateOk = false;
  readonly inner: LiteSvmChain;

  constructor(inner: LiteSvmChain) {
    this.inner = inner;
  }

  count(method: keyof ChainPort): number {
    return this.calls.filter((call) => call.method === method).length;
  }

  async getAccounts(addresses: readonly Address[]) {
    this.calls.push({ method: 'getAccounts', args: [addresses] });
    const result = await this.inner.getAccounts(addresses);
    const lag = this.lag !== null && this.lag.reads > 0 && addresses.includes(this.lag.address) ? this.lag : null;
    if (lag !== null) lag.reads -= 1;
    const accounts = result.accounts.map((raw, index) => {
      const address = addresses[index];
      if (address === undefined) return raw;
      if (lag !== null && address === lag.address) return lag.raw;
      return this.replace.has(address) ? (this.replace.get(address) ?? null) : raw;
    });
    return { slot: result.slot, accounts };
  }
  getClock() {
    this.calls.push({ method: 'getClock', args: [] });
    return this.inner.getClock();
  }
  getLatestBlockhash() {
    this.calls.push({ method: 'getLatestBlockhash', args: [] });
    return this.inner.getLatestBlockhash();
  }
  getBlockHeight() {
    this.calls.push({ method: 'getBlockHeight', args: [] });
    return this.inner.getBlockHeight();
  }
  getEpochInfo() {
    this.calls.push({ method: 'getEpochInfo', args: [] });
    return this.inner.getEpochInfo();
  }
  getBalance(address: Address) {
    this.calls.push({ method: 'getBalance', args: [address] });
    return this.inner.getBalance(address);
  }
  getMinimumBalanceForRentExemption(size: number) {
    this.calls.push({ method: 'getMinimumBalanceForRentExemption', args: [size] });
    return this.inner.getMinimumBalanceForRentExemption(size);
  }
  simulate(transaction: Parameters<ChainPort['simulate']>[0]): Promise<SimulationResult> {
    this.calls.push({ method: 'simulate', args: [transaction] });
    if (this.simulateOk) return Promise.resolve({ ok: true, logs: [], unitsConsumed: 0n });
    return this.inner.simulate(transaction);
  }
  send(transaction: Parameters<ChainPort['send']>[0]) {
    this.calls.push({ method: 'send', args: [transaction] });
    return this.inner.send(transaction);
  }
  getSignatureStatuses(signatures: readonly Signature[]) {
    this.calls.push({ method: 'getSignatureStatuses', args: [signatures] });
    return this.inner.getSignatureStatuses(signatures);
  }
  findStakeAccounts(filter: Parameters<ChainPort['findStakeAccounts']>[0]) {
    this.calls.push({ method: 'findStakeAccounts', args: [filter] });
    return this.inner.findStakeAccounts(filter);
  }
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

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('SigningSession on a durable nonce', { timeout: 60_000 }, () => {
  let testChain: TestChain;
  let lite: LiteSvmChain;
  let chain: TestPort;
  let mainKey: KeyPairSigner;
  let secondKey: KeyPairSigner;
  let A: Address;
  let K: Address;
  let main: TestWalletPort;
  let second: TestWalletPort;
  /** The other device: the second key in a wallet this page never sees. */
  let otherDevice: TestWalletPort;
  let S1: Address;
  let S2: Address;
  let S3: Address;
  let nonceA: Address;
  let slots: SlotStore;
  let wallets: StaticWalletRegistry;

  async function createNonce(owner: KeyPairSigner): Promise<Address> {
    const nonceAccount = await deriveNonceAccountAddress(owner.address);
    const lamports = testChain.svm.minimumBalanceForRentExemption(BigInt(NONCE_ACCOUNT_SIZE));
    const action: TransactionAction = { kind: 'nonce-setup', nonceAccount, nonceAuthority: owner.address, seed: NONCE_ACCOUNT_SEED, lamports };
    const result = await testChain.send(buildTransaction(action, { feePayer: owner.address, lifetime: testChain.blockhashLifetime() }).bytes, [owner]);
    if (!result.ok) throw new Error(`nonce setup failed: ${JSON.stringify(result.error)}`);
    return nonceAccount;
  }

  async function closeNonce(owner: KeyPairSigner, nonceAccount: Address): Promise<void> {
    const action: TransactionAction = {
      kind: 'nonce-close',
      nonceAccount,
      nonceAuthority: owner.address,
      recipient: owner.address,
      lamports: testChain.balance(nonceAccount),
    };
    const result = await testChain.send(buildTransaction(action, { feePayer: owner.address, lifetime: testChain.blockhashLifetime() }).bytes, [owner]);
    if (!result.ok) throw new Error(`nonce close failed: ${JSON.stringify(result.error)}`);
  }

  /** Another protect on the same nonce, landed directly: the nonce moves on. */
  async function advanceNonce(nonceAccount: Address, account: Address): Promise<void> {
    const action: TransactionAction = { kind: 'protect', stakeAccount: account, mainKey: A, secondKey: K, lockUntil: T };
    const lifetime = { kind: 'nonce', nonceAccount, nonceAuthority: A, nonceValue: testChain.nonceValue(nonceAccount) } as const;
    const result = await testChain.send(buildTransaction(action, { feePayer: A, lifetime }).bytes, [mainKey, secondKey]);
    if (!result.ok) throw new Error(`advance failed: ${JSON.stringify(result.error)}`);
  }

  /** The other device: adds the second key's signature to the link's bytes and sends them. */
  async function completeElsewhere(bytes: Uint8Array | null | undefined, port: ChainPort = lite): Promise<Signature> {
    if (bytes === null || bytes === undefined) throw new Error('no link bytes');
    const [signed] = await otherDevice.signTransactions(K, [bytes]);
    if (signed === undefined) throw new Error('not signed');
    return port.send(signed);
  }

  beforeEach(async () => {
    testChain = await TestChain.create();
    lite = new LiteSvmChain(testChain);
    chain = new TestPort(lite);
    [mainKey, secondKey] = await Promise.all([testChain.fundedKey(), testChain.fundedKey()]);
    A = mainKey.address;
    K = secondKey.address;
    main = await createTestWalletPort({ name: 'Main Wallet', signers: [mainKey], connected: true });
    second = await createTestWalletPort({ name: 'Second Wallet', signers: [secondKey], connected: true });
    otherDevice = await createTestWalletPort({ name: 'Other Device', signers: [secondKey], connected: true });
    S1 = await testChain.createStakeAccount({ staker: A, withdrawer: A });
    S2 = await testChain.createStakeAccount({ staker: A, withdrawer: A });
    S3 = await testChain.createStakeAccount({ staker: A, withdrawer: A });
    nonceA = await createNonce(mainKey);
    wallets = new StaticWalletRegistry([main, second]);
    slots = createSlotStore(null);
    slots.assign('main', { walletId: main.id, address: A });
    slots.assign('second', { walletId: second.id, address: K });
  });

  function session(options: Partial<SessionOptions> & { planInput?: Partial<PlanInput> } = {}): SigningSession {
    const { planInput, ...rest } = options;
    return new SigningSession({
      chain,
      plan: protectPlan({ mainKey: A, secondKey: K, nonce: { nonceAccount: nonceA, nonceAuthority: A }, ...planInput }),
      ids: [S1],
      resolveSigner: slotSignerResolver({ slots, wallets }),
      appendsTail,
      confirm: { pollIntervalMs: 1 },
      rereadDelayMs: 1,
      link: FAST,
      ...rest,
    });
  }

  /** A link session over S1: the main key signs here, then the link is open. */
  async function openLink(options: Partial<SessionOptions> = {}): Promise<{ s: SigningSession; state: SigningState }> {
    const s = session({ planInput: { remote: [K] }, ...options });
    s.start();
    await until(s, phaseIs('ready', 0));
    s.sign();
    const state = await until(s, (st) => st.phase.kind === 'link');
    return { s, state };
  }

  describe('rounds', () => {
    it('plan.nonce: one stake account per round, each on the value the nonce holds then; both keys sign here', async () => {
      const s = session({ ids: [S1, S2, S3], roundSize: 10 });
      expect(s.getSnapshot().roundSize).toBe(1);
      s.start();
      for (let round = 1; round <= 3; round += 1) {
        const ready = await until(s, (state) => state.roundNumber === round && phaseIs('ready', 0)(state));
        expect(ready.round?.steps.map((step) => [step.address, step.local])).toEqual([
          [A, true],
          [K, true],
        ]);
        s.sign();
        await until(s, phaseIs('ready', 1));
        s.sign();
      }
      const end = await until(s, phaseIs('finished'));
      expect(jobKinds(end)).toEqual({ [S1]: 'done', [S2]: 'done', [S3]: 'done' });
      expect(main.requests.map((request) => request.transactions.length)).toEqual([1, 1, 1]);
      expect(second.requests).toHaveLength(3);
      const values: string[] = [];
      for (const request of main.requests) {
        const inspected = await inspectTransaction(request.transactions[0] ?? new Uint8Array());
        if (!inspected.ok) throw new Error(inspected.error.message);
        expect(inspected.summary.feePayer).toBe(A);
        expect(inspected.summary.lifetime).toMatchObject({ kind: 'nonce', nonceAccount: nonceA, nonceAuthority: A });
        if (inspected.summary.lifetime.kind === 'nonce') values.push(inspected.summary.lifetime.nonceValue);
      }
      expect(new Set(values).size).toBe(3);
      expect(chain.count('getLatestBlockhash')).toBe(0);
      expect(chain.count('getBlockHeight')).toBe(0);
      for (const id of [S1, S2, S3]) expect(testChain.stakeAccount(id)?.lockup).toEqual({ unixTimestamp: T, epoch: 0n, custodian: K });
    });

    it('a link plan without a nonce, or with its nonce authority by link: prepare-failed inspector (a bug)', async () => {
      for (const planInput of [
        { nonce: undefined, remote: [K] },
        { remote: [A] },
      ] satisfies Partial<PlanInput>[]) {
        const s = session({ planInput });
        s.start();
        const failed = await until(s, phaseIs('prepare-failed'));
        expect(failed.phase).toMatchObject({
          problem: { kind: 'inspector', error: { code: 'bad-layout', message: 'link plan misconfigured' } },
        });
        s.dispose();
      }
      expect(main.requests).toHaveLength(0);
    });

    it('a plan that builds with another fee payer than the nonce authority: prepare-failed inspector', async () => {
      const s = session({ planInput: { feePayer: K } });
      s.start();
      const failed = await until(s, phaseIs('prepare-failed'));
      expect(failed.phase).toMatchObject({ problem: { kind: 'inspector' } });
      s.dispose();
    });

    it('a missing or unusable nonce account: prepare-failed nonce, no wallet asked', async () => {
      const missing = session({ planInput: { nonce: { nonceAccount: await deriveNonceAccountAddress(K), nonceAuthority: A } } });
      missing.start();
      expect((await until(missing, phaseIs('prepare-failed'))).phase).toEqual({
        kind: 'prepare-failed',
        problem: { kind: 'nonce', state: 'missing' },
      });
      missing.dispose();

      const nonceK = await createNonce(secondKey); // exists, but its authority is K, not A
      const unusable = session({ planInput: { nonce: { nonceAccount: nonceK, nonceAuthority: A } } });
      unusable.start();
      expect((await until(unusable, phaseIs('prepare-failed'))).phase).toEqual({
        kind: 'prepare-failed',
        problem: { kind: 'nonce', state: 'unusable' },
      });
      unusable.dispose();
      expect(main.requests).toHaveLength(0);
    });

    it('a lagging node that still shows a used nonce value: read again; still the same after the rereads -> stale', async () => {
      const used = testChain.account(nonceA);
      const s = session({ ids: [S1, S2] });
      s.start();
      await until(s, phaseIs('ready', 0));
      s.sign();
      await until(s, phaseIs('ready', 1));
      // From the next round on, the node answers the old nonce account: once more than the rereads allow.
      const lag = { address: nonceA, raw: used, reads: REREAD_ATTEMPTS + 1 };
      chain.lag = lag;
      s.sign();
      const stale = await until(s, phaseIs('prepare-failed'));
      expect(stale.phase).toEqual({ kind: 'prepare-failed', problem: { kind: 'nonce', state: 'stale' } });
      expect(stale.jobs[S1]?.state.kind).toBe('done');
      expect(lag.reads).toBe(0);

      // The node caught up: Try again builds on the new value.
      s.retryPrepare();
      const ready = await until(s, (state) => state.roundNumber === 2 && phaseIs('ready', 0)(state));
      const lifetime = ready.round?.txs[0]?.lifetime;
      expect(lifetime).toMatchObject({ kind: 'nonce', nonceValue: testChain.nonceValue(nonceA) });
      s.dispose();
    });

    it('a lagging node that catches up within the rereads: the round goes on, on the new value', async () => {
      const used = testChain.account(nonceA);
      const s = session({ ids: [S1, S2] });
      s.start();
      await until(s, phaseIs('ready', 0));
      s.sign();
      await until(s, phaseIs('ready', 1));
      const lag = { address: nonceA, raw: used, reads: 2 };
      chain.lag = lag;
      s.sign();
      const ready = await until(s, (state) => state.roundNumber === 2 && phaseIs('ready', 0)(state));
      expect(lag.reads).toBe(0);
      expect(ready.round?.txs[0]?.lifetime).toMatchObject({ nonceValue: testChain.nonceValue(nonceA) });
      s.sign();
      await until(s, phaseIs('ready', 1));
      s.sign();
      expect(jobKinds(await until(s, phaseIs('finished')))).toEqual({ [S1]: 'done', [S2]: 'done' });
    });

    it('a send whose nonce moved on meanwhile: expired, nothing changed', async () => {
      const gate = deferred();
      const s = session();
      s.start();
      await until(s, phaseIs('ready', 0));
      s.sign();
      await until(s, phaseIs('ready', 1));
      second.once({ delay: gate.promise });
      s.sign();
      await until(s, phaseIs('signing', 1));
      await advanceNonce(nonceA, S2);
      gate.resolve();
      const end = await until(s, phaseIs('finished'));
      expect(end.jobs[S1]?.state).toEqual({ kind: 'expired' });
      expect(testChain.stakeAccount(S1)?.lockup.unixTimestamp).toBe(0n);
    });

    it('the fee check counts a nonce setup deposit: a payer short of it gets fee-balance before any wallet', async () => {
      const payer = await generateKeyPairSigner();
      const nonceAccount = await deriveNonceAccountAddress(payer.address);
      const deposit = testChain.svm.minimumBalanceForRentExemption(BigInt(NONCE_ACCOUNT_SIZE));
      // Enough for the fee and the deposit but 1 lamport left over: below the minimum a payer must keep.
      testChain.airdrop(payer.address, deposit + 5_600n + 1n);
      chain.simulateOk = true; // the fee check alone decides (a simulation would also refuse this payer)
      const action: TransactionAction = { kind: 'nonce-setup', nonceAccount, nonceAuthority: payer.address, seed: NONCE_ACCOUNT_SEED, lamports: deposit };
      const plan: SigningPlan = {
        async prepare(port, ids) {
          return { clock: await port.getClock(), jobs: Object.fromEntries(ids.map((id) => [id, { kind: 'build', action, feePayer: payer.address, before: null } as const])) };
        },
      };
      const s = session({ plan, ids: [nonceAccount] });
      s.start();
      const failed = await until(s, phaseIs('prepare-failed'));
      const rent = testChain.svm.minimumBalanceForRentExemption(0n);
      expect(failed.phase).toMatchObject({
        problem: { kind: 'fee-balance', payer: payer.address, balance: deposit + 5_601n, needed: 5_600n + deposit + rent },
      });
    });
  });

  describe('signing by link', () => {
    it('signers by link come last and are never asked here; the link opens after the main key', async () => {
      const { s, state } = await openLink();
      expect(state.phase).toEqual({ kind: 'link', watching: true, lastCheckFailed: false });
      expect(state.round?.steps.map((step) => [step.address, step.local, step.status])).toEqual([
        [A, true, 'signed'],
        [K, false, 'pending'],
      ]);
      const job = state.jobs[S1];
      expect(job?.state).toEqual({ kind: 'ready' });
      expect(job?.bytes).toBe(state.round?.txs[0]?.bytes);
      expect(job?.signature).toBe(transactionIdOf(job?.bytes ?? new Uint8Array()));
      expect(job?.signature).not.toBeNull();
      expect(state.round?.txs[0]?.summary.presentSignatures).toEqual([A]);
      expect(second.requests).toHaveLength(0);
      expect(chain.count('send')).toBe(0);
      s.dispose();
    });

    it('the self-check refuses a link /cosign would refuse: stopped(inspect), the other key never asked', async () => {
      const nonceK = await createNonce(secondKey);
      // The second key pays on its own nonce for a protect: not the expected fee payer.
      const s = session({ planInput: { feePayer: K, nonce: { nonceAccount: nonceK, nonceAuthority: K }, remote: [A] } });
      s.start();
      const ready = await until(s, phaseIs('ready', 0));
      expect(ready.round?.steps.map((step) => [step.address, step.local])).toEqual([
        [K, true],
        [A, false],
      ]);
      s.sign();
      const stopped = await until(s, phaseIs('stopped'));
      expect(stopped.phase).toMatchObject({
        reason: { kind: 'inspect', error: { code: 'bad-layout', message: 'unexpected-fee-payer' } },
      });
      expect(main.requests).toHaveLength(0);
      s.dispose();
    });

    it('done once the other device signs and sends; found from the chain, then the next round', async () => {
      const { s, state } = await openLink({ ids: [S1, S2] });
      const signature = await completeElsewhere(state.jobs[S1]?.bytes);
      expect(signature).toBe(state.jobs[S1]?.signature);
      const next = await until(s, (st) => st.roundNumber === 2 && phaseIs('ready', 0)(st));
      expect(next.jobs[S1]?.state.kind).toBe('done');
      expect(testChain.stakeAccount(S1)?.lockup).toEqual({ unixTimestamp: T, epoch: 0n, custodian: K });
      // The next round is built on the moved nonce.
      expect(next.round?.txs[0]?.lifetime).toMatchObject({ nonceValue: testChain.nonceValue(nonceA) });
      s.dispose();
    });

    it('failed when the other device sends it and it lands with an error', async () => {
      const noPreflight = new LiteSvmChain(testChain, { preflight: false });
      const { s, state } = await openLink();
      // Meanwhile S1 got a lock held by another key: the protect lands but fails.
      const other = await generateKeyPairSigner();
      const lock: TransactionAction = { kind: 'protect', stakeAccount: S1, mainKey: A, secondKey: other.address, lockUntil: T };
      const locked = await testChain.send(buildTransaction(lock, { feePayer: A, lifetime: testChain.blockhashLifetime() }).bytes, [mainKey, other]);
      expect(locked.ok).toBe(true);
      await completeElsewhere(state.jobs[S1]?.bytes, noPreflight);
      const end = await until(s, phaseIs('finished'));
      expect(end.jobs[S1]?.state).toMatchObject({ kind: 'failed', error: { code: 'missing-signature' } });
    });

    it('expired once the link is cancelled (the nonce account closed); a later round finds the nonce missing', async () => {
      const { s } = await openLink({ ids: [S1, S2], link: { firstPollMs: 60_000, maxPollMs: 60_000 } });
      await closeNonce(mainKey, nonceA);
      s.checkLinkNow();
      const failed = await until(s, phaseIs('prepare-failed'), 5_000);
      expect(failed.jobs[S1]?.state).toEqual({ kind: 'expired' });
      expect(failed.phase).toEqual({ kind: 'prepare-failed', problem: { kind: 'nonce', state: 'missing' } });
      expect(testChain.stakeAccount(S1)?.lockup.unixTimestamp).toBe(0n);
      s.dispose();
    });

    it('pauses after watchMs; Check again (resumeLink) watches again and finds the landing', async () => {
      const { s, state } = await openLink({ link: { firstPollMs: 1, maxPollMs: 1, watchMs: 20 } });
      const paused = await until(s, (st) => st.phase.kind === 'link' && !st.phase.watching);
      expect(paused.phase).toEqual({ kind: 'link', watching: false, lastCheckFailed: false });
      const polls = chain.count('getAccounts');
      await sleep(30);
      expect(chain.count('getAccounts')).toBe(polls); // paused: no more checks
      await completeElsewhere(state.jobs[S1]?.bytes);
      s.resumeLink();
      expect(s.getSnapshot().phase).toEqual({ kind: 'link', watching: true, lastCheckFailed: false });
      const end = await until(s, phaseIs('finished'));
      expect(end.jobs[S1]?.state.kind).toBe('done');
    });

    it('a check that cannot reach the network says so and keeps watching', async () => {
      const { s, state } = await openLink();
      lite.failNext('getAccounts', new TypeError('Failed to fetch'), 1);
      await until(s, (st) => st.phase.kind === 'link' && st.phase.lastCheckFailed);
      await until(s, (st) => st.phase.kind === 'link' && !st.phase.lastCheckFailed);
      await completeElsewhere(state.jobs[S1]?.bytes);
      expect((await until(s, phaseIs('finished'))).jobs[S1]?.state.kind).toBe('done');
    });

    it('checkLinkNow checks at once instead of after the pause', async () => {
      const { s, state } = await openLink({ link: { firstPollMs: 60_000, maxPollMs: 60_000 } });
      await completeElsewhere(state.jobs[S1]?.bytes);
      await sleep(20);
      expect(s.getSnapshot().phase.kind).toBe('link'); // the first check is a minute away
      s.checkLinkNow();
      const end = await until(s, phaseIs('finished'), 5_000);
      expect(end.jobs[S1]?.state.kind).toBe('done');
    });

    it('stopWaiting while the link is open: unknown(link-open); checkLanded finds the landing later', async () => {
      const { s, state } = await openLink({ ids: [S1, S2] });
      s.stopWaiting();
      const end = s.getSnapshot();
      expect(end.phase).toEqual({ kind: 'finished' });
      expect(end.jobs[S1]?.state).toEqual({ kind: 'unknown', why: 'link-open' });
      expect(end.jobs[S2]?.state).toEqual({ kind: 'not-sent' });
      const job = end.jobs[S1];
      if (job?.action === null || job === undefined) throw new Error('no job');
      const item: LandedItem = { ...job, action: job.action, confirmed: false, why: 'link-open' };
      expect((await checkLanded(chain, [item], { rereads: 0 }))[S1]).toEqual({ kind: 'unknown', why: 'link-open' });
      await completeElsewhere(state.jobs[S1]?.bytes);
      expect((await checkLanded(chain, [item], { rereads: 0 }))[S1]?.kind).toBe('done');
    });

    it('dispose stops the watch: no chain request afterwards', async () => {
      const { s } = await openLink({ link: { firstPollMs: 1, maxPollMs: 1 } });
      await vi.waitFor(() => {
        expect(chain.count('getSignatureStatuses')).toBeGreaterThan(1);
      });
      s.dispose();
      const calls = chain.calls.length;
      await sleep(50);
      expect(chain.calls.length).toBe(calls);
    });
  });

  describe('bytes rounds (/cosign)', () => {
    /** S1's protect on A's nonce, signed by `signers`. */
    async function signedBytes(action: TransactionAction, feePayer: Address, lifetime: Parameters<typeof buildTransaction>[1]['lifetime'], signers: readonly TestWalletPort[]) {
      let bytes = buildTransaction(action, { feePayer, lifetime }).bytes;
      for (const wallet of signers) {
        const [signed] = await wallet.signTransactions(wallet.accounts[0] ?? A, [bytes]);
        if (signed === undefined) throw new Error('not signed');
        bytes = signed;
      }
      return bytes;
    }

    it('signs the bytes as they are: inspected, simulated, never rebuilt; the remaining key signs here and sends', async () => {
      const action: TransactionAction = { kind: 'protect', stakeAccount: S1, mainKey: A, secondKey: K, lockUntil: T };
      const nonce = { kind: 'nonce', nonceAccount: nonceA, nonceAuthority: A, nonceValue: testChain.nonceValue(nonceA) } as const;
      const bytes = await signedBytes(action, A, nonce, [main]);
      slots.clear('main'); // this device has only the second key
      const s = session({ plan: bytesPlan(bytes) });
      s.start();
      const ready = await until(s, phaseIs('ready', 0));
      expect(ready.round?.steps.map((step) => step.address)).toEqual([K]);
      expect(ready.round?.txs[0]?.bytes).toEqual(bytes);
      expect(ready.round?.txs[0]?.lifetime).toEqual(nonce);
      s.sign();
      const end = await until(s, phaseIs('finished'));
      expect(end.jobs[S1]?.state.kind).toBe('done');
      expect(chain.count('getLatestBlockhash')).toBe(0);
      expect(chain.count('simulate')).toBe(1);
      expect(second.requests).toHaveLength(1);
      expect(testChain.stakeAccount(S1)?.lockup.custodian).toBe(K);
    });

    it('a wallet that changes bytes another wallet signed: stopped(check) without "start with" (the first signature came with the link)', async () => {
      const newWallet = await testChain.fundedKey();
      const D = newWallet.address;
      const nonceD = await createNonce(newWallet);
      const locked = await testChain.createStakeAccount({
        staker: A,
        withdrawer: A,
        lockup: { unixTimestamp: T, epoch: 0n, custodian: K },
      });
      const fresh = await createTestWalletPort({ name: 'New Wallet', signers: [newWallet], connected: true });
      const action: TransactionAction = { kind: 'rescue', stakeAccount: locked, mainKey: A, secondKey: K, newWallet: D };
      const nonce = { kind: 'nonce', nonceAccount: nonceD, nonceAuthority: D, nonceValue: testChain.nonceValue(nonceD) } as const;
      const bytes = await signedBytes(action, D, nonce, [fresh]);
      const s = session({ plan: bytesPlan(bytes), ids: [locked] });
      s.start();
      const ready = await until(s, phaseIs('ready', 0));
      const order = ready.round?.steps.map((step) => step.address) ?? [];
      expect([...order].sort()).toEqual([A, K].sort());
      s.sign();
      await until(s, phaseIs('ready', 1));
      const laterWallet = order[1] === A ? main : second;
      laterWallet.once({ lighthouseTail: true });
      s.sign();
      const stopped = await until(s, phaseIs('stopped', 1));
      expect(stopped.phase).toMatchObject({ reason: { kind: 'check', code: 'tail-not-first-signer', startWith: null } });
      s.dispose();
    });

    it('a bytes job on a blockhash: prepare-failed inspector, no wallet asked', async () => {
      const action: TransactionAction = { kind: 'protect', stakeAccount: S1, mainKey: A, secondKey: K, lockUntil: T };
      const bytes = await signedBytes(action, A, { kind: 'blockhash', ...(await lite.getLatestBlockhash()) }, [main]);
      const s = session({ plan: bytesPlan(bytes) });
      s.start();
      const failed = await until(s, phaseIs('prepare-failed'));
      expect(failed.phase).toMatchObject({ problem: { kind: 'inspector' } });
      expect(second.requests).toHaveLength(0);
      s.dispose();
    });
  });

  describe('checkLanded on a durable nonce', () => {
    /** S1's protect on A's nonce, signed by both keys and not sent. */
    async function nonceItem(): Promise<LandedItem> {
      const action: TransactionAction = { kind: 'protect', stakeAccount: S1, mainKey: A, secondKey: K, lockUntil: T };
      const lifetime = { kind: 'nonce', nonceAccount: nonceA, nonceAuthority: A, nonceValue: testChain.nonceValue(nonceA) } as const;
      let bytes = buildTransaction(action, { feePayer: A, lifetime }).bytes;
      [bytes = bytes] = await main.signTransactions(A, [bytes]);
      [bytes = bytes] = await second.signTransactions(K, [bytes]);
      return { id: S1, action, signature: transactionIdOf(bytes), lifetime, bytes, before: testChain.stakeAccount(S1), confirmed: false };
    }

    it('applied: done, even after the node forgot the status', async () => {
      const item = await nonceItem();
      await lite.send(item.bytes ?? new Uint8Array());
      lite.forgetSignatureStatuses();
      expect(await lite.getSignatureStatuses([item.signature as Signature])).toEqual([null]);
      expect((await checkLanded(chain, [item]))[S1]?.kind).toBe('done');
    });

    it('landed with an error: failed', async () => {
      const item = await nonceItem();
      const other = await generateKeyPairSigner();
      const lock: TransactionAction = { kind: 'protect', stakeAccount: S1, mainKey: A, secondKey: other.address, lockUntil: T };
      await testChain.send(buildTransaction(lock, { feePayer: A, lifetime: testChain.blockhashLifetime() }).bytes, [mainKey, other]);
      await new LiteSvmChain(testChain, { preflight: false }).send(item.bytes ?? new Uint8Array());
      expect((await checkLanded(chain, [item]))[S1]).toMatchObject({ kind: 'failed' });
    });

    it('the nonce moved on, was closed or is unusable, with no status: expired', async () => {
      const moved = await nonceItem();
      await advanceNonce(nonceA, S2);
      expect((await checkLanded(chain, [moved]))[S1]).toEqual({ kind: 'expired' });

      await closeNonce(mainKey, nonceA);
      expect((await checkLanded(chain, [moved]))[S1]).toEqual({ kind: 'expired' });

      nonceA = await createNonce(mainKey);
      const unusable = await nonceItem();
      const raw = testChain.account(nonceA);
      if (raw === null) throw new Error('no nonce');
      chain.replace.set(nonceA, { ...raw, owner: STAKE_PROGRAM_ADDRESS });
      expect((await checkLanded(chain, [unusable]))[S1]).toEqual({ kind: 'expired' });
    });

    it('an unchanged nonce and no status: still unknown, with its earlier reason', async () => {
      const item = await nonceItem();
      expect((await checkLanded(chain, [item]))[S1]).toEqual({ kind: 'unknown', why: 'timeout' });
      expect((await checkLanded(chain, [{ ...item, why: 'link-open' }]))[S1]).toEqual({ kind: 'unknown', why: 'link-open' });
    });

    it('reads the target and the nonce account in one call, and never the block height for nonce items', async () => {
      const item = await nonceItem();
      await checkLanded(chain, [item]);
      const reads = chain.calls.filter((call) => call.method === 'getAccounts');
      expect(reads.map((call) => call.args[0])).toEqual([[S1, nonceA]]);
      expect(chain.count('getBlockHeight')).toBe(0);
    });
  });
});
