import type { Address, Nonce, ReadonlyUint8Array } from '@solana/kit';
import { deriveNonceAccountAddress } from './builders.ts';
import { inspectAndVerifyTransaction } from './inspect.ts';
import { rescueKitNonceSeed } from './nonce.ts';

/**
 * A one-tap rescue kit (D118): the rescue of one stake account, signed in advance by the main key, the second key and
 * the new wallet, on a durable nonce of the new wallet that nothing else uses. Anyone can send it later; all it can do
 * is move both authorities to the owner's own new wallet, so the bytes are not a secret.
 */
export type RescueKit = {
  stakeAccount: Address;
  mainKey: Address;
  secondKey: Address;
  newWallet: Address;
  nonceAccount: Address;
  nonceValue: Nonce;
};

export type RescueKitErrorCode =
  /** The inspector refused the bytes. */
  | 'not-stakeward'
  /** A Stakeward transaction, but not a rescue. */
  | 'not-rescue'
  /** Not on the new wallet's kit nonce account for this stake account. */
  | 'wrong-nonce'
  /** A wallet appended Lighthouse assertions: they pin today's account state, so the rescue could fail when needed. */
  | 'lighthouse-tail'
  /** A signature is missing, invalid or cannot be verified here. */
  | 'signatures';

export type RescueKitCheck = { ok: true; kit: RescueKit } | { ok: false; code: RescueKitErrorCode; message: string };

/**
 * Accepts the bytes only when they are a complete rescue kit: the inspector's rescue pair, paid by the new wallet, on
 * the nonce account at `rescueKitNonceSeed(stakeAccount)` of the new wallet, without a Lighthouse tail, with every
 * signature present and valid. The chain checks (lock in force, nonce value current) are the caller's. Never throws.
 */
export async function checkRescueKit(bytes: ReadonlyUint8Array): Promise<RescueKitCheck> {
  const inspected = await inspectAndVerifyTransaction(bytes);
  if (!inspected.ok) return { ok: false, code: 'not-stakeward', message: inspected.error.message };
  const { summary, signatures } = inspected;
  const { action, lifetime } = summary;
  if (action.kind !== 'rescue') return { ok: false, code: 'not-rescue', message: `A ${action.kind}, not a rescue` };
  if (lifetime.kind !== 'nonce') return { ok: false, code: 'wrong-nonce', message: 'Runs on a blockhash' };
  const expected = await deriveNonceAccountAddress(action.newWallet, rescueKitNonceSeed(action.stakeAccount));
  if (lifetime.nonceAccount !== expected || lifetime.nonceAuthority !== action.newWallet) {
    return { ok: false, code: 'wrong-nonce', message: `Runs on ${lifetime.nonceAccount}, expected ${expected}` };
  }
  if (summary.lighthouseTail !== null) {
    return { ok: false, code: 'lighthouse-tail', message: 'A wallet appended Lighthouse assertions' };
  }
  if (!signatures.ok) return { ok: false, code: 'signatures', message: signatures.error.message };
  return {
    ok: true,
    kit: {
      stakeAccount: action.stakeAccount,
      mainKey: action.mainKey,
      secondKey: action.secondKey,
      newWallet: action.newWallet,
      nonceAccount: lifetime.nonceAccount,
      nonceValue: lifetime.nonceValue,
    },
  };
}
