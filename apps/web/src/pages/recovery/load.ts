import type { Address } from '@solana/kit';
import { decodeStakeAccount, type ChainPort } from '@stakeward/core';
import { useLoad, type Load } from '@/hooks/use-load';
import { refreshStakeAccounts } from '@/ports/fresh-accounts';
import { buildRecoveryCard, cardLock, type RecoveryLoad } from './view.ts';

/**
 * Reads the recovery card of `route` from the network only (DECISIONS.md D74): the account and the Clock sysvar
 * together; for a lock a second key holds, the main key's stake accounts (the search, then each read again, D51).
 * Nothing is written and no wallet is asked. One failed read fails the whole card: never a partial card.
 */
export async function loadRecovery(chain: ChainPort, route: Address): Promise<RecoveryLoad> {
  const [{ accounts }, clock] = await Promise.all([chain.getAccounts([route]), chain.getClock()]);
  const raw = accounts[0] ?? null;
  if (raw === null) return { kind: 'refused', reason: 'not-found' };
  const decoded = decodeStakeAccount(raw);
  if (!decoded.ok) return { kind: 'refused', reason: 'not-stake-account' };
  const account = decoded.account;
  const lock = cardLock(account, clock);
  if (lock !== 'protected') return { kind: 'refused', reason: lock };
  const found = await chain.findStakeAccounts({ withdrawer: account.withdrawer });
  const fresh = await refreshStakeAccounts(chain, found.accounts);
  return { kind: 'card', card: buildRecoveryCard(account, fresh, clock) };
}

/** The card of `route`, read again whenever `attempt` changes (Try again); idle without an account. */
export function useRecovery(chain: ChainPort, route: Address | null, attempt: number): Load<RecoveryLoad> {
  return useLoad(route === null ? null : `${route}#${String(attempt)}`, () =>
    route === null ? Promise.reject(new Error('no account')) : loadRecovery(chain, route),
  );
}
