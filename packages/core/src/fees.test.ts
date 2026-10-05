import { describe, expect, it } from 'vitest';
import { canPayFee } from './fees.ts';

describe('canPayFee: a fee payer ends at exactly 0 or at least rent-exempt (D44)', () => {
  const rent = 890_880n;
  const fee = 10_600n;

  it.each([
    ['plenty left', 1_000_000_000n, true],
    ['exactly the rent minimum left', fee + rent, true],
    ['exactly 0 left', fee, true],
    ['1 lamport below the rent minimum left', fee + rent - 1n, false],
    ['1 lamport left', fee + 1n, false],
    ['not enough for the fee', fee - 1n, false],
    ['an empty wallet', 0n, false],
  ] as const)('%s -> %s', (_name, balance, expected) => {
    expect(canPayFee(balance, fee, rent)).toBe(expected);
  });

  it('refuses a negative balance after the fee even when the rent minimum is 0', () => {
    expect(canPayFee(5_000n, 10_000n, 0n)).toBe(false);
    expect(canPayFee(10_000n, 10_000n, 0n)).toBe(true);
  });
});
