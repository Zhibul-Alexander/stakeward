// Test-only fake of the worker's API (ApiPort) for page and scenario tests. With a chain it answers POST /api/watch the
// way the worker does: it reads the accounts and the Clock from that chain and applies core `watchVerdict`, and a row
// once written is never overwritten (insert only). Never imported from src; marked so no build can carry it.
import type { Address } from '@solana/kit';
import { watchVerdict, type ChainPort, type WatchResult } from '@stakeward/core';
import type { ApiPort } from '@/api/watch';

export const FAKE_API_MARKER = 'stakeward-test-only:fake-api';

export type FakeApi = ApiPort & {
  readonly marker: typeof FAKE_API_MARKER;
  /** The accounts of every watch() call, in call order. */
  readonly calls: Address[][];
  /** Accounts accepted so far (the worker's rows). */
  readonly watched: ReadonlySet<Address>;
  /** The next `times` calls reject with `error` (recorded in `calls` all the same). */
  failNext(error: Error, times?: number): void;
};

/**
 * Without a chain, every account asked is accepted. With one, each account is judged on what the chain shows now:
 * `watched` the first time it is accepted, `already-watched` after that, `rejected` with the verdict's reason otherwise.
 */
export function createFakeApi(chain?: ChainPort): FakeApi {
  const calls: Address[][] = [];
  const watched = new Set<Address>();
  const failures: Error[] = [];

  const watch = async (accounts: readonly Address[]): Promise<readonly WatchResult[]> => {
    calls.push([...accounts]);
    const failure = failures.shift();
    if (failure !== undefined) throw failure;
    const verdicts =
      chain === undefined
        ? null
        : await Promise.all([chain.getAccounts(accounts), chain.getClock()]).then(([read, clock]) =>
            accounts.map((_, index) => watchVerdict(read.accounts[index] ?? null, clock)),
          );
    return accounts.map((account, index): WatchResult => {
      const verdict = verdicts?.[index];
      if (verdict !== undefined && !verdict.ok) return { account, status: 'rejected', reason: verdict.reason };
      if (watched.has(account)) return { account, status: 'already-watched', reason: null };
      watched.add(account);
      return { account, status: 'watched', reason: null };
    });
  };

  return {
    marker: FAKE_API_MARKER,
    calls,
    watched,
    watch,
    failNext(error, times = 1) {
      for (let i = 0; i < times; i += 1) failures.push(error);
    },
  };
}
