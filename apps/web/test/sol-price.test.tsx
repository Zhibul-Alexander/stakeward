// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { fetchSolPrice, formatUsd } from '@/api/sol-price';
import { Fees } from '@/pages/landing/Fees.tsx';

// The Costs tab shows rough dollar figures next to SOL from GET /api/sol-price (DECISIONS.md D132).

const DEPOSIT = { status: 'ready', value: 1_056_640n } as const;

function fees() {
  const found = document.getElementById('fees');
  if (found === null) throw new Error('no #fees');
  return found;
}

describe('formatUsd', () => {
  it('rounds to one significant digit under a dollar and to cents above', () => {
    expect(formatUsd(10_600n, 150)).toBe('$0.002');
    expect(formatUsd(5_600n, 150)).toBe('$0.0008');
    expect(formatUsd(1_056_640n, 150)).toBe('$0.2');
    expect(formatUsd(1_000_000_000n, 143.274)).toBe('$143.27');
    expect(formatUsd(0n, 150)).toBe('$0');
  });
});

describe('fetchSolPrice', () => {
  const answer = (status: number, body: unknown) => () => Promise.resolve(new Response(JSON.stringify(body), { status }));

  it('reads the rate', async () => {
    await expect(fetchSolPrice({ fetch: answer(200, { usd: 150.5, at: '2026-10-11T12:00:00.000Z' }) })).resolves.toBe(150.5);
  });

  it('rejects another status and a malformed body', async () => {
    await expect(fetchSolPrice({ fetch: answer(502, { error: 'price-unavailable' }) })).rejects.toThrow('HTTP 502');
    for (const body of [{}, { usd: '150' }, { usd: 0 }, { usd: -1 }, null]) {
      await expect(fetchSolPrice({ fetch: answer(200, body) })).rejects.toThrow('Malformed');
    }
  });
});

describe('Costs tab in dollars', () => {
  it('shows every amount roughly in dollars under the SOL, and the rate used', () => {
    render(<Fees deposit={DEPOSIT} solUsd={{ status: 'ready', value: 150 }} />);
    const rows = [...fees().querySelectorAll('dl > div')];
    expect(rows.map((row) => row.querySelector('[data-slot="usd-amount"]')?.textContent)).toEqual([
      '≈ $0.002',
      '≈ $0.0008',
      '≈ $0.002',
      '≈ $0.002',
      '≈ $0.002',
      '≈ $0.2',
    ]);
    // SOL stays the main number.
    expect(within(rows[0] as HTMLElement).getByText('0.0000106 SOL')).toBeVisible();
    expect(within(fees()).getByText('Dollar amounts are rough, at about $150.00 per SOL. You always pay in SOL.')).toBeVisible();
  });

  it('shows SOL alone while the rate loads or when it cannot be read', () => {
    for (const solUsd of [{ status: 'loading' } as const, { status: 'idle' } as const]) {
      const { unmount } = render(<Fees deposit={DEPOSIT} solUsd={solUsd} />);
      expect(fees().querySelector('[data-slot="usd-amount"]')).toBeNull();
      expect(fees()).not.toHaveTextContent('$');
      expect(fees()).toHaveTextContent('0.0000106 SOL');
      unmount();
    }
  });
});
