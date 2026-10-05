import { signature as toSignature } from '@solana/kit';
import type { ChainPort, TransactionStatus } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { waitForConfirmation, type ConfirmationOptions } from './confirm.ts';

const SIGNATURE = toSignature('5'.repeat(88));

type Script = { statuses: (TransactionStatus | null | Error)[]; heights?: bigint[] };

/** A chain that answers getSignatureStatuses and getBlockHeight from a script (the last entry repeats). */
function scriptedChain(script: Script): { chain: ChainPort; statusCalls: () => number } {
  let statusCalls = 0;
  let heightCalls = 0;
  const pick = <T>(list: readonly T[], index: number): T => {
    const item = list[Math.min(index, list.length - 1)];
    if (item === undefined) throw new Error('empty script');
    return item;
  };
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
    getBlockHeight: () => Promise.resolve(pick(script.heights ?? [0n], heightCalls++)),
    getSignatureStatuses: () => {
      const next = pick(script.statuses, statusCalls++);
      return next instanceof Error ? Promise.reject(next) : Promise.resolve([next]);
    },
  };
  return { chain, statusCalls: () => statusCalls };
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

const BLOCKHASH = { kind: 'blockhash', lastValidBlockHeight: 100n } as const;
const status = (confirmationStatus: TransactionStatus['confirmationStatus'], error: unknown = null): TransactionStatus => ({
  slot: 7n,
  confirmationStatus,
  error,
});

describe('waitForConfirmation', () => {
  it('waits through "not seen" and "processed" until confirmed', async () => {
    const { chain } = scriptedChain({ statuses: [null, status('processed'), status('confirmed')], heights: [90n] });
    const time = virtualTime();
    expect(await waitForConfirmation(chain, SIGNATURE, BLOCKHASH, time)).toEqual({
      status: 'confirmed',
      slot: 7n,
      confirmationStatus: 'confirmed',
    });
    expect(time.slept).toEqual([2_000, 2_000]);
  });

  it('with commitment finalized, confirmed is not enough', async () => {
    const { chain } = scriptedChain({ statuses: [status('confirmed'), status('finalized')] });
    const outcome = await waitForConfirmation(chain, SIGNATURE, BLOCKHASH, { ...virtualTime(), commitment: 'finalized' });
    expect(outcome).toMatchObject({ status: 'confirmed', confirmationStatus: 'finalized' });
  });

  it('reports a transaction that landed with an error', async () => {
    const error = { InstructionError: [2n, { Custom: 1n }] };
    const { chain } = scriptedChain({ statuses: [status('confirmed', error)] });
    expect(await waitForConfirmation(chain, SIGNATURE, BLOCKHASH, virtualTime())).toEqual({ status: 'failed', slot: 7n, error });
  });

  it('expires once block height passes lastValidBlockHeight and a last look finds nothing', async () => {
    const { chain, statusCalls } = scriptedChain({ statuses: [null], heights: [99n, 100n, 101n] });
    expect(await waitForConfirmation(chain, SIGNATURE, BLOCKHASH, virtualTime())).toEqual({ status: 'expired' });
    expect(statusCalls()).toBe(4); // three rounds, plus the last look after the height passed
  });

  it('a transaction found by the last look after expiry still counts', async () => {
    const { chain } = scriptedChain({ statuses: [null, status('confirmed')], heights: [101n] });
    expect(await waitForConfirmation(chain, SIGNATURE, BLOCKHASH, virtualTime())).toMatchObject({ status: 'confirmed' });
  });

  it('a nonce transaction never expires by height: the wait ends at the deadline', async () => {
    const { chain } = scriptedChain({ statuses: [null] });
    const time = virtualTime();
    const outcome = await waitForConfirmation(chain, SIGNATURE, { kind: 'nonce' }, { ...time, timeoutMs: 10_000 });
    expect(outcome).toEqual({ status: 'timeout', lastError: null });
    expect(time.slept.reduce((a, b) => a + b, 0)).toBe(10_000);
  });

  it('keeps polling through read failures and reports the last one at the deadline', async () => {
    const offline = new TypeError('Failed to fetch');
    const { chain } = scriptedChain({ statuses: [offline] });
    const outcome = await waitForConfirmation(chain, SIGNATURE, BLOCKHASH, { ...virtualTime(), timeoutMs: 5_000 });
    expect(outcome).toEqual({ status: 'timeout', lastError: offline });

    const recovers = scriptedChain({ statuses: [offline, status('confirmed')] });
    expect(await waitForConfirmation(recovers.chain, SIGNATURE, BLOCKHASH, virtualTime())).toMatchObject({ status: 'confirmed' });
  });

  it('every wait is finite by default (120 s)', async () => {
    const { chain } = scriptedChain({ statuses: [status('processed')], heights: [0n] });
    const time = virtualTime();
    expect(await waitForConfirmation(chain, SIGNATURE, BLOCKHASH, time)).toMatchObject({ status: 'timeout' });
    expect(time.now()).toBe(120_000);
  });

  it('can be cancelled with an AbortSignal, also while sleeping', async () => {
    const { chain } = scriptedChain({ statuses: [null], heights: [0n] });
    const controller = new AbortController();
    controller.abort();
    await expect(waitForConfirmation(chain, SIGNATURE, BLOCKHASH, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });

    const later = new AbortController();
    const waiting = waitForConfirmation(chain, SIGNATURE, BLOCKHASH, { signal: later.signal, pollIntervalMs: 60_000 });
    setTimeout(() => {
      later.abort();
    }, 10);
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  });
});
