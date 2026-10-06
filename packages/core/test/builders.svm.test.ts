// Every builder's transaction executes on LiteSVM with the mainnet stake program v5.1.0. This also confirms that the
// program accepts the legacy (Ledger) account layout for Withdraw, AuthorizeChecked, Deactivate and DelegateStake (D1).
import type { Address, KeyPairSigner } from '@solana/kit';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildTransaction,
  COMPUTE_UNIT_LIMIT,
  cosignFragment,
  deriveNonceAccountAddress,
  expectedFeePayer,
  lockupEndForPeriod,
  NONCE_ACCOUNT_SEED,
  NONCE_ACCOUNT_SIZE,
  parseCosignFragment,
  stakeActivationStatus,
  SYSTEM_PROGRAM_ADDRESS,
  type Lifetime,
  type Lockup,
  type TransactionAction,
  type TransactionKind,
} from '../src/index.ts';
import { LAMPORTS_PER_SOL, TestChain, type SendResult } from './svm.ts';
import { testWallet } from './wallet.ts';

const STAKE_LOCKUP_IN_FORCE = 1;
const DAY = 86_400n;

/** Compute units used per transaction kind, written to the log for DECISIONS.md. */
const computeUnits = new Map<TransactionKind, bigint>();

function expectOk(result: SendResult, kind: TransactionKind): void {
  if (!result.ok) throw new Error(`${kind} failed: ${JSON.stringify(result.error)}\n${result.logs.join('\n')}`);
  if (result.computeUnits > (computeUnits.get(kind) ?? 0n)) computeUnits.set(kind, result.computeUnits);
  // The fixed limit keeps at least half of itself free for a wallet's Lighthouse tail.
  expect(result.computeUnits * 2n).toBeLessThanOrEqual(BigInt(COMPUTE_UNIT_LIMIT));
}

afterAll(() => {
  console.info('compute units by kind:', Object.fromEntries([...computeUnits].map(([k, v]) => [k, Number(v)])));
});

let chain: TestChain;
let A: KeyPairSigner; // main key: withdrawer and staker
let K: KeyPairSigner; // second key: custodian
let D: KeyPairSigner; // new wallet for rescue

beforeEach(async () => {
  chain = await TestChain.create();
  [A, K, D] = await Promise.all([chain.fundedKey(), chain.fundedKey(), chain.fundedKey()]);
});

function build(action: TransactionAction, lifetime: Lifetime = chain.blockhashLifetime(), feePayer?: Address) {
  return buildTransaction(action, { feePayer: feePayer ?? expectedFeePayer(action), lifetime });
}

function lockedUntil(days: bigint): Lockup {
  return { unixTimestamp: chain.clock().unixTimestamp + days * DAY, epoch: 0n, custodian: K.address };
}

describe('protect (SetLockupChecked, main key + second key)', () => {
  it('locks an unlocked account with the second key as custodian', async () => {
    const stakeAccount = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address });
    const lockUntil = lockupEndForPeriod(chain.clock().unixTimestamp, 6);
    const tx = build({ kind: 'protect', stakeAccount, mainKey: A.address, secondKey: K.address, lockUntil });
    expect(tx.meta.signers).toEqual([A.address, K.address]);

    expectOk(await chain.send(tx.bytes, [A, K]), 'protect');
    expect(chain.stakeAccount(stakeAccount)?.lockup).toEqual({ unixTimestamp: lockUntil, epoch: 0n, custodian: K.address });

    // Now the main key alone cannot withdraw...
    const withdraw = build({
      kind: 'withdraw',
      stakeAccount,
      mainKey: A.address,
      secondKey: null,
      recipient: A.address,
      lamports: 1_000_000n,
    });
    expect(await chain.send(withdraw.bytes, [A])).toMatchObject({
      ok: false,
      error: { kind: 'custom', code: STAKE_LOCKUP_IN_FORCE },
    });
    // ...and cannot set the lock again by itself, even with a cooperating new custodian.
    const again = build({ kind: 'protect', stakeAccount, mainKey: A.address, secondKey: D.address, lockUntil: 1n });
    expect(await chain.send(again.bytes, [A, D])).toMatchObject({
      ok: false,
      error: { kind: 'instruction', name: 'MissingRequiredSignature' },
    });
  });

  it('works on a delegated account', async () => {
    const voteAccount = await chain.createVoteAccount();
    const stakeAccount = await chain.createStakeAccount({
      staker: A.address,
      withdrawer: A.address,
      delegateTo: { voteAccount, stakerKey: A },
    });
    const lockUntil = lockupEndForPeriod(chain.clock().unixTimestamp, 1);
    const tx = build({ kind: 'protect', stakeAccount, mainKey: A.address, secondKey: K.address, lockUntil });
    expectOk(await chain.send(tx.bytes, [A, K]), 'protect');
    expect(chain.stakeAccount(stakeAccount)?.lockup.custodian).toBe(K.address);
  });
});

describe('extend and unlock (SetLockup by the second key)', () => {
  it('extends the lock, paid by the second key', async () => {
    const stakeAccount = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address, lockup: lockedUntil(10n) });
    const lockUntil = chain.clock().unixTimestamp + 400n * DAY;
    const tx = build({ kind: 'extend', stakeAccount, secondKey: K.address, lockUntil });
    expect(tx.meta.signers).toEqual([K.address]);
    expectOk(await chain.send(tx.bytes, [K]), 'extend');
    expect(chain.stakeAccount(stakeAccount)?.lockup).toEqual({ unixTimestamp: lockUntil, epoch: 0n, custodian: K.address });
  });

  it('extends with the main key paying when the second key has no SOL (F5)', async () => {
    const stakeAccount = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address, lockup: lockedUntil(10n) });
    const lockUntil = chain.clock().unixTimestamp + 20n * DAY;
    const tx = build({ kind: 'extend', stakeAccount, secondKey: K.address, lockUntil }, undefined, A.address);
    expect(tx.meta.signers).toEqual([A.address, K.address]);
    expectOk(await chain.send(tx.bytes, [A, K]), 'extend');
    expect(chain.stakeAccount(stakeAccount)?.lockup.unixTimestamp).toBe(lockUntil);
  });

  it('unlocks early; then the main key withdraws alone', async () => {
    const stakeAccount = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address, lockup: lockedUntil(100n) });
    const tx = build({ kind: 'unlock', stakeAccount, secondKey: K.address });
    expectOk(await chain.send(tx.bytes, [K]), 'unlock');
    expect(chain.stakeAccount(stakeAccount)?.lockup).toEqual({ unixTimestamp: 0n, epoch: 0n, custodian: K.address });

    const balance = chain.balance(stakeAccount);
    const withdraw = build({
      kind: 'withdraw',
      stakeAccount,
      mainKey: A.address,
      secondKey: null,
      recipient: A.address,
      lamports: balance,
    });
    expectOk(await chain.send(withdraw.bytes, [A]), 'withdraw');
    expect(chain.account(stakeAccount)).toBeNull();
  });
});

describe('change-second-key (SetLockupChecked by the second key, with the new second key co-signing)', () => {
  it('hands the lock to the new second key; its end and epoch stay as they were', async () => {
    const K2 = await chain.fundedKey(1n);
    // A past epoch next to the date shows that the epoch is kept too, not reset to 0.
    const lockup: Lockup = { ...lockedUntil(100n), epoch: chain.clock().epoch - 1n };
    const stakeAccount = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address, lockup });
    const tx = build({ kind: 'change-second-key', stakeAccount, secondKey: K.address, newSecondKey: K2.address });
    expect(tx.meta.signers).toEqual([K2.address, K.address]);
    const kBefore = chain.balance(K.address);
    expectOk(await chain.send(tx.bytes, [K2, K]), 'change-second-key');
    expect(chain.stakeAccount(stakeAccount)?.lockup).toEqual({ ...lockup, custodian: K2.address });
    // The old second key pays nothing.
    expect(chain.balance(K.address)).toBe(kBefore);
  });

  it('works on a delegated account, paid by the main key when asked (the F5 fallback)', async () => {
    const K2 = await chain.fundedKey(1n);
    const voteAccount = await chain.createVoteAccount();
    const stakeAccount = await chain.createStakeAccount({
      staker: A.address,
      withdrawer: A.address,
      lockup: lockedUntil(30n),
      delegateTo: { voteAccount, stakerKey: A },
    });
    const tx = build({ kind: 'change-second-key', stakeAccount, secondKey: K.address, newSecondKey: K2.address }, undefined, A.address);
    expect(tx.meta.signers[0]).toBe(A.address);
    expectOk(await chain.send(tx.bytes, [A, K, K2]), 'change-second-key');
    expect(chain.stakeAccount(stakeAccount)?.lockup.custodian).toBe(K2.address);
  });
});

describe('withdraw (legacy layout, main key + second key)', () => {
  it('withdraws the full balance of a locked account to the main key', async () => {
    const stakeAccount = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address, lockup: lockedUntil(100n) });
    const balance = chain.balance(stakeAccount);
    const before = chain.balance(A.address);
    const tx = build({
      kind: 'withdraw',
      stakeAccount,
      mainKey: A.address,
      secondKey: K.address,
      recipient: A.address,
      lamports: balance,
    });
    expect(tx.meta.signers).toEqual([A.address, K.address]);
    expectOk(await chain.send(tx.bytes, [A, K]), 'withdraw');
    expect(chain.account(stakeAccount)).toBeNull();
    expect(chain.balance(A.address)).toBeGreaterThan(before + balance - LAMPORTS_PER_SOL / 1000n);
  });
});

describe('deactivate and delegate (legacy layout, staker only)', () => {
  it('deactivates a locked delegated account, then withdraws it after the epoch ends', async () => {
    const voteAccount = await chain.createVoteAccount();
    const stakeAccount = await chain.createStakeAccount({
      staker: A.address,
      withdrawer: A.address,
      lockup: lockedUntil(100n),
      delegateTo: { voteAccount, stakerKey: A },
    });
    const { epoch } = chain.clock();
    chain.warpToEpoch(epoch + 2n);
    expect(stakeActivationStatus(chain.stakeAccount(stakeAccount)?.delegation ?? null, epoch + 2n)).toBe('active');

    const tx = build({ kind: 'deactivate', stakeAccount, staker: A.address });
    expect(tx.meta.signers).toEqual([A.address]);
    expectOk(await chain.send(tx.bytes, [A]), 'deactivate');
    const delegation = chain.stakeAccount(stakeAccount)?.delegation ?? null;
    expect(delegation?.deactivationEpoch).toBe(epoch + 2n);
    expect(stakeActivationStatus(delegation, epoch + 2n)).toBe('deactivating');

    chain.warpToEpoch(epoch + 3n);
    expect(stakeActivationStatus(delegation, epoch + 3n)).toBe('inactive');
    const withdraw = build({
      kind: 'withdraw',
      stakeAccount,
      mainKey: A.address,
      secondKey: K.address,
      recipient: A.address,
      lamports: chain.balance(stakeAccount),
    });
    expectOk(await chain.send(withdraw.bytes, [A, K]), 'withdraw');
    expect(chain.account(stakeAccount)).toBeNull();
  });

  it('delegates a locked initialized account', async () => {
    const voteAccount = await chain.createVoteAccount();
    const stakeAccount = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address, lockup: lockedUntil(100n) });
    const tx = build({ kind: 'delegate', stakeAccount, staker: A.address, voteAccount });
    expect(tx.meta.signers).toEqual([A.address]);
    expectOk(await chain.send(tx.bytes, [A]), 'delegate');
    const account = chain.stakeAccount(stakeAccount);
    expect(account?.kind).toBe('delegated');
    expect(account?.delegation?.voter).toBe(voteAccount);
    expect(stakeActivationStatus(account?.delegation ?? null, chain.clock().epoch)).toBe('activating');
  });
});

describe('rescue (two AuthorizeChecked, legacy layout, main key + new wallet + second key)', () => {
  it('moves both authorities to the new wallet on a durable nonce, signed one wallet at a time over links', async () => {
    // The thief, holding only the main key, moved the staker to X and deactivated the stake.
    const X = await chain.fundedKey();
    const lockup = lockedUntil(100n);
    const voteAccount = await chain.createVoteAccount();
    const stakeAccount = await chain.createStakeAccount({
      staker: X.address,
      withdrawer: A.address,
      lockup,
      delegateTo: { voteAccount, stakerKey: X },
    });
    chain.warpToEpoch(chain.clock().epoch + 2n);
    expectOk(await chain.send(build({ kind: 'deactivate', stakeAccount, staker: X.address }).bytes, [X]), 'deactivate');
    chain.warpToEpoch(chain.clock().epoch + 1n);

    // D creates its nonce account (CreateAccountWithSeed, no extra keypair).
    const nonceAccount = await deriveNonceAccountAddress(D.address);
    const rent = chain.svm.minimumBalanceForRentExemption(BigInt(NONCE_ACCOUNT_SIZE));
    const setup = build({ kind: 'nonce-setup', nonceAccount, nonceAuthority: D.address, seed: NONCE_ACCOUNT_SEED, lamports: rent });
    expect(setup.meta.signers).toEqual([D.address]);
    expectOk(await chain.send(setup.bytes, [D]), 'nonce-setup');
    expect(chain.account(nonceAccount)).toMatchObject({ owner: SYSTEM_PROGRAM_ADDRESS, lamports: rent });
    const nonceValue = chain.nonceValue(nonceAccount);

    const rescue = build(
      { kind: 'rescue', stakeAccount, mainKey: A.address, secondKey: K.address, newWallet: D.address },
      { kind: 'nonce', nonceAccount, nonceAuthority: D.address, nonceValue },
    );
    expect(rescue.meta.feePayer).toBe(D.address);
    expect(new Set(rescue.meta.signers)).toEqual(new Set([D.address, A.address, K.address]));
    expect(rescue.meta.signers[0]).toBe(D.address);

    // Fee payer first, then the others; each signs exactly the bytes the previous one returned, carried by a link.
    let link = cosignFragment(rescue.bytes);
    for (const signer of [D, A, K]) {
      const bytes = parseCosignFragment(`#${link}`);
      if (bytes === null) throw new Error('link did not parse');
      const [signed] = await testWallet(signer).signTransactions([bytes]);
      if (signed === undefined) throw new Error('wallet returned nothing');
      link = cosignFragment(signed);
    }
    const final = parseCosignFragment(link);
    if (final === null) throw new Error('link did not parse');
    expectOk(await chain.send(final), 'rescue');

    const account = chain.stakeAccount(stakeAccount);
    expect(account?.staker).toBe(D.address);
    expect(account?.withdrawer).toBe(D.address);
    expect(account?.lockup).toEqual(lockup);
    expect(chain.nonceValue(nonceAccount)).not.toBe(nonceValue);

    // The same signed bytes cannot land twice: the nonce moved on.
    expect(await chain.send(final)).toMatchObject({ ok: false, error: { kind: 'transaction', name: 'BlockhashNotFound' } });

    // D closes the nonce account and gets the deposit back.
    const before = chain.balance(D.address);
    const close = build({
      kind: 'nonce-close',
      nonceAccount,
      nonceAuthority: D.address,
      recipient: D.address,
      lamports: chain.balance(nonceAccount),
    });
    expectOk(await chain.send(close.bytes, [D]), 'nonce-close');
    expect(chain.account(nonceAccount)).toBeNull();
    expect(chain.balance(D.address)).toBeGreaterThan(before + rent - 10_000n);

    // The new wallet delegates the stake again (F4 step 6).
    const delegate = build({ kind: 'delegate', stakeAccount, staker: D.address, voteAccount });
    expectOk(await chain.send(delegate.bytes, [D]), 'delegate');
    expect(stakeActivationStatus(chain.stakeAccount(stakeAccount)?.delegation ?? null, chain.clock().epoch)).toBe(
      'activating',
    );
  });

  it('also accepts a blockhash lifetime', async () => {
    const stakeAccount = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address, lockup: lockedUntil(100n) });
    const tx = build({ kind: 'rescue', stakeAccount, mainKey: A.address, secondKey: K.address, newWallet: D.address });
    expectOk(await chain.send(tx.bytes, [D, A, K]), 'rescue');
    expect(chain.stakeAccount(stakeAccount)).toMatchObject({ staker: D.address, withdrawer: D.address });
  });
});
