// Transaction helpers for the gate: the section 4 format for instructions that core does not build, signing with
// in-memory keys, and the fee of a transaction.
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from '@solana/kit';
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from '@solana-program/compute-budget';
import { COMPUTE_UNIT_LIMIT, COMPUTE_UNIT_PRICE_MICRO_LAMPORTS, type BlockhashLifetime } from '@stakeward/core';

export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const LAMPORTS_PER_SIGNATURE = 5_000n;
/** Priority fee of every gate transaction: the fixed CU limit times the fixed price, rounded up (600 lamports). */
export const PRIORITY_FEE_LAMPORTS =
  (BigInt(COMPUTE_UNIT_LIMIT) * COMPUTE_UNIT_PRICE_MICRO_LAMPORTS + 999_999n) / 1_000_000n;

/** Network fee of a gate transaction with `signatures` signatures. */
export function transactionFee(signatures: number): bigint {
  return LAMPORTS_PER_SIGNATURE * BigInt(signatures) + PRIORITY_FEE_LAMPORTS;
}

/**
 * The same wire format as core's buildTransaction: a legacy message with [SetComputeUnitLimit, SetComputeUnitPrice]
 * and then `instructions`, on a blockhash lifetime. Used for setup transactions and for the few check instructions the
 * product never builds (the thief's AuthorizeChecked, Split, Merge).
 */
export function buildFormatted(
  instructions: readonly Instruction[],
  feePayer: Address,
  lifetime: BlockhashLifetime,
): Uint8Array {
  const message = pipe(
    createTransactionMessage({ version: 'legacy' }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
    (m) =>
      appendTransactionMessageInstructions(
        [
          getSetComputeUnitLimitInstruction({ units: COMPUTE_UNIT_LIMIT }),
          getSetComputeUnitPriceInstruction({ microLamports: COMPUTE_UNIT_PRICE_MICRO_LAMPORTS }),
          ...instructions,
        ],
        m,
      ),
  );
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
}

/** Every address that must sign `bytes`, fee payer first. */
export function requiredSigners(bytes: Uint8Array): Address[] {
  return Object.keys(getTransactionDecoder().decode(bytes).signatures) as Address[];
}

/** Adds the signatures of `signers` that the transaction asks for; other keys are ignored. */
export async function signWith(bytes: Uint8Array, signers: readonly KeyPairSigner[]): Promise<Uint8Array> {
  const transaction = getTransactionDecoder().decode(bytes);
  const wanted = new Set(Object.keys(transaction.signatures));
  const keyPairs = [...new Map(signers.map((s) => [s.address, s])).values()]
    .filter((s) => wanted.has(s.address))
    .map((s) => s.keyPair);
  const signed = keyPairs.length === 0 ? transaction : await partiallySignTransaction(keyPairs, transaction);
  return new Uint8Array(getTransactionEncoder().encode(signed));
}

/** `1002282880n` -> `1,00228288 SOL` (Russian decimal comma, no trailing zeros). */
export function formatSol(lamports: bigint): string {
  const sign = lamports < 0n ? '-' : '';
  const abs = lamports < 0n ? -lamports : lamports;
  const whole = abs / LAMPORTS_PER_SOL;
  const fraction = (abs % LAMPORTS_PER_SOL).toString().padStart(9, '0').replace(/0+$/, '');
  return `${sign}${whole.toString()}${fraction === '' ? '' : `,${fraction}`} SOL`;
}

/** `3238560n` -> `3 238 560` (thin grouping for lamport amounts in Russian text). */
export function formatLamports(lamports: bigint): string {
  return lamports.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
