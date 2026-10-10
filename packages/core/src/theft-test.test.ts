import { address, blockhash } from '@solana/kit';
import { describe, expect, it } from 'vitest';
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
    });
  });

  it('LockupInForce on the stake instruction is blocked', () => {
    expect(theftVerdict('withdraw', fail({ InstructionError: [2n, { Custom: 1n }] }), bytes)).toMatchObject({ verdict: 'blocked', code: 'lockup-in-force' });
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
