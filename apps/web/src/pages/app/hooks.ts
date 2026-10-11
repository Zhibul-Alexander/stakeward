import type { Address } from '@solana/kit';
import { translateError, type ChainClock, type ChainPort, type FriendlyError, type StakeAccount } from '@stakeward/core';
import { useEffect, useState } from 'react';
import type { Health } from '@/api/health';
import { refreshStakeAccounts } from '@/ports';

export type StakeAccountsData = {
  address: Address;
  /** Cluster time and epoch the statuses are computed with. */
  clock: ChainClock;
  /** Found by main key and by second key, each once, in the state read after the search. */
  accounts: readonly StakeAccount[];
};

/** Which searches run: by main key and by second key (/app), or by main key only (/proof). */
export type StakeAccountsScope = 'main-and-second' | 'main';

export type StakeAccountsState =
  | { status: 'loading' }
  | { status: 'error'; error: FriendlyError }
  | { status: 'ready'; data: StakeAccountsData };

/**
 * Reads what the accounts page needs from the chain: stake accounts whose main key is `address`, those whose lock
 * `address` holds, and the Clock sysvar. The search is cached for 30 s at the edge, so it only says which accounts
 * exist; their state is read again (refreshStakeAccounts), or a lock that just landed would look like one that ended
 * (DECISIONS D51). One failure fails the whole read: the page never shows a partial list. With `scope: 'main'` only
 * the first search runs (the proof page, D124, proves the wallet's own stake).
 */
export async function loadStakeAccounts(chain: ChainPort, address: Address, scope: StakeAccountsScope = 'main-and-second'): Promise<StakeAccountsData> {
  const [byMainKey, bySecondKey, clock] = await Promise.all([
    chain.findStakeAccounts({ withdrawer: address }),
    scope === 'main' ? Promise.resolve({ accounts: [] }) : chain.findStakeAccounts({ custodian: address }),
    chain.getClock(),
  ]);
  const accounts = await refreshStakeAccounts(chain, [...byMainKey.accounts, ...bySecondKey.accounts]);
  return { address, clock, accounts };
}

/** The read for `address`, again whenever `attempt` changes (Refresh, Try again). Results of older reads are dropped. */
export function useStakeAccounts(
  chain: ChainPort,
  address: Address,
  attempt: number,
  scope: StakeAccountsScope = 'main-and-second',
): StakeAccountsState {
  const key = `${address}#${scope}#${String(attempt)}`;
  const [result, setResult] = useState<{ key: string; state: StakeAccountsState } | null>(null);
  useEffect(() => {
    let current = true;
    loadStakeAccounts(chain, address, scope).then(
      (data) => {
        if (current) setResult({ key, state: { status: 'ready', data } });
      },
      (error: unknown) => {
        if (current) setResult({ key, state: { status: 'error', error: translateError(error) } });
      },
    );
    return () => {
      current = false;
    };
  }, [chain, address, scope, key]);
  return result !== null && result.key === key ? result.state : { status: 'loading' };
}

export type HealthState =
  | { status: 'loading' }
  | { status: 'error'; detail: string }
  /** `receivedAt`: local time of the answer, so the age shown is never older than the answer itself. */
  | { status: 'ready'; health: Health; receivedAt: number };

/** How often an open page asks /api/health again: the monitor runs every 2 minutes (CLAUDE.md section 8). */
export const HEALTH_POLL_MS = 60_000;

/**
 * GET /api/health now, every minute while the page is open, when the tab becomes visible again, and whenever `attempt`
 * changes (Refresh). Without the repeats an open page would turn the line red on a monitor that kept running. A failed
 * repeat keeps the last answer (its age keeps growing, and it turns red once it is 10 minutes old); an answer that
 * arrives after a newer one is dropped.
 */
export function useHealth(load: () => Promise<Health>, attempt: number): HealthState {
  const [result, setResult] = useState<{ attempt: number; state: HealthState } | null>(null);
  useEffect(() => {
    let current = true;
    let asked = 0;
    let answered = 0;
    const read = () => {
      asked += 1;
      const id = asked;
      load().then(
        (health) => {
          if (!current || id < answered) return;
          answered = id;
          setResult({ attempt, state: { status: 'ready', health, receivedAt: Date.now() } });
        },
        (error: unknown) => {
          if (!current || id < answered) return;
          const failed: HealthState = { status: 'error', detail: translateError(error).detail };
          setResult((previous) =>
            previous !== null && previous.attempt === attempt && previous.state.status === 'ready' ? previous : { attempt, state: failed },
          );
        },
      );
    };
    read();
    const timer = setInterval(read, HEALTH_POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') read();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      current = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load, attempt]);
  return result !== null && result.attempt === attempt ? result.state : { status: 'loading' };
}

/** The local time in ms, updated every `intervalMs`, so "N min ago" stays true while the page is open. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}
