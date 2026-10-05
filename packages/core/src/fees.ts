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
