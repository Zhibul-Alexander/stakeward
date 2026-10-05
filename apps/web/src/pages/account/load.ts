import { isAddress, type Address } from '@solana/kit';
import {
  decodeStakeAccount,
  ZERO_ADDRESS,
  type ChainClock,
  type ChainPort,
  type EpochInfo,
  type RawAccount,
  type StakeAccount,
} from '@stakeward/core';
import { useLoad, type Load } from '@/hooks/use-load';

/** One stake account page's read (/withdraw/:account, /extend/:account): the account, the cluster clock, the epoch. */
export type AccountState = {
  /** null: no account at this address. */
  raw: RawAccount | null;
  /** The decoded stake account; null when `raw` is missing or is not a stake account. */
  account: StakeAccount | null;
  clock: ChainClock;
  epoch: EpochInfo;
};

/** The `:account` of the page address: a base58 address that is not the zero key; null otherwise. */
export function parseAccountParam(text: string | undefined): Address | null {
  if (text === undefined || !isAddress(text)) return null;
  return text === ZERO_ADDRESS ? null : text;
}

/**
 * Reads one stake account, the Clock sysvar and the epoch together (three calls at once). Never a search: the page
 * knows its account, and the search is cached at the edge (DECISIONS.md D51). Rejects when any read fails.
 */
export async function loadAccountState(chain: ChainPort, address: Address): Promise<AccountState> {
  const [{ accounts }, clock, epoch] = await Promise.all([chain.getAccounts([address]), chain.getClock(), chain.getEpochInfo()]);
  const raw = accounts[0] ?? null;
  const decoded = raw === null ? null : decodeStakeAccount(raw);
  return { raw, account: decoded?.ok === true ? decoded.account : null, clock, epoch };
}

/** The read for `address`, again whenever `attempt` changes (Try again, Check again); idle without an address. */
export function useAccountState(chain: ChainPort, address: Address | null, attempt: number): Load<AccountState> {
  return useLoad(address === null ? null : `${address}#${String(attempt)}`, () =>
    address === null ? Promise.reject(new Error('no account')) : loadAccountState(chain, address),
  );
}
