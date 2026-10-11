import type { Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import {
  ADMISSION_FEE_LAMPORTS,
  decodeVoteAccount,
  formatValidatorAlert,
  newValidatorRisks,
  validatorRisks,
  VOTE_ACCOUNT_RENT_EXEMPT_LAMPORTS,
  VOTE_ACCOUNT_SIZE,
  VOTE_PROGRAM_ADDRESS,
} from './validator.ts';
import { voteAccountData, type Credits } from '../test/vote.ts';

const EPOCH = 900n;
const VOTING: Credits = [
  [898, 1000, 0],
  [899, 2000, 1000],
  [900, 2500, 2000],
];
const RICH = ADMISSION_FEE_LAMPORTS * 10n;
const voter = 'Vote1111111111111111111111111111111111111Ab' as Address;
const stake = 'Stake11111111111111111111111111111111111111' as Address;
const owner = 'Owner111111111111111111111111111111111111111' as Address;

function account(data: Uint8Array, lamports = RICH) {
  return { owner: VOTE_PROGRAM_ADDRESS, data, lamports };
}

describe('decodeVoteAccount', () => {
  it('reads a V4 account with a BLS key', () => {
    const view = decodeVoteAccount(voteAccountData({ version: 3, commission: 500, bls: true, credits: VOTING }));
    expect(view).toEqual({
      version: 'v4',
      commissionBps: 500,
      hasBlsKey: true,
      epochCredits: VOTING.map(([epoch, credits, prev]) => ({
        epoch: BigInt(epoch),
        credits: BigInt(credits),
        prevCredits: BigInt(prev),
      })),
    });
  });

  it('reads a V4 account without a BLS key, no root and no votes', () => {
    const view = decodeVoteAccount(voteAccountData({ version: 3, commission: 0, votes: 0, root: false, credits: [] }));
    expect(view).toMatchObject({ version: 'v4', hasBlsKey: false, epochCredits: [] });
  });

  it('reads V3 and V1_14_11 accounts: commission in percent, never a BLS key', () => {
    const v3 = decodeVoteAccount(voteAccountData({ version: 2, commission: 7, credits: VOTING }));
    expect(v3).toMatchObject({ version: 'v3', commissionBps: 700, hasBlsKey: false });
    expect(v3?.epochCredits).toHaveLength(3);
    const v1 = decodeVoteAccount(voteAccountData({ version: 1, commission: 100, credits: VOTING }));
    expect(v1).toMatchObject({ version: 'v1_14_11', commissionBps: 10_000 });
    expect(v1?.epochCredits.at(-1)?.epoch).toBe(900n);
  });

  it('refuses the wrong size, an unknown tag and lengths past the end', () => {
    const good = voteAccountData({ version: 3, commission: 0, credits: VOTING });
    expect(decodeVoteAccount(good.subarray(0, 200))).toBeNull();
    const uninitialized = new Uint8Array(VOTE_ACCOUNT_SIZE);
    expect(decodeVoteAccount(uninitialized)).toBeNull();
    const badLength = voteAccountData({ version: 3, commission: 0, votes: 0, credits: VOTING });
    // votes count right after the 145-byte header and the None BLS tag
    badLength.set([0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0], 4 + 128 + 2 + 2 + 8 + 1);
    expect(decodeVoteAccount(badLength)).toBeNull();
    const badOption = voteAccountData({ version: 3, commission: 0, credits: VOTING });
    badOption[4 + 128 + 2 + 2 + 8] = 2;
    expect(decodeVoteAccount(badOption)).toBeNull();
  });
});

describe('validatorRisks', () => {
  const healthy = voteAccountData({ version: 3, commission: 500, bls: true, credits: VOTING });

  it('finds no risk in a voting validator with a BLS key, a funded vote account and a fair commission', () => {
    expect(validatorRisks({ account: account(healthy), epoch: EPOCH })).toEqual([]);
  });

  it('calls a gone account or one owned by another program closed', () => {
    expect(validatorRisks({ account: null, epoch: EPOCH })).toEqual(['CLOSED']);
    expect(validatorRisks({ account: { ...account(healthy), owner }, epoch: EPOCH })).toEqual(['CLOSED']);
  });

  it('counts a validator that earned last epoch but not yet this one as voting', () => {
    const credits: Credits = [[899, 2000, 1000]];
    const data = voteAccountData({ version: 3, commission: 0, bls: true, credits });
    expect(validatorRisks({ account: account(data), epoch: EPOCH })).toEqual([]);
  });

  it('flags a validator with no credits in the last two epochs', () => {
    const stale = voteAccountData({ version: 3, commission: 0, bls: true, credits: [[897, 900, 0]] });
    expect(validatorRisks({ account: account(stale), epoch: EPOCH })).toEqual(['NOT_VOTING']);
    // An entry for this epoch that earned nothing is no vote either.
    const flat = voteAccountData({ version: 3, commission: 0, bls: true, credits: [[900, 900, 900]] });
    expect(validatorRisks({ account: account(flat), epoch: EPOCH })).toEqual(['NOT_VOTING']);
  });

  it('flags a missing BLS key, a low balance and a 100% commission', () => {
    const v3 = voteAccountData({ version: 2, commission: 100, credits: VOTING });
    const edge = ADMISSION_FEE_LAMPORTS + VOTE_ACCOUNT_RENT_EXEMPT_LAMPORTS;
    expect(validatorRisks({ account: account(v3, edge - 1n), epoch: EPOCH })).toEqual([
      'NO_BLS_KEY',
      'LOW_FEE_BALANCE',
      'FULL_COMMISSION',
    ]);
    expect(validatorRisks({ account: account(healthy, edge), epoch: EPOCH })).toEqual([]);
  });

  it('gives no risk for a vote account it cannot decode', () => {
    expect(validatorRisks({ account: account(new Uint8Array(VOTE_ACCOUNT_SIZE)), epoch: EPOCH })).toEqual([]);
  });
});

describe('newValidatorRisks', () => {
  it('keeps only the risks not seen before', () => {
    expect(newValidatorRisks([], ['NOT_VOTING'])).toEqual(['NOT_VOTING']);
    expect(newValidatorRisks(['NOT_VOTING'], ['NOT_VOTING', 'NO_BLS_KEY'])).toEqual(['NO_BLS_KEY']);
    expect(newValidatorRisks(['NOT_VOTING', 'NO_BLS_KEY'], ['NOT_VOTING'])).toEqual([]);
  });
});

describe('formatValidatorAlert', () => {
  const base = { stakeAccount: stake, withdrawer: owner };

  it('names the validator, the stake and every reason, and opens the accounts page', () => {
    const alert = formatValidatorAlert({ ...base, details: { voter, risks: ['NOT_VOTING', 'NO_BLS_KEY'] } });
    expect(alert.text).toBe(
      'Validator Vote...11Ab, which stake Stak...1111 is delegated to, has not voted for over an epoch and has no BLS ' +
        'key, so the network leaves it out of consensus. This stake earns no rewards while it stays there. Your SOL is ' +
        'safe. To earn again, move the stake to another validator: deactivate it, wait for the epoch to end, then ' +
        'delegate it.',
    );
    expect(alert.path).toBe(`/app?address=${owner}`);
    expect(alert.buttonLabel).toBe('Open Stakeward');
  });

  it('speaks of the future for a low balance alone, and of the share for a full commission alone', () => {
    const fee = formatValidatorAlert({ ...base, details: { voter, risks: ['LOW_FEE_BALANCE'] } });
    expect(fee.text).toContain('holds less than the 1.6 SOL Alpenglow admission fee. Once Alpenglow is live');
    const commission = formatValidatorAlert({ ...base, details: { voter, risks: ['FULL_COMMISSION'] } });
    expect(commission.text).toContain('keeps 100% of the rewards. You get none of the rewards this stake earns.');
  });

  it('refuses details without a risk', () => {
    expect(() => formatValidatorAlert({ ...base, details: { voter, risks: [] } })).toThrow();
  });
});
