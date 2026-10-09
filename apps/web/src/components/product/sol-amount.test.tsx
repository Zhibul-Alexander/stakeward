import { U64_MAX } from '@stakeward/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SolAmount } from './sol-amount.tsx';

describe('SolAmount', () => {
  it.each([
    [1n, '0.000000001 SOL'],
    [0n, '0 SOL'],
    [10n, '0.00000001 SOL'],
    [1_000_000_000n, '1 SOL'],
    [10_600n, '0.0000106 SOL'],
    [1_234_500_000_000n, '1,234.5 SOL'],
    [42_750_000_000n, '42.75 SOL'],
    [7_000_000_001n, '7.000000001 SOL'],
    // 2^53 + 1 lamports: a Number would round it; bigint arithmetic keeps the last lamport.
    [9_007_199_254_740_993n, '9,007,199.254740993 SOL'],
    [U64_MAX, '18,446,744,073.709551615 SOL'],
  ])('%s lamports -> %s', (lamports, text) => {
    render(<SolAmount lamports={lamports} />);
    const amount = screen.getByText(text);
    expect(amount).toHaveAttribute('data-lamports', lamports.toString());
  });
});
