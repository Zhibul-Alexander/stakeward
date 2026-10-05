import { address, type Address } from '@solana/kit';
import {
  actionApplied,
  decodeStakeAccount,
  isLockupInForce,
  stakeActivationStatus,
  type ChainClock,
  type ChainPort,
  type DeactivateAction,
  type RawAccount,
  type StakeAccount,
} from '@stakeward/core';
import { t } from '@/i18n';
import type { JobPlan, SigningPlan } from '@/signing/types';
import { lockHeldByNoSecondKey } from './stage.ts';

/** Why the plan will not withdraw or deactivate an account (the Done screen says it with `withdrawRefusalText`). */
export type WithdrawRefusal =
  | 'not-found'
  | 'not-stake-account'
  | 'not-main-key'
  | 'not-inactive'
  | 'unsupported-lock'
  | 'not-active'
  | 'not-staker';

const REFUSALS: readonly WithdrawRefusal[] = [
  'not-found',
  'not-stake-account',
  'not-main-key',
  'not-inactive',
  'unsupported-lock',
  'not-active',
  'not-staker',
];

/** One job's fresh read: refused when the account is gone, is not a stake account or has another main key. */
type Read = { kind: 'refused'; plan: JobPlan } | { kind: 'account'; raw: RawAccount; account: StakeAccount };

/**
 * Every round reads the accounts and the clock again (one call each); a page's earlier read is never trusted (D36).
 * Rules 1 to 3 of both plans: no account -> not-found; not a stake account -> not-stake-account; another main key ->
 * not-main-key.
 */
async function readAccounts(
  chain: ChainPort,
  ids: readonly string[],
  mainKey: Address,
): Promise<{ clock: ChainClock; reads: [string, Read][] }> {
  const [{ accounts }, clock] = await Promise.all([chain.getAccounts(ids.map((id) => address(id))), chain.getClock()]);
  const reads = ids.map((id, index): [string, Read] => {
    const raw = accounts[index] ?? null;
    if (raw === null) return [id, { kind: 'refused', plan: { kind: 'refused', reason: 'not-found', before: null } }];
    const decoded = decodeStakeAccount(raw);
    if (!decoded.ok) return [id, { kind: 'refused', plan: { kind: 'refused', reason: 'not-stake-account', before: null } }];
    const { account } = decoded;
    if (account.withdrawer !== mainKey) {
      return [id, { kind: 'refused', plan: { kind: 'refused', reason: 'not-main-key', before: account } }];
    }
    return [id, { kind: 'account', raw, account }];
  });
  return { clock, reads };
}

/**
 * F3 step 2: Withdraw the whole balance to the main key, signed by the main key and, while the lock is in force, by its
 * second key; the main key pays. There is no amount and no recipient to choose. The first matching rule decides:
 * 1-3. see `readAccounts` (a landed withdrawal is caught by the engine's landed check before this);
 * 4. not inactive (by epochs) -> not-inactive; 5. a lock held by the main key itself or by no key -> unsupported-lock;
 * 6. otherwise build. The simulation is the real check: a stake still cooling down network-wide fails it with
 *    insufficient funds, whose text says to wait.
 */
export function withdrawPlan(input: { mainKey: Address }): SigningPlan {
  const { mainKey } = input;
  return {
    async prepare(chain, ids) {
      const { clock, reads } = await readAccounts(chain, ids, mainKey);
      const jobs: Record<string, JobPlan> = {};
      for (const [id, read] of reads) {
        if (read.kind === 'refused') {
          jobs[id] = read.plan;
          continue;
        }
        const { account } = read;
        if (stakeActivationStatus(account.delegation, clock.epoch) !== 'inactive') {
          jobs[id] = { kind: 'refused', reason: 'not-inactive', before: account };
        } else if (lockHeldByNoSecondKey(account, clock)) {
          jobs[id] = { kind: 'refused', reason: 'unsupported-lock', before: account };
        } else {
          jobs[id] = {
            kind: 'build',
            action: {
              kind: 'withdraw',
              stakeAccount: account.address,
              mainKey,
              secondKey: isLockupInForce(account.lockup, clock) ? account.lockup.custodian : null,
              recipient: mainKey,
              lamports: account.lamports,
            },
            feePayer: mainKey,
            before: account,
          };
        }
      }
      return { clock, jobs };
    },
  };
}

/**
 * F3 step 1: Deactivate, signed by the main key as the staker; it pays. The lock does not matter. The first matching
 * rule decides: 1-3. see `readAccounts`; 4. the account already shows a deactivation -> done;
 * 5. not active or activating -> not-active; 6. another key manages staking -> not-staker; 7. otherwise build.
 */
export function deactivatePlan(input: { mainKey: Address }): SigningPlan {
  const { mainKey } = input;
  return {
    async prepare(chain, ids) {
      const { clock, reads } = await readAccounts(chain, ids, mainKey);
      const jobs: Record<string, JobPlan> = {};
      for (const [id, read] of reads) {
        if (read.kind === 'refused') {
          jobs[id] = read.plan;
          continue;
        }
        const { raw, account } = read;
        const action: DeactivateAction = { kind: 'deactivate', stakeAccount: account.address, staker: mainKey };
        const activation = stakeActivationStatus(account.delegation, clock.epoch);
        if (actionApplied(action, raw, account)) {
          jobs[id] = { kind: 'done', after: account };
        } else if (activation !== 'active' && activation !== 'activating') {
          jobs[id] = { kind: 'refused', reason: 'not-active', before: account };
        } else if (account.staker !== mainKey) {
          jobs[id] = { kind: 'refused', reason: 'not-staker', before: account };
        } else {
          jobs[id] = { kind: 'build', action, feePayer: mainKey, before: account };
        }
      }
      return { clock, jobs };
    },
  };
}

function isRefusal(reason: string): reason is WithdrawRefusal {
  return (REFUSALS as readonly string[]).includes(reason);
}

/** The refusal in plain words; an unknown reason reads as an unknown error. */
export function withdrawRefusalText(reason: string): string {
  return isRefusal(reason) ? t(`withdraw.refused.${reason}`) : t('errors.unknown');
}
