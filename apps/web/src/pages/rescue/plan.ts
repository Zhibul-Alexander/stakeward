import { address, type Address } from '@solana/kit';
import { decodeStakeAccount, isLockupInForce, U64_MAX, ZERO_ADDRESS, type StakeAccount } from '@stakeward/core';
import { t } from '@/i18n';
import type { JobPlan, SigningPlan } from '@/signing/types';

/** Why the plan will not move an account to the new wallet (the Done screen says it with `rescueRefusalText`). */
export type RescueRefusal =
  | 'not-found'
  | 'not-stake-account'
  | 'not-main-key'
  | 'other-second-key'
  | 'unsupported-lock'
  | 'key-rule'
  | 'kit-not-locked';

/** Why the plan will not delegate a moved account again. */
export type DelegateRefusal = 'not-found' | 'not-stake-account' | 'not-new-wallet' | 'no-validator';

const REFUSALS: readonly (RescueRefusal | DelegateRefusal)[] = [
  'not-found',
  'not-stake-account',
  'not-main-key',
  'other-second-key',
  'unsupported-lock',
  'key-rule',
  'kit-not-locked',
  'not-new-wallet',
  'no-validator',
];

type Decoded = { kind: 'refused'; plan: JobPlan } | { kind: 'account'; account: StakeAccount };

/** The account of one id as read now, or the refusal for a missing or foreign account. */
function decodeOrRefuse(raw: Parameters<typeof decodeStakeAccount>[0] | null): Decoded {
  if (raw === null) return { kind: 'refused', plan: { kind: 'refused', reason: 'not-found', before: null } };
  const decoded = decodeStakeAccount(raw);
  if (!decoded.ok) return { kind: 'refused', plan: { kind: 'refused', reason: 'not-stake-account', before: null } };
  return { kind: 'account', account: decoded.account };
}

/**
 * F4 step 4: per stake account, AuthorizeChecked(Staker -> D) and AuthorizeChecked(Withdrawer -> D) in one transaction,
 * signed by the main key A, the new wallet D and the second key K; D pays (the compromised key never pays nor owns the
 * nonce). With every key in this browser it runs on a recent blockhash; with a key signing by link, on D's durable
 * nonce. Phantom on mainnet moves the compute budget in front of AdvanceNonceAccount when it signs first, and the
 * runtime then no longer sees a nonce transaction (D120). `remote` are the keys that sign on another device by link. Every round reads the accounts and the clock again; the first match decides:
 * 1. no account -> not-found (merged or closed); 2. not a stake account -> not-stake-account;
 * 3. both keys are D already -> done; 4. A no longer withdraws -> not-main-key;
 * 5. a lock in force held by A itself or by no key -> unsupported-lock; 6. one held by another key than K ->
 * other-second-key; 7. A, K, D and the account not all different -> key-rule; 8. otherwise build.
 * A staker a thief changed needs nothing special: A is still the withdrawer, and the program lets it name the staker.
 */
export function rescuePlan(input: {
  mainKey: Address;
  secondKey: Address;
  newWallet: Address;
  /** D's durable nonce; none when every key signs in this browser (D120). */
  nonce?: { nonceAccount: Address; nonceAuthority: Address } | undefined;
  remote: readonly Address[];
}): SigningPlan {
  const { mainKey, secondKey, newWallet, nonce, remote } = input;
  return {
    ...(nonce === undefined ? {} : { nonce }),
    remote,
    async prepare(chain, ids) {
      const addresses = ids.map((id) => address(id));
      const [{ accounts }, clock] = await Promise.all([chain.getAccounts(addresses), chain.getClock()]);
      const jobs: Record<string, JobPlan> = {};
      addresses.forEach((id, index) => {
        const read = decodeOrRefuse(accounts[index] ?? null);
        if (read.kind === 'refused') {
          jobs[id] = read.plan;
          return;
        }
        const { account } = read;
        const refuse = (reason: RescueRefusal) => {
          jobs[id] = { kind: 'refused', reason, before: account };
        };
        if (account.staker === newWallet && account.withdrawer === newWallet) {
          jobs[id] = { kind: 'done', after: account };
          return;
        }
        if (account.withdrawer !== mainKey) {
          refuse('not-main-key');
          return;
        }
        const inForce = isLockupInForce(account.lockup, clock);
        const custodian = account.lockup.custodian;
        if (inForce && (custodian === mainKey || custodian === ZERO_ADDRESS)) {
          refuse('unsupported-lock');
          return;
        }
        if (inForce && custodian !== secondKey) {
          refuse('other-second-key');
          return;
        }
        if (new Set([mainKey, secondKey, newWallet, id]).size !== 4) {
          refuse('key-rule');
          return;
        }
        jobs[id] = {
          kind: 'build',
          action: { kind: 'rescue', stakeAccount: id, mainKey, secondKey, newWallet },
          feePayer: newWallet,
          before: account,
        };
      });
      return { clock, jobs };
    },
  };
}

/**
 * One-tap rescue kit (D118) of one stake account: the rescue pair exactly as `rescuePlan` decides it, on the new wallet's
 * kit nonce (core `rescueKitNonceSeed`), signed here by all three keys and handed to `deliver` (the worker keeps it)
 * instead of the chain. Only for a lock in force: without one the kit could not stop a thief, and the worker refuses it.
 */
export function rescueKitPlan(input: {
  mainKey: Address;
  secondKey: Address;
  newWallet: Address;
  nonceAccount: Address;
  deliver: (bytes: Uint8Array) => Promise<void>;
}): SigningPlan {
  const { mainKey, secondKey, newWallet, nonceAccount, deliver } = input;
  const base = rescuePlan({ mainKey, secondKey, newWallet, nonce: { nonceAccount, nonceAuthority: newWallet }, remote: [] });
  return {
    nonce: base.nonce,
    deliver,
    async prepare(chain, ids) {
      const decided = await base.prepare(chain, ids);
      const jobs: Record<string, JobPlan> = { ...decided.jobs };
      for (const [id, job] of Object.entries(jobs)) {
        if (job.kind === 'build' && (job.before === null || !isLockupInForce(job.before.lockup, decided.clock))) {
          jobs[id] = { kind: 'refused', reason: 'kit-not-locked', before: job.before };
        }
      }
      return { clock: decided.clock, jobs };
    },
  };
}

/**
 * F4 step 6: delegate moved accounts that stopped staking to the same validator again, signed and paid by the new
 * wallet D on a recent blockhash, all in one request. Per account, the first match decides:
 * 1. no account -> not-found; not a stake account -> not-stake-account; 2. D does not manage staking -> not-new-wallet;
 * 3. never delegated -> no-validator; 4. staking (not deactivating) -> done; 5. otherwise build.
 */
export function delegatePlan(input: { newWallet: Address }): SigningPlan {
  const { newWallet } = input;
  return {
    async prepare(chain, ids) {
      const addresses = ids.map((id) => address(id));
      const [{ accounts }, clock] = await Promise.all([chain.getAccounts(addresses), chain.getClock()]);
      const jobs: Record<string, JobPlan> = {};
      addresses.forEach((id, index) => {
        const read = decodeOrRefuse(accounts[index] ?? null);
        if (read.kind === 'refused') {
          jobs[id] = read.plan;
          return;
        }
        const { account } = read;
        const { delegation } = account;
        if (account.staker !== newWallet) {
          jobs[id] = { kind: 'refused', reason: 'not-new-wallet', before: account };
        } else if (delegation === null) {
          jobs[id] = { kind: 'refused', reason: 'no-validator', before: account };
        } else if (delegation.deactivationEpoch === U64_MAX) {
          jobs[id] = { kind: 'done', after: account };
        } else {
          jobs[id] = {
            kind: 'build',
            action: { kind: 'delegate', stakeAccount: id, staker: newWallet, voteAccount: delegation.voter },
            feePayer: newWallet,
            before: account,
          };
        }
      });
      return { clock, jobs };
    },
  };
}

function isRefusal(reason: string): reason is RescueRefusal | DelegateRefusal {
  return (REFUSALS as readonly string[]).includes(reason);
}

/** The refusal in plain words; an unknown reason reads as an unknown error. */
export function rescueRefusalText(reason: string): string {
  return isRefusal(reason) ? t(`rescue.refused.${reason}`) : t('errors.unknown');
}
