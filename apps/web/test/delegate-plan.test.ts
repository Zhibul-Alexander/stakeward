import { getAddressDecoder, type Address } from '@solana/kit';
import type { StakeAccount } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { delegateStage } from '@/pages/delegate/plan';
import { parseVoteAccounts } from '@/ports';

const key = (n: number): Address => getAddressDecoder().decode(new Uint8Array(32).fill(n));
const A = key(1);
const VOTE = key(4);
const clock = { unixTimestamp: 1_700_000_000n, epoch: 500n };
const MAX = 18_446_744_073_709_551_615n;
const account = (over: Partial<StakeAccount> = {}): StakeAccount => ({
  address: key(9),
  lamports: 5_000_000_000n,
  kind: 'initialized',
  rentExemptReserve: 1_666_240n,
  staker: A,
  withdrawer: A,
  lockup: { unixTimestamp: 0n, epoch: 0n, custodian: A },
  delegation: null,
  ...over,
});
const delegation = (activationEpoch: bigint, deactivationEpoch: bigint) => ({
  voter: VOTE,
  stake: 4_000_000_000n,
  activationEpoch,
  deactivationEpoch,
});

describe('delegateStage', () => {
  it('is ready for an inactive stake the main key manages', () => {
    expect(delegateStage(account(), clock)).toBe('ready');
    expect(delegateStage(account({ kind: 'delegated', delegation: delegation(10n, 20n) }), clock)).toBe('ready');
  });
  it('is earning, deactivating or service otherwise', () => {
    expect(delegateStage(account({ kind: 'delegated', delegation: delegation(10n, MAX) }), clock)).toBe('earning');
    expect(delegateStage(account({ kind: 'delegated', delegation: delegation(10n, 500n) }), clock)).toBe('deactivating');
    expect(delegateStage(account({ staker: key(5) }), clock)).toBe('service');
  });
});

describe('parseVoteAccounts', () => {
  it('reads the current validators and leaves out entries that do not parse', () => {
    const result = {
      current: [
        { votePubkey: VOTE, commission: 5n, activatedStake: 7n, epochVoteAccount: true, nodePubkey: A },
        { votePubkey: 'nope', commission: 5, activatedStake: 7, epochVoteAccount: true },
        { votePubkey: A, commission: 5, activatedStake: 7 },
      ],
      delinquent: [{ votePubkey: key(6), commission: 0, activatedStake: 1, epochVoteAccount: false }],
    };
    expect(parseVoteAccounts(result)).toEqual([{ voteAccount: VOTE, commission: 5, activatedStake: 7n, epochVoteAccount: true }]);
  });
  it('throws on a result that is not a vote account list', () => {
    expect(() => parseVoteAccounts(null)).toThrow();
    expect(() => parseVoteAccounts({ current: 1 })).toThrow();
  });
});
