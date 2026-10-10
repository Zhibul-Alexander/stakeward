import type { Address } from '@solana/kit';
import type { TransactionAction } from './actions.ts';
import { U64_MAX } from './constants.ts';
import { decodeStakeAccount, type Lockup, type RawAccount, type StakeAccount } from './decode.ts';
import { readNonceAccount } from './nonce.ts';

/**
 * "Did the chain take the change?" (CLAUDE.md section 12: nothing counts as done on a wallet's or RPC's answer alone).
 * `after` = the target account (see `actionTarget`) read after sending, null when it does not exist. `before` = the
 * stake account read before building, null when unknown. Pure.
 *
 * Stake kinds decode `after`; an account that does not decode is not applied, except where a rule accepts a closed
 * account:
 * - protect: the main key still withdraws, the second key holds the lock, and the lock ends at `lockUntil`.
 * - extend: the second key holds the lock and it ends at `lockUntil`. unlock: the lock timestamp is 0.
 * - withdraw: the account is closed, or it lost at least `lamports` since `before` (unknowable without `before`).
 * - deactivate: a delegation that is being deactivated. delegate: delegated to `voteAccount`, not deactivating.
 * - change-second-key: the new second key holds the lock, and its end and epoch are unchanged since `before` (when
 *   known).
 * - rescue: the new wallet is both staker and withdrawer, and the lockup is unchanged since `before` (when known).
 * - nonce-setup: a ready nonce account of `nonceAuthority`. nonce-close: the account is closed (or empty).
 * An `after` or `before` read of another account than the target is never proof (callers match reads by position).
 */
export function actionApplied(action: TransactionAction, after: RawAccount | null, before: StakeAccount | null): boolean {
  const target = actionTarget(action);
  if ((after !== null && after.address !== target) || (before !== null && before.address !== target)) return false;
  const account = after === null ? null : decoded(after);
  const delegation = account?.delegation ?? null;
  switch (action.kind) {
    case 'protect':
      return (
        account !== null &&
        account.withdrawer === action.mainKey &&
        account.lockup.custodian === action.secondKey &&
        account.lockup.unixTimestamp === action.lockUntil
      );
    case 'extend':
      return (
        account !== null &&
        account.lockup.custodian === action.secondKey &&
        account.lockup.unixTimestamp === action.lockUntil
      );
    case 'unlock':
      return account !== null && account.lockup.unixTimestamp === 0n;
    case 'withdraw':
      return (
        after === null ||
        (account !== null && before !== null && account.lamports <= before.lamports - action.lamports)
      );
    case 'deactivate':
      return delegation !== null && delegation.deactivationEpoch !== U64_MAX;
    case 'delegate':
      return delegation?.voter === action.voteAccount && delegation.deactivationEpoch === U64_MAX;
    case 'rescue':
      return (
        account !== null &&
        account.staker === action.newWallet &&
        account.withdrawer === action.newWallet &&
        (before === null || sameLockup(account.lockup, before.lockup))
      );
    case 'change-second-key':
      return (
        account !== null &&
        account.lockup.custodian === action.newWallet &&
        (before === null ||
          (account.lockup.unixTimestamp === before.lockup.unixTimestamp && account.lockup.epoch === before.lockup.epoch))
      );
    case 'nonce-setup':
      return readNonceAccount(after, action.nonceAuthority).kind === 'ready';
    case 'nonce-close':
      return after === null || after.lamports === 0n;
  }
}

/** The account `actionApplied` reads: the stake account, or the nonce account for the nonce kinds. */
export function actionTarget(action: TransactionAction): Address {
  return action.kind === 'nonce-setup' || action.kind === 'nonce-close' ? action.nonceAccount : action.stakeAccount;
}

function sameLockup(a: Lockup, b: Lockup): boolean {
  return a.unixTimestamp === b.unixTimestamp && a.epoch === b.epoch && a.custodian === b.custodian;
}

function decoded(raw: RawAccount): StakeAccount | null {
  const result = decodeStakeAccount(raw);
  return result.ok ? result.account : null;
}
