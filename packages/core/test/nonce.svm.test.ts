// readNonceAccount on a nonce account the `nonce-setup` builder created on LiteSVM.
import { generateKeyPairSigner } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import {
  buildTransaction,
  deriveNonceAccountAddress,
  NONCE_ACCOUNT_SEED,
  NONCE_ACCOUNT_SIZE,
  readNonceAccount,
} from '../src/index.ts';
import { TestChain } from './svm.ts';

describe('readNonceAccount on the chain', () => {
  it('reads the nonce account core creates: authority and the value the chain stores', async () => {
    const testChain = await TestChain.create();
    const owner = await testChain.fundedKey();
    const nonceAccount = await deriveNonceAccountAddress(owner.address);
    const lamports = testChain.svm.minimumBalanceForRentExemption(BigInt(NONCE_ACCOUNT_SIZE));
    const { bytes } = buildTransaction(
      { kind: 'nonce-setup', nonceAccount, nonceAuthority: owner.address, seed: NONCE_ACCOUNT_SEED, lamports },
      { feePayer: owner.address, lifetime: testChain.blockhashLifetime() },
    );
    expect(readNonceAccount(testChain.account(nonceAccount), owner.address)).toEqual({ kind: 'missing' });
    expect((await testChain.send(bytes, [owner])).ok).toBe(true);

    const raw = testChain.account(nonceAccount);
    expect(readNonceAccount(raw, owner.address)).toEqual({
      kind: 'ready',
      authority: owner.address,
      value: testChain.nonceValue(nonceAccount),
      lamports,
    });
    const stranger = (await generateKeyPairSigner()).address;
    expect(readNonceAccount(raw, stranger)).toEqual({ kind: 'unusable', reason: 'authority', lamports });
  });
});
