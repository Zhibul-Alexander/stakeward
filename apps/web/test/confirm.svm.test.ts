// @vitest-environment node
import { buildTransaction, translateError, type Lifetime } from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { createTestWalletPort, type TestWalletPort } from '@stakeward/core/test/test-wallet-port';
import { beforeEach, describe, expect, it } from 'vitest';
import { waitForConfirmation } from '@/ports/confirm';

// The confirmation wait against the real stake program: test wallets sign, LiteSvmChain sends and reports.
describe('waitForConfirmation on LiteSvmChain', () => {
  let testChain: TestChain;
  let chain: LiteSvmChain;
  let main: TestWalletPort;
  let second: TestWalletPort;

  beforeEach(async () => {
    testChain = await TestChain.create();
    chain = new LiteSvmChain(testChain);
    [main, second] = await Promise.all([
      createTestWalletPort({ name: 'Main', signers: [await testChain.fundedKey()], connected: true }),
      createTestWalletPort({ name: 'Second', signers: [await testChain.fundedKey()], connected: true }),
    ]);
  });

  async function signedProtect() {
    const mainKey = main.accounts[0];
    const secondKey = second.accounts[0];
    if (mainKey === undefined || secondKey === undefined) throw new Error('wallets not connected');
    const stakeAccount = await testChain.createStakeAccount({ staker: mainKey, withdrawer: mainKey });
    const lifetime: Lifetime = { kind: 'blockhash', ...(await chain.getLatestBlockhash()) };
    const built = buildTransaction(
      { kind: 'protect', stakeAccount, mainKey, secondKey, lockUntil: START_UNIX_TIMESTAMP + 3_600n },
      { feePayer: mainKey, lifetime },
    );
    const [byMain] = await main.signTransactions(mainKey, [built.bytes]);
    const [byBoth] = await second.signTransactions(secondKey, [byMain ?? new Uint8Array()]);
    if (byBoth === undefined) throw new Error('not signed');
    return { bytes: byBoth, lifetime, stakeAccount, secondKey };
  }

  it('confirms a protect transaction and the account reads back protected', async () => {
    const { bytes, lifetime, stakeAccount, secondKey } = await signedProtect();
    const signature = await chain.send(bytes);
    const outcome = await waitForConfirmation(chain, signature, lifetime, { pollIntervalMs: 1 });
    expect(outcome).toMatchObject({ status: 'confirmed', confirmationStatus: 'confirmed' });
    expect(testChain.stakeAccount(stakeAccount)?.lockup.custodian).toBe(secondKey);
  });

  it('reports expiry when the transaction never lands and its blockhash runs out', async () => {
    const { bytes, lifetime } = await signedProtect();
    chain.holdTransactions();
    const signature = await chain.send(bytes);
    chain.dropHeld();
    const waiting = waitForConfirmation(chain, signature, lifetime, { pollIntervalMs: 5 });
    setTimeout(() => {
      chain.expireBlockhash();
    }, 20);
    expect(await waiting).toEqual({ status: 'expired' });

    // Rebuilt on the new blockhash, the old bytes are refused before they could land twice.
    const error: unknown = await chain.send(bytes).catch((e: unknown) => e);
    expect(translateError(error, { transaction: bytes }).code).toBe('blockhash-expired');
  });

  it('keeps waiting while the transaction is in flight, then confirms when it lands', async () => {
    const { bytes, lifetime } = await signedProtect();
    chain.holdTransactions();
    const signature = await chain.send(bytes);
    const waiting = waitForConfirmation(chain, signature, lifetime, { pollIntervalMs: 5 });
    setTimeout(() => {
      chain.landHeld();
    }, 20);
    expect(await waiting).toMatchObject({ status: 'confirmed' });
  });

  it('reports a transaction that landed with an error (preflight skipped)', async () => {
    const noPreflight = new LiteSvmChain(testChain, { preflight: false });
    // First lock the account, then a withdraw by the main key alone: the lock refuses it on chain.
    const { bytes, lifetime } = await signedProtect();
    const signature = await noPreflight.send(bytes);
    expect(await waitForConfirmation(noPreflight, signature, lifetime, { pollIntervalMs: 1 })).toMatchObject({
      status: 'confirmed',
    });
    const mainKey = main.accounts[0];
    if (mainKey === undefined) throw new Error('not connected');
    const stakeAccount = (await noPreflight.findStakeAccounts({ withdrawer: mainKey })).accounts[0]?.address;
    if (stakeAccount === undefined) throw new Error('no stake account');
    const withdrawLifetime: Lifetime = { kind: 'blockhash', ...(await noPreflight.getLatestBlockhash()) };
    const withdraw = buildTransaction(
      { kind: 'withdraw', stakeAccount, mainKey, secondKey: null, recipient: mainKey, lamports: 1n },
      { feePayer: mainKey, lifetime: withdrawLifetime },
    );
    const [signedWithdraw] = await main.signTransactions(mainKey, [withdraw.bytes]);
    if (signedWithdraw === undefined) throw new Error('not signed');
    const failed = await noPreflight.send(signedWithdraw);
    const outcome = await waitForConfirmation(noPreflight, failed, withdrawLifetime, { pollIntervalMs: 1 });
    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(translateError(outcome.error, { transaction: signedWithdraw }).code).toBe('lockup-in-force');
  });
});
