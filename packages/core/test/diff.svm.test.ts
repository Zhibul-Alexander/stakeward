// Snapshot comparison on accounts changed by real transactions on LiteSVM (mainnet stake program v5.1.0): each event
// type comes out of the change that causes it in the product's threat model, and the EXPIRED boundary matches the
// moment the program stops enforcing the lock. Pure cases are in src/diff.test.ts.
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from '@solana/kit';
import { getAuthorizeCheckedInstruction, StakeAuthorize } from '@solana-program/stake';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildTransaction,
  decodeStakeAccount,
  diffSnapshots,
  expectedFeePayer,
  needsWithdrawerRescan,
  snapshotOf,
  type AccountSnapshot,
  type MonitorEvent,
  type TransactionAction,
} from '../src/index.ts';
import { FIXTURES, rawFromFixture } from './fixtures.ts';
import { LAMPORTS_PER_SOL, START_EPOCH, TestChain } from './svm.ts';

const DAY = 86_400n;

let chain: TestChain;
let A: KeyPairSigner; // main key: staker and withdrawer
let K: KeyPairSigner; // second key
let K2: KeyPairSigner; // replacement second key (F7)
let D: KeyPairSigner; // new wallet (rescue)
let X: KeyPairSigner; // thief's own key

beforeEach(async () => {
  chain = await TestChain.create();
  [A, K, K2, D, X] = await Promise.all([
    chain.fundedKey(),
    chain.fundedKey(),
    chain.fundedKey(),
    chain.fundedKey(),
    chain.fundedKey(),
  ]);
});

/** The worker's view of time: one clock for `checkedAt` and for the diff (DiffContext doc). */
function snapshot(stakeAccount: Address): AccountSnapshot {
  const account = chain.stakeAccount(stakeAccount);
  if (account === null) throw new Error(`${stakeAccount} does not exist`);
  return snapshotOf(account, chain.svm.getClock().slot, Number(chain.clock().unixTimestamp) * 1000);
}

function diff(previous: AccountSnapshot): MonitorEvent[] {
  return diffSnapshots(previous, chain.stakeAccount(previous.stakeAccount), {
    slot: chain.svm.getClock().slot,
    checkedAt: Number(chain.clock().unixTimestamp) * 1000,
    clock: chain.clock(),
  });
}

async function send(action: TransactionAction, signers: KeyPairSigner[]): Promise<void> {
  const tx = buildTransaction(action, { feePayer: expectedFeePayer(action), lifetime: chain.blockhashLifetime() });
  const result = await chain.send(tx.bytes, signers);
  if (!result.ok) throw new Error(`${action.kind} failed: ${JSON.stringify(result.error)}\n${result.logs.join('\n')}`);
}

/** Instructions Stakeward never builds (the thief's AuthorizeChecked), paid by `feePayer`. */
async function sendInstructions(instructions: Instruction[], feePayer: Address, signers: KeyPairSigner[]): Promise<void> {
  const message = pipe(
    createTransactionMessage({ version: 'legacy' }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(chain.blockhashLifetime(), m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const bytes = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
  const result = await chain.send(bytes, signers);
  if (!result.ok) throw new Error(`transaction failed: ${JSON.stringify(result.error)}`);
}

function lockedFor(days: bigint, custodian: Address = K.address) {
  return { unixTimestamp: chain.clock().unixTimestamp + days * DAY, epoch: 0n, custodian };
}

function types(events: readonly MonitorEvent[]): string[] {
  return events.map((e) => e.type);
}

describe('diffSnapshots on LiteSVM', () => {
  it('a thief with the main key deactivates and takes the staker role: both events, then quiet', async () => {
    const voteAccount = await chain.createVoteAccount();
    const stakeAccount = await chain.createStakeAccount({
      staker: A.address,
      withdrawer: A.address,
      lockup: lockedFor(180n),
      delegateTo: { voteAccount, stakerKey: A },
    });
    chain.warpToEpoch(START_EPOCH + 5n);
    const before = snapshot(stakeAccount);
    expect(diff(before)).toEqual([]);

    await send({ kind: 'deactivate', stakeAccount, staker: A.address }, [A]);
    await sendInstructions(
      [
        getAuthorizeCheckedInstruction({
          stake: stakeAccount,
          authority: createNoopSigner(A.address),
          newAuthority: createNoopSigner(X.address),
          stakeAuthorize: StakeAuthorize.Staker,
        }),
      ],
      X.address,
      [A, X],
    );

    const events = diff(before);
    expect(events).toMatchObject([
      { type: 'DEACTIVATED', details: { deactivationEpoch: (START_EPOCH + 5n).toString() }, stakeAccount },
      { type: 'STAKER_CHANGED', details: { from: A.address, to: X.address }, stakeAccount },
    ]);
    expect(needsWithdrawerRescan(events)).toBe(true);
    expect(diff(snapshot(stakeAccount))).toEqual([]);
  });

  it('first delegation, deactivation and re-delegation to another validator', async () => {
    const V1 = await chain.createVoteAccount(); // one at a time: only the latest blockhash is valid
    const V2 = await chain.createVoteAccount();
    const stakeAccount = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address, lockup: lockedFor(180n) });

    let previous = snapshot(stakeAccount);
    await send({ kind: 'delegate', stakeAccount, staker: A.address, voteAccount: V1 }, [A]);
    expect(diff(previous)).toMatchObject([{ type: 'DELEGATION_CHANGED', details: { fromVoter: null, toVoter: V1 } }]);

    chain.warpToEpoch(START_EPOCH + 3n);
    previous = snapshot(stakeAccount);
    await send({ kind: 'deactivate', stakeAccount, staker: A.address }, [A]);
    expect(types(diff(previous))).toEqual(['DEACTIVATED']);

    chain.warpToEpoch(START_EPOCH + 4n); // cooldown over (no stake history: fully inactive after the epoch)
    previous = snapshot(stakeAccount);
    await send({ kind: 'delegate', stakeAccount, staker: A.address, voteAccount: V2 }, [A]);
    expect(diff(previous)).toMatchObject([{ type: 'DELEGATION_CHANGED', details: { fromVoter: V1, toVoter: V2 } }]);
  });

  it('second key extends, is replaced with an earlier end (F7), then lifts the lock', async () => {
    const stakeAccount = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address, lockup: lockedFor(30n) });

    let previous = snapshot(stakeAccount);
    await send({ kind: 'extend', stakeAccount, secondKey: K.address, lockUntil: previous.lockUntil + 60n * DAY }, [K]);
    expect(diff(previous)).toMatchObject([{ type: 'LOCKUP_CHANGED', details: { changes: ['extended'] } }]);

    previous = snapshot(stakeAccount);
    // SetLockupChecked by the current second key with a new one co-signing: the builder's protect layout.
    await send(
      { kind: 'protect', stakeAccount, mainKey: K.address, secondKey: K2.address, lockUntil: previous.lockUntil - 10n * DAY },
      [K, K2],
    );
    expect(diff(previous)).toMatchObject([
      {
        type: 'LOCKUP_CHANGED',
        details: { changes: ['shortened', 'custodian-changed'], fromCustodian: K.address, toCustodian: K2.address },
      },
    ]);

    previous = snapshot(stakeAccount);
    await send({ kind: 'unlock', stakeAccount, secondKey: K2.address }, [K2]);
    expect(diff(previous)).toMatchObject([
      { type: 'LOCKUP_CHANGED', details: { changes: ['removed'], toLockUntil: '0' } },
    ]);
  });

  it('withdrawals with both keys: BALANCE_DECREASED, then ACCOUNT_CLOSED when emptied', async () => {
    const stakeAccount = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address, lockup: lockedFor(30n) });
    const withdraw = (lamports: bigint): TransactionAction => ({
      kind: 'withdraw',
      stakeAccount,
      mainKey: A.address,
      secondKey: K.address,
      recipient: A.address,
      lamports,
    });

    let previous = snapshot(stakeAccount);
    await send(withdraw(LAMPORTS_PER_SOL), [A, K]);
    const events = diff(previous);
    expect(events).toMatchObject([
      {
        type: 'BALANCE_DECREASED',
        details: { fromLamports: previous.lamports.toString(), toLamports: (previous.lamports - LAMPORTS_PER_SOL).toString() },
      },
    ]);
    expect(needsWithdrawerRescan(events)).toBe(true);

    previous = snapshot(stakeAccount);
    await send(withdraw(previous.lamports), [A, K]);
    expect(chain.account(stakeAccount)).toBeNull();
    expect(diff(previous)).toMatchObject([{ type: 'ACCOUNT_CLOSED', details: {}, stakeAccount }]);
  });

  it('rescue moves both authorities to the new wallet and leaves the lock', async () => {
    const stakeAccount = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address, lockup: lockedFor(30n) });
    const previous = snapshot(stakeAccount);
    await send({ kind: 'rescue', stakeAccount, mainKey: A.address, secondKey: K.address, newWallet: D.address }, [A, K, D]);
    expect(diff(previous)).toMatchObject([
      { type: 'STAKER_CHANGED', details: { from: A.address, to: D.address } },
      { type: 'WITHDRAWER_CHANGED', details: { from: A.address, to: D.address } },
    ]);
  });

  it('EXPIRED fires exactly when the program stops enforcing the lock', async () => {
    const lockup = lockedFor(1n);
    const stakeAccount = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address, lockup });
    const previous = snapshot(stakeAccount);
    const withdrawAlone: TransactionAction = {
      kind: 'withdraw',
      stakeAccount,
      mainKey: A.address,
      secondKey: null,
      recipient: A.address,
      lamports: 1_000_000n,
    };
    const tryWithdraw = async () => {
      const tx = buildTransaction(withdrawAlone, { feePayer: A.address, lifetime: chain.blockhashLifetime() });
      return (await chain.send(tx.bytes, [A])).ok;
    };

    chain.setTime(lockup.unixTimestamp - 1n);
    expect(diff(previous)).toEqual([]);
    expect(await tryWithdraw()).toBe(false); // LockupInForce one second before T

    chain.setTime(lockup.unixTimestamp);
    expect(await tryWithdraw()).toBe(true); // at T the main key alone can withdraw
    const events = diff(previous);
    expect(types(events)).toEqual(['BALANCE_DECREASED', 'EXPIRED']);
    expect(events[1]).toMatchObject({ details: { lockUntil: lockup.unixTimestamp.toString() } });
    expect(diff(snapshot(stakeAccount))).toEqual([]);
  });
});

describe('mainnet fixtures', () => {
  it.each(Object.entries(FIXTURES))('%s: no events when unchanged or first seen', (_name, fixture) => {
    const decoded = decodeStakeAccount(rawFromFixture(fixture));
    if (!decoded.ok) throw new Error(decoded.error);
    const clock = { unixTimestamp: 1_790_899_200n, epoch: 1_047n }; // 2026-10-02, epoch of the fixtures
    const checkedAt = Number(clock.unixTimestamp) * 1000;
    const previous = snapshotOf(decoded.account, 452_563_563n, checkedAt - 120_000);
    expect(diffSnapshots(null, decoded.account, { slot: 452_563_600n, checkedAt, clock })).toEqual([]);
    expect(diffSnapshots(previous, decoded.account, { slot: 452_563_600n, checkedAt, clock })).toEqual([]);
  });
});
