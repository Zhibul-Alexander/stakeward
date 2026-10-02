import { getTransactionDecoder, getTransactionEncoder, partiallySignTransaction, type KeyPairSigner } from '@solana/kit';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildTransaction,
  deriveNonceAccountAddress,
  NONCE_ACCOUNT_SEED,
  NONCE_ACCOUNT_SIZE,
  STAKE_ACCOUNT_SIZE,
  translateError,
  ZERO_ADDRESS,
  type ChainPort,
  type Lifetime,
  type TransactionAction,
} from '../src/index.ts';
import { BLOCKHASH_VALIDITY_BLOCKS, LiteSvmChain, LITESVM_CHAIN_MARKER } from './litesvm-chain.ts';
import { LAMPORTS_PER_SOL, START_EPOCH, START_UNIX_TIMESTAMP, TestChain } from './svm.ts';

const HOUR = 3_600n;

async function sign(bytes: Uint8Array, ...signers: KeyPairSigner[]): Promise<Uint8Array> {
  const signed = await partiallySignTransaction(
    signers.map((signer) => signer.keyPair),
    getTransactionDecoder().decode(bytes),
  );
  return new Uint8Array(getTransactionEncoder().encode(signed));
}

describe('LiteSvmChain', () => {
  let testChain: TestChain;
  let chain: LiteSvmChain;
  let A: KeyPairSigner;
  let K: KeyPairSigner;

  beforeEach(async () => {
    testChain = await TestChain.create();
    chain = new LiteSvmChain(testChain);
    [A, K] = await Promise.all([testChain.fundedKey(), testChain.fundedKey()]);
  });

  async function lifetime(port: ChainPort = chain): Promise<Lifetime> {
    return { kind: 'blockhash', ...(await port.getLatestBlockhash()) };
  }

  async function protect(stakeAccount: Awaited<ReturnType<TestChain['createStakeAccount']>>, lockUntil: bigint) {
    const action: TransactionAction = { kind: 'protect', stakeAccount, mainKey: A.address, secondKey: K.address, lockUntil };
    return buildTransaction(action, { feePayer: A.address, lifetime: await lifetime() });
  }

  it('carries the test-only marker (no build may contain it)', () => {
    expect(chain.marker).toBe(LITESVM_CHAIN_MARKER);
    expect(LITESVM_CHAIN_MARKER.startsWith('stakeward-test-only:')).toBe(true);
  });

  it('reads accounts, clock, balance and rent from LiteSVM', async () => {
    const stake = await testChain.createStakeAccount({ staker: A.address, withdrawer: A.address });
    const missing = (await testChain.fundedKey(0n)).address;
    const { slot, accounts } = await chain.getAccounts([stake, missing]);
    expect(slot).toBe(testChain.svm.getClock().slot);
    expect(accounts[0]).toMatchObject({ address: stake, lamports: testChain.balance(stake) });
    expect(accounts[0]?.data.length).toBe(STAKE_ACCOUNT_SIZE);
    expect(accounts[1]).toBeNull();

    expect(await chain.getClock()).toEqual({ slot, epoch: START_EPOCH, unixTimestamp: START_UNIX_TIMESTAMP });
    expect(await chain.getBalance(A.address)).toBe(10n * LAMPORTS_PER_SOL);
    expect(await chain.getBalance(missing)).toBe(0n);
    // Mainnet rent (D22): 5080 lamports per byte including the 128-byte header.
    expect(await chain.getMinimumBalanceForRentExemption(STAKE_ACCOUNT_SIZE)).toBe(1_666_240n);
    expect(await chain.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_SIZE)).toBe(1_056_640n);
  });

  it('finds stake accounts by main key (withdrawer) and by second key (custodian), decoded', async () => {
    const other = await testChain.fundedKey(0n);
    const unlocked = await testChain.createStakeAccount({ staker: A.address, withdrawer: A.address });
    const locked = await testChain.createStakeAccount({
      staker: A.address,
      withdrawer: A.address,
      lockup: { unixTimestamp: START_UNIX_TIMESTAMP + HOUR, epoch: 0n, custodian: K.address },
    });
    const notMine = await testChain.createStakeAccount({ staker: other.address, withdrawer: other.address });

    const byMain = await chain.findStakeAccounts({ withdrawer: A.address });
    expect(byMain.accounts.map((account) => account.address).sort()).toEqual([unlocked, locked].sort());
    expect(byMain.accounts.find((account) => account.address === locked)?.lockup).toEqual({
      unixTimestamp: START_UNIX_TIMESTAMP + HOUR,
      epoch: 0n,
      custodian: K.address,
    });
    expect((await chain.findStakeAccounts({ custodian: K.address })).accounts.map((a) => a.address)).toEqual([locked]);
    expect((await chain.findStakeAccounts({ withdrawer: K.address })).accounts).toEqual([]);
    expect(byMain.accounts.some((account) => account.address === notMine)).toBe(false);
    expect((await chain.findStakeAccounts({ custodian: ZERO_ADDRESS })).accounts.map((a) => a.address).sort()).toEqual(
      [unlocked, notMine].sort(),
    );
  });

  it('protects an account end to end: simulate partly signed, send, confirm, read back', async () => {
    const stake = await testChain.createStakeAccount({ staker: A.address, withdrawer: A.address });
    const lockUntil = START_UNIX_TIMESTAMP + HOUR;
    const built = await protect(stake, lockUntil);

    const partly = await sign(built.bytes, A);
    const simulation = await chain.simulate(partly);
    expect(simulation).toMatchObject({ ok: true });
    expect(simulation.unitsConsumed).toBeGreaterThan(0n);

    const signed = await sign(partly, K);
    const signature = await chain.send(signed);
    expect(await chain.getSignatureStatuses([signature])).toEqual([
      { slot: testChain.svm.getClock().slot, confirmationStatus: 'confirmed', error: null },
    ]);
    expect(testChain.stakeAccount(stake)?.lockup).toEqual({ unixTimestamp: lockUntil, epoch: 0n, custodian: K.address });

    // Sending the same bytes again is safe and answers with the same signature (CLAUDE.md section 12).
    expect(await chain.send(signed)).toBe(signature);
  });

  it('rejects a send that fails preflight with the error translateError reads, and lands nothing', async () => {
    const stake = await testChain.createStakeAccount({
      staker: A.address,
      withdrawer: A.address,
      lockup: { unixTimestamp: START_UNIX_TIMESTAMP + HOUR, epoch: 0n, custodian: K.address },
    });
    const action: TransactionAction = {
      kind: 'withdraw',
      stakeAccount: stake,
      mainKey: A.address,
      secondKey: null,
      recipient: A.address,
      lamports: LAMPORTS_PER_SOL,
    };
    const built = buildTransaction(action, { feePayer: A.address, lifetime: await lifetime() });
    const signed = await sign(built.bytes, A);

    const simulation = await chain.simulate(signed);
    expect(simulation.ok).toBe(false);
    if (simulation.ok) return;
    expect(translateError(simulation.error, { transaction: signed }).code).toBe('lockup-in-force');

    const balance = testChain.balance(A.address);
    const error: unknown = await chain.send(signed).catch((e: unknown) => e);
    expect(translateError(error, { transaction: signed }).code).toBe('lockup-in-force');
    expect(testChain.balance(A.address)).toBe(balance); // no fee: it never landed
  });

  it('without preflight a failing transaction lands with an error in its status', async () => {
    const noPreflight = new LiteSvmChain(testChain, { preflight: false });
    const stake = await testChain.createStakeAccount({
      staker: A.address,
      withdrawer: A.address,
      lockup: { unixTimestamp: START_UNIX_TIMESTAMP + HOUR, epoch: 0n, custodian: K.address },
    });
    const built = buildTransaction(
      { kind: 'withdraw', stakeAccount: stake, mainKey: A.address, secondKey: null, recipient: A.address, lamports: 1n },
      { feePayer: A.address, lifetime: await lifetime(noPreflight) },
    );
    const signed = await sign(built.bytes, A);
    const signature = await noPreflight.send(signed);
    const [status] = await noPreflight.getSignatureStatuses([signature]);
    expect(status?.confirmationStatus).toBe('confirmed');
    expect(translateError(status?.error, { transaction: signed }).code).toBe('lockup-in-force');
  });

  it('rejects a transaction without the fee payer signature before anything runs', async () => {
    const stake = await testChain.createStakeAccount({ staker: A.address, withdrawer: A.address });
    const built = await protect(stake, START_UNIX_TIMESTAMP + HOUR);
    const onlyK = await sign(built.bytes, K);
    const error: unknown = await chain.send(onlyK).catch((e: unknown) => e);
    expect(translateError(error).code).toBe('missing-signature');
  });

  it('emulates block height: a blockhash expires after expireBlockhash() or 150 blocks', async () => {
    const first = await chain.getLatestBlockhash();
    const height = await chain.getBlockHeight();
    expect(first.lastValidBlockHeight).toBe(height + BLOCKHASH_VALIDITY_BLOCKS);
    expect(await chain.getLatestBlockhash()).toEqual(first); // stable until it expires

    chain.advanceBlocks(10n);
    expect(await chain.getBlockHeight()).toBe(height + 10n);
    expect((await chain.getLatestBlockhash()).blockhash).toBe(first.blockhash);

    chain.advanceBlocks(BLOCKHASH_VALIDITY_BLOCKS);
    expect(await chain.getBlockHeight()).toBeGreaterThan(first.lastValidBlockHeight);
    const second = await chain.getLatestBlockhash();
    expect(second.blockhash).not.toBe(first.blockhash);

    // Setup transactions of the harness also move LiteSVM's blockhash on: the emulation follows.
    await testChain.createStakeAccount({ staker: A.address, withdrawer: A.address });
    expect(await chain.getBlockHeight()).toBeGreaterThan(second.lastValidBlockHeight);
  });

  it('a transaction on an expired blockhash is refused as blockhash-expired', async () => {
    const stake = await testChain.createStakeAccount({ staker: A.address, withdrawer: A.address });
    const built = await protect(stake, START_UNIX_TIMESTAMP + HOUR);
    chain.expireBlockhash();
    const signed = await sign(built.bytes, A, K);
    const error: unknown = await chain.send(signed).catch((e: unknown) => e);
    expect(translateError(error, { transaction: signed }).code).toBe('blockhash-expired');
  });

  it('holds sent transactions in flight until landed or dropped', async () => {
    const s1 = await testChain.createStakeAccount({ staker: A.address, withdrawer: A.address });
    const s2 = await testChain.createStakeAccount({ staker: A.address, withdrawer: A.address });
    const lockUntil = START_UNIX_TIMESTAMP + HOUR;
    const t1 = await sign((await protect(s1, lockUntil)).bytes, A, K);
    const t2 = await sign((await protect(s2, lockUntil)).bytes, A, K);

    chain.holdTransactions();
    const sig1 = await chain.send(t1);
    expect(await chain.getSignatureStatuses([sig1])).toEqual([null]);
    expect(await chain.send(t1)).toBe(sig1);
    chain.landHeld();
    expect((await chain.getSignatureStatuses([sig1]))[0]?.error).toBeNull();
    expect(testChain.stakeAccount(s1)?.lockup.custodian).toBe(K.address);

    chain.holdTransactions();
    const sig2 = await chain.send(t2);
    chain.dropHeld();
    expect(await chain.getSignatureStatuses([sig2])).toEqual([null]);
    expect(testChain.stakeAccount(s2)?.lockup.custodian).toBe(ZERO_ADDRESS);
  });

  it('fails the next calls on request, e.g. a network error', async () => {
    const offline = new TypeError('Failed to fetch');
    chain.failNext('getClock', offline, 2);
    await expect(chain.getClock()).rejects.toBe(offline);
    await expect(chain.getClock()).rejects.toBe(offline);
    expect(translateError(offline).code).toBe('network');
    await expect(chain.getClock()).resolves.toMatchObject({ epoch: START_EPOCH });
  });

  it('runs a durable-nonce transaction (LiteSVM needs the blockhash moved past the nonce value)', async () => {
    const D = await testChain.fundedKey();
    const stake = await testChain.createStakeAccount({ staker: A.address, withdrawer: A.address });
    const nonceAccount = await deriveNonceAccountAddress(D.address);
    const rent = await chain.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_SIZE);
    const setup = buildTransaction(
      { kind: 'nonce-setup', nonceAccount, nonceAuthority: D.address, seed: NONCE_ACCOUNT_SEED, lamports: rent },
      { feePayer: D.address, lifetime: await lifetime() },
    );
    await chain.send(await sign(setup.bytes, D));
    const nonceValue = testChain.nonceValue(nonceAccount);
    const blockhashAtSetup = testChain.svm.latestBlockhash();

    const built = buildTransaction(
      { kind: 'protect', stakeAccount: stake, mainKey: A.address, secondKey: K.address, lockUntil: START_UNIX_TIMESTAMP + HOUR },
      { feePayer: A.address, lifetime: { kind: 'nonce', nonceAccount, nonceAuthority: D.address, nonceValue } },
    );
    const signed = await sign(built.bytes, A, K, D);
    expect(await chain.simulate(signed)).toMatchObject({ ok: true });
    expect(testChain.svm.latestBlockhash()).not.toBe(blockhashAtSetup);
    const signature = await chain.send(signed);
    expect((await chain.getSignatureStatuses([signature]))[0]?.error).toBeNull();
    expect(testChain.nonceValue(nonceAccount)).not.toBe(nonceValue);
  });
});
