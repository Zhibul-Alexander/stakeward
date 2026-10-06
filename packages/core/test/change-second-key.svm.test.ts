// F7 on LiteSVM with the mainnet stake program v5.1.0: the second key hands the lock to a new second key. The
// SetLockupChecked passes neither a lock end nor an epoch, and the program keeps both; from then on only the new key
// co-signs. The check against the chain (core secondKeyChangeProblem) refuses what the program would take but what
// protects nothing (the main key as the new second key), and what the program would refuse.
import { getSolanaErrorFromLiteSvmFailure } from '@solana/kit-plugin-litesvm';
import {
  generateKeyPairSigner,
  getTransactionDecoder,
  partiallySignTransaction,
  type Address,
  type KeyPairSigner,
  type SolanaError,
} from '@solana/kit';
import { FailedTransactionMetadata } from 'litesvm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  actionApplied,
  buildTransaction,
  expectedFeePayer,
  inspectTransaction,
  lockupEndForPeriod,
  networkFeeFor,
  secondKeyChangeProblem,
  translateError,
  type ChangeSecondKeyAction,
  type StakeAccount,
  type TransactionAction,
} from '../src/index.ts';
import { LAMPORTS_PER_SOL, TestChain } from './svm.ts';

const STAKE_LOCKUP_IN_FORCE = 1;
const DAY = 86_400n;

let chain: TestChain;
let A: KeyPairSigner; // main key: withdrawer and staker
let K: KeyPairSigner; // second key, which may be stolen
let K2: KeyPairSigner; // new second key, from its own seed phrase

beforeEach(async () => {
  chain = await TestChain.create();
  [A, K, K2] = await Promise.all([chain.fundedKey(), chain.fundedKey(), chain.fundedKey(1n)]);
});

function build(action: TransactionAction, feePayer: Address = expectedFeePayer(action)): Uint8Array {
  return buildTransaction(action, { feePayer, lifetime: chain.blockhashLifetime() }).bytes;
}

function read(stakeAccount: Address): StakeAccount {
  const account = chain.stakeAccount(stakeAccount);
  if (account === null) throw new Error(`${stakeAccount} is gone`);
  return account;
}

/** A stake account the main key protects with K for 6 months (F1), as the protect wizard leaves it. */
async function protectedAccount(): Promise<{ stakeAccount: Address; lockUntil: bigint }> {
  const stakeAccount = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address });
  const lockUntil = lockupEndForPeriod(chain.clock().unixTimestamp, 6);
  const protect = build({ kind: 'protect', stakeAccount, mainKey: A.address, secondKey: K.address, lockUntil });
  const result = await chain.send(protect, [A, K]);
  if (!result.ok) throw new Error(`protect failed: ${JSON.stringify(result.error)}`);
  return { stakeAccount, lockUntil };
}

function withdraw(stakeAccount: Address, secondKey: Address | null, lamports: bigint): Uint8Array {
  return build({ kind: 'withdraw', stakeAccount, mainKey: A.address, secondKey, recipient: A.address, lamports });
}

/** Signs and sends without the harness's error mapping: the SolanaError a page's ChainPort would see. */
async function failure(bytes: Uint8Array, signers: readonly KeyPairSigner[]): Promise<SolanaError> {
  const signed = await partiallySignTransaction(
    signers.map((signer) => signer.keyPair),
    getTransactionDecoder().decode(bytes),
  );
  const result = chain.svm.sendTransaction(signed);
  if (!(result instanceof FailedTransactionMetadata)) throw new Error('expected the transaction to fail');
  return getSolanaErrorFromLiteSvmFailure(result);
}

describe('F7: protect with K, hand the lock to K2, then only K2 co-signs', () => {
  it('the end stays; A + K can no longer withdraw, A + K2 can', async () => {
    const { stakeAccount, lockUntil } = await protectedAccount();
    const before = read(stakeAccount);
    expect(before.lockup).toEqual({ unixTimestamp: lockUntil, epoch: 0n, custodian: K.address });

    const change: ChangeSecondKeyAction = { kind: 'change-second-key', stakeAccount, secondKey: K.address, newSecondKey: K2.address };
    expect(secondKeyChangeProblem(change, before, chain.clock())).toBeNull();
    const bytes = build(change);
    const inspected = await inspectTransaction(bytes);
    expect(inspected.ok && inspected.summary).toMatchObject({ action: change, feePayer: K2.address, requiredSigners: [K2.address, K.address] });
    expect(actionApplied(change, chain.account(stakeAccount), before)).toBe(false);

    const kBefore = chain.balance(K.address);
    const k2Before = chain.balance(K2.address);
    expect((await chain.send(bytes, [K2, K])).ok).toBe(true);
    expect(read(stakeAccount).lockup).toEqual({ unixTimestamp: lockUntil, epoch: 0n, custodian: K2.address });
    expect(actionApplied(change, chain.account(stakeAccount), before)).toBe(true);
    // The new second key paid; the old one, which may be drained by a thief, paid nothing.
    expect(chain.balance(K2.address)).toBe(k2Before - networkFeeFor(2));
    expect(chain.balance(K.address)).toBe(kBefore);

    // The old second key no longer lifts the lock for a withdrawal...
    expect(await chain.send(withdraw(stakeAccount, K.address, LAMPORTS_PER_SOL), [A, K])).toMatchObject({
      ok: false,
      error: { kind: 'custom', code: STAKE_LOCKUP_IN_FORCE },
    });
    // ...and cannot move the lock any more (a thief with K is locked out).
    const extendByOldKey = build({ kind: 'extend', stakeAccount, secondKey: K.address, lockUntil: lockUntil + 30n * DAY });
    expect(await chain.send(extendByOldKey, [K])).toMatchObject({
      ok: false,
      error: { kind: 'instruction', name: 'MissingRequiredSignature' },
    });
    const changeBack = build({ kind: 'change-second-key', stakeAccount, secondKey: K.address, newSecondKey: A.address }, A.address);
    expect(await chain.send(changeBack, [A, K])).toMatchObject({
      ok: false,
      error: { kind: 'instruction', name: 'MissingRequiredSignature' },
    });

    // The new second key co-signs a withdrawal.
    expect((await chain.send(withdraw(stakeAccount, K2.address, LAMPORTS_PER_SOL), [A, K2])).ok).toBe(true);
    expect(read(stakeAccount).lockup.custodian).toBe(K2.address);
  });

  it('keeps an epoch lock as it is too: only the key changes', async () => {
    const lockup = { unixTimestamp: 0n, epoch: chain.clock().epoch + 5n, custodian: K.address };
    const stakeAccount = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address, lockup });
    const change: ChangeSecondKeyAction = { kind: 'change-second-key', stakeAccount, secondKey: K.address, newSecondKey: K2.address };
    expect(secondKeyChangeProblem(change, read(stakeAccount), chain.clock())).toBeNull();
    expect((await chain.send(build(change), [K2, K])).ok).toBe(true);
    expect(read(stakeAccount).lockup).toEqual({ ...lockup, custodian: K2.address });
  });
});

describe('F7: who pays', () => {
  it('the main key pays and co-signs when the new second key has no SOL', async () => {
    const { stakeAccount, lockUntil } = await protectedAccount();
    const empty = await generateKeyPairSigner();
    expect(chain.balance(empty.address)).toBe(0n);
    const change: ChangeSecondKeyAction = { kind: 'change-second-key', stakeAccount, secondKey: K.address, newSecondKey: empty.address };

    // Paid by a key without SOL, the network refuses it before the program runs.
    expect((await chain.send(build(change), [empty, K])).ok).toBe(false);
    expect(read(stakeAccount).lockup.custodian).toBe(K.address);

    // The fallback: the main key pays for all three signatures; the old second key pays nothing.
    const aBefore = chain.balance(A.address);
    const kBefore = chain.balance(K.address);
    const bytes = build(change, A.address);
    const inspected = await inspectTransaction(bytes);
    expect(inspected.ok && inspected.summary.feePayer).toBe(A.address);
    expect((await chain.send(bytes, [A, K, empty])).ok).toBe(true);
    expect(read(stakeAccount).lockup).toEqual({ unixTimestamp: lockUntil, epoch: 0n, custodian: empty.address });
    expect(chain.balance(A.address)).toBe(aBefore - networkFeeFor(3));
    expect(chain.balance(K.address)).toBe(kBefore);
    expect(chain.balance(empty.address)).toBe(0n);
  });

  it('Stakeward never builds one the old second key pays for', () => {
    const change: TransactionAction = { kind: 'change-second-key', stakeAccount: K2.address, secondKey: K.address, newSecondKey: A.address };
    expect(() => build(change, K.address)).toThrow(/never paid by the old second key/);
  });
});

describe('F7: the check against the chain', () => {
  it('refuses the main key as the new second key: the program would take it, and the lock would then protect nothing', async () => {
    const { stakeAccount } = await protectedAccount();
    const toMainKey: ChangeSecondKeyAction = { kind: 'change-second-key', stakeAccount, secondKey: K.address, newSecondKey: A.address };
    expect(secondKeyChangeProblem(toMainKey, read(stakeAccount), chain.clock())).toBe('main-key');

    // Why: sent anyway, the program accepts it (the custodian is any key) ...
    expect((await chain.send(build(toMainKey, A.address), [A, K])).ok).toBe(true);
    expect(read(stakeAccount).lockup.custodian).toBe(A.address);
    // ... and the main key alone, as a thief would hold it, removes the lock and withdraws everything.
    expect((await chain.send(build({ kind: 'unlock', stakeAccount, secondKey: A.address }), [A])).ok).toBe(true);
    expect((await chain.send(withdraw(stakeAccount, null, chain.balance(stakeAccount)), [A])).ok).toBe(true);
    expect(chain.account(stakeAccount)).toBeNull();
  });

  it('refuses a key that does not hold the lock; the program says MissingRequiredSignature, which reads in plain words', async () => {
    const X = await chain.fundedKey();
    // Another key holds the lock now (for example a thief who moved it first).
    const { stakeAccount } = await protectedAccount();
    const byOther: ChangeSecondKeyAction = { kind: 'change-second-key', stakeAccount, secondKey: X.address, newSecondKey: K2.address };
    expect(secondKeyChangeProblem(byOther, read(stakeAccount), chain.clock())).toBe('not-current-second-key');
    const bytes = build(byOther);
    const error = await failure(bytes, [K2, X]);
    expect(translateError(error, { transaction: bytes })).toMatchObject({
      code: 'missing-signature',
      title: 'A key that must sign did not, or it no longer controls this stake. Check the connected wallets and try again.',
    });

    // No lock in force: SetLockupChecked then wants the main key (that is protect), not a second key.
    const unlocked = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address });
    const onUnlocked: ChangeSecondKeyAction = { kind: 'change-second-key', stakeAccount: unlocked, secondKey: K.address, newSecondKey: K2.address };
    expect(secondKeyChangeProblem(onUnlocked, read(unlocked), chain.clock())).toBe('not-locked');
    expect(await chain.send(build(onUnlocked), [K2, K])).toMatchObject({
      ok: false,
      error: { kind: 'instruction', name: 'MissingRequiredSignature' },
    });

    // A lock that ended works the same way.
    chain.setTime(read(stakeAccount).lockup.unixTimestamp);
    const late: ChangeSecondKeyAction = { kind: 'change-second-key', stakeAccount, secondKey: K.address, newSecondKey: K2.address };
    expect(secondKeyChangeProblem(late, read(stakeAccount), chain.clock())).toBe('not-locked');
    expect(await chain.send(build(late), [K2, K])).toMatchObject({
      ok: false,
      error: { kind: 'instruction', name: 'MissingRequiredSignature' },
    });
  });
});
