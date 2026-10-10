import type { Address } from '@solana/kit';
import { buildTransaction, type BuiltTransaction } from './builders.ts';
import { INSUFFICIENT_STAKE_BALANCE, translateError, type ErrorCode } from './errors.ts';
import type { StakeAccount } from './decode.ts';
import type { ChainPort, LatestBlockhash, SimulationResult } from './ports.ts';

/**
 * "Try to steal it" (DECISIONS.md D123): what a thief holding only the main key could do to one stake account right
 * now, asked of the network itself by simulation. Nothing is signed or sent: the transactions carry no signatures and
 * the RPC simulates them with sigVerify off. Both are transactions Stakeward already builds, so the worker's
 * inspector and policy accept them (a withdraw goes to the main key only).
 *
 * - `withdraw`: Withdraw of the whole balance to the main key, signed by the main key alone.
 * - `remove-lock`: SetLockup to 0 (remove the lock), signed by the main key alone.
 *
 * Taking the withdraw right (AuthorizeChecked) is refused by the same rule while the lock is in force; it is not
 * simulated here because the only form Stakeward builds is the rescue, paid by the new owner (docs/gate.md check 4).
 */
export type TheftAttempt = 'withdraw' | 'remove-lock';

export const THEFT_ATTEMPTS: readonly TheftAttempt[] = ['withdraw', 'remove-lock'];

/**
 * - `blocked`: the stake program refused for want of the second key (LockupInForce, CustodianMissing,
 *   CustodianSignatureMissing, MissingRequiredSignature).
 * - `would-succeed`: the network accepted it.
 * - `after-unstaking`: only the stake's own balance rule stopped it (InsufficientFunds on a delegated stake): a thief
 *   unstakes first and withdraws after the epoch ends.
 * - `unknown`: the test could not run (the main key has no SOL for the fee, the network failed, ...).
 */
export type TheftVerdict = 'blocked' | 'would-succeed' | 'after-unstaking' | 'unknown';

export type TheftResult = {
  attempt: TheftAttempt;
  verdict: TheftVerdict;
  /** The translated error code; null when the simulation succeeded. */
  code: ErrorCode | null;
  /** The original error text, for Details; empty on success. */
  detail: string;
};

const BLOCKED_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'lockup-in-force',
  'custodian-missing',
  'custodian-signature-missing',
  'missing-signature',
]);

/** The unsigned transaction of one attempt, paid by the main key (it must hold SOL for the fee to simulate). */
export function buildTheftAttempt(
  attempt: TheftAttempt,
  account: Pick<StakeAccount, 'address' | 'withdrawer' | 'lamports'>,
  lifetime: LatestBlockhash,
): BuiltTransaction {
  const mainKey: Address = account.withdrawer;
  const options = { feePayer: mainKey, lifetime: { kind: 'blockhash' as const, ...lifetime } };
  return attempt === 'withdraw'
    ? buildTransaction(
        { kind: 'withdraw', stakeAccount: account.address, mainKey, secondKey: null, recipient: mainKey, lamports: account.lamports },
        options,
      )
    : buildTransaction({ kind: 'unlock', stakeAccount: account.address, secondKey: mainKey }, options);
}

/** Reads a simulation of `bytes` as a verdict. */
export function theftVerdict(attempt: TheftAttempt, simulation: SimulationResult, bytes: Uint8Array, lockUntil?: bigint): TheftResult {
  if (simulation.ok) return { attempt, verdict: 'would-succeed', code: null, detail: '' };
  const friendly = translateError(simulation.error, { transaction: bytes, ...(lockUntil === undefined ? {} : { lockUntil }) });
  let verdict: TheftVerdict = 'unknown';
  if (BLOCKED_CODES.has(friendly.code)) verdict = 'blocked';
  else if (friendly.code === 'insufficient-funds' && friendly.title === INSUFFICIENT_STAKE_BALANCE) verdict = 'after-unstaking';
  return { attempt, verdict, code: friendly.code, detail: friendly.detail };
}

/**
 * Runs both attempts against the network. A transport failure of one attempt becomes `unknown` for it, with the
 * error as detail; it never rejects.
 */
export async function runTheftTest(chain: ChainPort, account: StakeAccount): Promise<readonly TheftResult[]> {
  let lifetime: LatestBlockhash;
  try {
    lifetime = await chain.getLatestBlockhash();
  } catch (error) {
    const { code, detail } = translateError(error);
    return THEFT_ATTEMPTS.map((attempt) => ({ attempt, verdict: 'unknown' as const, code, detail }));
  }
  const lockUntil = account.lockup.unixTimestamp > 0n ? account.lockup.unixTimestamp : undefined;
  return Promise.all(
    THEFT_ATTEMPTS.map(async (attempt): Promise<TheftResult> => {
      try {
        const { bytes } = buildTheftAttempt(attempt, account, lifetime);
        return theftVerdict(attempt, await chain.simulate(bytes), bytes, lockUntil);
      } catch (error) {
        const { code, detail } = translateError(error);
        return { attempt, verdict: 'unknown', code, detail };
      }
    }),
  );
}
