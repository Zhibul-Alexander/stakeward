import { generateKeyPairSigner, type Address } from '@solana/kit';
import {
  fillPlaceholders,
  lockupEndForPeriod,
  RECOVERY_PLACEHOLDERS,
  recoveryCommands,
  rfc3339Utc,
  ZERO_ADDRESS,
  type ClockView,
  type Lockup,
  type RecoveryCommandId,
  type StakeAccount,
} from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { recoveryCard, type RecoveryCard } from './card.ts';

const NOW = 1_790_000_000n; // 2026-09-21
const DAY = 86_400n;
const T = NOW + 100n * DAY;
const CLOCK: ClockView = { unixTimestamp: NOW, epoch: 900n };

const [A, K, X, S] = await Promise.all([
  generateKeyPairSigner(),
  generateKeyPairSigner(),
  generateKeyPairSigner(),
  generateKeyPairSigner(),
]).then((keys) => keys.map((key) => key.address) as [Address, Address, Address, Address]);

function account(lockup: Lockup, staker: Address = A): StakeAccount {
  return {
    address: S,
    lamports: 5_002_282_880n,
    kind: 'initialized',
    rentExemptReserve: 2_282_880n,
    staker,
    withdrawer: A,
    lockup,
    delegation: null,
  };
}

function cardOf(stake: StakeAccount, clock: ClockView = CLOCK): RecoveryCard {
  const result = recoveryCard(stake, clock, 'mainnet');
  if (result.kind !== 'card') throw new Error(`no card: ${result.reason}`);
  return result.card;
}

const IDS: readonly RecoveryCommandId[] = [
  'find',
  'show',
  'epoch',
  'rescue',
  'deactivate',
  'withdraw',
  'withdraw-alone',
  'extend',
  'remove-lock',
  'change-second-key',
];

describe('recoveryCard', () => {
  it('a lock in force: the keys and the lock end from the chain, every command for this account', () => {
    const card = cardOf(account({ unixTimestamp: T, epoch: 0n, custodian: K }));

    expect(card).toMatchObject({ mainKey: A, secondKey: K, staker: null, lockUntil: T, lockEpoch: null });
    const templates = recoveryCommands({ mainKeyAddress: A, url: 'mainnet-beta' });
    for (const id of IDS) {
      // The core template, with this stake account in place of <STAKE_ACCOUNT> and nothing else changed.
      expect(card.commands[id], id).toEqual(fillPlaceholders(templates[id], { [RECOVERY_PLACEHOLDERS.stakeAccount]: S }));
      expect(card.commands[id], id).not.toContain(RECOVERY_PLACEHOLDERS.stakeAccount);
      expect(card.commands[id].slice(-2), id).toEqual(['--url', 'mainnet-beta']);
    }
    // The only address filled in besides the stake account: the main key's, in the read-only search.
    expect(card.commands.find).toEqual(['solana', 'stakes', '--withdraw-authority', A, '--url', 'mainnet-beta']);
    // Keys that sign stay placeholders: the card never holds a key (CLAUDE.md section 2).
    expect(card.commands.rescue).toEqual(expect.arrayContaining(['<MAIN_KEY>', '<SECOND_KEY>', '<NEW_WALLET>']));
    expect(card.commands.rescue).not.toContain(K);
    expect(card.commands.extend).toContain('<NEW_END_DATE>');
  });

  it('devnet commands say --url devnet', () => {
    const result = recoveryCard(account({ unixTimestamp: T, epoch: 0n, custodian: K }), CLOCK, 'devnet');
    expect(result.kind).toBe('card');
    if (result.kind !== 'card') return;
    for (const id of IDS) expect(result.card.commands[id].slice(-2), id).toEqual(['--url', 'devnet']);
  });

  it('the extend example is six months after the lock end, at 00:00 UTC, in the form --lockup-date takes', () => {
    const card = cardOf(account({ unixTimestamp: T, epoch: 0n, custodian: K }));
    expect(card.exampleEndDate).toBe(rfc3339Utc(lockupEndForPeriod(T, 6)));
    expect(card.exampleEndDate).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00Z$/);
  });

  it('names the staking key when it is not the main key (a service, or a thief who took it)', () => {
    expect(cardOf(account({ unixTimestamp: T, epoch: 0n, custodian: K }, X)).staker).toBe(X);
  });

  it('a lock its epoch holds: no end date, the epoch, and an example from now', () => {
    const card = cardOf(account({ unixTimestamp: 0n, epoch: 950n, custodian: K }));
    expect(card).toMatchObject({ lockUntil: null, lockEpoch: 950n });
    expect(card.exampleEndDate).toBe(rfc3339Utc(lockupEndForPeriod(NOW, 6)));

    const both = cardOf(account({ unixTimestamp: T, epoch: 950n, custodian: K }));
    expect(both).toMatchObject({ lockUntil: T, lockEpoch: 950n });
  });

  it('a lock end beyond any calendar date still gives a future example, never a past one', () => {
    const card = cardOf(account({ unixTimestamp: 2n ** 62n, epoch: 0n, custodian: K }));
    expect(card.lockUntil).toBe(2n ** 62n);
    expect(card.exampleEndDate).toBe(rfc3339Utc(lockupEndForPeriod(NOW, 6)));
  });

  it('no card without a second key to describe: no lock, an ended lock, a lock the main key holds', () => {
    expect(recoveryCard(account({ unixTimestamp: 0n, epoch: 0n, custodian: ZERO_ADDRESS }), CLOCK, 'mainnet')).toEqual({
      kind: 'none',
      reason: 'no-lock',
      date: null,
    });
    // Removed early by the second key (SetLockup to 0): the custodian is still written, the lock is empty.
    expect(recoveryCard(account({ unixTimestamp: 0n, epoch: 0n, custodian: K }), CLOCK, 'mainnet')).toMatchObject({
      reason: 'no-lock',
    });
    expect(recoveryCard(account({ unixTimestamp: NOW - DAY, epoch: 0n, custodian: K }), CLOCK, 'mainnet')).toEqual({
      kind: 'none',
      reason: 'lock-ended',
      date: NOW - DAY,
    });
    // The lock holds until the clock passes T: at T exactly it has ended (isLockupInForce).
    expect(recoveryCard(account({ unixTimestamp: NOW, epoch: 0n, custodian: K }), CLOCK, 'mainnet')).toMatchObject({
      reason: 'lock-ended',
    });
    expect(recoveryCard(account({ unixTimestamp: 0n, epoch: 900n, custodian: K }), CLOCK, 'mainnet')).toEqual({
      kind: 'none',
      reason: 'lock-ended',
      date: null,
    });
    expect(recoveryCard(account({ unixTimestamp: T, epoch: 0n, custodian: A }), CLOCK, 'mainnet')).toEqual({
      kind: 'none',
      reason: 'main-key-holds',
      date: null,
    });
  });

  it('a lock in force that the zero key holds (create-stake-account without --custodian): nobody can help, no card', () => {
    expect(recoveryCard(account({ unixTimestamp: T, epoch: 0n, custodian: ZERO_ADDRESS }), CLOCK, 'mainnet')).toEqual({
      kind: 'none',
      reason: 'nobody-holds',
      date: T,
    });
    // Held by its epoch: no date to say.
    expect(recoveryCard(account({ unixTimestamp: T, epoch: 950n, custodian: ZERO_ADDRESS }), CLOCK, 'mainnet')).toEqual({
      kind: 'none',
      reason: 'nobody-holds',
      date: null,
    });
  });
});
