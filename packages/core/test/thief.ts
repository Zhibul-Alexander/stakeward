// What a thief who holds only the main key A can do to a stake account (CLAUDE.md section 4: deactivate, change the
// staker, split), for the rescue tests. Test-only code: product code never imports it. It takes svm.ts's harness by
// type only, so a bundle of it carries no LiteSVM: every helper carries THIEF_MARKER instead, which no build may
// contain (apps/web/test/test-code-guard.test.ts).
import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  generateKeyPairSigner,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from '@solana/kit';
import { getAuthorizeCheckedInstruction, getSplitInstruction, StakeAuthorize, StakeInstruction } from '@solana-program/stake';
import { getCreateAccountInstruction } from '@solana-program/system';
import {
  buildTransaction,
  LEGACY_SYSVAR_SLOTS,
  STAKE_ACCOUNT_SIZE,
  STAKE_PROGRAM_ADDRESS,
  toLegacyLayout,
} from '../src/index.ts';
import type { SendResult, TestChain } from './svm.ts';

/** In every helper's code path (`check`), so any bundle that takes one of them shows it. */
export const THIEF_MARKER = 'stakeward-test-only:thief';

/**
 * AuthorizeChecked(Staker -> newStaker) in the legacy layout (LEGACY_SYSVAR_SLOTS, like the product's rescue), signed by
 * the withdrawer and newStaker. A separate funded payer stands in for the harness bank, so the withdrawer pays nothing.
 */
export async function changeStaker(
  chain: TestChain,
  input: { stake: Address; withdrawer: KeyPairSigner; newStaker: KeyPairSigner },
): Promise<void> {
  const slot = LEGACY_SYSVAR_SLOTS[StakeInstruction.AuthorizeChecked];
  if (slot === undefined) throw new Error('No legacy layout for AuthorizeChecked');
  const authorize = toLegacyLayout(
    getAuthorizeCheckedInstruction({
      stake: input.stake,
      authority: input.withdrawer,
      newAuthority: input.newStaker,
      stakeAuthorize: StakeAuthorize.Staker,
    }),
    slot,
  );
  await sendInstructions(chain, 'changeStaker', [authorize]);
}

/** Deactivate signed by `staker` (core buildTransaction, kind deactivate); a separate funded payer pays. */
export async function deactivateAs(chain: TestChain, input: { stake: Address; staker: KeyPairSigner }): Promise<void> {
  const payer = await chain.fundedKey(1n);
  const { bytes } = buildTransaction(
    { kind: 'deactivate', stakeAccount: input.stake, staker: input.staker.address },
    { feePayer: payer.address, lifetime: chain.blockhashLifetime() },
  );
  check('deactivateAs', await chain.send(bytes, [payer, input.staker]));
}

/**
 * Creates a 200-byte account owned by the stake program (funded with its rent-exempt reserve) and Splits `lamports`
 * of `stake` into it, signed by the staker; a separate funded payer pays. Returns the new account's address: it carries
 * the same authorities and lock as `stake`.
 */
export async function splitStake(
  chain: TestChain,
  input: { stake: Address; staker: KeyPairSigner; lamports: bigint },
): Promise<Address> {
  const payer = await chain.fundedKey(1n);
  const target = await generateKeyPairSigner();
  const create = getCreateAccountInstruction({
    payer,
    newAccount: target,
    lamports: chain.svm.minimumBalanceForRentExemption(BigInt(STAKE_ACCOUNT_SIZE)),
    space: STAKE_ACCOUNT_SIZE,
    programAddress: STAKE_PROGRAM_ADDRESS,
  });
  const split = getSplitInstruction({
    stake: input.stake,
    splitStake: target.address,
    stakeAuthority: input.staker,
    args: input.lamports,
  });
  await sendInstructions(chain, 'splitStake', [create, split], payer);
  return target.address;
}

/** One legacy transaction of `instructions` (their kit signers sign), paid by `payer` (default: a new funded key). */
async function sendInstructions(
  chain: TestChain,
  what: string,
  instructions: readonly Instruction[],
  payer?: KeyPairSigner,
): Promise<void> {
  const feePayer = payer ?? (await chain.fundedKey(1n));
  const lifetime = chain.blockhashLifetime();
  const message = pipe(
    createTransactionMessage({ version: 'legacy' }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  check(what, await chain.send(new Uint8Array(getTransactionEncoder().encode(signed))));
}

function check(what: string, result: SendResult): void {
  if (!result.ok) throw new Error(`${THIEF_MARKER} ${what} failed: ${JSON.stringify(result.error)}\n${result.logs.join('\n')}`);
}
