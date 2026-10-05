import { address, type Address } from '@solana/kit';
import { canPayFee, decodeStakeAccount, isLockupInForce, networkFeeFor, ZERO_ADDRESS } from '@stakeward/core';
import { t } from '@/i18n';
import { LOCK_END_MARGIN_SECONDS } from '@/pages/protect/wizard';
import type { JobPlan, SigningPlan } from '@/signing/types';

/** Why the plan will not move or remove a lock (the Done screen says it with `extendRefusalText`). */
export type ExtendRefusal =
  | 'not-found'
  | 'not-stake-account'
  | 'epoch-locked'
  | 'not-locked'
  | 'other-second-key'
  | 'not-later'
  | 'lock-end-passed';

const REFUSALS: readonly ExtendRefusal[] = [
  'not-found',
  'not-stake-account',
  'epoch-locked',
  'not-locked',
  'other-second-key',
  'not-later',
  'lock-end-passed',
];

/**
 * F5: SetLockup signed by the second key K: a new lock end `lockUntil`, or `0n` to remove the lock now. K pays when it
 * can (core canPayFee with one signature's fee); otherwise the main key pays and signs too, and the engine's fee check
 * then checks the main key. Every round reads the account, the clock, K's balance and the minimum balance again. The
 * first matching rule decides:
 * 1. no account -> not-found; 2. not a stake account -> not-stake-account; 3. an epoch holds the lock -> epoch-locked;
 * 4. removing, and no lock in force -> done; 5. extending, and K already holds the lock until `lockUntil` -> done;
 * 6. no lock in force, or one held by the main key itself or by no key -> not-locked; 7. another key holds it ->
 * other-second-key; 8. the lock already ends at or after `lockUntil` -> not-later; 9. `lockUntil` within
 * LOCK_END_MARGIN_SECONDS of the cluster clock -> lock-end-passed; 10. otherwise build.
 */
export function extendPlan(input: { secondKey: Address; lockUntil: bigint }): SigningPlan {
  const { secondKey, lockUntil } = input;
  const removing = lockUntil === 0n;
  return {
    async prepare(chain, ids) {
      const [{ accounts }, clock, balance, rent0] = await Promise.all([
        chain.getAccounts(ids.map((id) => address(id))),
        chain.getClock(),
        chain.getBalance(secondKey),
        chain.getMinimumBalanceForRentExemption(0),
      ]);
      const jobs: Record<string, JobPlan> = {};
      ids.forEach((id, index) => {
        const raw = accounts[index] ?? null;
        if (raw === null) {
          jobs[id] = { kind: 'refused', reason: 'not-found', before: null };
          return;
        }
        const decoded = decodeStakeAccount(raw);
        if (!decoded.ok) {
          jobs[id] = { kind: 'refused', reason: 'not-stake-account', before: null };
          return;
        }
        const { account } = decoded;
        const { lockup } = account;
        const inForce = isLockupInForce(lockup, clock);
        const refuse = (reason: ExtendRefusal) => {
          jobs[id] = { kind: 'refused', reason, before: account };
        };
        if (lockup.epoch > clock.epoch) {
          refuse('epoch-locked');
        } else if (removing && !inForce) {
          jobs[id] = { kind: 'done', after: account };
        } else if (!removing && lockup.custodian === secondKey && lockup.unixTimestamp === lockUntil) {
          jobs[id] = { kind: 'done', after: account };
        } else if (!inForce || lockup.custodian === account.withdrawer || lockup.custodian === ZERO_ADDRESS) {
          refuse('not-locked');
        } else if (lockup.custodian !== secondKey) {
          refuse('other-second-key');
        } else if (!removing && lockUntil <= lockup.unixTimestamp) {
          refuse('not-later');
        } else if (!removing && lockUntil <= clock.unixTimestamp + LOCK_END_MARGIN_SECONDS) {
          refuse('lock-end-passed');
        } else {
          jobs[id] = {
            kind: 'build',
            action: removing
              ? { kind: 'unlock', stakeAccount: account.address, secondKey }
              : { kind: 'extend', stakeAccount: account.address, secondKey, lockUntil },
            // F5: the second key pays when it can; a phone wallet then signs alone (UX rule 10).
            feePayer: canPayFee(balance, networkFeeFor(1), rent0) ? secondKey : account.withdrawer,
            before: account,
          };
        }
      });
      return { clock, jobs };
    },
  };
}

function isRefusal(reason: string): reason is ExtendRefusal {
  return (REFUSALS as readonly string[]).includes(reason);
}

/** The refusal in plain words; an unknown reason reads as an unknown error. */
export function extendRefusalText(reason: string): string {
  return isRefusal(reason) ? t(`extend.refused.${reason}`) : t('errors.unknown');
}
