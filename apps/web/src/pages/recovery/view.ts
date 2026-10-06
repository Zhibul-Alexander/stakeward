import type { Address } from '@solana/kit';
import {
  EXPIRING_THRESHOLD_SECONDS,
  isLockupInForce,
  stakeActivationStatus,
  ZERO_ADDRESS,
  type ActivationStatus,
  type ClockView,
  type StakeAccount,
} from '@stakeward/core';

/**
 * The recovery card's rules, pure (DECISIONS.md D74). One card per pair of keys: every stake account of the main key
 * that the same second key locks. The page's account only picks the pair; the keys come from the chain, never from
 * this device (the card never says "Protected", D35: it cannot know whether the second key is the reader's).
 */

/** Why there is no card for the page's account. */
export type RecoveryRefusal = 'not-found' | 'not-stake-account' | 'not-protected' | 'unsupported-lock';

export type RecoveryAccountRow = {
  account: StakeAccount;
  activation: ActivationStatus;
  /** The lock end (unix seconds), held by the timestamp alone (`cardLock` refuses locks an epoch holds). */
  lockUntil: bigint;
  /** The stake authority, only when it is not the main key (a service may manage the stake, or a thief took it). */
  staker: Address | null;
};

export type RecoveryCard = {
  /** The page's account, first in the list. */
  route: Address;
  /** The withdraw authority of the page's account. */
  mainKey: Address;
  /** The lockup custodian of the page's account. */
  secondKey: Address;
  accounts: readonly RecoveryAccountRow[];
  /** Stake accounts of the main key that this card does not cover (no lock, an ended lock, another second key). */
  others: number;
  /** The cluster clock when the card was read (unix seconds). */
  readAt: bigint;
  /** The first lock on the card to end (unix seconds). */
  earliestEnd: bigint;
  /** `earliestEnd` is less than 30 days after `readAt` (the Expiring threshold of the accounts page). */
  expiringSoon: boolean;
};

export type RecoveryLoad = { kind: 'card'; card: RecoveryCard } | { kind: 'refused'; reason: RecoveryRefusal };

/**
 * What the card can say about one account's lock, first match wins:
 * - no lock in force, or one the main key holds itself (it can lift it alone, D14) -> `not-protected`;
 * - a lock an epoch holds, or one held by no key -> `unsupported-lock` (Stakeward never sets either; the card's
 *   commands and dates would be wrong for it);
 * - otherwise `protected`: a date lock held by another key.
 */
export function cardLock(account: StakeAccount, clock: ClockView): 'protected' | 'not-protected' | 'unsupported-lock' {
  const { lockup } = account;
  if (!isLockupInForce(lockup, clock) || lockup.custodian === account.withdrawer) return 'not-protected';
  if (lockup.epoch > clock.epoch || lockup.custodian === ZERO_ADDRESS) return 'unsupported-lock';
  return 'protected';
}

/**
 * The card for the page's account `route` (whose `cardLock` must be `protected`) and the main key's other stake
 * accounts `found` (searched and read again):
 * - the card lists `found` and `route`, once each (the route's own read wins), with the route's main key and second
 *   key and a `protected` lock;
 * - the route first, then the earliest lock end, the larger balance, the address;
 * - `others` counts the main key's stake accounts left off the card.
 */
export function buildRecoveryCard(route: StakeAccount, found: readonly StakeAccount[], clock: ClockView): RecoveryCard {
  if (cardLock(route, clock) !== 'protected') throw new Error(`No recovery card for ${route.address}: its lock is not one a second key holds`);
  const mainKey = route.withdrawer;
  const secondKey = route.lockup.custodian;
  const byAddress = new Map<Address, StakeAccount>();
  for (const account of found) byAddress.set(account.address, account);
  byAddress.set(route.address, route);

  const ofMainKey = [...byAddress.values()].filter((account) => account.withdrawer === mainKey);
  const onCard = ofMainKey.filter((account) => account.lockup.custodian === secondKey && cardLock(account, clock) === 'protected');
  onCard.sort((a, b) => {
    if (a.address === route.address) return -1;
    if (b.address === route.address) return 1;
    if (a.lockup.unixTimestamp !== b.lockup.unixTimestamp) return a.lockup.unixTimestamp < b.lockup.unixTimestamp ? -1 : 1;
    if (a.lamports !== b.lamports) return a.lamports > b.lamports ? -1 : 1;
    return a.address < b.address ? -1 : a.address > b.address ? 1 : 0;
  });

  const accounts = onCard.map((account) => ({
    account,
    activation: stakeActivationStatus(account.delegation, clock.epoch),
    lockUntil: account.lockup.unixTimestamp,
    staker: account.staker === account.withdrawer ? null : account.staker,
  }));
  const earliestEnd = accounts.reduce((earliest, row) => (row.lockUntil < earliest ? row.lockUntil : earliest), route.lockup.unixTimestamp);
  return {
    route: route.address,
    mainKey,
    secondKey,
    accounts,
    others: ofMainKey.length - onCard.length,
    readAt: clock.unixTimestamp,
    earliestEnd,
    expiringSoon: earliestEnd - clock.unixTimestamp < EXPIRING_THRESHOLD_SECONDS,
  };
}

/** /app for the main key: every stake account it has, by address (no wallet needed). */
export function accountsPath(mainKey: Address): string {
  return `/app?${new URLSearchParams({ address: mainKey }).toString()}`;
}
