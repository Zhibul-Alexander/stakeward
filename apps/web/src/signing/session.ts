import type { Address, Nonce, Signature } from '@solana/kit';
import {
  actionRoles,
  actionsEqual,
  buildTransaction,
  canPayFee,
  checkSigningStep,
  cosignLinkProblem,
  inspectTransaction,
  payerOutflow,
  readNonceAccount,
  signingOrder,
  translateError,
  verifyAllSignatures,
  type ChainPort,
  type FriendlyError,
  type LatestBlockhash,
  type Lifetime,
  type NonceLifetime,
  type StakeAccount,
  type TransactionAction,
  type TransactionSummary,
  type TranslateContext,
  type WalletPort,
  type WalletRole,
} from '@stakeward/core';
import { waitForConfirmations, type ConfirmationOptions, type ConfirmationOutcome } from '@/ports/confirm';
import { connectOffering } from '@/ports/connect-offering';
import { checkLanded, type LandedItem } from './check.ts';
import { transactionIdOf } from './link.ts';
import {
  initialSigningState,
  roundSigned,
  signingReducer,
  type JobState,
  type JobView,
  type PrepareProblem,
  type Round,
  type RoundTx,
  type SignStep,
  type SigningEvent,
  type SigningState,
  type StopReason,
  type WalletStopCode,
} from './machine.ts';
import {
  LINK_FIRST_POLL_MS,
  LINK_MAX_POLL_MS,
  LINK_POLL_FACTOR,
  LINK_WATCH_MS,
  MAX_ROUND_SIZE,
  MIN_BLOCKS_LEFT_TO_SIGN,
  REREAD_ATTEMPTS,
  REREAD_DELAY_MS,
} from './rules.ts';
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
  /**
   * The watch of an open link (phase `link`): the first check after `firstPollMs` (default LINK_FIRST_POLL_MS), each
   * pause LINK_POLL_FACTOR longer up to `maxPollMs` (LINK_MAX_POLL_MS), paused after `watchMs` (LINK_WATCH_MS).
   */
  link?: { firstPollMs?: number | undefined; maxPollMs?: number | undefined; watchMs?: number | undefined } | undefined;
  /** Called on EVERY entry into `finished`, never after dispose. */
  onFinished?: ((state: SigningState) => void) | undefined;
};

/** One async job of the session: stale once another starts, Stop waiting is pressed or the session is disposed. */
type Work = { op: number; signal: AbortSignal };

type Built = {
  id: string;
  bytes: Uint8Array;
  summary: TransactionSummary;
  lifetime: Lifetime;
  before: StakeAccount | null;
  /** Durable nonce: the context slot of the read that found the nonce value (JobView.nonceSlot). */
  nonceSlot: bigint | null;
};

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
 * - Signing by link (DECISIONS.md D67): with `plan.nonce` every round is one transaction on that durable nonce. Local
 *   signers sign first (the fee payer, who owns the nonce, among them); after the last local signature the bytes must
 *   pass core `cosignLinkProblem` (Stakeward never shows a link /cosign would refuse), then phase `link` watches the
 *   chain for the outcome. `usedNonces` keeps a lagging RPC node from building on a nonce value already used.
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
  /** Nonce values this session put in a link or sent: a round is never built on one again. */
  private readonly usedNonces = new Set<Nonce>();
  /** Ends the link watch's current pause early (checkLinkNow); null outside a pause. */
  private linkWake: (() => void) | null = null;
  /** checkLinkNow during a link check: skip the next pause. */
  private linkWakePending = false;

  constructor(options: SessionOptions) {
    this.options = options;
    // Each transaction consumes the nonce: one stake account per round (CLAUDE.md section 4).
    const roundSize = options.plan.nonce ? 1 : (options.roundSize ?? Math.min(options.ids.length, MAX_ROUND_SIZE));
    this.state = initialSigningState(options.ids, roundSize);
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

  /**
   * Starting: back to the screen of the click (nothing was asked). Signing: stop waiting for the wallet (nothing was
   * sent). Sending, confirming, checking: stop and finish. Link: stop watching and finish; the link stays usable
   * (unknown(link-open), Check again on the Done screen).
   */
  stopWaiting(): void {
    const { phase } = this.state;
    if (phase.kind === 'link') {
      this.cancel();
      this.dispatch({ type: 'stop-waiting' });
      return;
    }
    if (phase.kind === 'starting') {
      this.cancel();
      this.dispatch({ type: 'stop-waiting' });
      return;
    }
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

  /** "Check again" after the link watch paused: a new watch of LINK_WATCH_MS. */
  resumeLink(): void {
    this.dispatch({ type: 'link-resume' });
  }

  /**
   * While a link is watched: check the chain now instead of after the current pause, and start the pauses over (the
   * tab became visible again, or the link was just cancelled).
   */
  checkLinkNow(): void {
    const { phase } = this.state;
    if (phase.kind !== 'link' || !phase.watching) return;
    if (this.linkWake === null) this.linkWakePending = true;
    else this.linkWake();
  }

  /**
   * "Stop here and see the result", outside the waits: the run ends where it stands, so onFinished reports what earlier
   * rounds landed; what was not sent stays not sent.
   */
  finish(): void {
    if (signingReducer(this.state, { type: 'finish' }) === this.state) return;
    this.cancel();
    this.dispatch({ type: 'finish' });
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
      case 'link':
        // On entry and on link-resume; a finished check (link-checked) keeps the same watch.
        if (next.phase.watching && !(previous.phase.kind === 'link' && previous.phase.watching)) {
          void this.watchLink(this.begin());
        }
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
      checkLinkPlan(plan);
      const decided = await plan.prepare(chain, ids);
      if (this.stale(work)) return;
      const jobs: Record<string, JobView> = {};
      const built: Built[] = [];
      // One lifetime for the round's builds: the plan's durable nonce, or a recent blockhash; read only when needed.
      let lifetime: Lifetime | null = null;
      let nonceSlot: bigint | null = null;
      for (const id of ids) {
        const decision = decided.jobs[id] ?? { kind: 'refused', reason: 'not-decided', before: null };
        if (decision.kind === 'done') {
          jobs[id] = jobView(id, { kind: 'already-done', after: decision.after }, { before: null });
        } else if (decision.kind === 'refused') {
          jobs[id] = jobView(id, { kind: 'refused', reason: decision.reason }, { before: decision.before });
        } else if (decision.kind === 'bytes') {
          const item = await inspectBytes(id, decision.bytes, decision.before, decision.nonceSlot ?? null);
          if (this.stale(work)) return;
          built.push(item);
        } else {
          if (plan.nonce !== undefined && decision.feePayer !== plan.nonce.nonceAuthority) {
            // The fee payer owns the nonce (CLAUDE.md section 5): a plan that says otherwise is a bug.
            throw new PrepareFailure({
              kind: 'inspector',
              error: { code: 'bad-layout', message: 'The fee payer of a durable-nonce round must be the nonce authority' },
            });
          }
          if (lifetime === null) {
            if (plan.nonce === undefined) {
              lifetime = await this.blockhashLifetime();
            } else {
              const read = await this.nonceLifetime(work, plan.nonce);
              if (read === null) return;
              lifetime = read.lifetime;
              nonceSlot = read.slot;
            }
            if (this.stale(work)) return;
          }
          const bytes = buildOwn(decision.action, decision.feePayer, lifetime);
          const summary = await inspectOwn(bytes, decision.action, decision.feePayer);
          if (this.stale(work)) return;
          built.push({ id, bytes, summary, lifetime, before: decision.before, nonceSlot });
        }
      }
      if (built.length > 1 && built.some((item) => item.lifetime.kind === 'nonce')) {
        // Each transaction consumes the nonce: a nonce round holds one (the constructor forces round size 1).
        throw new PrepareFailure({
          kind: 'inspector',
          error: { code: 'bad-layout', message: 'A durable-nonce round must hold exactly one transaction' },
        });
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
        const error = translateError(simulation.error, context);
        if (error.code === 'insufficient-funds') {
          // A fee payer that cannot pay this one fails its simulation before the round's fee check: name the key to
          // fund (fee-balance) instead of a failure that names none (SECURITY-CHECK П16). A short stake account passes.
          await this.checkFees(work, [item], roleHints([item.summary.action]));
          if (this.stale(work)) return;
        }
        jobs[item.id] = jobView(item.id, { kind: 'sim-failed', error }, item);
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

  private async blockhashLifetime(): Promise<Lifetime> {
    const latest: LatestBlockhash = await this.options.chain.getLatestBlockhash();
    return { kind: 'blockhash', ...latest };
  }

  /**
   * The plan's nonce account, read fresh: missing or unusable stops the round. A value this session already put in a
   * link or sent means a lagging RPC node: read again (REREAD_ATTEMPTS times, rereadDelayMs apart), then `stale`.
   * With the lifetime comes the slot of the read that found its value. Null when the work went stale meanwhile.
   */
  private async nonceLifetime(
    work: Work,
    nonce: { nonceAccount: Address; nonceAuthority: Address },
  ): Promise<{ lifetime: NonceLifetime; slot: bigint } | null> {
    const delay = this.options.rereadDelayMs ?? REREAD_DELAY_MS;
    for (let attempt = 0; ; attempt += 1) {
      const { slot, accounts } = await this.options.chain.getAccounts([nonce.nonceAccount]);
      if (this.stale(work)) return null;
      const read = readNonceAccount(accounts[0] ?? null, nonce.nonceAuthority);
      if (read.kind !== 'ready') throw new PrepareFailure({ kind: 'nonce', state: read.kind });
      if (!this.usedNonces.has(read.value)) {
        const { nonceAccount, nonceAuthority } = nonce;
        return { lifetime: { kind: 'nonce', nonceAccount, nonceAuthority, nonceValue: read.value }, slot };
      }
      if (attempt >= REREAD_ATTEMPTS) throw new PrepareFailure({ kind: 'nonce', state: 'stale' });
      await pause(delay, work.signal);
      if (this.stale(work)) return null;
    }
  }

  /**
   * Per distinct fee payer: the round's fees, plus what the payer moves out besides (a nonce setup's deposit, core
   * payerOutflow), must leave it at 0 or at least rent-exempt (core canPayFee).
   */
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
        .reduce((sum, item) => sum + item.summary.networkFeeLamports + payerOutflow(item.summary.action), 0n);
      if (!canPayFee(balance, fees, rent)) {
        const { role } = this.options.resolveSigner(payer, hints.get(payer) ?? null);
        throw new PrepareFailure({ kind: 'fee-balance', payer, role, balance, needed: fees + rent });
      }
    }
  }

  /**
   * The round's wallet requests in core `signingOrder`, each with the transactions that still lack that signer. Signers
   * by link (plan `remote`) never count as appending a tail here, and come last: the link is shown after the last local
   * signature.
   */
  private steps(remaining: readonly Built[], hints: ReadonlyMap<Address, WalletRole>): SignStep[] {
    const [head] = remaining;
    if (head === undefined) return [];
    const remote = new Set(this.options.plan.remote ?? []);
    const required = unique(remaining.flatMap((item) => item.summary.requiredSigners));
    const present = required.filter((signer) => remaining.every((item) => item.summary.presentSignatures.includes(signer)));
    const order = signingOrder({
      required,
      present,
      feePayer: head.summary.feePayer,
      appendsTail: (signer) => {
        if (remote.has(signer)) return false;
        const resolution = this.options.resolveSigner(signer, hints.get(signer) ?? null);
        return resolution.kind === 'ready' && this.options.appendsTail(resolution.wallet);
      },
      first: this.state.first,
    });
    const local = order.filter((address) => !remote.has(address));
    const byLink = order.filter((address) => remote.has(address));
    return [...local, ...byLink].map((address) =>
      this.resolveStep({
        address,
        role: hints.get(address) ?? 'main',
        walletName: null,
        count: remaining.filter((item) => lacks(item.summary, address)).length,
        status: 'pending',
        local: !remote.has(address),
      }),
    );
  }

  private async afterSwitch(index: number): Promise<void> {
    await this.signStep(index, true);
  }

  /**
   * One wallet request for every transaction of the round that lacks this step's signature. A wallet that does not
   * offer the step's account is asked for it first (the user's own click: Sign, or Continue after switching), and
   * reconnected once if it keeps offering another one: Phantom stays on the account the site connected first
   * (connectOffering, D109). Still missing: the user is asked to switch accounts (`again` after Continue).
   */
  private async signStep(index: number, afterSwitch = false): Promise<void> {
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
      this.dispatch({ type: 'starting', step: index, waitFor: 'wallet' });
      try {
        await connectOffering(wallet, (offered) => offered.includes(step.address), { signal: work.signal });
      } catch {
        // Declined or failed: the check below keeps the user on this step.
      }
      if (this.stale(work)) return;
      if (!wallet.accounts.includes(step.address)) {
        this.dispatch({ type: 'switch-account', step: index, again: afterSwitch });
        return;
      }
    }

    // Enough time left? A read error is ignored: the wallet is asked and the send reports an expiry. A durable nonce
    // does not expire.
    const lastValid = lastValidOf(round.txs);
    if (lastValid !== null) {
      this.dispatch({ type: 'starting', step: index, waitFor: 'network' });
      const height = await blockHeight(this.options.chain);
      if (this.stale(work)) return;
      if (height !== null) {
        if (!roundSigned(round) && lastValid - height < MIN_BLOCKS_LEFT_TO_SIGN) {
          this.dispatch({ type: 'refresh' });
          return;
        }
        if (roundSigned(round) && height > lastValid) {
          this.dispatch({ type: 'expired' });
          return;
        }
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
          // Bytes that arrived signed (/cosign) keep their first signature whoever signs here first.
          startWith: index > 0 && firstMayHelp && !tried && !arrivedSigned(round) ? step.address : null,
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
      // The wallet must have added its own valid signature: unchanged bytes pass checkSigningStep, and the step would
      // read as signed while the last check (or the other device, by link) asks for this key again.
      if (!inspected.summary.presentSignatures.includes(step.address)) {
        this.stop(work, index, {
          kind: 'verify',
          code: 'missing-signatures',
          detail: `${wallet.name} returned transaction ${tx.id} without a valid signature of ${step.address}`,
        });
        return;
      }
      signed.set(tx.id, { ...tx, bytes, summary: inspected.summary });
    }
    const txs = round.txs.map((tx) => signed.get(tx.id) ?? tx);
    const next = round.steps[index + 1];
    if (next === undefined) {
      for (const tx of txs) {
        const verified = await verifyAllSignatures(tx.bytes);
        if (this.stale(work)) return;
        if (!verified.ok) {
          this.stop(work, index, { kind: 'verify', code: verified.error.code, detail: verified.error.message });
          return;
        }
      }
    } else if (!next.local) {
      // The last signature here; the rest sign by link. Never show a link /cosign would refuse (D69).
      for (const tx of txs) {
        const problem = cosignLinkProblem(tx.summary);
        if (problem !== null) {
          this.stop(work, index, { kind: 'inspect', walletName: wallet.name, error: { code: 'bad-layout', message: problem } });
          return;
        }
      }
      for (const tx of txs) if (tx.lifetime.kind === 'nonce') this.usedNonces.add(tx.lifetime.nonceValue);
      const [head] = txs;
      this.dispatch({ type: 'signed', step: index, txs, signature: head === undefined ? null : transactionIdOf(head.bytes) });
      return;
    }
    this.dispatch({ type: 'signed', step: index, txs });
  }

  /** Sends every ready transaction of the round, in order; each send's outcome is its own (accounts are independent). */
  private async send(work: Work): Promise<void> {
    const { chain } = this.options;
    const round = this.state.round;
    if (round === null) return;
    // Sent (or about to be): never build on this nonce value again, even if a lagging node still shows it.
    for (const tx of round.txs) if (tx.lifetime.kind === 'nonce') this.usedNonces.add(tx.lifetime.nonceValue);
    const lastValid = lastValidOf(round.txs);
    if (lastValid !== null) {
      const height = await blockHeight(chain);
      if (this.stale(work)) return;
      if (height !== null && height > lastValid) {
        this.dispatch({ type: 'expired' });
        return;
      }
    }
    for (const tx of round.txs) {
      if (this.state.jobs[tx.id]?.state.kind !== 'ready') continue;
      this.dispatch({ type: 'job', id: tx.id, state: { kind: 'sending' }, signature: transactionIdOf(tx.bytes), bytes: tx.bytes });
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
              nonceSlot: job.nonceSlot,
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

  /**
   * Phase link: checks the chain for the link's outcome (core actionApplied on the target and the nonce account read
   * together, then the signature status; no searchTransactionHistory), first after `firstPollMs`, then each pause
   * LINK_POLL_FACTOR longer up to `maxPollMs`. A landing, a failure or a moved nonce ends the round (`link-result`);
   * after `watchMs` the watch pauses. checkLinkNow ends a pause early and starts the pauses over.
   */
  private async watchLink(work: Work): Promise<void> {
    const item = this.linkItem();
    if (item === null) return;
    const link = this.options.link;
    const firstPollMs = link?.firstPollMs ?? LINK_FIRST_POLL_MS;
    const maxPollMs = link?.maxPollMs ?? LINK_MAX_POLL_MS;
    const watchMs = link?.watchMs ?? LINK_WATCH_MS;
    this.linkWakePending = false;
    const start = Date.now();
    let delay = firstPollMs;
    for (;;) {
      const woken = await this.linkPause(delay, work.signal);
      if (this.stale(work)) return;
      let ok = true;
      try {
        const state = (await checkLanded(this.options.chain, [item], { signal: work.signal, rereads: 0 }))[item.id];
        if (this.stale(work)) return;
        if (state?.kind === 'done' || state?.kind === 'failed' || state?.kind === 'expired') {
          this.dispatch({ type: 'link-result', id: item.id, state });
          return;
        }
      } catch {
        if (this.stale(work)) return;
        ok = false;
      }
      this.dispatch({ type: 'link-checked', ok });
      if (Date.now() - start >= watchMs) {
        this.dispatch({ type: 'link-paused' });
        return;
      }
      delay = woken ? firstPollMs : Math.min(delay * LINK_POLL_FACTOR, maxPollMs);
    }
  }

  /** What the link watch checks: the round's one transaction as signed here. */
  private linkItem(): LandedItem | null {
    const tx = this.state.round?.txs[0];
    const job = tx === undefined ? undefined : this.state.jobs[tx.id];
    if (tx === undefined || job === undefined) return null;
    return {
      id: tx.id,
      action: tx.summary.action,
      signature: job.signature,
      lifetime: tx.lifetime,
      nonceSlot: job.nonceSlot,
      bytes: tx.bytes,
      before: job.before,
      confirmed: false,
      why: 'link-open',
    };
  }

  /** A pause of the link watch: true when checkLinkNow ended it early, false after `ms` or on abort. */
  private linkPause(ms: number, signal: AbortSignal): Promise<boolean> {
    if (this.linkWakePending) {
      this.linkWakePending = false;
      return Promise.resolve(true);
    }
    if (signal.aborted) return Promise.resolve(false);
    return new Promise((resolve) => {
      let settled = false;
      const done = (woken: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        if (this.linkWake === wake) this.linkWake = null;
        resolve(woken);
      };
      const wake = () => {
        done(true);
      };
      const onAbort = () => {
        done(false);
      };
      const timer = setTimeout(() => {
        done(false);
      }, ms);
      this.linkWake = wake;
      signal.addEventListener('abort', onAbort, { once: true });
    });
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
function buildOwn(action: TransactionAction, feePayer: Address, lifetime: Lifetime): Uint8Array {
  try {
    return buildTransaction(action, { feePayer, lifetime }).bytes;
  } catch (error) {
    const message = `Stakeward could not build its own transaction: ${translateError(error).detail}`;
    throw new PrepareFailure({ kind: 'inspector', error: { code: 'bad-layout', message } });
  }
}

/** A link plan names its remote signers only with a nonce, and never its nonce authority (the fee payer): a bug. */
function checkLinkPlan(plan: SigningPlan): void {
  const remote = plan.remote ?? [];
  if (remote.length === 0) return;
  if (plan.nonce === undefined || remote.includes(plan.nonce.nonceAuthority)) {
    throw new PrepareFailure({ kind: 'inspector', error: { code: 'bad-layout', message: 'link plan misconfigured' } });
  }
}

/** Bytes to sign as they are (/cosign): the inspector must read them, on a durable nonce; they are never rebuilt. */
async function inspectBytes(id: string, bytes: Uint8Array, before: StakeAccount | null, nonceSlot: bigint | null): Promise<Built> {
  const inspected = await inspectTransaction(bytes);
  if (!inspected.ok) throw new PrepareFailure({ kind: 'inspector', error: inspected.error });
  const { lifetime } = inspected.summary;
  if (lifetime.kind !== 'nonce') {
    throw new PrepareFailure({
      kind: 'inspector',
      error: { code: 'bad-layout', message: 'Signed bytes from a link must use a durable nonce' },
    });
  }
  return { id, bytes: Uint8Array.from(bytes), summary: inspected.summary, lifetime, before, nonceSlot };
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
  from: {
    before: StakeAccount | null;
    summary?: TransactionSummary;
    lifetime?: Lifetime;
    bytes?: Uint8Array;
    nonceSlot?: bigint | null;
  },
): JobView {
  const view: JobView = {
    id,
    state,
    before: from.before,
    action: from.summary?.action ?? null,
    lifetime: from.lifetime ?? null,
    signature: null,
    bytes: from.bytes ?? null,
  };
  if (from.nonceSlot !== undefined && from.nonceSlot !== null) view.nonceSlot = from.nonceSlot;
  return view;
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

/** The lowest last valid block height of the round's blockhash transactions; null for a durable-nonce round. */
function lastValidOf(txs: readonly RoundTx[]): bigint | null {
  let lowest: bigint | null = null;
  for (const tx of txs) {
    if (tx.lifetime.kind !== 'blockhash') continue;
    const value = tx.lifetime.lastValidBlockHeight;
    if (lowest === null || value < lowest) lowest = value;
  }
  return lowest;
}

/** True when the round's bytes came with signatures already (a /cosign bytes round): fewer steps than signers. */
function arrivedSigned(round: Round): boolean {
  return round.steps.length < unique(round.txs.flatMap((tx) => tx.summary.requiredSigners)).length;
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

/**
 * A send that failed: definite errors fail; a lost answer may still have reached the network, so it is polled until
 * its blockhash expires. A 429 is definite: the worker's rate limit runs before the proxy forwards anything. A resend
 * after a lost answer is not: HttpChain then throws SendOutcomeUnknownError, which reads as a network failure.
 */
function sendFailure(error: FriendlyError): JobState {
  switch (error.code) {
    case 'blockhash-expired':
    case 'nonce-advanced':
      // Never lands: the blockhash ran out, or the nonce moved on (the link was used or cancelled).
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

/** Waits `ms`; resolves early on abort (the caller's stale check then ends its work). */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}
