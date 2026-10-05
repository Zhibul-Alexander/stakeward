import type { ChainPort } from '@stakeward/core';
import { checkLanded } from '@/signing/check';
import type { JobState, JobView } from '@/signing/machine';

/** Outcomes a new run may retry: nothing was sent, or what was sent is known not to land (engine `retryableIds`). */
const RETRYABLE: readonly JobState['kind'][] = ['sim-failed', 'failed', 'expired', 'not-sent'];

export function isRetryable(job: JobView): boolean {
  return RETRYABLE.includes(job.state.kind);
}

/** The run's outcome for this stake account landed: the chain shows the change (now, or before the run). */
export function isLanded(job: JobView): boolean {
  return job.state.kind === 'done' || job.state.kind === 'already-done';
}

/**
 * "Check again" for an uncertain outcome on a stake account page: one read of the chain (core `actionApplied` first,
 * then the transaction's status), never a wait. Rejects when the chain cannot be read; the job is unchanged when the
 * check learns nothing it can report.
 */
export async function checkJobAgain(chain: ChainPort, job: JobView): Promise<JobView> {
  if (job.action === null) return job;
  const states = await checkLanded(
    chain,
    [
      {
        id: job.id,
        action: job.action,
        signature: job.signature,
        lifetime: job.lifetime,
        bytes: job.bytes,
        before: job.before,
        confirmed: false,
        why: job.state.kind === 'unknown' ? job.state.why : undefined,
      },
    ],
    { rereads: 0 },
  );
  const state = states[job.id];
  return state === undefined ? job : { ...job, state };
}
