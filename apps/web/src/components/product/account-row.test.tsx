import type { Address } from '@solana/kit';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AccountRow } from './account-row.tsx';

const STAKE = 'AYA9kYsn7XVDTPARBfAuASypyyDGFJw1Xds2vHgW9DfW' as Address;
const OTHER = '57M4tyxx6Rk1gz3uYVvfoB3KdQGQkyveqqmZzJUdw3Sz' as Address;
const SECOND = '9DpLwZiYboWcwYFVtSjSksfaP9EqVoSuZw7Jofet96fi' as Address;
const APRIL_2027 = 1_807_488_000n;

const account = (custodian: Address, unixTimestamp = APRIL_2027) => ({
  address: STAKE,
  lamports: 1_250_500_000_000n,
  lockup: { unixTimestamp, epoch: 0n, custodian },
});

describe('AccountRow', () => {
  it('protected: short address, SOL, status with the lock end date, staking state and actions', () => {
    render(
      <AccountRow
        account={account(SECOND)}
        activation="active"
        protection="protected"
        managedByService={false}
        actions={<button type="button">Extend</button>}
      />,
    );
    const row = screen.getByRole('article', { name: 'Stake account AYA...DfW' });
    expect(row).toHaveTextContent('1,250.5 SOL');
    expect(screen.getByText('Protected')).toBeInTheDocument();
    expect(screen.getByText('until 12 April 2027')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Extend' })).toBeInTheDocument();
  });

  it('locked by another key names that key, with copy and explorer, so the viewer can connect it if it is theirs', () => {
    render(<AccountRow account={account(OTHER)} activation="inactive" protection="locked-by-other" managedByService={false} />);
    expect(screen.getByText('Locked by another key')).toBeInTheDocument();
    const holder = screen.getByRole('article').querySelector('[data-slot="lock-holder"]');
    if (!(holder instanceof HTMLElement)) throw new Error('no lock holder');
    expect(holder).toHaveTextContent('Second key');
    expect(within(holder).getByText('57M...3Sz')).toBeInTheDocument();
    expect(within(holder).getByRole('button', { name: 'Copy address 57M...3Sz' })).toBeInTheDocument();
    expect(within(holder).getByRole('link', { name: /^View 57M...3Sz on Solana Explorer/ })).toHaveAttribute('href', expect.stringContaining(OTHER));
    expect(screen.getByText('If this second key is yours, connect it to manage the lock.')).toBeInTheDocument();
  });

  it('F6: a stake that was protected and lost its lock shows red', () => {
    render(
      <AccountRow
        account={account(SECOND, 1_700_000_000n)}
        activation="active"
        protection="unprotected"
        managedByService={false}
        wasProtected
      />,
    );
    expect(screen.getByRole('article')).toHaveAttribute('data-status', 'was-protected');
    expect(screen.getByText('No longer protected')).toHaveAttribute('data-tone', 'danger');
    expect(screen.queryByText(/until/)).not.toBeInTheDocument();
  });

  it('warns when a staking service may manage the stake', () => {
    render(<AccountRow account={account(SECOND, 0n)} activation="active" protection="unprotected" managedByService />);
    expect(screen.getByText('A staking service may manage this stake.')).toBeInTheDocument();
  });
});
