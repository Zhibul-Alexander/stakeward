// Review (step 3, waitForConfirmation vs the new transport timeouts): the wait promises to be "finite and
// cancellable" with an upper bound of timeoutMs (default 120 s). Neither the signal nor the deadline reaches the reads
// themselves: ChainPort calls take no signal, and the deadline is only checked between rounds. With the browser timeout
// now 30 s per attempt and two retries (about 92 s per read in the worst case), one round (status, block height,
// status again) can run about 276 s past the deadline, and Cancel does nothing until the read in flight returns.
import { signature as toSignature } from '@solana/kit';
import type { ChainPort, TransactionStatus } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { waitForConfirmation } from './confirm.ts';

const SIGNATURE = toSignature('5'.repeat(88));
const unused = () => Promise.reject(new Error('not used'));

function chainWith(getSignatureStatuses: ChainPort['getSignatureStatuses'], getBlockHeight: ChainPort['getBlockHeight']): ChainPort {
  return {
    getAccounts: unused,
    getClock: unused,
    getLatestBlockhash: unused,
    getBalance: unused,
    getMinimumBalanceForRentExemption: unused,
    simulate: unused,
    send: unused,
    findStakeAccounts: unused,
    getBlockHeight,
    getSignatureStatuses,
  };
}

describe('review: waitForConfirmation is cancellable and bounded', () => {
  it('rejects promptly when the signal aborts while a status read is in flight', async () => {
    const never = new Promise<readonly (TransactionStatus | null)[]>(() => undefined);
    const chain = chainWith(() => never, () => Promise.resolve(0n));
    const controller = new AbortController();
    const wait = waitForConfirmation(chain, SIGNATURE, { kind: 'nonce' }, { signal: controller.signal });
    controller.abort();
    const settled = await Promise.race([
      wait.then(
        () => 'resolved',
        () => 'rejected',
      ),
      new Promise((resolve) => setTimeout(() => { resolve('still waiting'); }, 200)),
    ]);
    expect(settled).toBe('rejected');
  });

  it('never ends later than timeoutMs, even when a read takes the transport worst case (~92 s)', async () => {
    // Fix round of step 3: the first version advanced a virtual clock inside each fake read, which no implementation
    // can stop once a read has started; a read that hangs is the same case in real time.
    const hanging = new Promise<never>(() => undefined);
    const chain = chainWith(
      () => hanging,
      () => hanging,
    );
    const started = Date.now();
    const outcome = await waitForConfirmation(chain, SIGNATURE, { kind: 'blockhash', lastValidBlockHeight: 100n }, { timeoutMs: 150 });
    expect(outcome.status).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
