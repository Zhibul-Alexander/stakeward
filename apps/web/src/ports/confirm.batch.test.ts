import { signature as toSignature, type Signature } from '@solana/kit';
import type { ChainPort, TransactionStatus } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { waitForConfirmations, type ConfirmationEntry, type ConfirmationOptions } from './confirm.ts';

// waitForConfirmations: one wait for a round of sent transactions (step 4 spec section 3.8).

const sig = (digit: string): Signature => toSignature(digit.repeat(88));
const [S1, S2, S3, S4] = [sig('2'), sig('3'), sig('4'), sig('5')] as [Signature, Signature, Signature, Signature];

const status = (confirmationStatus: TransactionStatus['confirmationStatus'], error: unknown = null): TransactionStatus => ({
  slot: 7n,
  confirmationStatus,
  error,
});

/**
 * A chain whose status for each signature follows its own script, one step per getSignatureStatuses call that asks for
 * it (the last step repeats), and whose block height follows `heights` (one step per call). Every call is recorded.
 */
function scriptedChain(script: Partial<Record<Signature, (TransactionStatus | null)[]>>, heights: bigint[] = [0n]) {
  const statusCalls: Signature[][] = [];
  let heightCalls = 0;
  const asked = new Map<Signature, number>();
  const unused = () => Promise.reject(new Error('not used'));
  const chain: ChainPort = {
    getAccounts: unused,
    getClock: unused,
    getLatestBlockhash: unused,
    getBalance: unused,
    getMinimumBalanceForRentExemption: unused,
    simulate: unused,
    send: unused,
    findStakeAccounts: unused,
    getEpochInfo: unused,
    getBlockHeight: () => Promise.resolve(heights[Math.min(heightCalls++, heights.length - 1)] ?? 0n),
    getSignatureStatuses: (signatures) => {
      statusCalls.push([...signatures]);
      return Promise.resolve(
        signatures.map((signature) => {
          const steps = script[signature] ?? [null];
          const index = asked.get(signature) ?? 0;
          asked.set(signature, index + 1);
          return steps[Math.min(index, steps.length - 1)] ?? null;
        }),
      );
    },
  };
  return { chain, statusCalls, heightCalls: () => heightCalls };
}

/** Virtual time: sleeping advances the clock instantly. */
function virtualTime(): Required<Pick<ConfirmationOptions, 'now' | 'sleep'>> & { slept: number[] } {
  let time = 0;
  const slept: number[] = [];
  return {
    slept,
    now: () => time,
    sleep: (ms) => {
      slept.push(ms);
      time += ms;
      return Promise.resolve();
    },
  };
}

const blockhash = (signature: Signature, lastValidBlockHeight = 100n): ConfirmationEntry => ({
  signature,
  lifetime: { kind: 'blockhash', lastValidBlockHeight },
});

describe('waitForConfirmations', () => {
  it('reads every pending status in ONE getSignatureStatuses call per round, and drops settled ones', async () => {
    const { chain, statusCalls, heightCalls } = scriptedChain(
      { [S1]: [status('confirmed')], [S2]: [null, status('processed'), status('confirmed')], [S3]: [status('processed'), status('confirmed')] },
      [90n],
    );
    const outcomes = await waitForConfirmations(chain, [blockhash(S1), blockhash(S2), blockhash(S3)], virtualTime());
    expect([...outcomes.keys()]).toEqual([S1, S2, S3]);
    expect([...outcomes.values()].every((outcome) => outcome.status === 'confirmed')).toBe(true);
    expect(statusCalls).toEqual([[S1, S2, S3], [S2, S3], [S2]]);
    // Only the first round had an unseen blockhash transaction (S2): one block height read for it.
    expect(heightCalls()).toBe(1);
  });

  it('settles mixed outcomes: confirmed, failed, expired and (nonce) timeout', async () => {
    const error = { InstructionError: [2n, { Custom: 1n }] };
    const { chain, statusCalls, heightCalls } = scriptedChain(
      { [S1]: [status('confirmed')], [S2]: [status('confirmed', error)], [S3]: [null], [S4]: [null] },
      [99n, 101n],
    );
    const time = virtualTime();
    const outcomes = await waitForConfirmations(
      chain,
      [blockhash(S1), blockhash(S2), blockhash(S3), { signature: S4, lifetime: { kind: 'nonce' } }],
      { ...time, timeoutMs: 10_000 },
    );
    expect(outcomes.get(S1)).toEqual({ status: 'confirmed', slot: 7n, confirmationStatus: 'confirmed' });
    expect(outcomes.get(S2)).toEqual({ status: 'failed', slot: 7n, error });
    expect(outcomes.get(S3)).toEqual({ status: 'expired' });
    expect(outcomes.get(S4)).toEqual({ status: 'timeout', lastError: null });
    // Round 1: all four, height 99. Round 2: S3 and S4, height 101, one more look at S3 only. Then S4 alone until the
    // deadline: a nonce transaction needs no block height.
    expect(statusCalls.slice(0, 3)).toEqual([[S1, S2, S3, S4], [S3, S4], [S3]]);
    expect(statusCalls.slice(3).every((call) => call.length === 1 && call[0] === S4)).toBe(true);
    expect(heightCalls()).toBe(2);
    expect(time.now()).toBe(10_000);
  });

  it('a transaction found by the last look after expiry still counts', async () => {
    const { chain } = scriptedChain({ [S1]: [null, status('confirmed')], [S2]: [null] }, [101n]);
    const outcomes = await waitForConfirmations(chain, [blockhash(S1), blockhash(S2)], virtualTime());
    expect(outcomes.get(S1)).toMatchObject({ status: 'confirmed' });
    expect(outcomes.get(S2)).toEqual({ status: 'expired' });
  });

  it('each transaction expires by its own lastValidBlockHeight', async () => {
    const { chain } = scriptedChain({ [S1]: [null], [S2]: [null, null, status('confirmed')] }, [150n]);
    const outcomes = await waitForConfirmations(chain, [blockhash(S1, 120n), blockhash(S2, 200n)], virtualTime());
    expect(outcomes.get(S1)).toEqual({ status: 'expired' });
    expect(outcomes.get(S2)).toMatchObject({ status: 'confirmed' });
  });

  it('asks once for a repeated signature and answers it once', async () => {
    const { chain, statusCalls } = scriptedChain({ [S1]: [status('confirmed')] });
    const outcomes = await waitForConfirmations(chain, [blockhash(S1), blockhash(S1)], virtualTime());
    expect(outcomes.size).toBe(1);
    expect(statusCalls).toEqual([[S1]]);
  });

  it('nothing to wait for: no read at all', async () => {
    const { chain, statusCalls } = scriptedChain({});
    expect((await waitForConfirmations(chain, [], virtualTime())).size).toBe(0);
    expect(statusCalls).toEqual([]);
  });

  it('keeps polling through read failures; at the deadline every pending one times out with the last error', async () => {
    const offline = new TypeError('Failed to fetch');
    const { chain } = scriptedChain({ [S1]: [status('confirmed')], [S2]: [status('confirmed')] });
    const down: ChainPort = { ...chain, getSignatureStatuses: () => Promise.reject(offline) };
    const outcomes = await waitForConfirmations(down, [blockhash(S1), blockhash(S2)], { ...virtualTime(), timeoutMs: 5_000 });
    expect(outcomes.get(S1)).toEqual({ status: 'timeout', lastError: offline });
    expect(outcomes.get(S2)).toEqual({ status: 'timeout', lastError: offline });

    let failures = 1;
    const recovers: ChainPort = {
      ...chain,
      getSignatureStatuses: (signatures) => (failures-- > 0 ? Promise.reject(offline) : chain.getSignatureStatuses(signatures)),
    };
    const later = await waitForConfirmations(recovers, [blockhash(S1), blockhash(S2)], virtualTime());
    expect([...later.values()].map((outcome) => outcome.status)).toEqual(['confirmed', 'confirmed']);
  });

  it('a round cut off by the deadline settles nothing: its outcomes are not half-applied', async () => {
    const hanging = new Promise<never>(() => undefined);
    const { chain } = scriptedChain({ [S1]: [status('confirmed')], [S2]: [null] });
    const outcomes = await waitForConfirmations(
      { ...chain, getBlockHeight: () => hanging },
      [blockhash(S1), blockhash(S2)],
      { timeoutMs: 100 },
    );
    expect(outcomes.get(S1)).toMatchObject({ status: 'timeout' });
    expect(outcomes.get(S2)).toMatchObject({ status: 'timeout' });
  });

  it('can be cancelled, also while a status read is in flight', async () => {
    const { chain } = scriptedChain({});
    const done = new AbortController();
    done.abort();
    await expect(waitForConfirmations(chain, [blockhash(S1)], { signal: done.signal })).rejects.toMatchObject({ name: 'AbortError' });

    const never = new Promise<readonly (TransactionStatus | null)[]>(() => undefined);
    const later = new AbortController();
    const waiting = waitForConfirmations({ ...chain, getSignatureStatuses: () => never }, [blockhash(S1), blockhash(S2)], {
      signal: later.signal,
    });
    setTimeout(() => {
      later.abort();
    }, 10);
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  });
});
