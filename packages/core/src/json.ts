import { isAddress, type Address } from '@solana/kit';
import { I64_MAX, U64_MAX } from './constants.ts';
import type { StakeAccount } from './decode.ts';

/**
 * JSON shape of GET /api/stake-accounts, shared by the worker (writes it) and the site (reads it). Every u64 and i64
 * is a decimal string: JSON numbers lose precision above 2^53 (large balances, the u64::MAX deactivation epoch).
 */
export type StakeAccountJson = {
  address: string;
  lamports: string;
  kind: 'initialized' | 'delegated';
  rentExemptReserve: string;
  staker: string;
  withdrawer: string;
  lockup: { unixTimestamp: string; epoch: string; custodian: string };
  delegation: { voter: string; stake: string; activationEpoch: string; deactivationEpoch: string } | null;
};

/** The whole response: stake accounts read at `slot`. */
export type StakeAccountsJson = { slot: string; accounts: StakeAccountJson[] };

export type StakeAccounts = { slot: bigint; accounts: StakeAccount[] };

export function stakeAccountToJson(account: StakeAccount): StakeAccountJson {
  const { delegation, lockup } = account;
  return {
    address: account.address,
    lamports: account.lamports.toString(),
    kind: account.kind,
    rentExemptReserve: account.rentExemptReserve.toString(),
    staker: account.staker,
    withdrawer: account.withdrawer,
    lockup: {
      unixTimestamp: lockup.unixTimestamp.toString(),
      epoch: lockup.epoch.toString(),
      custodian: lockup.custodian,
    },
    delegation:
      delegation === null
        ? null
        : {
            voter: delegation.voter,
            stake: delegation.stake.toString(),
            activationEpoch: delegation.activationEpoch.toString(),
            deactivationEpoch: delegation.deactivationEpoch.toString(),
          },
  };
}

export function stakeAccountsToJson(result: { slot: bigint; accounts: readonly StakeAccount[] }): StakeAccountsJson {
  return { slot: result.slot.toString(), accounts: result.accounts.map(stakeAccountToJson) };
}

/**
 * Parses a GET /api/stake-accounts body strictly: exact keys, canonical decimal strings in range, valid addresses,
 * `delegation` present exactly for `kind: 'delegated'`. Throws an Error named `InvalidStakeAccountsJsonError` that
 * says which field is wrong; never returns partial data.
 */
export function stakeAccountsFromJson(json: unknown): StakeAccounts {
  const root = record(json, '', ['slot', 'accounts']);
  const accounts = root.accounts;
  if (!Array.isArray(accounts)) fail('accounts', 'is not an array');
  return {
    slot: u64(root.slot, 'slot'),
    accounts: accounts.map((item: unknown, index) => stakeAccountFromJson(item, `accounts[${String(index)}]`)),
  };
}

function stakeAccountFromJson(json: unknown, path: string): StakeAccount {
  const item = record(json, path, [
    'address',
    'lamports',
    'kind',
    'rentExemptReserve',
    'staker',
    'withdrawer',
    'lockup',
    'delegation',
  ]);
  const kind = item.kind;
  if (kind !== 'initialized' && kind !== 'delegated') fail(`${path}.kind`, 'is not initialized or delegated');
  const lockup = record(item.lockup, `${path}.lockup`, ['unixTimestamp', 'epoch', 'custodian']);
  let delegation: StakeAccount['delegation'] = null;
  if (kind === 'delegated') {
    const d = record(item.delegation, `${path}.delegation`, ['voter', 'stake', 'activationEpoch', 'deactivationEpoch']);
    delegation = {
      voter: addressAt(d.voter, `${path}.delegation.voter`),
      stake: u64(d.stake, `${path}.delegation.stake`),
      activationEpoch: u64(d.activationEpoch, `${path}.delegation.activationEpoch`),
      deactivationEpoch: u64(d.deactivationEpoch, `${path}.delegation.deactivationEpoch`),
    };
  } else if (item.delegation !== null) {
    fail(`${path}.delegation`, 'must be null for an initialized account');
  }
  return {
    address: addressAt(item.address, `${path}.address`),
    lamports: u64(item.lamports, `${path}.lamports`),
    kind,
    rentExemptReserve: u64(item.rentExemptReserve, `${path}.rentExemptReserve`),
    staker: addressAt(item.staker, `${path}.staker`),
    withdrawer: addressAt(item.withdrawer, `${path}.withdrawer`),
    lockup: {
      unixTimestamp: i64(lockup.unixTimestamp, `${path}.lockup.unixTimestamp`),
      epoch: u64(lockup.epoch, `${path}.lockup.epoch`),
      custodian: addressAt(lockup.custodian, `${path}.lockup.custodian`),
    },
    delegation,
  };
}

function fail(path: string, problem: string): never {
  const error = new Error(`Invalid stake accounts response: ${path === '' ? 'body' : path} ${problem}`);
  error.name = 'InvalidStakeAccountsJsonError';
  throw error;
}

/** A plain object with exactly `keys`. */
function record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'is not an object');
  const actual = Object.keys(value);
  const unexpected = actual.find((key) => !keys.includes(key));
  if (unexpected !== undefined) fail(path, `has an unexpected field "${unexpected}"`);
  const missing = keys.find((key) => !actual.includes(key));
  if (missing !== undefined) fail(path, `misses the field "${missing}"`);
  return value as Record<string, unknown>;
}

function addressAt(value: unknown, path: string): Address {
  if (typeof value !== 'string' || !isAddress(value)) fail(path, 'is not a base58 address');
  return value;
}

const UNSIGNED = /^(0|[1-9][0-9]*)$/;
const SIGNED = /^(0|-?[1-9][0-9]*)$/;

function u64(value: unknown, path: string): bigint {
  if (typeof value !== 'string' || value.length > 20 || !UNSIGNED.test(value)) fail(path, 'is not a u64 decimal string');
  const n = BigInt(value);
  if (n > U64_MAX) fail(path, 'is larger than u64');
  return n;
}

function i64(value: unknown, path: string): bigint {
  if (typeof value !== 'string' || value.length > 20 || !SIGNED.test(value)) fail(path, 'is not an i64 decimal string');
  const n = BigInt(value);
  if (n > I64_MAX || n < -I64_MAX - 1n) fail(path, 'is out of the i64 range');
  return n;
}
