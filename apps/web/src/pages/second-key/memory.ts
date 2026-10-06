import type { Address } from '@solana/kit';
import { isLockupInForce, type ChainPort } from '@stakeward/core';
import type { Ports } from '@/ports';
import { refreshStakeAccounts } from '@/ports/fresh-accounts';

/** The keys of a landed run of /second-key/:account. */
export type HandOver = { account: Address; mainKey: Address; secondKey: Address; newSecondKey: Address };

/**
 * The other stake accounts of this main key whose lock in force the old second key still holds, read from the chain
 * (the search says which accounts exist, a fresh read what they hold now: fresh-accounts.ts). Rejects when the chain
 * cannot be read: the caller then cannot know, and keeps the old key (`settle`).
 */
export async function otherLocksOf(chain: ChainPort, run: HandOver): Promise<Address[]> {
  const [found, clock] = await Promise.all([chain.findStakeAccounts({ custodian: run.secondKey }), chain.getClock()]);
  const fresh = await refreshStakeAccounts(chain, found.accounts);
  return fresh
    .filter(
      (stake) =>
        stake.address !== run.account &&
        stake.withdrawer === run.mainKey &&
        stake.lockup.custodian === run.secondKey &&
        isLockupInForce(stake.lockup, clock),
    )
    .map((stake) => stake.address);
}

/**
 * This device's memory once the chain shows the new second key holding the lock. The new key is always remembered as a
 * second key. The old one is forgotten, and the slots follow (the old key leaves the Second key slot, the new one moves
 * there from the New wallet slot, so /extend and /withdraw find it under its role and /rescue finds New wallet free),
 * only when `othersHeld` is known to be empty. While the old key still holds other locks of this main key, or when that
 * could not be read (null), it stays known and the slots stay as they are: those accounts keep their actions, and the
 * next hand-over on /second-key finds both keys already connected.
 */
export function settle(ports: Pick<Ports, 'secondKeys' | 'slots'>, run: HandOver, othersHeld: readonly Address[] | null): void {
  ports.secondKeys.remember(run.newSecondKey);
  if (othersHeld === null || othersHeld.length > 0) return;
  ports.secondKeys.forget(run.secondKey);
  const { slots } = ports;
  if (slots.getSnapshot().second?.address === run.secondKey) slots.clear('second');
  const moved = slots.getSnapshot().new;
  // Only when the Second key slot is free: a slot holding some other key keeps it, and the new key stays where it is.
  if (moved?.address === run.newSecondKey && slots.getSnapshot().second === null) {
    slots.clear('new');
    slots.assign('second', moved);
  }
}
