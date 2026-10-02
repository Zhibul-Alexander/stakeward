// LiteSVM adapter for the gate, on top of the core test harness: the mainnet stake program v5.1.0, a realistic clock,
// a real vote account. Test-only (loads the native litesvm module).
import type { Address } from '@solana/kit';
import { decodeStakeAccount, STAKE_PROGRAM_ADDRESS } from '@stakeward/core';
import { TestChain } from '@stakeward/core/test/svm';
import { readProgramElf, type GateChain } from './chain.ts';

export type LiteSvmGateChain = GateChain & {
  readonly testChain: TestChain;
  /** Airdrops `lamports` from LiteSVM's faucet (the gate's funder starts with exactly its budget). */
  fund(address: Address, lamports: bigint): void;
};

export async function createLiteSvmChain(): Promise<LiteSvmGateChain> {
  const chain = await TestChain.create();
  let voteAccount: Promise<Address> | null = null;
  const account = (address: Address) => Promise.resolve(chain.account(address));
  return {
    testChain: chain,
    fund: (address, lamports) => {
      chain.airdrop(address, lamports);
    },
    clock: () => Promise.resolve(chain.clock()),
    lifetime: () => Promise.resolve(chain.blockhashLifetime()),
    rentExempt: (space) => Promise.resolve(chain.svm.minimumBalanceForRentExemption(BigInt(space))),
    balance: (address) => Promise.resolve(chain.balance(address)),
    account,
    async send(bytes) {
      const result = await chain.send(bytes);
      return result.ok
        ? { status: 'ok', signature: result.signature }
        : { status: 'failed', signature: result.signature, error: result.error };
    },
    voteAccount: () => (voteAccount ??= chain.createVoteAccount()),
    stakeAccountsOf(withdrawer) {
      const addresses = chain.svm.getProgramAccounts(STAKE_PROGRAM_ADDRESS).flatMap((encoded) => {
        const decoded = decodeStakeAccount({
          address: encoded.address,
          data: encoded.data,
          lamports: encoded.lamports,
          owner: encoded.programAddress,
        });
        return decoded.ok && decoded.account.withdrawer === withdrawer ? [encoded.address] : [];
      });
      return Promise.resolve(addresses);
    },
    programElf: () => readProgramElf(account),
    setTime: (unixTimestamp) => {
      chain.setTime(unixTimestamp);
    },
  };
}
