import type { Address } from '@solana/kit';
import {
  buildTransaction,
  deriveNonceAccountAddress,
  inspectTransaction,
  lockupEnd,
  NONCE_ACCOUNT_SEED,
  NONCE_ACCOUNT_SIZE,
  type BuiltTransaction,
  type ChainPort,
  type Cluster,
  type Lifetime,
} from '@stakeward/core';
import { readNonceAccount, type NonceAccountState } from './nonce.ts';
import type { LifetimeChoice } from './report.ts';

/**
 * The transactions of the dev page, all from core's `buildTransaction` (the same bytes the product sends):
 * protect (the matrix run), unlock (reset), nonce setup and close. Reads go through ChainPort.
 */

/** Dev lock period: short enough to retry the same stake account soon (devnet only, D13). */
export const DEV_LOCK_PERIOD = '10-minutes';

export type NonceInfo = { address: Address; state: NonceAccountState; deposit: bigint };

export async function readNonceInfo(chain: ChainPort, mainKey: Address): Promise<NonceInfo> {
  const address = await deriveNonceAccountAddress(mainKey);
  const [{ accounts }, deposit] = await Promise.all([
    chain.getAccounts([address]),
    chain.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_SIZE),
  ]);
  return { address, state: readNonceAccount(accounts[0] ?? null, mainKey), deposit };
}

export class NonceNotReadyError extends Error {
  constructor() {
    super('The nonce account of the main key is missing or unusable. Create it first.');
    this.name = 'NonceNotReadyError';
  }
}

/** A fresh lifetime: a recent blockhash, or the current value of the main key's nonce account (fee payer = owner). */
async function lifetimeFor(chain: ChainPort, choice: LifetimeChoice, mainKey: Address): Promise<Lifetime> {
  if (choice === 'blockhash') return { kind: 'blockhash', ...(await chain.getLatestBlockhash()) };
  const nonce = await readNonceInfo(chain, mainKey);
  if (nonce.state.kind !== 'ready') throw new NonceNotReadyError();
  return { kind: 'nonce', nonceAccount: nonce.address, nonceAuthority: mainKey, nonceValue: nonce.state.value };
}

/**
 * The matrix transaction: SetLockupChecked by the main key A with the second key K as new custodian, lock end
 * 10 minutes after the cluster clock, fee paid by A (CLAUDE.md section 5).
 */
export async function buildProtect(
  chain: ChainPort,
  input: { stakeAccount: Address; mainKey: Address; secondKey: Address; lifetime: LifetimeChoice; cluster: Cluster },
): Promise<{ built: BuiltTransaction; lockUntil: bigint }> {
  const clock = await chain.getClock();
  const lockUntil = lockupEnd(clock.unixTimestamp, DEV_LOCK_PERIOD, input.cluster);
  const lifetime = await lifetimeFor(chain, input.lifetime, input.mainKey);
  const built = buildTransaction(
    { kind: 'protect', stakeAccount: input.stakeAccount, mainKey: input.mainKey, secondKey: input.secondKey, lockUntil },
    { feePayer: input.mainKey, lifetime },
  );
  return { built, lockUntil };
}

/**
 * Reset: the second key lifts the lock (SetLockup with unix timestamp 0). K pays; when K cannot cover the fee, the
 * main key pays and co-signs (F5). Covering the fee means more than the fee: a fee payer must end rent-exempt or at
 * exactly 0 (the runtime refuses anything in between with InsufficientFundsForRent).
 */
export async function buildUnlock(
  chain: ChainPort,
  input: { stakeAccount: Address; mainKey: Address; secondKey: Address },
): Promise<{ built: BuiltTransaction; feePayer: 'second' | 'main' }> {
  const action = { kind: 'unlock', stakeAccount: input.stakeAccount, secondKey: input.secondKey } as const;
  const [blockhash, balance, rentExempt] = await Promise.all([
    chain.getLatestBlockhash(),
    chain.getBalance(input.secondKey),
    chain.getMinimumBalanceForRentExemption(0),
  ]);
  const lifetime: Lifetime = { kind: 'blockhash', ...blockhash };
  const bySecond = buildTransaction(action, { feePayer: input.secondKey, lifetime });
  const inspected = await inspectTransaction(bySecond.bytes);
  if (inspected.ok) {
    const left = balance - inspected.summary.networkFeeLamports;
    if (left === 0n || left >= rentExempt) return { built: bySecond, feePayer: 'second' };
  }
  return { built: buildTransaction(action, { feePayer: input.mainKey, lifetime }), feePayer: 'main' };
}

export async function buildNonceSetup(chain: ChainPort, mainKey: Address): Promise<BuiltTransaction> {
  const [nonceAccount, lamports, blockhash] = await Promise.all([
    deriveNonceAccountAddress(mainKey),
    chain.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_SIZE),
    chain.getLatestBlockhash(),
  ]);
  return buildTransaction(
    { kind: 'nonce-setup', nonceAccount, nonceAuthority: mainKey, seed: NONCE_ACCOUNT_SEED, lamports },
    { feePayer: mainKey, lifetime: { kind: 'blockhash', ...blockhash } },
  );
}

/** Closes the nonce account: its whole balance goes back to the main key. */
export async function buildNonceClose(chain: ChainPort, mainKey: Address): Promise<BuiltTransaction> {
  const [nonce, blockhash] = await Promise.all([readNonceInfo(chain, mainKey), chain.getLatestBlockhash()]);
  if (nonce.state.kind !== 'ready') throw new NonceNotReadyError();
  return buildTransaction(
    { kind: 'nonce-close', nonceAccount: nonce.address, nonceAuthority: mainKey, recipient: mainKey, lamports: nonce.state.lamports },
    { feePayer: mainKey, lifetime: { kind: 'blockhash', ...blockhash } },
  );
}
