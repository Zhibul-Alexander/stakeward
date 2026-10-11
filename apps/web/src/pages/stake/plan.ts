import { address, type Address } from '@solana/kit';
import { decodeStakeAccount, U64_MAX } from '@stakeward/core';
import { t } from '@/i18n';
import type { JobPlan, SigningPlan } from '@/signing/types';

/** Smallest amount /stake offers to stake. The network may ask for more (its minimum delegation); simulation tells. */
export const MIN_STAKE_LAMPORTS = 10_000_000n;

/** Left in the wallet by "Max": fees for this transaction and the next few (protect, unstake). */
export const FEE_RESERVE_LAMPORTS = 10_000_000n;

const DECIMALS = 9;

/** "1.5" -> 1 500 000 000 lamports. Null for anything that is not a plain positive number with up to 9 decimals. */
export function parseSolAmount(text: string): bigint | null {
  const match = /^(\d+)(?:[.,](\d*))?$/.exec(text.trim());
  if (match === null) return null;
  const [, whole = '', fraction = ''] = match;
  if (fraction.length > DECIMALS) return null;
  const lamports = BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(DECIMALS, '0') || '0');
  return lamports > 0n ? lamports : null;
}

/** Lamports as a SOL number for the amount field: no unit, no grouping, no trailing zeros ("1.5"). */
export function solInputText(lamports: bigint): string {
  const whole = lamports / 1_000_000_000n;
  const fraction = (lamports % 1_000_000_000n).toString().padStart(DECIMALS, '0').replace(/0+$/, '');
  return fraction === '' ? whole.toString() : `${whole.toString()}.${fraction}`;
}

/** Why the plan will not create the account (the Done screen says it with `stakeRefusalText`). */
export type StakeRefusal = 'exists';

/**
 * Create-and-delegate of a new stake account (D139): `stakeAccount` is derived from the main key and `seed`, which are
 * fixed for the run. Every round reads it again: no account -> build (the main key signs and pays, moving `lamports`
 * into it); an account of this main key delegated to `voteAccount` -> done (a late landing); anything else at that
 * address -> refused.
 */
export function createStakePlan(input: {
  mainKey: Address;
  stakeAccount: Address;
  seed: string;
  lamports: bigint;
  voteAccount: Address;
}): SigningPlan {
  const { mainKey, stakeAccount, seed, lamports, voteAccount } = input;
  return {
    async prepare(chain, ids) {
      const [{ accounts }, clock] = await Promise.all([chain.getAccounts(ids.map((id) => address(id))), chain.getClock()]);
      const jobs: Record<string, JobPlan> = {};
      ids.forEach((id, index) => {
        const raw = accounts[index] ?? null;
        if (id !== stakeAccount) {
          jobs[id] = { kind: 'refused', reason: 'exists', before: null };
          return;
        }
        if (raw === null) {
          jobs[id] = {
            kind: 'build',
            action: { kind: 'create-stake', stakeAccount, mainKey, seed, lamports, voteAccount },
            feePayer: mainKey,
            before: null,
          };
          return;
        }
        const result = decodeStakeAccount(raw);
        const account = result.ok ? result.account : null;
        if (
          account !== null &&
          account.withdrawer === mainKey &&
          account.delegation?.voter === voteAccount &&
          account.delegation.deactivationEpoch === U64_MAX
        ) {
          jobs[id] = { kind: 'done', after: account };
        } else {
          jobs[id] = { kind: 'refused', reason: 'exists', before: account };
        }
      });
      return { clock, jobs };
    },
  };
}

/** The refusal in plain words; an unknown reason reads as an unknown error. */
export function stakeRefusalText(reason: string): string {
  return reason === 'exists' ? t('stake.refused.exists') : t('errors.unknown');
}
