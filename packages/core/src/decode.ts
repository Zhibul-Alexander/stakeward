import type { Address, ReadonlyUint8Array } from '@solana/kit';
import { getStakeStateAccountDecoder, getStakeStateAccountEncoder, type StakeStateV2Args } from '@solana-program/stake';
import { STAKE_ACCOUNT_SIZE, STAKE_PROGRAM_ADDRESS } from './constants.ts';

/** Lockup of a stake account. Values are raw chain values (seconds, epochs). */
export type Lockup = {
  /** i64 unix seconds; the lockup is in force while it is later than the cluster clock. */
  unixTimestamp: bigint;
  /** u64 epoch; the lockup is in force while it is later than the current epoch. */
  epoch: bigint;
  /** The lockup authority (CLAUDE.md "second key"). The all-zero key when unset. */
  custodian: Address;
};

export type Delegation = {
  voter: Address;
  /** Delegated lamports. */
  stake: bigint;
  activationEpoch: bigint;
  /** u64::MAX while the stake is not being deactivated. */
  deactivationEpoch: bigint;
};

/** Typed view of a stake account; only the fields Stakeward uses. */
export type StakeAccount = {
  address: Address;
  /** Total balance of the account (rent reserve + delegated + undelegated lamports). */
  lamports: bigint;
  /** `delegated` means the account holds a delegation record (StakeStateV2::Stake), active or not. */
  kind: 'initialized' | 'delegated';
  rentExemptReserve: bigint;
  staker: Address;
  withdrawer: Address;
  lockup: Lockup;
  delegation: Delegation | null;
};

/** Raw account as read from the chain (RPC getAccountInfo / getMultipleAccounts with base64, or LiteSVM). */
export type RawAccount = {
  address: Address;
  data: ReadonlyUint8Array;
  lamports: bigint;
  /** Owner program. */
  owner: Address;
};

/**
 * Why bytes were not accepted as a stake account Stakeward can work with.
 * `uninitialized` and `rewards-pool` are real stake program states without authorities.
 */
export type DecodeError = 'wrong-owner' | 'wrong-size' | 'malformed' | 'uninitialized' | 'rewards-pool';

export type DecodeResult = { ok: true; account: StakeAccount } | { ok: false; error: DecodeError };

/** Size in bytes of the Clock sysvar account data. */
export const CLOCK_SYSVAR_SIZE = 40;

/**
 * Clock sysvar: u64 slot @0, i64 epoch_start @8, u64 epoch @16, u64 leader_schedule_epoch @24, i64 unix_timestamp @32
 * (little endian). Returns null when `data` is shorter than 40 bytes; the owner is the caller's to check.
 */
export function decodeClockSysvar(data: ReadonlyUint8Array): { slot: bigint; epoch: bigint; unixTimestamp: bigint } | null {
  if (data.length < CLOCK_SYSVAR_SIZE) return null;
  const view = new DataView(data.buffer, data.byteOffset, CLOCK_SYSVAR_SIZE);
  return {
    slot: view.getBigUint64(0, true),
    epoch: view.getBigUint64(16, true),
    unixTimestamp: view.getBigInt64(32, true),
  };
}

/** Built once: the worker decodes up to hundreds of accounts per request, and building the decoder costs more. */
const stakeStateAccountDecoder = /* @__PURE__ */ getStakeStateAccountDecoder();

/**
 * Decodes a stake account with the generated stake client. Checks the owner and the 200-byte size first,
 * because the generated decoder checks neither (it decodes any bytes as a stake account).
 */
export function decodeStakeAccount(raw: RawAccount): DecodeResult {
  if (raw.owner !== STAKE_PROGRAM_ADDRESS) return { ok: false, error: 'wrong-owner' };
  if (raw.data.length !== STAKE_ACCOUNT_SIZE) return { ok: false, error: 'wrong-size' };

  let state;
  try {
    state = stakeStateAccountDecoder.decode(raw.data).state;
  } catch {
    return { ok: false, error: 'malformed' };
  }

  switch (state.__kind) {
    case 'Uninitialized':
      return { ok: false, error: 'uninitialized' };
    case 'RewardsPool':
      return { ok: false, error: 'rewards-pool' };
    case 'Initialized':
    case 'Stake': {
      const [meta] = state.fields;
      const delegation =
        state.__kind === 'Stake'
          ? {
              voter: state.fields[1].delegation.voterPubkey,
              stake: state.fields[1].delegation.stake,
              activationEpoch: state.fields[1].delegation.activationEpoch,
              deactivationEpoch: state.fields[1].delegation.deactivationEpoch,
            }
          : null;
      return {
        ok: true,
        account: {
          address: raw.address,
          lamports: raw.lamports,
          kind: delegation === null ? 'initialized' : 'delegated',
          rentExemptReserve: meta.rentExemptReserve,
          staker: meta.authorized.staker,
          withdrawer: meta.authorized.withdrawer,
          lockup: {
            unixTimestamp: meta.lockup.unixTimestamp,
            epoch: meta.lockup.epoch,
            custodian: meta.lockup.custodian,
          },
          delegation,
        },
      };
    }
  }
}

/** Built once, like the decoder. Bundles that never encode (the site) drop it. */
const stakeStateAccountEncoder = /* @__PURE__ */ getStakeStateAccountEncoder();

/** The fields of a stake account that live in its data. */
export type StakeAccountData = Pick<StakeAccount, 'rentExemptReserve' | 'staker' | 'withdrawer' | 'lockup' | 'delegation'>;

/**
 * The 200 data bytes of a stake account, written with the generated stake client: Initialized without a delegation,
 * Stake with one. `decodeStakeAccount` reads the same fields back. What Stakeward never reads is zero: the deprecated
 * warmup rate, credits_observed and the stake flags. For synthetic accounts (the worker's warm-up); no transaction
 * carries these bytes.
 */
export function encodeStakeAccountData(account: StakeAccountData): Uint8Array {
  const meta = {
    rentExemptReserve: account.rentExemptReserve,
    authorized: { staker: account.staker, withdrawer: account.withdrawer },
    lockup: account.lockup,
  };
  const { delegation } = account;
  const state: StakeStateV2Args =
    delegation === null
      ? { __kind: 'Initialized', fields: [meta] }
      : {
          __kind: 'Stake',
          fields: [
            meta,
            {
              delegation: {
                voterPubkey: delegation.voter,
                stake: delegation.stake,
                activationEpoch: delegation.activationEpoch,
                deactivationEpoch: delegation.deactivationEpoch,
                reserved: new Array<number>(8).fill(0),
              },
              creditsObserved: 0n,
            },
            { bits: 0 },
          ],
        };
  const data = new Uint8Array(STAKE_ACCOUNT_SIZE);
  data.set(stakeStateAccountEncoder.encode({ state }));
  return data;
}
