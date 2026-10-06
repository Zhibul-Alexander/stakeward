import type { Address } from '@solana/kit';
import { formatUtcDate, U64_MAX, ZERO_ADDRESS, type Delegation, type StakeAccount } from '@stakeward/core';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import type { LoadedAccount } from '@/pages/account/AccountView';
import { StageBlock } from './StageBlock.tsx';

// The waits on /withdraw/:account count the epoch's own slot time from the Clock sysvar (about 270 ms on mainnet in
// October 2026), not the 400 ms target, which made a 32-hour wait read as 48 hours.

const MAIN = 'B1agBSrGRgub2jXMJEozYkRLRzFc9HLd5hHjSrCtuXu8' as Address;
const STAKE = 'AYA9kYsn7XVDTPARBfAuASypyyDGFJw1Xds2vHgW9DfW' as Address;
const VOTE = '7xKTg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgA9fQ' as Address;
const STAKE_PROGRAM = 'Stake11111111111111111111111111111111111111' as Address;

/** Epoch 1050 started at EPOCH_START; 100 000 of its 432 000 slots took 27 000 s: 270 ms per slot. */
const EPOCH_START = 1_800_000_000n;
const READ_AT = EPOCH_START + 27_000n;
/** The other 332 000 slots at 270 ms: 1 d 0 h 54 min (at 400 ms it would be 1 d 12 h 53 min). */
const LEFT = 89_640n;

function loaded(delegation: Delegation): LoadedAccount {
  const account: StakeAccount = {
    address: STAKE,
    lamports: 2_001_666_240n,
    kind: 'delegated',
    rentExemptReserve: 1_666_240n,
    staker: MAIN,
    withdrawer: MAIN,
    lockup: { unixTimestamp: 0n, epoch: 0n, custodian: ZERO_ADDRESS },
    delegation,
  };
  return {
    raw: { address: STAKE, data: new Uint8Array(200), lamports: account.lamports, owner: STAKE_PROGRAM },
    account,
    clock: { slot: 453_700_000n, epoch: 1_050n, epochStartTimestamp: EPOCH_START, unixTimestamp: READ_AT },
    epoch: { epoch: 1_050n, slotIndex: 100_000n, slotsInEpoch: 432_000n, blockHeight: 400_000_000n },
    readAt: READ_AT,
  };
}

function renderStage(delegation: Delegation) {
  const noop = () => undefined;
  render(
    <StageBlock
      headingRef={createRef()}
      loaded={loaded(delegation)}
      onSign={noop}
      secondMode="here"
      onSecondMode={noop}
      onCheckAgain={noop}
      onCountdownEnd={noop}
    />,
  );
}

describe('StageBlock: epoch waits at the measured slot time', () => {
  it('an active stake: the time until it stops', () => {
    renderStage({ voter: VOTE, stake: 2_000_000_000n, activationEpoch: 800n, deactivationEpoch: U64_MAX });
    expect(
      screen.getByText(
        'This stake is earning rewards. Stop staking first: it stops at the end of the current epoch, in about 1 d 0 h. Then come back to withdraw. Only your main key signs.',
      ),
    ).toBeInTheDocument();
  });

  it('a deactivating stake: the countdown ends when the epoch does', () => {
    renderStage({ voter: VOTE, stake: 2_000_000_000n, activationEpoch: 800n, deactivationEpoch: 1_050n });
    // READ_AT + LEFT = 16 January 2027, 16:24 UTC.
    expect(screen.getByText(`Around 16:24 UTC on ${formatUtcDate(READ_AT + LEFT) ?? ''}`)).toBeInTheDocument();
  });
});
