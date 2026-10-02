// Decoding matches real mainnet stake accounts (raw getAccountInfo responses saved on 2026-10-02, epoch 1047).
import { address, getAddressDecoder, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { decodeStakeAccount, STAKE_ACCOUNT_SIZE, STAKE_PROGRAM_ADDRESS, U64_MAX, type RawAccount } from '../src/index.ts';
import { FIXTURES, rawFromFixture, type Fixture } from './fixtures.ts';

const { deactivating, custodianIsWithdrawer, delegatedLockup, delegatedNoLockup, stakerIsNotWithdrawer, initializedLockup, initialized } =
  FIXTURES;

function decodeOk(fixture: Fixture) {
  const result = decodeStakeAccount(rawFromFixture(fixture));
  if (!result.ok) throw new Error(`decode failed: ${result.error}`);
  return result.account;
}

const ZERO = address('11111111111111111111111111111111');

describe('decodeStakeAccount on mainnet fixtures', () => {
  it('delegated, no lockup', () => {
    expect(decodeOk(delegatedNoLockup)).toEqual({
      address: address('93iHZBUYNmiLtj9Z6KfwkvZ6XPEz1rTQYHKRKZQMpFF4'),
      lamports: 23_221_971_776n,
      kind: 'delegated',
      rentExemptReserve: 2_282_880n,
      staker: address('HUQtZ3Kkh8uqU6P5C5xRiqJ3SX7dUWQSURfWFXp57UMf'),
      withdrawer: address('HUQtZ3Kkh8uqU6P5C5xRiqJ3SX7dUWQSURfWFXp57UMf'),
      lockup: { unixTimestamp: 0n, epoch: 0n, custodian: ZERO },
      delegation: {
        voter: address('he1iusunGwqrNtafDtLdhsUQDFvo13z9sUa36PauBtk'),
        stake: 23_219_688_896n,
        activationEpoch: 731n,
        deactivationEpoch: U64_MAX,
      },
    });
  });

  it('delegated, with lockup', () => {
    expect(decodeOk(delegatedLockup)).toEqual({
      address: address('14ss8zTNioPxXPVG2K7KtS252wDCkKQ711Lgon3ESP7S'),
      lamports: 1_468_841_692_445n,
      kind: 'delegated',
      rentExemptReserve: 2_282_880n,
      staker: address('7wiYBtskxQzUuMmxSkZrT32JgPK3ySBKc6QGY7emn33w'),
      withdrawer: address('7wiYBtskxQzUuMmxSkZrT32JgPK3ySBKc6QGY7emn33w'),
      // 2027-11-07T00:00:00Z
      lockup: { unixTimestamp: 1_825_545_600n, epoch: 0n, custodian: address('3XdBZcURF5nKg3oTZAcfQZg8XEc5eKsx6vK8r3BdGGxg') },
      delegation: {
        voter: address('XzMLju7T6BSSngmsPogeuryd6uswiimkPU87gB2chho'),
        stake: 1_445_759_655_302n,
        activationEpoch: 628n,
        deactivationEpoch: U64_MAX,
      },
    });
  });

  it('initialized, not delegated', () => {
    expect(decodeOk(initialized)).toEqual({
      address: address('HaDSjzGMBkdbdXLYWXRybc1i8f5ww1fYMenZZnEyjQcf'),
      lamports: 44_560_439n,
      kind: 'initialized',
      rentExemptReserve: 2_282_880n,
      staker: address('7zo3q61Sefdg3X5JLgVnYM48D7qMUhYMPmQkC8yhbSTE'),
      withdrawer: address('7zo3q61Sefdg3X5JLgVnYM48D7qMUhYMPmQkC8yhbSTE'),
      lockup: { unixTimestamp: 0n, epoch: 0n, custodian: ZERO },
      delegation: null,
    });
  });

  it.each([
    ['delegated-no-lockup', delegatedNoLockup],
    ['delegated-lockup', delegatedLockup],
    ['initialized', initialized],
    ['initialized-lockup', initializedLockup],
    ['delegated-custodian-eq-withdrawer', custodianIsWithdrawer],
    ['delegated-staker-ne-withdrawer', stakerIsNotWithdrawer],
    ['deactivating', deactivating],
  ])('%s agrees with the raw byte offsets of CLAUDE.md section 4', (_name, fixture: Fixture) => {
    const raw = rawFromFixture(fixture);
    const account = decodeOk(fixture);
    const bytes = Uint8Array.from(raw.data);
    const view = new DataView(bytes.buffer);
    const key = (offset: number): Address => getAddressDecoder().decode(bytes, offset);

    expect(bytes.length).toBe(STAKE_ACCOUNT_SIZE);
    expect(view.getUint32(0, true)).toBe(account.kind === 'initialized' ? 1 : 2);
    expect(view.getBigUint64(4, true)).toBe(account.rentExemptReserve);
    expect(key(12)).toBe(account.staker);
    expect(key(44)).toBe(account.withdrawer);
    expect(view.getBigInt64(76, true)).toBe(account.lockup.unixTimestamp);
    expect(view.getBigUint64(84, true)).toBe(account.lockup.epoch);
    expect(key(92)).toBe(account.lockup.custodian);
    if (account.delegation === null) return;
    expect(key(124)).toBe(account.delegation.voter);
    expect(view.getBigUint64(156, true)).toBe(account.delegation.stake);
    expect(view.getBigUint64(164, true)).toBe(account.delegation.activationEpoch);
    expect(view.getBigUint64(172, true)).toBe(account.delegation.deactivationEpoch);
  });
});

describe('decodeStakeAccount rejects what is not a usable stake account', () => {
  const valid = rawFromFixture(initialized);
  const withState = (tag: number): RawAccount => {
    const data = new Uint8Array(STAKE_ACCOUNT_SIZE);
    new DataView(data.buffer).setUint32(0, tag, true);
    return { ...valid, data };
  };

  it('checks the owner before decoding', () => {
    expect(decodeStakeAccount({ ...valid, owner: ZERO })).toEqual({ ok: false, error: 'wrong-owner' });
  });

  it('checks the size', () => {
    expect(decodeStakeAccount({ ...valid, data: valid.data.slice(0, 199) })).toEqual({ ok: false, error: 'wrong-size' });
    expect(decodeStakeAccount({ ...valid, data: new Uint8Array(0) })).toEqual({ ok: false, error: 'wrong-size' });
  });

  it('reports states without authorities and unknown tags', () => {
    expect(decodeStakeAccount(withState(0))).toEqual({ ok: false, error: 'uninitialized' });
    expect(decodeStakeAccount(withState(3))).toEqual({ ok: false, error: 'rewards-pool' });
    expect(decodeStakeAccount(withState(4))).toEqual({ ok: false, error: 'malformed' });
  });

  it('accepts only the stake program as owner', () => {
    expect(valid.owner).toBe(STAKE_PROGRAM_ADDRESS);
  });
});
