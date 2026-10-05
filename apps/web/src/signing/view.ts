import type { JobStatus, JobStatusItem } from '@/components/product/job-status-list';
import type { SignerListItem, SignerStatus } from '@/components/product/signer-list';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { roundSigned, type JobState, type JobView, type SignStep, type SigningState } from './machine.ts';

/**
 * Pure mapping from the engine's state to what the signing panel shows. No React here: /dev/ui and tests feed it
 * fixtures.
 */

/** The round's signers in signing order, each with where it stands now. */
export function signerItems(state: SigningState): SignerListItem[] {
  const steps = state.round?.steps ?? [];
  return steps.map((step, index) => {
    const status = signerStatus(state, step, index);
    return {
      role: step.role,
      walletName: status === 'missing' ? null : step.walletName,
      address: step.address,
      count: step.count,
      status,
    };
  });
}

function signerStatus(state: SigningState, step: SignStep, index: number): SignerStatus {
  if (step.status === 'signed') return 'signed';
  const { phase } = state;
  if (!('step' in phase) || phase.step !== index) return step.walletName === null ? 'missing' : 'waiting';
  switch (phase.kind) {
    case 'ready':
    case 'starting':
    case 'signing':
      return 'current';
    case 'needs-wallet':
      return 'missing';
    case 'switch-account':
      return 'switch';
    case 'stopped':
      return 'stopped';
  }
}

/** The text of a job's outcome; `undefined` when the state needs no explanation (or the page gives it). */
export type JobReason = (job: JobView) => string | undefined;

/** What the engine itself can explain: errors, an expiry and the uncertain cases. Refusals are the page's words. */
export function defaultJobReason(job: JobView): string | undefined {
  const { state } = job;
  switch (state.kind) {
    case 'failed':
    case 'sim-failed': {
      const lockUntil = job.before?.lockup.unixTimestamp;
      return lockUntil === undefined ? errorMessage(state.error) : errorMessage(state.error, lockUntil);
    }
    case 'expired':
      return t('components.jobs.expired');
    case 'unknown':
      return t(`components.jobs.unknown.${state.why}`);
    default:
      return undefined;
  }
}

/** One line per transaction of the round (the stake accounts being signed and sent), in round order. */
export function jobItems(state: SigningState, reasonText: JobReason = defaultJobReason): JobStatusItem[] {
  const txs = state.round?.txs ?? [];
  return txs.flatMap((tx) => {
    const job = state.jobs[tx.id];
    if (job === undefined) return [];
    const stakeAccount = 'stakeAccount' in tx.summary.action ? tx.summary.action.stakeAccount : null;
    if (stakeAccount === null) return [];
    const item: JobStatusItem = { address: stakeAccount, status: jobStatus(job.state), signature: job.signature };
    const reason = reasonText(job);
    if (reason !== undefined) item.reason = reason;
    const detail = errorDetail(job.state);
    if (detail !== undefined) item.detail = detail;
    return [item];
  });
}

export function jobStatus(state: JobState): JobStatus {
  switch (state.kind) {
    case 'queued':
    case 'preparing':
    case 'ready':
      return 'waiting';
    case 'refused':
      return 'left-out';
    case 'already-done':
    case 'done':
      return 'done';
    case 'sim-failed':
    case 'failed':
      return 'failed';
    case 'not-sent':
      return 'not-sent';
    case 'sending':
    case 'confirming':
    case 'checking':
    case 'expired':
    case 'unknown':
      return state.kind;
  }
}

function errorDetail(state: JobState): string | undefined {
  return state.kind === 'failed' || state.kind === 'sim-failed' ? state.error.detail : undefined;
}

/** Jobs whose transaction was sent (landed or not). */
const SENT: ReadonlySet<JobState['kind']> = new Set(['sending', 'confirming', 'checking', 'done', 'failed', 'expired', 'unknown']);

/** What a run must report once it ends: a sent transaction, or a change the chain already showed. */
function reported(kind: JobState['kind'] | undefined): boolean {
  return kind === 'already-done' || (kind !== undefined && SENT.has(kind));
}

/**
 * The way back from the signing step: `back` while no wallet has signed, `stop-and-back` after one did (the signed
 * bytes are dropped; nothing was sent), none while a wallet or the network is being waited for, or at the end. Once
 * the run has something to report (an earlier round was sent, or the chain already showed a change), going back would
 * drop it: `finish` ends the run instead, so the page shows and records what happened.
 */
export function backKind(state: SigningState): 'back' | 'stop-and-back' | 'finish' | null {
  switch (state.phase.kind) {
    case 'starting':
    case 'signing':
    case 'sending':
    case 'confirming':
    case 'checking':
    case 'finished':
      return null;
    default:
      if (state.ids.some((id) => reported(state.jobs[id]?.state.kind))) return 'finish';
      return state.round !== null && roundSigned(state.round) ? 'stop-and-back' : 'back';
  }
}

/** Stake accounts whose transaction an earlier round of this run already sent ("Nothing was sent" is about this round). */
export function earlierSent(state: SigningState): number {
  const current = state.round?.ids ?? [];
  return state.ids.filter((id) => {
    const kind = state.jobs[id]?.state.kind;
    return !current.includes(id) && kind !== undefined && SENT.has(kind);
  }).length;
}

/** "Round {current} of {total}": rounds started so far, plus the rounds the queued jobs still need. */
export function roundProgress(state: SigningState): { current: number; total: number } {
  const queued = state.ids.filter((id) => state.jobs[id]?.state.kind === 'queued').length;
  const current = Math.max(1, state.roundNumber);
  const total = Math.max(current, state.roundNumber + Math.ceil(queued / state.roundSize));
  return { current, total };
}

/** The transactions of the round that have left `ready` (sent or being sent), for "Sending: {current} of {total}". */
export function sendProgress(state: SigningState): { current: number; total: number } {
  const txs = state.round?.txs ?? [];
  const sent = txs.filter((tx) => state.jobs[tx.id]?.state.kind !== 'ready').length;
  return { current: Math.max(1, sent), total: txs.length };
}
