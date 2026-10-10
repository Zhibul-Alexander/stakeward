import { address, type Address } from '@solana/kit';
import { decodeStakeAccount, isLockupInForce, ZERO_ADDRESS, type ClockView, type StakeAccount } from '@stakeward/core';
import { t } from '@/i18n';
import type { JobPlan, SigningPlan } from '@/signing/types';

/** Where a lock stands for a second key change (F7): held by a second key now, or not. */
export type ChangeKeyStage = 'ready' | 'not-locked';

/**
 * `ready` when a lock is in force and a second key holds it: only that key can hand the lock on. Otherwise
 * `not-locked`: no lock, or one held by the main key itself or by no key; the main key protects the stake instead.
 */
export function changeKeyStage(account: StakeAccount, clock: ClockView): ChangeKeyStage {
  const { lockup } = account;
  const held = lockup.custodian !== account.withdrawer && lockup.custodian !== ZERO_ADDRESS;
  return isLockupInForce(lockup, clock) && held ? 'ready' : 'not-locked';
}

/** Why a connected wallet cannot be the new second key of `account`. */
export type NewKeyProblem = 'is-second' | 'is-main' | 'is-staker' | 'is-stake-account';

/** The new second key must differ from every key the account names, and from the account itself (CLAUDE.md section 5). */
export function newKeyProblems(newKey: Address, account: StakeAccount): NewKeyProblem[] {
  const problems: NewKeyProblem[] = [];
  if (newKey === account.lockup.custodian) problems.push('is-second');
  if (newKey === account.withdrawer) problems.push('is-main');
  else if (newKey === account.staker) problems.push('is-staker');
  if (newKey === account.address) problems.push('is-stake-account');
  return problems;
}

/** Why the plan will not hand the lock on (the Done screen says it with `changeKeyRefusalText`). */
export type ChangeKeyRefusal = 'not-found' | 'not-stake-account' | 'not-locked' | 'other-second-key' | 'bad-new-key';

const REFUSALS: readonly ChangeKeyRefusal[] = ['not-found', 'not-stake-account', 'not-locked', 'other-second-key', 'bad-new-key'];

/**
 * F7: SetLockupChecked signed by the second key K that holds the lock, with `newKey` as the new custodian; the new key
 * co-signs and always pays (K may be stolen, CLAUDE.md section 5). The lock's end and epoch stay as they are. Every round
 * reads the account and the clock again. The first matching rule decides:
 * 1. no account -> not-found; 2. not a stake account -> not-stake-account; 3. the new key already holds a lock in force
 * -> done; 4. no lock in force, or one held by the main key itself or by no key -> not-locked; 5. another key holds it
 * -> other-second-key; 6. the new key is a key of the account -> bad-new-key; 7. otherwise build.
 */
export function changeKeyPlan(input: { secondKey: Address; newKey: Address }): SigningPlan {
  const { secondKey, newKey } = input;
  return {
    async prepare(chain, ids) {
      const [{ accounts }, clock] = await Promise.all([chain.getAccounts(ids.map((id) => address(id))), chain.getClock()]);
      const jobs: Record<string, JobPlan> = {};
      ids.forEach((id, index) => {
        const raw = accounts[index] ?? null;
        if (raw === null) {
          jobs[id] = { kind: 'refused', reason: 'not-found', before: null };
          return;
        }
        const result = decodeStakeAccount(raw);
        if (!result.ok) {
          jobs[id] = { kind: 'refused', reason: 'not-stake-account', before: null };
          return;
        }
        const { account } = result;
        const refuse = (reason: ChangeKeyRefusal) => {
          jobs[id] = { kind: 'refused', reason, before: account };
        };
        if (account.lockup.custodian === newKey && isLockupInForce(account.lockup, clock)) {
          jobs[id] = { kind: 'done', after: account };
        } else if (changeKeyStage(account, clock) !== 'ready') {
          refuse('not-locked');
        } else if (account.lockup.custodian !== secondKey) {
          refuse('other-second-key');
        } else if (newKeyProblems(newKey, account).length > 0) {
          refuse('bad-new-key');
        } else {
          jobs[id] = {
            kind: 'build',
            action: { kind: 'change-second-key', stakeAccount: account.address, secondKey, newWallet: newKey },
            feePayer: newKey,
            before: account,
          };
        }
      });
      return { clock, jobs };
    },
  };
}

function isRefusal(reason: string): reason is ChangeKeyRefusal {
  return (REFUSALS as readonly string[]).includes(reason);
}

/** The refusal in plain words; an unknown reason reads as an unknown error. */
export function changeKeyRefusalText(reason: string): string {
  return isRefusal(reason) ? t(`changeKey.refused.${reason}`) : t('errors.unknown');
}
