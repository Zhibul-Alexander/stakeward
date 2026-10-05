import type { Address, Blockhash, Nonce } from '@solana/kit';
import type { WalletRole } from './ports.ts';

/**
 * The shared vocabulary of the builders and the inspector: what a Stakeward transaction does.
 * `buildTransaction(action)` produces bytes; `inspectTransaction(bytes)` must give back the same action.
 * Key roles use the UI names (CLAUDE.md section 9): main key A, second key K, new wallet D.
 */
export type TransactionKind =
  | 'protect'
  | 'extend'
  | 'unlock'
  | 'withdraw'
  | 'deactivate'
  | 'delegate'
  | 'rescue'
  | 'nonce-setup'
  | 'nonce-close';

/**
 * F1. SetLockupChecked signed by the main key A (withdrawer) with the second key K as new custodian; K co-signs.
 * Sets the lockup unix timestamp to `lockUntil`; the lockup epoch is left unchanged (it is 0 on normal accounts).
 */
export type ProtectAction = {
  kind: 'protect';
  stakeAccount: Address;
  mainKey: Address;
  secondKey: Address;
  /** Lockup end T, unix seconds. */
  lockUntil: bigint;
};

/** F5. SetLockup signed by the custodian K: new lockup end `lockUntil` (> 0); epoch and custodian unchanged. */
export type ExtendAction = {
  kind: 'extend';
  stakeAccount: Address;
  secondKey: Address;
  lockUntil: bigint;
};

/** F5. SetLockup signed by the custodian K with unix timestamp 0: lifts the lock early. */
export type UnlockAction = {
  kind: 'unlock';
  stakeAccount: Address;
  secondKey: Address;
};

/**
 * F3. Withdraw `lamports` to `recipient`, signed by the withdrawer A and by the custodian K while the lock is in
 * force. `secondKey: null` builds a Withdraw without a custodian (after the lock ended or was lifted).
 */
export type WithdrawAction = {
  kind: 'withdraw';
  stakeAccount: Address;
  mainKey: Address;
  secondKey: Address | null;
  recipient: Address;
  lamports: bigint;
};

/** F3. Deactivate, signed by the staker. The lock does not affect it. */
export type DeactivateAction = {
  kind: 'deactivate';
  stakeAccount: Address;
  staker: Address;
};

/** F4 step 6. DelegateStake to `voteAccount`, signed by the staker. */
export type DelegateAction = {
  kind: 'delegate';
  stakeAccount: Address;
  staker: Address;
  voteAccount: Address;
};

/**
 * F4. AuthorizeChecked(Staker -> D) signed by A and D, then AuthorizeChecked(Withdrawer -> D) signed by A, D and the
 * custodian K. Both authorities move to the new wallet D; the lockup stays as it is.
 */
export type RescueAction = {
  kind: 'rescue';
  stakeAccount: Address;
  mainKey: Address;
  secondKey: Address;
  newWallet: Address;
};

/**
 * Creates a durable nonce account with System CreateAccountWithSeed (base = `nonceAuthority`, which pays and signs)
 * and initializes it with `nonceAuthority` as its authority. `nonceAccount` must equal
 * `deriveNonceAccountAddress(nonceAuthority, seed)`; no extra keypair is involved.
 */
export type NonceSetupAction = {
  kind: 'nonce-setup';
  nonceAccount: Address;
  nonceAuthority: Address;
  /** Address-derivation seed, always `NONCE_ACCOUNT_SEED` (a plain label, not a key); the builder refuses others. */
  seed: string;
  /** Rent-exempt deposit for 80 bytes, returned when the account is closed. */
  lamports: bigint;
};

/** Closes the nonce account: WithdrawNonceAccount of its whole balance to `recipient`, signed by its authority. */
export type NonceCloseAction = {
  kind: 'nonce-close';
  nonceAccount: Address;
  nonceAuthority: Address;
  recipient: Address;
  lamports: bigint;
};

export type TransactionAction =
  | ProtectAction
  | ExtendAction
  | UnlockAction
  | WithdrawAction
  | DeactivateAction
  | DelegateAction
  | RescueAction
  | NonceSetupAction
  | NonceCloseAction;

/** Live signing: a recent blockhash. `lastValidBlockHeight` is not part of the bytes; it tells when to give up. */
export type BlockhashLifetime = { kind: 'blockhash'; blockhash: Blockhash; lastValidBlockHeight: bigint };

/**
 * Signing by link: a durable nonce. The transaction starts with AdvanceNonceAccount, which `nonceAuthority` signs.
 * `nonceValue` is the value currently stored in the nonce account.
 */
export type NonceLifetime = { kind: 'nonce'; nonceAccount: Address; nonceAuthority: Address; nonceValue: Nonce };

export type Lifetime = BlockhashLifetime | NonceLifetime;

/**
 * Who pays the network fee (CLAUDE.md section 5). A possibly compromised key never pays and never owns the nonce
 * account: a sweeper bot drains it and a thief could advance the nonce.
 * - protect, withdraw: the main key.
 * - extend, unlock: the second key. Fallback allowed by F5: when K has no SOL the main key pays and co-signs; the
 *   caller then passes the main key as fee payer explicitly.
 * - deactivate, delegate: the staker who signs it.
 * - rescue: the new wallet D, never the main key; the builder refuses any other fee payer, and a nonce account that
 *   D does not own.
 * - nonce setup and close: the nonce authority.
 */
export function expectedFeePayer(action: TransactionAction): Address {
  switch (action.kind) {
    case 'protect':
    case 'withdraw':
      return action.mainKey;
    case 'extend':
    case 'unlock':
      return action.secondKey;
    case 'deactivate':
    case 'delegate':
      return action.staker;
    case 'rescue':
      return action.newWallet;
    case 'nonce-setup':
    case 'nonce-close':
      return action.nonceAuthority;
  }
}

/**
 * Roles the action itself names: mainKey -> main, secondKey (when not null) -> second, newWallet -> new. Other keys
 * (a staker, a nonce authority, a recipient) have no role of their own; the page knows whose they are.
 */
export function actionRoles(action: TransactionAction): Partial<Record<WalletRole, Address>> {
  const roles: Partial<Record<WalletRole, Address>> = {};
  if ('mainKey' in action) roles.main = action.mainKey;
  if ('secondKey' in action && action.secondKey !== null) roles.second = action.secondKey;
  if ('newWallet' in action) roles.new = action.newWallet;
  return roles;
}
