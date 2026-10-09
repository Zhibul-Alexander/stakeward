// actionApplied against the chain: for every builder kind it is false before the transaction lands and true after.
import type { KeyPairSigner } from '@solana/kit';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  actionApplied,
  actionTarget,
  buildTransaction,
  deriveNonceAccountAddress,
  expectedFeePayer,
  lockupEndForPeriod,
  NONCE_ACCOUNT_SEED,
  NONCE_ACCOUNT_SIZE,
  type Lockup,
  type StakeAccount,
  type TransactionAction,
} from '../src/index.ts';
import { LAMPORTS_PER_SOL, TestChain } from './svm.ts';

const DAY = 86_400n;

let chain: TestChain;
let A: KeyPairSigner; // main key: withdrawer and staker
let K: KeyPairSigner; // second key: custodian
let D: KeyPairSigner; // new wallet

beforeEach(async () => {
  chain = await TestChain.create();
  [A, K, D] = await Promise.all([chain.fundedKey(), chain.fundedKey(), chain.fundedKey()]);
});

function lockedUntil(days: bigint): Lockup {
  return { unixTimestamp: chain.clock().unixTimestamp + days * DAY, epoch: 0n, custodian: K.address };
}

/** Reads the target, checks the change is not there yet, sends the built transaction, checks it is there now. */
async function expectAppliedOnlyAfterSending(action: TransactionAction, signers: readonly KeyPairSigner[]): Promise<void> {
  const target = actionTarget(action);
  const before: StakeAccount | null = action.kind === 'nonce-setup' || action.kind === 'nonce-close' ? null : chain.stakeAccount(target);
  expect(actionApplied(action, chain.account(target), before)).toBe(false);

  const { bytes } = buildTransaction(action, { feePayer: expectedFeePayer(action), lifetime: chain.blockhashLifetime() });
  const result = await chain.send(bytes, signers);
  if (!result.ok) throw new Error(`${action.kind} failed: ${JSON.stringify(result.error)}\n${result.logs.join('\n')}`);
  expect(actionApplied(action, chain.account(target), before)).toBe(true);
}

describe('actionApplied on the chain, for every builder kind', () => {
  it('protect', async () => {
    const stakeAccount = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address });
    const lockUntil = lockupEndForPeriod(chain.clock().unixTimestamp, 6);
    await expectAppliedOnlyAfterSending(
      { kind: 'protect', stakeAccount, mainKey: A.address, secondKey: K.address, lockUntil },
      [A, K],
    );
  });

  it('extend', async () => {
    const stakeAccount = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address, lockup: lockedUntil(10n) });
    const lockUntil = chain.clock().unixTimestamp + 20n * DAY;
    await expectAppliedOnlyAfterSending({ kind: 'extend', stakeAccount, secondKey: K.address, lockUntil }, [K]);
  });

  it('unlock', async () => {
    const stakeAccount = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address, lockup: lockedUntil(10n) });
    await expectAppliedOnlyAfterSending({ kind: 'unlock', stakeAccount, secondKey: K.address }, [K]);
  });

  it('withdraw, part of the balance', async () => {
    const stakeAccount = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address, lockup: lockedUntil(10n) });
    await expectAppliedOnlyAfterSending(
      {
        kind: 'withdraw',
        stakeAccount,
        mainKey: A.address,
        secondKey: K.address,
        recipient: A.address,
        lamports: LAMPORTS_PER_SOL,
      },
      [A, K],
    );
  });

  it('withdraw, the whole balance (the account closes)', async () => {
    const stakeAccount = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address, lockup: lockedUntil(10n) });
    await expectAppliedOnlyAfterSending(
      {
        kind: 'withdraw',
        stakeAccount,
        mainKey: A.address,
        secondKey: K.address,
        recipient: A.address,
        lamports: chain.balance(stakeAccount),
      },
      [A, K],
    );
    expect(chain.account(stakeAccount)).toBeNull();
  });

  it('deactivate', async () => {
    const voteAccount = await chain.createVoteAccount();
    const stakeAccount = await chain.createStakeAccount({
      staker: A.address,
      withdrawer: A.address,
      delegateTo: { voteAccount, stakerKey: A },
    });
    chain.warpToEpoch(chain.clock().epoch + 2n);
    await expectAppliedOnlyAfterSending({ kind: 'deactivate', stakeAccount, staker: A.address }, [A]);
  });

  it('delegate', async () => {
    const voteAccount = await chain.createVoteAccount();
    const stakeAccount = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address, lockup: lockedUntil(10n) });
    await expectAppliedOnlyAfterSending({ kind: 'delegate', stakeAccount, staker: A.address, voteAccount }, [A]);
  });

  it('rescue', async () => {
    const stakeAccount = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address, lockup: lockedUntil(100n) });
    await expectAppliedOnlyAfterSending(
      { kind: 'rescue', stakeAccount, mainKey: A.address, secondKey: K.address, newWallet: D.address },
      [D, A, K],
    );
  });

  it('nonce setup, then nonce close', async () => {
    const nonceAccount = await deriveNonceAccountAddress(D.address);
    const lamports = chain.svm.minimumBalanceForRentExemption(BigInt(NONCE_ACCOUNT_SIZE));
    await expectAppliedOnlyAfterSending(
      { kind: 'nonce-setup', nonceAccount, nonceAuthority: D.address, seed: NONCE_ACCOUNT_SEED, lamports },
      [D],
    );
    await expectAppliedOnlyAfterSending(
      { kind: 'nonce-close', nonceAccount, nonceAuthority: D.address, recipient: D.address, lamports: chain.balance(nonceAccount) },
      [D],
    );
  });
});
