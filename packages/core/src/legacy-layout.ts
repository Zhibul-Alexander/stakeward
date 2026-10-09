import {
  AccountRole,
  type AccountMeta,
  type Address,
  type Instruction,
  type InstructionWithAccounts,
  type InstructionWithData,
  type ReadonlyUint8Array,
} from '@solana/kit';
import { StakeInstruction } from '@solana-program/stake';
import { STAKE_CONFIG_ADDRESS, SYSVAR_CLOCK_ADDRESS, SYSVAR_STAKE_HISTORY_ADDRESS } from './constants.ts';

/**
 * Legacy (Ledger-parsable) account layouts, DECISIONS.md D1.
 *
 * `@solana-program/stake` 0.10.0 emits the new layout without sysvar accounts. Ledger clear-signs Withdraw,
 * AuthorizeChecked, Deactivate and DelegateStake only in the legacy layout, where read-only sysvars sit at fixed
 * positions; with the new layout it falls back to blind signing or, for AuthorizeChecked with a custodian, shows the
 * wrong keys. The on-chain program accepts both. Stakeward emits the legacy layout for these four instructions;
 * SetLockup and SetLockupChecked are the same in both layouts.
 */
export type StakeIx = Instruction & InstructionWithAccounts<readonly AccountMeta[]> & InstructionWithData<ReadonlyUint8Array>;

/** Insert `sysvars` (read-only) before account index `at` of the generated instruction. */
export type LegacySysvarSlot = { readonly at: number; readonly sysvars: readonly Address[] };

/**
 * Where each legacy layout differs from the generated one. The inspector uses the same table to check that the
 * sysvars are exactly there and to strip them before `parseStakeInstruction`.
 * - Withdraw: stake, recipient, Clock, StakeHistory, withdrawAuthority, [custodian]
 * - AuthorizeChecked: stake, Clock, authority, newAuthority, [custodian]
 * - Deactivate: stake, Clock, stakeAuthority
 * - DelegateStake: stake, vote, Clock, StakeHistory, StakeConfig, stakeAuthority
 */
export const LEGACY_SYSVAR_SLOTS: Readonly<Partial<Record<StakeInstruction, LegacySysvarSlot>>> = {
  [StakeInstruction.Withdraw]: { at: 2, sysvars: [SYSVAR_CLOCK_ADDRESS, SYSVAR_STAKE_HISTORY_ADDRESS] },
  [StakeInstruction.AuthorizeChecked]: { at: 1, sysvars: [SYSVAR_CLOCK_ADDRESS] },
  [StakeInstruction.Deactivate]: { at: 1, sysvars: [SYSVAR_CLOCK_ADDRESS] },
  [StakeInstruction.DelegateStake]: {
    at: 2,
    sysvars: [SYSVAR_CLOCK_ADDRESS, SYSVAR_STAKE_HISTORY_ADDRESS, STAKE_CONFIG_ADDRESS],
  },
};

/** Returns a copy of a generated stake instruction with the legacy sysvar accounts inserted. */
export function toLegacyLayout(instruction: StakeIx, slot: LegacySysvarSlot): StakeIx {
  const accounts = [...instruction.accounts];
  accounts.splice(slot.at, 0, ...slot.sysvars.map((address) => ({ address, role: AccountRole.READONLY })));
  return Object.freeze({ ...instruction, accounts: Object.freeze(accounts) });
}
