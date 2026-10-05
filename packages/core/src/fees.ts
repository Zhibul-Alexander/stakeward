import { COMPUTE_UNIT_LIMIT, COMPUTE_UNIT_PRICE_MICRO_LAMPORTS } from './constants.ts';
import { LAMPORTS_PER_SIGNATURE } from './inspect.ts';

/**
 * Whether a wallet with `balance` lamports can pay `fee` (CLAUDE.md section 5, F5: the second key pays when it can).
 * A fee payer must end at exactly 0 or at least rent-exempt (runtime rule, DECISIONS.md D44): the runtime refuses
 * anything in between with InsufficientFundsForRent. `rentExemptMinimum` is the network's minimum for a 0-byte account.
 */
export function canPayFee(balance: bigint, fee: bigint, rentExemptMinimum: bigint): boolean {
  const left = balance - fee;
  if (left < 0n) return false;
  return left === 0n || left >= rentExemptMinimum;
}

/**
 * Network fee upper bound for a Stakeward transaction with `signers` signatures: 5000 per signature plus the fixed
 * priority fee, ceil(COMPUTE_UNIT_LIMIT x price / 1e6). 1 -> 5 600, 2 -> 10 600, 3 -> 15 600. The same formula as the
 * inspector's `networkFeeLamports` (fees.test.ts pins them equal for every kind), for a plan that has to choose a fee
 * payer before any transaction is built.
 */
export function networkFeeFor(signers: number): bigint {
  const priority = (BigInt(COMPUTE_UNIT_LIMIT) * COMPUTE_UNIT_PRICE_MICRO_LAMPORTS + 999_999n) / 1_000_000n;
  return LAMPORTS_PER_SIGNATURE * BigInt(signers) + priority;
}
