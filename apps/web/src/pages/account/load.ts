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
import { systemDeviceClock, type DeviceClock } from '@/ports/device-clock';

/** One stake account page's read (/withdraw/:account, /extend/:account): the account, the cluster clock, the epoch. */
export type AccountState = {
  /** null: no account at this address. */
  raw: RawAccount | null;
  /** The decoded stake account; null when `raw` is missing or is not a stake account. */
  account: StakeAccount | null;
  clock: ChainClock;
  epoch: EpochInfo;
  /**
   * The device clock (unix seconds) when the reads arrived. Epoch-end estimates count from it, because the countdown
   * that shows them ticks on the device clock (the cluster clock can differ from it).
   */
  readAt: bigint;
};

/** The `:account` of the page address: a base58 address that is not the zero key; null otherwise. */
export function parseAccountParam(text: string | undefined): Address | null {
  if (text === undefined || !isAddress(text)) return null;
  return text === ZERO_ADDRESS ? null : text;
}

/**
 * Reads one stake account, the Clock sysvar and the epoch together (three calls at once). Never a search: the page
 * knows its account, and the search is cached at the edge (DECISIONS.md D51). Rejects when any read fails.
 * `readAt` comes from `deviceClock` (default: the system clock).
 */
export async function loadAccountState(
  chain: ChainPort,
  address: Address,
  deviceClock: DeviceClock = systemDeviceClock,
): Promise<AccountState> {
  const [{ accounts }, clock, epoch] = await Promise.all([chain.getAccounts([address]), chain.getClock(), chain.getEpochInfo()]);
  const raw = accounts[0] ?? null;
  const decoded = raw === null ? null : decodeStakeAccount(raw);
  const readAt = deviceClock();
  return { raw, account: decoded?.ok === true ? decoded.account : null, clock, epoch, readAt };
}

/** The read for `address`, again whenever `attempt` changes (Try again, Check again); idle without an address. */
export function useAccountState(
  chain: ChainPort,
  address: Address | null,
  attempt: number,
  deviceClock: DeviceClock = systemDeviceClock,
): Load<AccountState> {
  return useLoad(address === null ? null : `${address}#${String(attempt)}`, () =>
    address === null ? Promise.reject(new Error('no account')) : loadAccountState(chain, address, deviceClock),
  );
}
