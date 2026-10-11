import { address, type Address } from '@solana/kit';
import { decodeStakeAccount, stakeActivationStatus, type ClockView, type StakeAccount } from '@stakeward/core';
import { t } from '@/i18n';
import type { JobPlan, SigningPlan } from '@/signing/types';

/**
 * Where a stake account stands for delegating (DECISIONS.md D134): `ready` when it is inactive and the main key manages
 * staking; `earning` when it is already delegated (active or activating); `deactivating` until its epoch ends;
 * `service` when another key manages staking, so only that key can delegate it.
 */
export type DelegateStage = 'ready' | 'earning' | 'deactivating' | 'service';

export function delegateStage(account: StakeAccount, clock: ClockView): DelegateStage {
  const activation = stakeActivationStatus(account.delegation, clock.epoch);
  if (activation === 'active' || activation === 'activating') return 'earning';
  if (activation === 'deactivating') return 'deactivating';
  return account.staker === account.withdrawer ? 'ready' : 'service';
}

/** Why the plan will not delegate (the Done screen says it with `delegateRefusalText`). */
export type DelegateRefusal = 'not-found' | 'not-stake-account' | 'not-main-key' | 'not-inactive' | 'not-staker';

const REFUSALS: readonly DelegateRefusal[] = ['not-found', 'not-stake-account', 'not-main-key', 'not-inactive', 'not-staker'];

/**
 * DelegateStake of an inactive stake account to `voteAccount`, signed by the main key as the staker; it pays. The lock
 * does not matter: delegating moves no SOL. Every round reads the account and the clock again. The first matching rule
 * decides: 1. no account -> not-found; 2. not a stake account -> not-stake-account; 3. another main key ->
 * not-main-key; 4. already staking with this validator -> done; 5. not inactive -> not-inactive; 6. another key manages
 * staking -> not-staker; 7. otherwise build.
 */
export function delegatePlan(input: { mainKey: Address; voteAccount: Address }): SigningPlan {
  const { mainKey, voteAccount } = input;
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
        const refuse = (reason: DelegateRefusal) => {
          jobs[id] = { kind: 'refused', reason, before: account };
        };
        const stage = delegateStage(account, clock);
        if (account.withdrawer !== mainKey) {
          refuse('not-main-key');
        } else if (stage === 'earning' && account.delegation?.voter === voteAccount) {
          jobs[id] = { kind: 'done', after: account };
        } else if (stage === 'earning' || stage === 'deactivating') {
          refuse('not-inactive');
        } else if (stage === 'service') {
          refuse('not-staker');
        } else {
          jobs[id] = {
            kind: 'build',
            action: { kind: 'delegate', stakeAccount: account.address, staker: mainKey, voteAccount },
            feePayer: mainKey,
            before: account,
          };
        }
      });
      return { clock, jobs };
    },
  };
}

function isRefusal(reason: string): reason is DelegateRefusal {
  return (REFUSALS as readonly string[]).includes(reason);
}

/** The refusal in plain words; an unknown reason reads as an unknown error. */
export function delegateRefusalText(reason: string): string {
  return isRefusal(reason) ? t(`delegate.refused.${reason}`) : t('errors.unknown');
}
