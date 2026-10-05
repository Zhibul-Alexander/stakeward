import { isLockupInForce, stakeActivationStatus, ZERO_ADDRESS, type ClockView, type StakeAccount } from '@stakeward/core';

/**
 * Where a stake account stands on the way to a withdrawal (F3), from epochs and the lock only:
 * - `deactivate`: staking (active or activating) and the main key manages staking, so it can stop it;
 * - `service-staker`: staking, but another key manages staking (a service, or a thief): nothing to sign here;
 * - `deactivating`: stopping at the end of the epoch;
 * - `withdraw`: inactive, and the lock (if any) is held by a second key, or not in force;
 * - `unsupported-lock`: inactive, but the lock in force is held by the main key itself or by no key (the zero key):
 *   Stakeward never builds a Withdraw signed by the main key as its own custodian.
 */
export type WithdrawStage = 'deactivate' | 'service-staker' | 'deactivating' | 'withdraw' | 'unsupported-lock';

export function withdrawStage(account: StakeAccount, clock: ClockView): WithdrawStage {
  const activation = stakeActivationStatus(account.delegation, clock.epoch);
  if (activation === 'active' || activation === 'activating') {
    return account.staker === account.withdrawer ? 'deactivate' : 'service-staker';
  }
  if (activation === 'deactivating') return 'deactivating';
  return lockHeldByNoSecondKey(account, clock) ? 'unsupported-lock' : 'withdraw';
}

/** A lock in force whose custodian is the main key itself or the zero key: no second key can co-sign for it. */
export function lockHeldByNoSecondKey(account: StakeAccount, clock: ClockView): boolean {
  const { lockup } = account;
  return isLockupInForce(lockup, clock) && (lockup.custodian === account.withdrawer || lockup.custodian === ZERO_ADDRESS);
}
