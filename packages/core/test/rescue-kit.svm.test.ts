// One-tap rescue kit (D118): signed in advance on its own nonce, it still lands after the thief moved the staker.
import type { Address, KeyPairSigner } from '@solana/kit';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildTransaction,
  checkRescueKit,
  deriveNonceAccountAddress,
  expectedFeePayer,
  NONCE_ACCOUNT_SEED,
  NONCE_ACCOUNT_SIZE,
  rescueKitNonceSeed,
  type Lifetime,
  type TransactionAction,
} from '../src/index.ts';
import { START_UNIX_TIMESTAMP, TestChain, type SendResult } from './svm.ts';
import { changeStaker } from './thief.ts';
import { testWallet } from './wallet.ts';

function expectOk(result: SendResult, what: string): void {
  if (!result.ok) throw new Error(`${what} failed: ${JSON.stringify(result.error)}\n${result.logs.join('\n')}`);
}

describe('rescue kit', { timeout: 30_000 }, () => {
  let chain: TestChain;
  let A: KeyPairSigner;
  let K: KeyPairSigner;
  let D: KeyPairSigner;
  let X: KeyPairSigner;

  const build = (action: TransactionAction, lifetime: Lifetime = chain.blockhashLifetime()) =>
    buildTransaction(action, { feePayer: expectedFeePayer(action), lifetime });

  async function signAll(bytes: Uint8Array, signers: readonly KeyPairSigner[]): Promise<Uint8Array> {
    let current = bytes;
    for (const signer of signers) {
      const [signed] = await testWallet(signer).signTransactions([current]);
      if (signed === undefined) throw new Error('wallet returned nothing');
      current = signed;
    }
    return current;
  }

  async function createNonce(seed: string): Promise<Address> {
    const nonceAccount = await deriveNonceAccountAddress(D.address, seed);
    const lamports = chain.svm.minimumBalanceForRentExemption(BigInt(NONCE_ACCOUNT_SIZE));
    const setup = build({ kind: 'nonce-setup', nonceAccount, nonceAuthority: D.address, seed, lamports });
    expectOk(await chain.send(setup.bytes, [D]), 'nonce-setup');
    return nonceAccount;
  }

  async function prepareKit(stakeAccount: Address): Promise<Uint8Array> {
    const nonceAccount = await createNonce(rescueKitNonceSeed(stakeAccount));
    const rescue = build(
      { kind: 'rescue', stakeAccount, mainKey: A.address, secondKey: K.address, newWallet: D.address },
      { kind: 'nonce', nonceAccount, nonceAuthority: D.address, nonceValue: chain.nonceValue(nonceAccount) },
    );
    return signAll(rescue.bytes, [D, A, K]);
  }

  beforeEach(async () => {
    chain = await TestChain.create();
    [A, K, D, X] = await Promise.all([chain.fundedKey(0n), chain.fundedKey(0n), chain.fundedKey(), chain.fundedKey()]);
  });

  it('is accepted, survives a staker change by the thief and moves both authorities to the new wallet', async () => {
    const lockup = { unixTimestamp: START_UNIX_TIMESTAMP + 3_600n, epoch: 0n, custodian: K.address };
    const stakeAccount = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address, lockup });
    const kit = await prepareKit(stakeAccount);

    const checked = await checkRescueKit(kit);
    expect(checked).toMatchObject({
      ok: true,
      kit: { stakeAccount, mainKey: A.address, secondKey: K.address, newWallet: D.address },
    });

    // The new wallet uses its ordinary link-signing nonce meanwhile: the kit's own nonce does not move.
    await createNonce(NONCE_ACCOUNT_SEED);

    await changeStaker(chain, { stake: stakeAccount, withdrawer: A, newStaker: X });
    expectOk(await chain.send(kit), 'rescue kit');

    const account = chain.stakeAccount(stakeAccount);
    expect(account).toMatchObject({ staker: D.address, withdrawer: D.address, lockup });
    expect(chain.balance(A.address)).toBe(0n);
  });

  it('refuses a kit with a missing signature, a rescue on a blockhash and one on the ordinary nonce', async () => {
    const lockup = { unixTimestamp: START_UNIX_TIMESTAMP + 3_600n, epoch: 0n, custodian: K.address };
    const stakeAccount = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address, lockup });
    const action: TransactionAction = {
      kind: 'rescue',
      stakeAccount,
      mainKey: A.address,
      secondKey: K.address,
      newWallet: D.address,
    };

    const kitNonce = await createNonce(rescueKitNonceSeed(stakeAccount));
    const partial = await signAll(
      build(action, { kind: 'nonce', nonceAccount: kitNonce, nonceAuthority: D.address, nonceValue: chain.nonceValue(kitNonce) }).bytes,
      [D, A],
    );
    expect(await checkRescueKit(partial)).toMatchObject({ ok: false, code: 'signatures' });

    const onBlockhash = await signAll(build(action).bytes, [D, A, K]);
    expect(await checkRescueKit(onBlockhash)).toMatchObject({ ok: false, code: 'wrong-nonce' });

    const ordinary = await createNonce(NONCE_ACCOUNT_SEED);
    const onOrdinary = await signAll(
      build(action, { kind: 'nonce', nonceAccount: ordinary, nonceAuthority: D.address, nonceValue: chain.nonceValue(ordinary) }).bytes,
      [D, A, K],
    );
    expect(await checkRescueKit(onOrdinary)).toMatchObject({ ok: false, code: 'wrong-nonce' });

    const deactivate = await signAll(build({ kind: 'deactivate', stakeAccount, staker: A.address }).bytes, [A]);
    expect(await checkRescueKit(deactivate)).toMatchObject({ ok: false, code: 'not-rescue' });
    expect(await checkRescueKit(new Uint8Array([1, 2, 3]))).toMatchObject({ ok: false, code: 'not-stakeward' });
  });
});
