// Stake accounts and D1 rows for the monitor tests: real 200-byte account data (test/transactions.ts) decoded by core.
import type { Address } from '@solana/kit';
import { decodeStakeAccount, STAKE_PROGRAM_ADDRESS, type StakeAccount } from '@stakeward/core';
import { encodeBase64 } from '../../src/base64.ts';
import type { AccountRow, WatchRow } from '../../src/monitor/store.ts';
import { stakeAccountData, type StakeAccountSpec } from '../transactions.ts';

export type TestStake = { account: StakeAccount; data: Uint8Array; dataBase64: string; lamports: bigint };

/** A stake account built from `spec` and decoded with core, plus its raw data. */
export function testStake(address: Address, spec: StakeAccountSpec, lamports = 10_000_000_000n): TestStake {
  const data = stakeAccountData(spec);
  const decoded = decodeStakeAccount({ address, data, lamports, owner: STAKE_PROGRAM_ADDRESS });
  if (!decoded.ok) throw new Error(`test stake account does not decode: ${decoded.error}`);
  return { account: decoded.account, data, dataBase64: encodeBase64(data), lamports };
}

/** The row PAGE returns for a stored WatchRow. */
export function accountRowOf(row: WatchRow): AccountRow {
  return {
    stake_account: row.stakeAccount,
    withdrawer: row.withdrawer,
    staker: row.staker,
    custodian: row.custodian,
    lock_until: row.lockUntil,
    lamports: row.lamports,
    state: row.state,
    voter: row.voter,
    activation_epoch: row.activationEpoch,
    deactivation_epoch: row.deactivationEpoch,
    slot: row.slot,
    checked_at: row.checkedAt,
    last_reminder_days: row.lastReminderDays,
    fingerprint: row.fingerprint,
  };
}
