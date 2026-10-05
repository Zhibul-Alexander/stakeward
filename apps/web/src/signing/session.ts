import { getSignatureFromTransaction, getTransactionDecoder, type Address, type Signature } from '@solana/kit';
import {
  actionRoles,
  actionsEqual,
  buildTransaction,
  canPayFee,
  checkSigningStep,
  inspectTransaction,
  signingOrder,
  translateError,
  verifyAllSignatures,
  type BlockhashLifetime,
  type ChainPort,
  type FriendlyError,
  type LatestBlockhash,
  type StakeAccount,
  type TransactionAction,
  type TransactionSummary,
  type TranslateContext,
  type WalletPort,
  type WalletRole,
} from '@stakeward/core';
import { waitForConfirmations, type ConfirmationOptions, type ConfirmationOutcome } from '@/ports/confirm';
import { checkLanded, type LandedItem } from './check.ts';
import {
  initialSigningState,
  roundSigned,
  signingReducer,
  type JobState,
  type JobView,
  type PrepareProblem,
  type RoundTx,
  type SignStep,
  type SigningEvent,
  type SigningState,
  type StopReason,
  type WalletStopCode,
} from './machine.ts';
import { MAX_ROUND_SIZE, MIN_BLOCKS_LEFT_TO_SIGN, REREAD_ATTEMPTS, REREAD_DELAY_MS } from './rules.ts';
import type { SignerResolver, SigningPlan } from './types.ts';

export type SessionOptions = {
  chain: ChainPort;
  plan: SigningPlan;
  ids: readonly string[];
  resolveSigner: SignerResolver;
  appendsTail: (wallet: WalletPort) => boolean;
  /** Default: every job in one round, at most MAX_ROUND_SIZE. */
  roundSize?: number | undefined;
  confirm?: { pollIntervalMs?: number | undefined; timeoutMs?: number | undefined } | undefined;
  /** Default REREAD_DELAY_MS. */
  rereadDelayMs?: number | undefined;
  /** Called on EVERY entry into `finished`, never after dispose. */
  onFinished?: ((state: SigningState) => void) | undefined;
};

/** One async job of the session: stale once another starts, Stop waiting is pressed or the session is disposed. */
type Work = { op: number; signal: AbortSignal };

type Built = { id: string; bytes: Uint8Array; summary: TransactionSummary; lifetime: BlockhashLifetime; before: StakeAccount | null };

const PORT_STOPS: readonly string[] = ['WalletBusyError', 'WalletUnsupportedError', 'WalletBatchUnsupportedError'];

/** A prepare step that cannot go on; caught once at the top of `prepare`. */
class PrepareFailure extends Error {
  readonly problem: PrepareProblem;

  constructor(problem: PrepareProblem) {
    super(problem.kind);
    this.problem = problem;
  }
}

/**
 * The signing engine's driver (DECISIONS.md D47): runs the I/O of each phase of `signingReducer` and feeds the
 * results back as events. No React: the page reads it as an external store (`subscribe`, `getSnapshot`) through
 * `useSigningSession`.
 *
 * - Signing steps come only from the inspector's reading of the current bytes (required signers minus present
 *   signatures), in core `signingOrder`. Each signer approves every transaction of the round in ONE wallet request.
 * - Every returned transaction passes `checkSigningStep` and the inspector; before sending, `verifyAllSignatures`.
 *   Any failure stops the whole round; nothing is sent.
 * - Sending starts by itself after the last signature. Nothing is rebuilt while a sent transaction might still land.
 * - Each async step runs under a token (`op`) and an AbortController: a late answer after Stop waiting, a newer step or
 *   `dispose` changes nothing.
 */
export class SigningSession {
  private state: SigningState;
  private readonly options: SessionOptions;
  private readonly listeners = new Set<() => void>();
  private op = 0;
  private controller: AbortController | null = null;
  private disposed = false;
  /** The wallet asked in the current signing step (for "You stopped waiting for <wallet>"). */
  private askedWallet = '';

  constructor(options: SessionOptions) {
    this.options = options;
    this.state = initialSigningState(options.ids, options.roundSize ?? Math.min(options.ids.length, MAX_ROUND_SIZE));
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Immutable; replaced on every change. */
  readonly getSnapshot = (): SigningState => this.state;

  start(): void {
    this.dispatch({ type: 'start' });
  }

  /** Asks the wallet of the current step: in ready(k), or "Try again" in stopped(wallet) at k (same bytes). */
  sign(): void {
    const { phase } = this.state;
    if (phase.kind === 'ready' || (phase.kind === 'stopped' && phase.reason.kind === 'wallet')) {
      void this.signStep(phase.step);
    }
  }

  /** needs-wallet(k) -> ready(k) once a wallet in this browser holds the key; otherwise nothing changes. */
  continueWithWallet(): void {
    const { phase, round } = this.state;
    if (phase.kind !== 'needs-wallet' || round === null) return;
    const step = round.steps[phase.step];
    if (step === undefined || this.options.resolveSigner(step.address, step.role).kind !== 'ready') return;
    this.dispatch({ type: 'wallet-ready', step: phase.step, steps: round.steps.map((other) => this.resolveStep(other)) });
  }

  /** switch-account(k): the user says the wallet offers the account now. */
  continueAfterSwitch(): void {
    const { phase } = this.state;
    if (phase.kind === 'switch-account') void this.afterSwitch(phase.step);
  }

  /** Signing: stop waiting for the wallet (nothing was sent). Sending, confirming, checking: stop and finish. */
  stopWaiting(): void {
    const { phase } = this.state;
    if (phase.kind === 'signing') {
      this.cancel();
      const reason: StopReason = {
        kind: 'wallet',
        walletName: this.askedWallet,
        error: translateError(abortError('Stopped waiting for the wallet')),
        portError: 'cancelled',
      };
      this.dispatch({ type: 'stopped', step: phase.step, reason });
      return;
    }
    if (phase.kind === 'sending' || phase.kind === 'confirming' || phase.kind === 'checking') {
      this.cancel();
      this.dispatch({ type: 'stop-waiting' });
    }
  }

  /** "Start again" (or "Start again with <wallet> signing first"): the round is read, built and simulated again. */
  restartRound(first?: Address): void {
    this.dispatch({ type: 'restart-round', first: first ?? null });
  }

  /** "Sign one stake account at a time". */
  oneAtATime(): void {
    this.dispatch({ type: 'one-at-a-time' });
  }

  retryPrepare(): void {
    this.dispatch({ type: 'retry-prepare' });
  }

  /** Aborts everything; no listener and no onFinished is called afterwards. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.listeners.clear();
  }

  // ---- Internals ----

  private dispatch(event: SigningEvent): void {
    if (this.disposed) return;
    const previous = this.state;
    const next = signingReducer(previous, event);
    if (next === previous) return;
    this.state = next;
    for (const listener of [...this.listeners]) listener();
    if (next.phase === previous.phase) return;
    switch (next.phase.kind) {
      case 'preparing':
        void this.prepare(this.begin());
        return;
      case 'sending':
        void this.send(this.begin());
        return;
      case 'confirming':
        void this.confirm(this.begin());
        return;
      case 'checking':
        void this.check(this.begin());
        return;
      case 'ready':
        this.needsWallet(next.phase.step);
        return;
      case 'finished':
        this.options.onFinished?.(next);
        return;
      default:
        return;
    }
  }

  private begin(): Work {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.op += 1;
    return { op: this.op, signal: controller.signal };
  }

  private cancel(): void {
    this.op += 1;
    this.controller?.abort();
    this.controller = null;
  }

  private stale(work: Work): boolean {
    return this.disposed || work.op !== this.op;
  }

  /** A turn whose key no wallet in this browser holds shows the key slot at once, not after a click. */
  private needsWallet(index: number): void {
    const step = this.state.round?.steps[index];
    if (step !== undefined && this.options.resolveSigner(step.address, step.role).kind === 'missing') {
      this.dispatch({ type: 'needs-wallet', step: index });
    }
  }

  private resolveStep(step: SignStep): SignStep {
    const resolution = this.options.resolveSigner(step.address, step.role);
    return { ...step, role: resolution.role, walletName: resolution.kind === 'ready' ? resolution.wallet.name : null };
  }

  private stop(work: Work, step: number, reason: StopReason): void {
    if (!this.stale(work)) this.dispatch({ type: 'stopped', step, reason });
  }

  /** Fresh reads, build, inspect, simulate and fee check for the jobs in `preparing`; then the signing steps. */
  private async prepare(work: Work): Promise<void> {
    const { chain, plan } = this.options;
    const round = this.state.round;
    if (round === null) return;
    const ids = round.ids.filter((id) => this.state.jobs[id]?.state.kind === 'preparing');
    try {
      const decided = await plan.prepare(chain, ids);
      if (this.stale(work)) return;
      const jobs: Record<string, JobView> = {};
      const built: Built[] = [];
      let latest: LatestBlockhash | null = null;
      for (const id of ids) {
        const decision = decided.jobs[id] ?? { kind: 'refused', reason: 'not-decided', before: null };
        if (decision.kind === 'done') {
          jobs[id] = jobView(id, { kind: 'already-done', after: decision.after }, { before: null });
        } else if (decision.kind === 'refused') {
          jobs[id] = jobView(id, { kind: 'refused', reason: decision.reason }, { before: decision.before });
        } else {
          latest ??= await chain.getLatestBlockhash();
          if (this.stale(work)) return;
          const lifetime: BlockhashLifetime = { kind: 'blockhash', ...latest };
          const bytes = buildOwn(decision.action, decision.feePayer, lifetime);
          const summary = await inspectOwn(bytes, decision.action, decision.feePayer);
          if (this.stale(work)) return;
          built.push({ id, bytes, summary, lifetime, before: decision.before });
        }
      }

      // One simulation at a time; a refused one leaves the round, the others go on.
      const remaining: Built[] = [];
      for (const item of built) {
        const simulation = await chain.simulate(item.bytes);
        if (this.stale(work)) return;
        if (simulation.ok) {
          remaining.push(item);
          continue;
        }
        const context: TranslateContext = { transaction: item.bytes };
        if (item.before !== null) context.lockUntil = item.before.lockup.unixTimestamp;
        jobs[item.id] = jobView(item.id, { kind: 'sim-failed', error: translateError(simulation.error, context) }, item);
      }

      const hints = roleHints(remaining.map((item) => item.summary.action));
      await this.checkFees(work, remaining, hints);
      if (this.stale(work)) return;

      for (const item of remaining) jobs[item.id] = jobView(item.id, { kind: 'ready' }, item);
      const txs: RoundTx[] = remaining.map(({ id, bytes, summary, lifetime }) => ({ id, bytes, summary, lifetime }));
      this.dispatch({ type: 'prepared', clock: decided.clock, jobs, txs, steps: this.steps(remaining, hints) });
    } catch (error) {
      if (this.stale(work)) return;
      const problem: PrepareProblem =
        error instanceof PrepareFailure ? error.problem : { kind: 'read', error: translateError(error) };
      this.dispatch({ type: 'prepare-failed', problem });
    }
  }

  /** Per distinct fee payer: the round's fees must leave it at 0 or at least rent-exempt (core canPayFee). */
  private async checkFees(work: Work, remaining: readonly Built[], hints: ReadonlyMap<Address, WalletRole>): Promise<void> {
    if (remaining.length === 0) return;
    const { chain } = this.options;
    const rent = await chain.getMinimumBalanceForRentExemption(0);
    const payers = unique(remaining.map((item) => item.summary.feePayer));
    for (const payer of payers) {
      const balance = await chain.getBalance(payer);
      if (this.stale(work)) return;
      const fees = remaining
        .filter((item) => item.summary.feePayer === payer)
        .reduce((sum, item) => sum + item.summary.networkFeeLamports, 0n);
      if (!canPayFee(balance, fees, rent)) {
        const { role } = this.options.resolveSigner(payer, hints.get(payer) ?? null);
        throw new PrepareFailure({ kind: 'fee-balance', payer, role, balance, needed: fees + rent });
      }
    }
  }

  /** The round's wallet requests in core `signingOrder`, each with the transactions that still lack that signer. */
  private steps(remaining: readonly Built[], hints: ReadonlyMap<Address, WalletRole>): SignStep[] {
    const [head] = remaining;
    if (head === undefined) return [];
    const required = unique(remaining.flatMap((item) => item.summary.requiredSigners));
    const present = required.filter((signer) => remaining.every((item) => item.summary.presentSignatures.includes(signer)));
    const order = signingOrder({
      required,
      present,
      feePayer: head.summary.feePayer,
      appendsTail: (signer) => {
        const resolution = this.options.resolveSigner(signer, hints.get(signer) ?? null);
        return resolution.kind === 'ready' && this.options.appendsTail(resolution.wallet);
      },
      first: this.state.first,
    });
    return order.map((address) =>
      this.resolveStep({
        address,
        role: hints.get(address) ?? 'main',
        walletName: null,
        count: remaining.filter((item) => lacks(item.summary, address)).length,
        status: 'pending',
      }),
    );
  }

  private async afterSwitch(index: number): Promise<void> {
    const step = this.state.round?.steps[index];
    if (step === undefined) return;
    const resolution = this.options.resolveSigner(step.address, step.role);
    if (resolution.kind === 'missing') {
      this.dispatch({ type: 'needs-wallet', step: index });
      return;
    }
    const { wallet } = resolution;
    if (!wallet.accounts.includes(step.address)) {
      // A wallet that dropped this site's access to the account asks again (the user's own click).
      const work = this.begin();
      try {
        await wallet.connect({ signal: work.signal });
      } catch {
        // Declined or failed: the check below keeps the user on this step.
      }
      if (this.stale(work)) return;
      if (!wallet.accounts.includes(step.address)) {
        this.dispatch({ type: 'switch-account', step: index, again: true });
        return;
      }
    }
    await this.signStep(index);
  }

  /** One wallet request for every transaction of the round that lacks this step's signature. */
  private async signStep(index: number): Promise<void> {
    const round = this.state.round;
    const step = round?.steps[index];
    if (round === null || step === undefined) return;
    const work = this.begin();
    const resolution = this.options.resolveSigner(step.address, step.role);
    if (resolution.kind === 'missing') {
      this.dispatch({ type: 'needs-wallet', step: index });
      return;
    }
    const { wallet } = resolution;
    if (!wallet.accounts.includes(step.address)) {
      this.dispatch({ type: 'switch-account', step: index, again: false });
      return;
    }

    // Enough time left? A read error is ignored: the wallet is asked and the send reports an expiry.
    const height = await blockHeight(this.options.chain);
    if (this.stale(work)) return;
    const lastValid = lastValidOf(round.txs);
    if (height !== null && lastValid !== null) {
      if (!roundSigned(round) && lastValid - height < MIN_BLOCKS_LEFT_TO_SIGN) {
        this.dispatch({ type: 'refresh' });
        return;
      }
      if (roundSigned(round) && height > lastValid) {
        this.dispatch({ type: 'expired' });
        return;
      }
    }

    const needing = round.txs.filter((tx) => lacks(tx.summary, step.address));
    this.askedWallet = wallet.name;
    this.dispatch({ type: 'asking', step: index });
    const { phase } = this.state;
    if (phase.kind !== 'signing' || phase.step !== index) return;

    let returned: readonly Uint8Array[];
    try {
      returned = await wallet.signTransactions(
        step.address,
        needing.map((tx) => tx.bytes),
        { signal: work.signal },
      );
    } catch (error) {
      if (this.stale(work)) return;
      const name = errorName(error);
      if (name === 'WalletAccountUnavailableError') {
        this.dispatch({ type: 'switch-account', step: index, again: false });
        return;
      }
      const portError: WalletStopCode | null = work.signal.aborted
        ? 'cancelled'
        : name !== null && PORT_STOPS.includes(name)
          ? (name as WalletStopCode)
          : null;
      this.stop(work, index, { kind: 'wallet', walletName: wallet.name, error: translateError(error), portError });
      return;
    }
    if (this.stale(work)) return;
    if (returned.length !== needing.length) {
      const error = new Error(
        `${wallet.name} returned ${String(returned.length)} signed transactions for ${String(needing.length)}`,
      );
      error.name = 'WalletBatchUnsupportedError';
      this.stop(work, index, {
        kind: 'wallet',
        walletName: wallet.name,
        error: translateError(error),
        portError: 'WalletBatchUnsupportedError',
      });
      return;
    }

    // Every returned transaction is checked before anything is kept: the first failure stops the whole round.
    const copies = returned.map((bytes) => Uint8Array.from(bytes));
    for (const [position, tx] of needing.entries()) {
      const result = await checkSigningStep(tx.bytes, copies[position] ?? new Uint8Array());
      if (this.stale(work)) return;
      if (!result.ok) {
        const { code, message } = result.error;
        const tried = this.state.triedFirst.includes(step.address);
        const firstMayHelp = code === 'message-changed' || code === 'tail-not-first-signer';
        this.stop(work, index, {
          kind: 'check',
          walletName: wallet.name,
          code,
          detail: message,
          startWith: index > 0 && firstMayHelp && !tried ? step.address : null,
          bothWays: code === 'tail-not-first-signer' && tried,
        });
        return;
      }
    }
    const signed = new Map<string, RoundTx>();
    for (const [position, tx] of needing.entries()) {
      const bytes = copies[position] ?? new Uint8Array();
      const inspected = await inspectTransaction(bytes);
      if (this.stale(work)) return;
      if (!inspected.ok) {
        this.stop(work, index, { kind: 'inspect', walletName: wallet.name, error: inspected.error });
        return;
      }
      signed.set(tx.id, { ...tx, bytes, summary: inspected.summary });
    }
    const txs = round.txs.map((tx) => signed.get(tx.id) ?? tx);
    if (index >= round.steps.length - 1) {
      for (const tx of txs) {
        const verified = await verifyAllSignatures(tx.bytes);
        if (this.stale(work)) return;
        if (!verified.ok) {
          this.stop(work, index, { kind: 'verify', code: verified.error.code, detail: verified.error.message });
          return;
        }
      }
    }
    this.dispatch({ type: 'signed', step: index, txs });
  }

  /** Sends every ready transaction of the round, in order; each send's outcome is its own (accounts are independent). */
  private async send(work: Work): Promise<void> {
    const { chain } = this.options;
    const round = this.state.round;
    if (round === null) return;
    const height = await blockHeight(chain);
    if (this.stale(work)) return;
    const lastValid = lastValidOf(round.txs);
    if (height !== null && lastValid !== null && height > lastValid) {
      this.dispatch({ type: 'expired' });
      return;
    }
    for (const tx of round.txs) {
      if (this.state.jobs[tx.id]?.state.kind !== 'ready') continue;
      this.dispatch({ type: 'job', id: tx.id, state: { kind: 'sending' }, signature: signatureOf(tx.bytes), bytes: tx.bytes });
      try {
        await chain.send(tx.bytes);
        if (this.stale(work)) return;
        this.dispatch({ type: 'job', id: tx.id, state: { kind: 'confirming', indefinite: false } });
      } catch (error) {
        if (this.stale(work)) return;
        this.dispatch({ type: 'job', id: tx.id, state: sendFailure(translateError(error, { transaction: tx.bytes })) });
      }
    }
    this.dispatch({ type: 'send-done' });
  }

  /** One status poll for the whole round (ports/confirm.ts), until each transaction is confirmed, failed or expired. */
  private async confirm(work: Work): Promise<void> {
    const round = this.state.round;
    if (round === null) return;
    const waiting = round.ids.flatMap((id) => {
      const job = this.state.jobs[id];
      return job?.state.kind === 'confirming' ? [job] : [];
    });
    const entries = waiting.flatMap((job) =>
      job.signature === null || job.lifetime === null ? [] : [{ signature: job.signature, lifetime: job.lifetime }],
    );
    let outcomes: ReadonlyMap<Signature, ConfirmationOutcome> = new Map();
    try {
      outcomes = await waitForConfirmations(this.options.chain, entries, this.confirmOptions(work.signal));
    } catch {
      // Aborted (stale below), or an unexpected failure: every transaction stays uncertain (timeout).
    }
    if (this.stale(work)) return;
    for (const job of waiting) {
      const outcome = job.signature === null ? undefined : outcomes.get(job.signature);
      this.dispatch({ type: 'job', id: job.id, state: confirmationState(outcome, job.bytes) });
    }
    this.dispatch({ type: 'confirm-done' });
  }

  /** The chain must show each confirmed change (CLAUDE.md section 12); a lagging node is read again. */
  private async check(work: Work): Promise<void> {
    const round = this.state.round;
    if (round === null) return;
    const checking = round.ids.flatMap((id) => {
      const job = this.state.jobs[id];
      return job?.state.kind === 'checking' ? [job] : [];
    });
    const items: LandedItem[] = checking.flatMap((job) =>
      job.action === null
        ? []
        : [
            {
              id: job.id,
              action: job.action,
              signature: job.signature,
              lifetime: job.lifetime,
              bytes: job.bytes,
              before: job.before,
              confirmed: true,
            },
          ],
    );
    // A read failure leaves every one of them unverified (Check again on the Done screen).
    const results: Record<string, JobState> = await checkLanded(this.options.chain, items, {
      signal: work.signal,
      rereads: REREAD_ATTEMPTS,
      rereadDelayMs: this.options.rereadDelayMs ?? REREAD_DELAY_MS,
    }).catch(() => ({}));
    if (this.stale(work)) return;
    for (const job of checking) {
      this.dispatch({ type: 'job', id: job.id, state: results[job.id] ?? { kind: 'unknown', why: 'unverified' } });
    }
    this.dispatch({ type: 'check-done' });
  }

  private confirmOptions(signal: AbortSignal): ConfirmationOptions {
    const options: ConfirmationOptions = { signal };
    const { confirm } = this.options;
    if (confirm?.pollIntervalMs !== undefined) options.pollIntervalMs = confirm.pollIntervalMs;
    if (confirm?.timeoutMs !== undefined) options.timeoutMs = confirm.timeoutMs;
    return options;
  }
}

/** Builds the plan's action; the builder refusing the plan's own input is a bug, shown like an inspector refusal. */
function buildOwn(action: TransactionAction, feePayer: Address, lifetime: BlockhashLifetime): Uint8Array {
  try {
    return buildTransaction(action, { feePayer, lifetime }).bytes;
  } catch (error) {
    const message = `Stakeward could not build its own transaction: ${translateError(error).detail}`;
    throw new PrepareFailure({ kind: 'inspector', error: { code: 'bad-layout', message } });
  }
}

/** The bytes of our own build must read back as exactly that action and fee payer; anything else is a bug. */
async function inspectOwn(bytes: Uint8Array, action: TransactionAction, feePayer: Address): Promise<TransactionSummary> {
  const inspected = await inspectTransaction(bytes);
  if (!inspected.ok) throw new PrepareFailure({ kind: 'inspector', error: inspected.error });
  if (!actionsEqual(inspected.summary.action, action) || inspected.summary.feePayer !== feePayer) {
    throw new PrepareFailure({
      kind: 'inspector',
      error: { code: 'bad-layout', message: 'The inspector read another action or fee payer than Stakeward built' },
    });
  }
  return inspected.summary;
}

function jobView(
  id: string,
  state: JobState,
  from: { before: StakeAccount | null; summary?: TransactionSummary; lifetime?: BlockhashLifetime; bytes?: Uint8Array },
): JobView {
  return {
    id,
    state,
    before: from.before,
    action: from.summary?.action ?? null,
    lifetime: from.lifetime ?? null,
    signature: null,
    bytes: from.bytes ?? null,
  };
}

/** Roles the actions name (main, second, new), as hints for keys no slot holds. */
function roleHints(actions: readonly TransactionAction[]): Map<Address, WalletRole> {
  const hints = new Map<Address, WalletRole>();
  for (const action of actions) {
    for (const [role, address] of Object.entries(actionRoles(action)) as [WalletRole, Address | undefined][]) {
      if (address !== undefined && !hints.has(address)) hints.set(address, role);
    }
  }
  return hints;
}

function lacks(summary: TransactionSummary, signer: Address): boolean {
  return summary.requiredSigners.includes(signer) && !summary.presentSignatures.includes(signer);
}

function lastValidOf(txs: readonly RoundTx[]): bigint | null {
  let lowest: bigint | null = null;
  for (const tx of txs) {
    const value = tx.lifetime.lastValidBlockHeight;
    if (lowest === null || value < lowest) lowest = value;
  }
  return lowest;
}

function unique<T>(values: readonly T[]): T[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

/** The current block height, or null when it cannot be read. */
async function blockHeight(chain: ChainPort): Promise<bigint | null> {
  try {
    return await chain.getBlockHeight();
  } catch {
    return null;
  }
}

/** The fee payer's signature (the transaction id), present once every wallet signed. */
function signatureOf(bytes: Uint8Array): Signature | null {
  try {
    return getSignatureFromTransaction(getTransactionDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/**
 * A send that failed: definite errors fail; a lost answer may still have reached the network, so it is polled until
 * its blockhash expires. A 429 is definite: the worker's rate limit runs before the proxy forwards anything.
 */
function sendFailure(error: FriendlyError): JobState {
  switch (error.code) {
    case 'blockhash-expired':
      return { kind: 'expired' };
    case 'network':
    case 'unknown':
    case 'already-processed':
      return { kind: 'confirming', indefinite: true };
    default:
      return { kind: 'failed', error };
  }
}

function confirmationState(outcome: ConfirmationOutcome | undefined, bytes: Uint8Array | null): JobState {
  switch (outcome?.status) {
    case 'confirmed':
      return { kind: 'checking' };
    case 'failed':
      return { kind: 'failed', error: translateError(outcome.error, bytes === null ? {} : { transaction: bytes }) };
    case 'expired':
      return { kind: 'expired' };
    case 'timeout':
    case undefined:
      return { kind: 'unknown', why: 'timeout' };
  }
}

function errorName(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string' ? error.name : null;
}

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}
