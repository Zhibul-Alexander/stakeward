import type { Address, Signature } from '@solana/kit';
import type {
  ChainClock,
  FriendlyError,
  InspectError,
  Lifetime,
  SignatureCheckError,
  SigningStepErrorCode,
  StakeAccount,
  TransactionAction,
  TransactionSummary,
  WalletRole,
} from '@stakeward/core';

/**
 * The signing engine's state machine (DECISIONS.md D47), pure: `signingReducer(state, event)` returns the next state,
 * or the SAME object when the event does not fit the current phase. A late answer from a wallet or the network is
 * therefore a no-op here, on top of the driver's own tokens (session.ts).
 *
 * A run signs `ids` (one job per stake account) in rounds of `roundSize`. Each round is prepared (fresh chain reads,
 * build, inspect, simulate, fee check), then every signer approves all of the round's transactions in ONE wallet
 * request, in core `signingOrder`, then the round is sent automatically, confirmed and checked on the chain.
 *
 * Signing by link (DECISIONS.md D67): a round on a durable nonce has one transaction. Signers in this browser sign
 * first; when the rest sign on another device (remote steps), the round waits in phase `link` after the last local
 * signature: the other device sends, and this one learns the outcome from the chain (`link-result`).
 */

/** One transaction of the round being signed. */
export type RoundTx = {
  id: string;
  /** Unsigned, then partly signed, then fully signed wire bytes (a copy of what the last wallet returned). */
  bytes: Uint8Array;
  /** `inspectTransaction(bytes)`, run again after every signature: the screen shows only what the bytes say. */
  summary: TransactionSummary;
  /** A recent blockhash, or a durable nonce (signing by link, rescue, /cosign). */
  lifetime: Lifetime;
};

/** One wallet request of the round: `address` approves `count` transactions. */
export type SignStep = {
  address: Address;
  role: WalletRole;
  /** The wallet that holds this key in this browser; null when none does. */
  walletName: string | null;
  count: number;
  status: 'pending' | 'signed';
  /** Signs in this browser. False: signs on another device by link (plan `remote`); such a step is never asked here. */
  local: boolean;
};

/** `link-open`: signed here and shown as a link; the other device may still sign and send it. */
export type UnknownWhy = 'timeout' | 'stopped' | 'not-applied' | 'unverified' | 'link-open';

export type JobState =
  | { kind: 'queued' }
  | { kind: 'preparing' }
  | { kind: 'refused'; reason: string }
  /** `after` is null when the target is not a stake account (a nonce account) or was closed. */
  | { kind: 'already-done'; after: StakeAccount | null }
  | { kind: 'sim-failed'; error: FriendlyError }
  /** Built and simulated, in the round being signed. */
  | { kind: 'ready' }
  /** Its round stopped or expired before it was sent: nothing changed. */
  | { kind: 'not-sent' }
  | { kind: 'sending' }
  /** `indefinite`: the send's answer was lost, so it may or may not have reached the network. */
  | { kind: 'confirming'; indefinite: boolean }
  | { kind: 'checking' }
  | { kind: 'done'; after: StakeAccount | null }
  | { kind: 'failed'; error: FriendlyError }
  /**
   * Never lands: sent and its blockhash passed with no status, or (durable nonce) its nonce moved on without it (a link
   * that was used, cancelled or failed).
   */
  | { kind: 'expired' }
  | { kind: 'unknown'; why: UnknownWhy };

export type JobView = {
  id: string;
  state: JobState;
  /** The account as read before building. */
  before: StakeAccount | null;
  /** From the inspected bytes. */
  action: TransactionAction | null;
  lifetime: Lifetime | null;
  /** The fee payer's signature (the transaction id), once known. */
  signature: Signature | null;
  /** The last bytes (fully signed once sent). */
  bytes: Uint8Array | null;
};

export type PrepareProblem =
  | { kind: 'read'; error: FriendlyError }
  /** `needed` = the round's fees plus the minimum balance the payer must keep. */
  | { kind: 'fee-balance'; payer: Address; role: WalletRole; balance: bigint; needed: bigint }
  /** Stakeward's own bytes were refused, or they say another action or fee payer: a bug. */
  | { kind: 'inspector'; error: InspectError }
  /**
   * The plan's durable nonce account: `missing` (closed, or never made), `unusable` (another owner, size, state or
   * authority), `stale` (it still holds a value this session already used: the RPC node has not caught up).
   */
  | { kind: 'nonce'; state: 'missing' | 'unusable' | 'stale' };

export type WalletStopCode = 'WalletBusyError' | 'WalletUnsupportedError' | 'WalletBatchUnsupportedError' | 'cancelled';

export type StopReason =
  | { kind: 'wallet'; walletName: string; error: FriendlyError; portError: WalletStopCode | null }
  | {
      kind: 'check';
      walletName: string;
      code: SigningStepErrorCode;
      detail: string;
      /** "Start again with <wallet> signing first", when that may help and was not tried yet. */
      startWith: Address | null;
      /** That wallet breaks the round whichever key signs first. */
      bothWays: boolean;
    }
  | { kind: 'inspect'; walletName: string; error: InspectError }
  | { kind: 'verify'; code: SignatureCheckError['code']; detail: string };

export type Phase =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'prepare-failed'; problem: PrepareProblem }
  /** `refreshed`: the round was just built again because too few blocks were left to sign it. */
  | { kind: 'ready'; step: number; refreshed: boolean }
  /**
   * After a click, before the wallet request: the wallet is asked to offer the account again (`wallet`, after
   * switch-account), or the block height is read to check there is time to sign (`network`). Stop waiting goes back.
   */
  | { kind: 'starting'; step: number; waitFor: 'wallet' | 'network' }
  | { kind: 'needs-wallet'; step: number }
  | { kind: 'switch-account'; step: number; again: boolean }
  | { kind: 'signing'; step: number }
  | { kind: 'stopped'; step: number; reason: StopReason }
  | { kind: 'expired' }
  /**
   * Every local signature is there; the rest sign on another device through the link. `watching`: this page checks the
   * chain for the outcome (paused after LINK_WATCH_MS). `lastCheckFailed`: the latest check could not reach the network.
   */
  | { kind: 'link'; watching: boolean; lastCheckFailed: boolean }
  | { kind: 'sending' }
  | { kind: 'confirming' }
  | { kind: 'checking' }
  | { kind: 'finished' };

export type Round = { ids: readonly string[]; txs: readonly RoundTx[]; steps: readonly SignStep[] };

export type SigningState = {
  ids: readonly string[];
  roundSize: number;
  /** Rounds started so far (the current one included). */
  roundNumber: number;
  jobs: Readonly<Record<string, JobView>>;
  round: Round | null;
  phase: Phase;
  clock: ChainClock | null;
  /** The signer the user put first ("Start again with <wallet> signing first"); kept for the rest of the run. */
  first: Address | null;
  /** Every signer that was put first once; asking again would not help. */
  triedFirst: readonly Address[];
  /** The round is being built again before any signature (fewer than MIN_BLOCKS_LEFT_TO_SIGN blocks were left). */
  refreshing: boolean;
};

export type SigningEvent =
  | { type: 'start' }
  | {
      type: 'prepared';
      clock: ChainClock;
      jobs: Readonly<Record<string, JobView>>;
      txs: readonly RoundTx[];
      steps: readonly SignStep[];
    }
  | { type: 'prepare-failed'; problem: PrepareProblem }
  | { type: 'retry-prepare' }
  | { type: 'refresh' }
  | { type: 'needs-wallet'; step: number }
  /** The missing key is connected now: back to its turn, with the wallet names read again. */
  | { type: 'wallet-ready'; step: number; steps: readonly SignStep[] }
  | { type: 'switch-account'; step: number; again: boolean }
  | { type: 'starting'; step: number; waitFor: 'wallet' | 'network' }
  | { type: 'asking'; step: number }
  /** `signature`: the transaction id, when the next step signs by link (it becomes the job's signature). */
  | { type: 'signed'; step: number; txs: readonly RoundTx[]; signature?: Signature | null }
  | { type: 'stopped'; step: number; reason: StopReason }
  | { type: 'expired' }
  | { type: 'restart-round'; first: Address | null }
  | { type: 'one-at-a-time' }
  | { type: 'job'; id: string; state: JobState; signature?: Signature | null; bytes?: Uint8Array | null }
  | { type: 'send-done' }
  | { type: 'confirm-done' }
  | { type: 'check-done' }
  | { type: 'stop-waiting' }
  /** "Stop here and see the result": ends the run where it stands, outside a wait; what was not sent stays not sent. */
  | { type: 'finish' }
  /** A link check found nothing new (`ok`), or could not reach the network. */
  | { type: 'link-checked'; ok: boolean }
  /** The link watch ran out of time (LINK_WATCH_MS). */
  | { type: 'link-paused' }
  /** "Check again" after the pause: a new watch. */
  | { type: 'link-resume' }
  /** The chain shows the link's outcome: landed (`done`), failed, or the nonce moved on without it (`expired`). */
  | { type: 'link-result'; id: string; state: JobState };

const QUEUED: JobState = { kind: 'queued' };
const PREPARING: JobState = { kind: 'preparing' };
const NOT_SENT: JobState = { kind: 'not-sent' };

/** Phase idle, every job queued. Duplicate ids count once. */
export function initialSigningState(ids: readonly string[], roundSize: number): SigningState {
  const unique = ids.filter((id, index) => ids.indexOf(id) === index);
  const jobs: Record<string, JobView> = {};
  for (const id of unique) {
    jobs[id] = { id, state: QUEUED, before: null, action: null, lifetime: null, signature: null, bytes: null };
  }
  return {
    ids: unique,
    roundSize: Math.max(1, Math.floor(roundSize)),
    roundNumber: 0,
    jobs,
    round: null,
    phase: { kind: 'idle' },
    clock: null,
    first: null,
    triedFirst: [],
    refreshing: false,
  };
}

/** Jobs that can be tried again in a new run: nothing was sent, or what was sent is known not to land. */
export function retryableIds(state: SigningState): string[] {
  return state.ids.filter((id) => {
    const kind = state.jobs[id]?.state.kind;
    return kind === 'sim-failed' || kind === 'failed' || kind === 'expired' || kind === 'not-sent';
  });
}

/** The transition table of DECISIONS.md D47. Any event that does not fit the phase returns `state` itself. */
export function signingReducer(state: SigningState, event: SigningEvent): SigningState {
  const { phase, round } = state;
  switch (event.type) {
    case 'start':
      return phase.kind === 'idle' ? advance(state) : state;

    case 'prepared': {
      if (phase.kind !== 'preparing' || round === null) return state;
      const next: SigningState = {
        ...state,
        jobs: { ...state.jobs, ...event.jobs },
        clock: event.clock,
        round: { ...round, txs: event.txs, steps: event.steps },
      };
      if (event.txs.length === 0) return advance(next);
      return { ...next, phase: { kind: 'ready', step: 0, refreshed: state.refreshing }, refreshing: false };
    }

    case 'prepare-failed':
      return phase.kind === 'preparing' ? { ...state, phase: { kind: 'prepare-failed', problem: event.problem } } : state;

    case 'retry-prepare':
      if (phase.kind !== 'prepare-failed' || round === null) return state;
      return { ...state, jobs: setStates(state.jobs, round.ids, () => PREPARING), phase: { kind: 'preparing' } };

    case 'refresh':
      // Only before the first signature: the user sees the new summaries and signs again.
      if (round === null || roundSigned(round) || stepAt(phase) !== 0) return state;
      if (phase.kind !== 'ready' && phase.kind !== 'switch-account' && phase.kind !== 'starting' && !walletStop(phase)) {
        return state;
      }
      return {
        ...state,
        jobs: setStates(state.jobs, round.ids, () => PREPARING),
        refreshing: true,
        phase: { kind: 'preparing' },
      };

    case 'needs-wallet':
      if (stepAt(phase) !== event.step) return state;
      if (phase.kind !== 'ready' && phase.kind !== 'switch-account' && phase.kind !== 'starting' && !walletStop(phase)) {
        return state;
      }
      return { ...state, phase: { kind: 'needs-wallet', step: event.step } };

    case 'wallet-ready':
      if (phase.kind !== 'needs-wallet' || phase.step !== event.step || round === null) return state;
      return { ...state, round: { ...round, steps: event.steps }, phase: { kind: 'ready', step: event.step, refreshed: false } };

    case 'switch-account':
      if (stepAt(phase) !== event.step) return state;
      if (
        phase.kind !== 'ready' &&
        phase.kind !== 'needs-wallet' &&
        phase.kind !== 'switch-account' &&
        phase.kind !== 'starting' &&
        phase.kind !== 'signing' &&
        !walletStop(phase)
      ) {
        return state;
      }
      return { ...state, phase: { kind: 'switch-account', step: event.step, again: event.again } };

    case 'starting':
      if (stepAt(phase) !== event.step) return state;
      if (
        phase.kind !== 'ready' &&
        phase.kind !== 'switch-account' &&
        !walletStop(phase) &&
        !(phase.kind === 'starting' && phase.waitFor === 'wallet')
      ) {
        return state;
      }
      return { ...state, phase: { kind: 'starting', step: event.step, waitFor: event.waitFor } };

    case 'asking':
      if (stepAt(phase) !== event.step) return state;
      if (
        phase.kind !== 'ready' &&
        phase.kind !== 'needs-wallet' &&
        phase.kind !== 'switch-account' &&
        phase.kind !== 'starting' &&
        !walletStop(phase)
      ) {
        return state;
      }
      return { ...state, phase: { kind: 'signing', step: event.step } };

    case 'signed': {
      if (phase.kind !== 'signing' || phase.step !== event.step || round === null) return state;
      const steps = round.steps.map((step, index) => (index === event.step ? { ...step, status: 'signed' as const } : step));
      const next = round.steps[event.step + 1];
      const signedRound = { ...round, txs: event.txs, steps };
      if (next === undefined) return { ...state, round: signedRound, phase: { kind: 'sending' } };
      if (next.local) return { ...state, round: signedRound, phase: { kind: 'ready', step: event.step + 1, refreshed: false } };
      // The rest sign by link: the round's one transaction (a nonce round) now has its id and the bytes of the link.
      const jobs: Record<string, JobView> = { ...state.jobs };
      const [tx] = event.txs;
      const job = tx === undefined ? undefined : jobs[tx.id];
      if (tx !== undefined && job !== undefined) jobs[tx.id] = { ...job, signature: event.signature ?? null, bytes: tx.bytes };
      return { ...state, jobs, round: signedRound, phase: { kind: 'link', watching: true, lastCheckFailed: false } };
    }

    case 'link-checked':
      if (phase.kind !== 'link' || phase.lastCheckFailed === !event.ok) return state;
      return { ...state, phase: { ...phase, lastCheckFailed: !event.ok } };

    case 'link-paused':
      if (phase.kind !== 'link' || !phase.watching) return state;
      return { ...state, phase: { ...phase, watching: false } };

    case 'link-resume':
      // A new phase object: the driver starts a new watch.
      if (phase.kind !== 'link' || phase.watching) return state;
      return { ...state, phase: { kind: 'link', watching: true, lastCheckFailed: false } };

    case 'link-result': {
      if (phase.kind !== 'link' || round === null || !round.ids.includes(event.id)) return state;
      const job = state.jobs[event.id];
      if (job === undefined) return state;
      return advance({ ...state, jobs: { ...state.jobs, [event.id]: { ...job, state: event.state } } });
    }

    case 'stopped':
      if (stepAt(phase) !== event.step) return state;
      if (phase.kind !== 'signing' && phase.kind !== 'ready' && phase.kind !== 'needs-wallet' && phase.kind !== 'switch-account') {
        return state;
      }
      return { ...state, phase: { kind: 'stopped', step: event.step, reason: event.reason } };

    case 'expired': {
      if (round === null) return state;
      const allowed =
        phase.kind === 'ready' ||
        phase.kind === 'switch-account' ||
        phase.kind === 'starting' ||
        walletStop(phase) ||
        (phase.kind === 'sending' && round.txs.every((tx) => state.jobs[tx.id]?.state.kind === 'ready'));
      if (!allowed) return state;
      return {
        ...state,
        jobs: setStates(state.jobs, round.ids, (job) => (job.state.kind === 'ready' ? NOT_SENT : null)),
        phase: { kind: 'expired' },
      };
    }

    case 'restart-round': {
      if (round === null) return state;
      const allowed =
        phase.kind === 'expired' ||
        (phase.kind === 'stopped' && (phase.reason.kind === 'check' || phase.reason.kind === 'inspect' || phase.reason.kind === 'verify'));
      if (!allowed) return state;
      // "Start again with <wallet> signing first" sets the order; "Sign again" and plain "Start again" keep it.
      const first = event.first ?? state.first;
      return {
        ...state,
        jobs: setStates(state.jobs, round.ids, (job) => (unsent(job.state) ? PREPARING : null)),
        first,
        triedFirst: first === null || state.triedFirst.includes(first) ? state.triedFirst : [...state.triedFirst, first],
        phase: { kind: 'preparing' },
      };
    }

    case 'one-at-a-time': {
      if (round === null) return state;
      const allowed =
        phase.kind === 'expired' ||
        (phase.kind === 'stopped' &&
          phase.reason.kind === 'wallet' &&
          phase.reason.portError === 'WalletBatchUnsupportedError');
      if (!allowed) return state;
      // The stopped round is split into rounds of one; it does not count as a round of its own ("Round 1 of 2").
      return advance({
        ...state,
        jobs: setStates(state.jobs, round.ids, (job) => (unsent(job.state) ? QUEUED : null)),
        roundSize: 1,
        roundNumber: Math.max(0, state.roundNumber - 1),
      });
    }

    case 'job': {
      if (phase.kind !== 'sending' && phase.kind !== 'confirming' && phase.kind !== 'checking') return state;
      const job = state.jobs[event.id];
      if (job === undefined) return state;
      const next: JobView = { ...job, state: event.state };
      if (event.signature !== undefined) next.signature = event.signature;
      if (event.bytes !== undefined) next.bytes = event.bytes;
      return { ...state, jobs: { ...state.jobs, [event.id]: next } };
    }

    case 'send-done':
      if (phase.kind !== 'sending') return state;
      return roundHas(state, 'confirming') ? { ...state, phase: { kind: 'confirming' } } : advance(state);

    case 'confirm-done':
      if (phase.kind !== 'confirming') return state;
      return roundHas(state, 'checking') ? { ...state, phase: { kind: 'checking' } } : advance(state);

    case 'check-done':
      return phase.kind === 'checking' ? advance(state) : state;

    case 'stop-waiting':
      // Before the wallet request: back to the click's own screen, nothing was asked.
      if (phase.kind === 'starting') {
        return {
          ...state,
          phase:
            phase.waitFor === 'wallet'
              ? { kind: 'switch-account', step: phase.step, again: false }
              : { kind: 'ready', step: phase.step, refreshed: false },
        };
      }
      if (phase.kind === 'link') {
        // Signed here, and the link may still be used: unknown until the chain says otherwise (Check again).
        return { ...state, jobs: setStates(state.jobs, state.ids, linkStopState), phase: { kind: 'finished' } };
      }
      if (phase.kind !== 'sending' && phase.kind !== 'confirming' && phase.kind !== 'checking') return state;
      return { ...state, jobs: setStates(state.jobs, state.ids, stopWaitingState), phase: { kind: 'finished' } };

    case 'finish': {
      const allowed =
        phase.kind === 'preparing' ||
        phase.kind === 'prepare-failed' ||
        phase.kind === 'ready' ||
        phase.kind === 'needs-wallet' ||
        phase.kind === 'switch-account' ||
        phase.kind === 'stopped' ||
        phase.kind === 'expired';
      if (!allowed) return state;
      return {
        ...state,
        jobs: setStates(state.jobs, state.ids, (job) => (waitingToSend(job.state) ? NOT_SENT : null)),
        phase: { kind: 'finished' },
        refreshing: false,
      };
    }
  }
}

/**
 * Next round: the first `roundSize` queued jobs in `ids` order are prepared; with none left the run is finished. The
 * signers stay the same, so the signing order the user chose ("Start again with <wallet> signing first") holds.
 */
function advance(state: SigningState): SigningState {
  const ids = state.ids.filter((id) => state.jobs[id]?.state.kind === 'queued').slice(0, state.roundSize);
  if (ids.length === 0) return { ...state, phase: { kind: 'finished' }, refreshing: false };
  return {
    ...state,
    jobs: setStates(state.jobs, ids, () => PREPARING),
    roundNumber: state.roundNumber + 1,
    round: { ids, txs: [], steps: [] },
    phase: { kind: 'preparing' },
    refreshing: false,
  };
}

/** What Stop waiting leaves: anything in flight may still land (check again); anything not sent was not sent. */
function stopWaitingState(job: JobView): JobState | null {
  switch (job.state.kind) {
    case 'sending':
    case 'confirming':
      return { kind: 'unknown', why: 'stopped' };
    case 'checking':
      return { kind: 'unknown', why: 'unverified' };
    case 'ready':
    case 'queued':
      return NOT_SENT;
    default:
      return null;
  }
}

/** What Stop waiting leaves while a link is open: the signed job may still land; later rounds were not sent. */
function linkStopState(job: JobView): JobState | null {
  switch (job.state.kind) {
    case 'ready':
      return { kind: 'unknown', why: 'link-open' };
    case 'queued':
      return NOT_SENT;
    default:
      return null;
  }
}

/** `jobs` with `update(job)` applied to `ids`; `null` keeps a job as it is. */
function setStates(
  jobs: Readonly<Record<string, JobView>>,
  ids: readonly string[],
  update: (job: JobView) => JobState | null,
): Record<string, JobView> {
  const next: Record<string, JobView> = { ...jobs };
  for (const id of ids) {
    const job = jobs[id];
    if (job === undefined) continue;
    const state = update(job);
    if (state !== null) next[id] = { ...job, state };
  }
  return next;
}

function unsent(state: JobState): boolean {
  return state.kind === 'ready' || state.kind === 'not-sent';
}

/** Not sent yet, and would be in this run: queued for a later round, being prepared, or built and ready to sign. */
function waitingToSend(state: JobState): boolean {
  return state.kind === 'queued' || state.kind === 'preparing' || state.kind === 'ready';
}

function roundHas(state: SigningState, kind: JobState['kind']): boolean {
  return state.round?.ids.some((id) => state.jobs[id]?.state.kind === kind) ?? false;
}

/** True once any transaction of the round carries a signature. */
export function roundSigned(round: Round): boolean {
  return round.txs.some((tx) => tx.summary.presentSignatures.length > 0);
}

function stepAt(phase: Phase): number | null {
  switch (phase.kind) {
    case 'ready':
    case 'starting':
    case 'needs-wallet':
    case 'switch-account':
    case 'signing':
    case 'stopped':
      return phase.step;
    default:
      return null;
  }
}

function walletStop(phase: Phase): boolean {
  return phase.kind === 'stopped' && phase.reason.kind === 'wallet';
}
