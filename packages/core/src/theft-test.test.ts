import { address, blockhash, decompileTransactionMessage, getCompiledTransactionMessageDecoder, getTransactionDecoder } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { COMPUTE_BUDGET_PROGRAM_ADDRESS, STAKE_PROGRAM_ADDRESS } from './constants.ts';
import { inspectTransaction } from './inspect.ts';
import { buildTheftAttempt, THEFT_ATTEMPTS, theftVerdict } from './theft-test.ts';

const ACCOUNT = {
  address: address('8qbHbw2BbbTHBW1sbeqakYXVKRQM8Ne7pLK7m6CVfeR'),
  withdrawer: address('2WGcYYau2gLu2DUq68SxxXQmCgi77n8hFqqkxhhTSdTD'),
  lamports: 5_000_000_000n,
};
const LIFETIME = { blockhash: blockhash('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'), lastValidBlockHeight: 100n };

describe('buildTheftAttempt', () => {
  // The worker simulates only bytes the inspector accepts (apps/worker/src/rpc.ts), and its policy allows a withdraw
  // to the main key only.
  it.each(THEFT_ATTEMPTS)('%s: the inspector accepts it, the main key alone signs and pays, a withdraw goes to it', async (attempt) => {
    const built = buildTheftAttempt(attempt, ACCOUNT, LIFETIME);
    expect(built.meta.signers).toEqual([ACCOUNT.withdrawer]);
    const result = await inspectTransaction(built.bytes);
    if (!result.ok) throw new Error(result.error.message);
    const { action } = result.summary;
    expect(action.kind).toBe(attempt === 'withdraw' ? 'withdraw' : 'unlock');
    if (action.kind === 'withdraw') {
      expect(action.recipient).toBe(ACCOUNT.withdrawer);
      expect(action.secondKey).toBeNull();
      expect(action.lamports).toBe(ACCOUNT.lamports);
    }
  });

  // Details say "the steps before it only set the network fee" when the stake instruction is refused.
  it.each(THEFT_ATTEMPTS)('%s: two Compute Budget steps, then the one stake instruction', (attempt) => {
    const { messageBytes } = getTransactionDecoder().decode(buildTheftAttempt(attempt, ACCOUNT, LIFETIME).bytes);
    const { instructions } = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(messageBytes));
    expect(Array.from(instructions, (instruction): string => instruction.programAddress)).toEqual([
      COMPUTE_BUDGET_PROGRAM_ADDRESS,
      COMPUTE_BUDGET_PROGRAM_ADDRESS,
      STAKE_PROGRAM_ADDRESS,
    ]);
  });
});

describe('theftVerdict', () => {
  const bytes = buildTheftAttempt('withdraw', ACCOUNT, LIFETIME).bytes;
  const fail = (error: unknown) => ({ ok: false as const, logs: [], unitsConsumed: null, error });

  it('success is would-succeed', () => {
    expect(theftVerdict('withdraw', { ok: true, logs: [], unitsConsumed: 1n }, bytes)).toEqual({
      attempt: 'withdraw',
      verdict: 'would-succeed',
      code: null,
      detail: '',
      refused: null,
    });
  });

  it('LockupInForce on the stake instruction is blocked, and Details name the refused step', () => {
    expect(theftVerdict('withdraw', fail({ InstructionError: [2n, { Custom: 1n }] }), bytes)).toMatchObject({
      verdict: 'blocked',
      code: 'lockup-in-force',
      detail: '{"InstructionError":["2",{"Custom":"1"}]}',
      refused: { index: 2, steps: 3, stakeInstruction: true },
    });
  });

  it('a refusal of a step before the stake instruction is not the stake instruction; a fee error refuses no step', () => {
    expect(theftVerdict('withdraw', fail({ InstructionError: [0n, 'InvalidInstructionData'] }), bytes).refused).toEqual({
      index: 0,
      steps: 3,
      stakeInstruction: false,
    });
    expect(theftVerdict('withdraw', fail('InsufficientFundsForFee'), bytes).refused).toBeNull();
    // An index past the end of the transaction cannot be read against it.
    expect(theftVerdict('withdraw', fail({ InstructionError: [7n, { Custom: 1n }] }), bytes).refused).toBeNull();
  });

  it('InsufficientFunds in the stake instruction waits for unstaking; for the fee it is unknown', () => {
    expect(theftVerdict('withdraw', fail({ InstructionError: [2n, 'InsufficientFunds'] }), bytes)).toMatchObject({ verdict: 'after-unstaking' });
    expect(theftVerdict('withdraw', fail('InsufficientFundsForFee'), bytes)).toMatchObject({ verdict: 'unknown', code: 'insufficient-funds' });
  });

  it('anything else is unknown, with the raw error for Details', () => {
    const result = theftVerdict('withdraw', fail({ InstructionError: [2n, { Custom: 99n }] }), bytes);
    expect(result.verdict).toBe('unknown');
    expect(result.detail).not.toBe('');
  });
});
