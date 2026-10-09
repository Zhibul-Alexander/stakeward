// Review (step 3, /dev/cosign Reset = F5 fee rule): buildUnlock lets the second key pay whenever its balance covers the
// fee. A fee payer must stay rent-exempt (or end at exactly 0): a wallet holding between the rent-exempt minimum and
// that minimum plus the fee cannot pay, the runtime refuses with InsufficientFundsForRent. The page then offers a
// transaction that fails, instead of letting the main key pay and co-sign (F5).
import { generateKeyPairSigner, getTransactionDecoder, getTransactionEncoder, partiallySignTransaction } from '@solana/kit';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { describe, expect, it } from 'vitest';
import { buildUnlock } from '@/pages/dev-cosign/tasks';

describe('review: Reset fee payer', () => {
  it('never picks a second key that cannot pay the fee and stay rent-exempt', async () => {
    const testChain = await TestChain.create();
    const chain = new LiteSvmChain(testChain);
    const main = await testChain.fundedKey();
    const K = await generateKeyPairSigner();
    const rentExempt = await chain.getMinimumBalanceForRentExemption(0);
    testChain.airdrop(K.address, rentExempt + 5_000n); // covers the 5 600 fee, but not the fee AND rent exemption
    const stake = await testChain.createStakeAccount({
      staker: main.address,
      withdrawer: main.address,
      lockup: { unixTimestamp: START_UNIX_TIMESTAMP + 600n, epoch: 0n, custodian: K.address },
    });

    const { built, feePayer } = await buildUnlock(chain, { stakeAccount: stake, mainKey: main.address, secondKey: K.address });
    const signers = feePayer === 'second' ? [K] : [main, K];
    const signed = await partiallySignTransaction(
      signers.map((signer) => signer.keyPair),
      getTransactionDecoder().decode(built.bytes),
    );
    const simulation = await chain.simulate(new Uint8Array(getTransactionEncoder().encode(signed)));
    const error = simulation.ok ? null : simulation.error;
    const name = typeof error === 'object' && error !== null && 'context' in error ? JSON.stringify((error).context, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)) : String(error);
    expect(simulation.ok, `fee payer ${feePayer}: ${String(error)} ${name}`).toBe(true);
  });
});
