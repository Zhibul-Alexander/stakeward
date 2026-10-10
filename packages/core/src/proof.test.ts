import { getAddressDecoder, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { U64_MAX, ZERO_ADDRESS } from './constants.ts';
import type { StakeAccount } from './decode.ts';
import { buildProof } from './proof.ts';

const key = (n: number): Address => getAddressDecoder().decode(new Uint8Array(32).fill(n));
const DAY = 86_400n;
const NOW = 1_790_942_400n;
const CLOCK = { unixTimestamp: NOW, epoch: 850n };
const WALLET = key(1);
const SECOND = key(2);

type Make = { n: number; lamports: bigint; withdrawer?: Address; staker?: Address; end?: bigint; epoch?: bigint; custodian?: Address };
const make = ({ n, lamports, withdrawer = WALLET, staker = withdrawer, end = 0n, epoch = 0n, custodian = ZERO_ADDRESS }: Make): StakeAccount => ({
  address: key(n),
  lamports,
  kind: 'delegated',
  rentExemptReserve: 2_282_880n,
  staker,
  withdrawer,
  lockup: { unixTimestamp: end, epoch, custodian },
  delegation: { voter: key(99), stake: lamports, activationEpoch: 700n, deactivationEpoch: U64_MAX },
});

describe('buildProof', () => {
  const open = make({ n: 10, lamports: 3n });
  const late = make({ n: 11, lamports: 40n, end: NOW + 200n * DAY, custodian: SECOND });
  const soon = make({ n: 12, lamports: 5n, end: NOW + 10n * DAY, custodian: SECOND });
  const ended = make({ n: 13, lamports: 7n, end: NOW - DAY, custodian: SECOND });
  const selfLocked = make({ n: 14, lamports: 11n, end: NOW + 100n * DAY, custodian: WALLET });
  const byEpoch = make({ n: 15, lamports: 13n, epoch: 900n, custodian: SECOND });
  const othersStake = make({ n: 16, lamports: 1000n, withdrawer: key(3), end: NOW + 100n * DAY, custodian: WALLET });
  const stakerOnly = make({ n: 17, lamports: 1000n, withdrawer: key(4), staker: WALLET });

  it('counts the locked accounts and their SOL out of the wallet own stake only', () => {
    const proof = buildProof(WALLET, [open, late, soon, ended, selfLocked, byEpoch, othersStake, stakerOnly], CLOCK);
    expect(proof.wallet).toBe(WALLET);
    expect(proof.totals).toEqual({ count: 6, lockedCount: 3, lamports: 79n, lockedLamports: 58n });
    // The lock that ends first, among the dated ones; an epoch lock has no date.
    expect(proof.earliestLockEnd).toBe(NOW + 10n * DAY);
  });

  it('calls only a lock in force of another key locked, and dates only a timestamp lock', () => {
    const proof = buildProof(WALLET, [open, late, ended, selfLocked, byEpoch], CLOCK);
    const byAddress = new Map(proof.rows.map((row) => [row.account.address, row]));
    expect(byAddress.get(late.address)).toMatchObject({ locked: true, protection: 'locked-by-other', lockEnd: NOW + 200n * DAY, activation: 'active' });
    expect(byAddress.get(byEpoch.address)).toMatchObject({ locked: true, protection: 'locked-by-other', lockEnd: null });
    // An ended lock, and a lock the main key holds itself (it can lift it alone), lock nothing.
    expect(byAddress.get(ended.address)).toMatchObject({ locked: false, protection: 'unprotected', lockEnd: null });
    expect(byAddress.get(selfLocked.address)).toMatchObject({ locked: false, protection: 'unprotected', lockEnd: null });
    expect(byAddress.get(open.address)).toMatchObject({ locked: false, managedByService: false });
  });

  it('lists accounts without a lock first, then by lock end, then larger first', () => {
    const big = make({ n: 20, lamports: 99n });
    const proof = buildProof(WALLET, [late, byEpoch, soon, open, big], CLOCK);
    expect(proof.rows.map((row) => row.account.address)).toEqual([big.address, open.address, soon.address, late.address, byEpoch.address]);
  });

  it('says a staking service may manage the stake', () => {
    const service = make({ n: 21, lamports: 1n, staker: key(5), end: NOW + DAY * 50n, custodian: SECOND });
    expect(buildProof(WALLET, [service], CLOCK).rows[0]).toMatchObject({ locked: true, managedByService: true });
  });

  it('counts an account found twice once', () => {
    expect(buildProof(WALLET, [late, late], CLOCK).totals).toEqual({ count: 1, lockedCount: 1, lamports: 40n, lockedLamports: 40n });
  });

  it('is empty, with no lock end, for a wallet without stake', () => {
    expect(buildProof(WALLET, [othersStake], CLOCK)).toEqual({
      wallet: WALLET,
      rows: [],
      totals: { count: 0, lockedCount: 0, lamports: 0n, lockedLamports: 0n },
      earliestLockEnd: null,
    });
  });
});
