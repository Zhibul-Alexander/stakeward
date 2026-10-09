// Test-only: raw 200-byte stake accounts for rule tests (actionApplied, watchVerdict), encoded with the generated stake
// client. Decoding itself is tested against mainnet fixtures (decode.test.ts). No Node or DOM APIs: src tests import
// this file too.
import { getAddressDecoder, type Address } from '@solana/kit';
import { getStakeStateAccountEncoder, type StakeStateV2Args } from '@solana-program/stake';
import {
  STAKE_ACCOUNT_SIZE,
  STAKE_PROGRAM_ADDRESS,
  ZERO_ADDRESS,
  type RawAccount,
  type StakeAccount,
} from '../src/index.ts';

const key = (n: number): Address => getAddressDecoder().decode(new Uint8Array(32).fill(n));

/** An initialized stake account of 5 SOL: staker = withdrawer = `key(1)`, no lockup. Override any field. */
export function stakeAccountOf(fields: Partial<StakeAccount> = {}): StakeAccount {
  return {
    address: key(9),
    lamports: 5_000_000_000n,
    kind: 'initialized',
    rentExemptReserve: 1_666_240n,
    staker: key(1),
    withdrawer: key(1),
    lockup: { unixTimestamp: 0n, epoch: 0n, custodian: ZERO_ADDRESS },
    delegation: null,
    ...fields,
  };
}

/** `account` as the chain stores it: owned by the stake program, Initialized or Stake (when it has a delegation). */
export function rawStakeAccount(account: StakeAccount): RawAccount {
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
  data.set(getStakeStateAccountEncoder().encode({ state }));
  return { address: account.address, data, lamports: account.lamports, owner: STAKE_PROGRAM_ADDRESS };
}
