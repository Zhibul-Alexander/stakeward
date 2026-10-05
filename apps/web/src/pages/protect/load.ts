import type { Address } from '@solana/kit';
import { translateError, type ChainClock, type ChainPort, type FriendlyError, type StakeAccount } from '@stakeward/core';
import { useEffect, useState } from 'react';
import { refreshStakeAccounts } from '@/ports';

export type MainKeyAccountsState =
  /** No main key to read for: nothing is read. */
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: FriendlyError }
  | { status: 'ready'; accounts: readonly StakeAccount[]; clock: ChainClock };

/**
 * The stake accounts `mainKey` can withdraw, in their state now, and the cluster clock. The search is cached for 30 s
 * at the edge, so it only says which accounts exist; their state is read again (DECISIONS.md D51). An account whose
 * main key changed since the search is dropped.
 */
export async function loadMainKeyAccounts(
  chain: ChainPort,
  mainKey: Address,
): Promise<{ accounts: StakeAccount[]; clock: ChainClock }> {
  const [found, clock] = await Promise.all([chain.findStakeAccounts({ withdrawer: mainKey }), chain.getClock()]);
  const fresh = await refreshStakeAccounts(chain, found.accounts);
  return { accounts: fresh.filter((account) => account.withdrawer === mainKey), clock };
}

/**
 * The read for `mainKey`, again whenever `attempt` changes (Try again); `idle` without a main key. Results of older
 * reads are dropped (the useStakeAccounts pattern).
 */
export function useMainKeyAccounts(chain: ChainPort, mainKey: Address | null, attempt: number): MainKeyAccountsState {
  const key = mainKey === null ? null : `${mainKey}#${String(attempt)}`;
  const [result, setResult] = useState<{ key: string; state: MainKeyAccountsState } | null>(null);
  useEffect(() => {
    if (mainKey === null || key === null) return undefined;
    let current = true;
    loadMainKeyAccounts(chain, mainKey).then(
      ({ accounts, clock }) => {
        if (current) setResult({ key, state: { status: 'ready', accounts, clock } });
      },
      (error: unknown) => {
        if (current) setResult({ key, state: { status: 'error', error: translateError(error) } });
      },
    );
    return () => {
      current = false;
    };
  }, [chain, mainKey, key]);
  if (key === null) return { status: 'idle' };
  return result !== null && result.key === key ? result.state : { status: 'loading' };
}

export type ClusterClockState =
  | { status: 'loading' }
  | { status: 'error'; error: FriendlyError }
  | { status: 'ready'; clock: ChainClock };

/** The cluster clock (the lock end is computed from it), read again whenever `attempt` changes. */
export function useClusterClock(chain: ChainPort, attempt: number): ClusterClockState {
  const [result, setResult] = useState<{ attempt: number; state: ClusterClockState } | null>(null);
  useEffect(() => {
    let current = true;
    chain.getClock().then(
      (clock) => {
        if (current) setResult({ attempt, state: { status: 'ready', clock } });
      },
      (error: unknown) => {
        if (current) setResult({ attempt, state: { status: 'error', error: translateError(error) } });
      },
    );
    return () => {
      current = false;
    };
  }, [chain, attempt]);
  return result !== null && result.attempt === attempt ? result.state : { status: 'loading' };
}
