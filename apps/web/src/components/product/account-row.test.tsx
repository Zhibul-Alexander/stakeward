import type { Address } from '@solana/kit';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
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
        secondKeyKnown
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

  it('a lock of a key this browser does not know names that key, with copy and explorer, so the viewer can connect it if it is theirs', () => {
    render(
      <AccountRow account={account(OTHER)} activation="inactive" protection="locked-by-other" managedByService={false} secondKeyKnown={false} />,
    );
    expect(screen.getByText('Locked by a second key')).toBeInTheDocument();
    expect(screen.queryByText('Locked by another key')).toBeNull();
    const holder = screen.getByRole('article').querySelector('[data-slot="lock-holder"]');
    if (!(holder instanceof HTMLElement)) throw new Error('no lock holder');
    expect(holder).toHaveTextContent('Second key');
    expect(within(holder).getByText('57M...3Sz')).toBeInTheDocument();
    expect(within(holder).getByRole('button', { name: 'Copy address 57M...3Sz' })).toBeInTheDocument();
    expect(within(holder).getByRole('link', { name: /^View 57M...3Sz on Solana Explorer/ })).toHaveAttribute('href', expect.stringContaining(OTHER));
    // On a new device this is the owner's own lock as well: say what is not known and what to do, accuse no one.
    expect(
      screen.getByText(
        'This browser does not know this key yet. If it is your second key, connect it to manage the lock; if not, only that key can change it.',
      ),
    ).toBeInTheDocument();
  });

  // D35, the fake-site case: this browser knows a second key and none of them holds the lock. Never the soft words or
  // "connect it": they would send a victim to the key a fake site set. View only, as before.
  it('a lock held by none of the second keys this browser knows: Locked by another key, with that key and no "connect it"', () => {
    render(
      <AccountRow account={account(OTHER)} activation="inactive" protection="locked-by-other" managedByService={false} secondKeyKnown />,
    );
    const row = screen.getByRole('article');
    expect(row).toHaveAttribute('data-status', 'locked-by-other');
    const badge = screen.getByText('Locked by another key');
    expect(badge).toHaveAttribute('data-tone', 'info');
    expect(screen.queryByText('Locked by a second key')).toBeNull();
    const holder = row.querySelector('[data-slot="lock-holder"]');
    if (!(holder instanceof HTMLElement)) throw new Error('no lock holder');
    expect(within(holder).getByText('57M...3Sz')).toBeInTheDocument();
    expect(screen.getByText('This is not the second key you connected here. If you did not set this lock, someone else holds it.')).toBeInTheDocument();
    expect(row).not.toHaveTextContent(/does not know this key|connect it/i);
  });

  it('F6: a stake that was protected and lost its lock shows red', () => {
    render(
      <AccountRow
        account={account(SECOND, 1_700_000_000n)}
        activation="active"
        protection="unprotected"
        managedByService={false}
        secondKeyKnown
        wasProtected
      />,
    );
    expect(screen.getByRole('article')).toHaveAttribute('data-status', 'was-protected');
    expect(screen.getByText('No longer protected')).toHaveAttribute('data-tone', 'danger');
    expect(screen.queryByText(/until/)).not.toBeInTheDocument();
  });

  it('warns when a staking service may manage the stake', () => {
    render(<AccountRow account={account(SECOND, 0n)} activation="active" protection="unprotected" managedByService secondKeyKnown={false} />);
    expect(screen.getByText('A staking service may manage this stake.')).toBeInTheDocument();
    expect(screen.queryByText(/your main key may be stolen/)).toBeNull();
  });

  // SECURITY-CHECK П6: under a lock of the viewer's own second key, another stake key is what a thief with the main
  // key does first (CLAUDE.md section 4). Say so, and lead to Rescue; the service hint is for unlocked rows.
  it.each(['protected', 'expiring'] as const)('%s with another stake key: the main key may be stolen, with a link to Rescue', (protection) => {
    const { hook, searchHook } = memoryLocation({ path: '/app' });
    render(
      <Router hook={hook} searchHook={searchHook}>
        <AccountRow
          account={account(SECOND)}
          activation="deactivating"
          protection={protection}
          managedByService
          secondKeyKnown
          rescueHref="/rescue?address=MAIN"
        />
      </Router>,
    );
    const warning = screen.getByText('Another key can stop or move this stake. If you did not set this up, your main key may be stolen.');
    const alert = warning.closest('[data-slot="alert"]') as HTMLElement;
    expect(alert).toHaveAttribute('data-tone', 'warning');
    expect(within(alert).getByRole('link', { name: 'Open Rescue' })).toHaveAttribute('href', '/rescue?address=MAIN');
    expect(screen.queryByText('A staking service may manage this stake.')).toBeNull();
  });

  it('the same warning without a link where no Rescue link is given (the rescue pages themselves)', () => {
    render(<AccountRow account={account(SECOND)} activation="active" protection="protected" managedByService secondKeyKnown />);
    expect(screen.getByText('Another key can stop or move this stake. If you did not set this up, your main key may be stolen.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Rescue' })).toBeNull();
  });

  it.each([false, true])('a lock held by another key keeps the service hint (second key known: %s)', (secondKeyKnown) => {
    render(
      <AccountRow
        account={account(OTHER)}
        activation="active"
        protection="locked-by-other"
        managedByService
        secondKeyKnown={secondKeyKnown}
        rescueHref="/rescue"
      />,
    );
    expect(screen.getByText('A staking service may manage this stake.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Rescue' })).toBeNull();
  });
});
