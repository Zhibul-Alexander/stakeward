import { address, type Address } from '@solana/kit';
import {
  canPayFee,
  decodeStakeAccount,
  networkFeeFor,
  secondKeyChangeProblem,
  type ChangeSecondKeyAction,
  type NewSecondKeyViolation,
  type SecondKeyChangeProblem,
} from '@stakeward/core';
import { t } from '@/i18n';
import { LOCK_END_MARGIN_SECONDS } from '@/pages/protect/wizard';
import type { JobPlan, SigningPlan } from '@/signing/types';

/**
 * Why the plan will not hand the lock over (the Done screen says it with `secondKeyRefusalText`): the page's own rules,
 * or what core secondKeyChangeProblem finds against the chain.
 */
export type SecondKeyRefusal = 'not-found' | 'not-stake-account' | 'epoch-locked' | 'lock-ending' | SecondKeyChangeProblem;

/** The refusals said in the page's words; the rest are rules of the new key (`NewSecondKeyViolation`). */
type PageRefusal = Exclude<SecondKeyRefusal, NewSecondKeyViolation>;

const PAGE_REFUSALS: readonly PageRefusal[] = [
  'not-found',
  'not-stake-account',
  'epoch-locked',
  'lock-ending',
  'other-account',
  'not-locked',
  'not-current-second-key',
];

const KEY_RULES: readonly NewSecondKeyViolation[] = ['zero-key', 'main-key', 'staker', 'stake-account', 'current-second-key'];

/**
 * F7: SetLockupChecked signed by the second key K that holds the lock, handing it to the new second key K2, which signs
 * too; the lock keeps its end and epoch. K2 pays when it can (core canPayFee with two signatures' fee); otherwise the main
 * key pays and signs too, the F5 fallback of /extend, and the engine's fee check then checks the main key. K never pays:
 * it may be stolen and drained (the builder refuses it). Every round reads the account, the clock, K2's balance and the
 * minimum balance again. The first matching rule decides:
 * 1. no account -> not-found; 2. not a stake account -> not-stake-account; 3. an epoch holds the lock -> epoch-locked
 * (Stakeward only handles locks that end on a date, as on /extend); 4. K2 is K -> current-second-key (else rule 5 would
 * call it done); 5. K2 holds the lock already -> done; 6. core secondKeyChangeProblem: no lock in force, or one the main
 * key or no key holds -> not-locked; another key holds it -> not-current-second-key; K2 breaks a rule (the main key,
 * the staker, the stake account, the zero key) -> that rule; 7. the lock ends within LOCK_END_MARGIN_SECONDS of the
 * cluster clock -> lock-ending (it would end before the change lands, and then only the main key can set a lock);
 * 8. otherwise build.
 */
export function secondKeyPlan(input: { secondKey: Address; newSecondKey: Address }): SigningPlan {
  const { secondKey, newSecondKey } = input;
  return {
    async prepare(chain, ids) {
      const [{ accounts }, clock, balance, rent0] = await Promise.all([
        chain.getAccounts(ids.map((id) => address(id))),
        chain.getClock(),
        chain.getBalance(newSecondKey),
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
        const refuse = (reason: SecondKeyRefusal) => {
          jobs[id] = { kind: 'refused', reason, before: account };
        };
        const action: ChangeSecondKeyAction = { kind: 'change-second-key', stakeAccount: account.address, secondKey, newSecondKey };
        if (lockup.epoch > clock.epoch) {
          refuse('epoch-locked');
          return;
        }
        // Before the done rule: handing the lock to the key that has it would read as already done.
        if (newSecondKey === secondKey) {
          refuse('current-second-key');
          return;
        }
        if (lockup.custodian === newSecondKey) {
          jobs[id] = { kind: 'done', after: account };
          return;
        }
        const problem = secondKeyChangeProblem(action, account, clock);
        if (problem !== null) {
          refuse(problem);
        } else if (lockup.unixTimestamp <= clock.unixTimestamp + LOCK_END_MARGIN_SECONDS) {
          refuse('lock-ending');
        } else {
          jobs[id] = {
            kind: 'build',
            action,
            // The new second key pays when it can; the old one never does.
            feePayer: canPayFee(balance, networkFeeFor(2), rent0) ? newSecondKey : account.withdrawer,
            before: account,
          };
        }
      });
      return { clock, jobs };
    },
  };
}

function isPageRefusal(reason: string): reason is PageRefusal {
  return (PAGE_REFUSALS as readonly string[]).includes(reason);
}

function isKeyRule(reason: string): reason is NewSecondKeyViolation {
  return (KEY_RULES as readonly string[]).includes(reason);
}

/** What is wrong with a new second key, in the words of the step that connects it. */
export function newKeyProblemText(violation: NewSecondKeyViolation): string {
  return t(`secondKey.choose.problem.${violation}`);
}

/** The refusal in plain words; an unknown reason reads as an unknown error. */
export function secondKeyRefusalText(reason: string): string {
  if (isPageRefusal(reason)) return t(`secondKey.refused.${reason}`);
  if (isKeyRule(reason)) return newKeyProblemText(reason);
  return t('errors.unknown');
}
