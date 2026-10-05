import { address, type Address } from '@solana/kit';
import { decodeStakeAccount, isLockupInForce, protectBlock, validateSecondKey } from '@stakeward/core';
import { t } from '@/i18n';
import type { JobPlan, SigningPlan } from '@/signing/types';
import { LOCK_END_MARGIN_SECONDS } from './wizard.ts';

/** Why the plan will not lock an account (the Done screen says it with `refusalText`). */
export type ProtectRefusal =
  | 'not-found'
  | 'not-stake-account'
  | 'not-main-key'
  | 'locked-by-other'
  | 'already-protected'
  | 'second-key-rule'
  | 'lock-end-passed';

const REFUSALS: readonly ProtectRefusal[] = [
  'not-found',
  'not-stake-account',
  'not-main-key',
  'locked-by-other',
  'already-protected',
  'second-key-rule',
  'lock-end-passed',
];

/**
 * F1 step 4: SetLockupChecked { unixTimestamp: T } per stake account, authority A, new second key K, fee paid by A.
 * Every round reads the accounts and the clock again (a link is never trusted, DECISIONS.md D36), so a retry after a
 * late landing finds the lock already there (`done`). The first matching rule decides each account:
 * 1. no account -> not-found; 2. not a stake account -> not-stake-account; 3. A cannot withdraw it -> not-main-key;
 * 4. the lock (K, T) is already in force -> done; 5. a lock held by another key -> already-protected (K, another T)
 * or locked-by-other; 6. K breaks a second-key rule -> second-key-rule; 7. T within LOCK_END_MARGIN_SECONDS of the
 * cluster clock -> lock-end-passed; 8. otherwise build.
 */
export function protectPlan(input: { mainKey: Address; secondKey: Address; lockUntil: bigint }): SigningPlan {
  const { mainKey, secondKey, lockUntil } = input;
  return {
    async prepare(chain, ids) {
      const addresses = ids.map((id) => address(id));
      const [{ accounts }, clock] = await Promise.all([chain.getAccounts(addresses), chain.getClock()]);
      const jobs: Record<string, JobPlan> = {};
      addresses.forEach((id, index) => {
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
        const account = decoded.account;
        const refuse = (reason: ProtectRefusal) => {
          jobs[id] = { kind: 'refused', reason, before: account };
        };
        if (account.withdrawer !== mainKey) {
          refuse('not-main-key');
          return;
        }
        const { lockup } = account;
        if (isLockupInForce(lockup, clock) && lockup.custodian === secondKey && lockup.unixTimestamp === lockUntil) {
          jobs[id] = { kind: 'done', after: account };
          return;
        }
        const block = protectBlock(account, mainKey, [secondKey], clock);
        if (block === 'already-protected' || block === 'locked-by-other') {
          refuse(block);
          return;
        }
        if (validateSecondKey({ second: secondKey, mainKey, staker: account.staker, stakeAccount: id }).length > 0) {
          refuse('second-key-rule');
          return;
        }
        if (lockUntil <= clock.unixTimestamp + LOCK_END_MARGIN_SECONDS) {
          refuse('lock-end-passed');
          return;
        }
        jobs[id] = {
          kind: 'build',
          action: { kind: 'protect', stakeAccount: id, mainKey, secondKey, lockUntil },
          feePayer: mainKey,
          before: account,
        };
      });
      return { clock, jobs };
    },
  };
}

function isRefusal(reason: string): reason is ProtectRefusal {
  return (REFUSALS as readonly string[]).includes(reason);
}

/** The refusal in plain words; an unknown reason reads as an unknown error. */
export function refusalText(reason: string): string {
  return isRefusal(reason) ? t(`protect.refused.${reason}`) : t('errors.unknown');
}
