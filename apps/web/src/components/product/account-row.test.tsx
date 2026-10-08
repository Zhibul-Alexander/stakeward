import type { Address } from '@solana/kit';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { AccountList, AccountListItem, AccountListSkeleton, AccountRow, AccountRowError } from './account-row.tsx';

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
  it('protected: short address, SOL, status with the lock end date, staking state and its action', () => {
    render(
      <AccountRow
        account={account(SECOND)}
        activation="active"
        protection="protected"
        managedByService={false}
        secondKeyKnown
        action={<button type="button">Extend</button>}
      />,
    );
    const row = screen.getByRole('article', { name: 'Stake account AYA...DfW' });
    expect(row).toHaveTextContent('1,250.5 SOL');
    expect(screen.getByText('Protected')).toBeInTheDocument();
    expect(screen.getByText('Protected')).toHaveAttribute('data-size', 'sm');
    expect(screen.getByText('until 12 April 2027')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Extend' })).toBeInTheDocument();
    // Compact (D109): no "Stake account" eyebrow on screen, the article's name says it; nothing behind a More.
    expect(within(row).queryByText('Stake account')).toBeNull();
    expect(screen.queryByRole('button', { name: /^More for stake account/ })).toBeNull();
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
    // One unframed line with the warning icon, always visible (a sign of theft is never folded, D109).
    const line = warning.closest('[data-slot="row-warning"]') as HTMLElement;
    expect(line).toHaveAttribute('data-tone', 'warning');
    expect(line).toHaveAttribute('role', 'note');
    expect(within(line).getByRole('link', { name: 'Open Rescue' })).toHaveAttribute('href', '/rescue?address=MAIN');
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

  it('the service warning says what a lock may do to the service only with serviceDetail', () => {
    const { rerender } = render(
      <AccountRow account={account(SECOND, 0n)} activation="active" protection="unprotected" managedByService secondKeyKnown={false} />,
    );
    const detail = 'With a lock, the service may fail to rebalance or merge it. Check with the service before you protect it.';
    expect(screen.queryByText(detail)).toBeNull();
    rerender(
      <AccountRow account={account(SECOND, 0n)} activation="active" protection="unprotected" managedByService secondKeyKnown={false} serviceDetail />,
    );
    const line = screen.getByText('A staking service may manage this stake.').closest('[data-slot="row-warning"]') as HTMLElement;
    expect(within(line).getByText(detail)).toBeInTheDocument();
  });

  it('one visible action; the rest behind More, which is closed and empty until opened', async () => {
    const user = userEvent.setup();
    render(
      <AccountRow
        account={account(SECOND)}
        activation="active"
        protection="protected"
        managedByService={false}
        secondKeyKnown
        action={<button type="button">Extend</button>}
        moreActions={
          <>
            <button type="button">Withdraw</button>
            <button type="button">Recovery card</button>
          </>
        }
      />,
    );
    expect(screen.getByRole('button', { name: 'Extend' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
    const more = screen.getByRole('button', { name: 'More for stake account AYA...DfW' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Recovery card' })).toBeVisible();
    await user.click(more);
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
  });

  it('select puts a named checkbox at the start of the row; meta goes on the second line', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <AccountRow
        account={account(SECOND, 0n)}
        activation="inactive"
        protection="unprotected"
        managedByService={false}
        secondKeyKnown={false}
        select={{ checked: false, onCheckedChange, label: 'Protect stake account AYA...DfW' }}
        meta={<span>Transaction 5Kx...</span>}
      />,
    );
    const box = screen.getByRole('checkbox', { name: 'Protect stake account AYA...DfW' });
    await user.click(box);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(screen.getByText('Transaction 5Kx...').parentElement).toHaveTextContent('Inactive');
  });

  it('a disabled selection cannot be ticked', () => {
    render(
      <AccountRow
        account={account(OTHER)}
        activation="inactive"
        protection="locked-by-other"
        managedByService={false}
        secondKeyKnown={false}
        select={{ checked: false, onCheckedChange: vi.fn(), label: 'Protect stake account AYA...DfW', disabled: true }}
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Protect stake account AYA...DfW' })).toBeDisabled();
  });

  it('hint={false} leaves the status sentence to the group; F6 shows no red sentence, only the red badge', () => {
    const { rerender } = render(
      <AccountRow account={account(OTHER)} activation="inactive" protection="locked-by-other" managedByService={false} secondKeyKnown={false} hint={false} />,
    );
    expect(screen.queryByText(/^This browser does not know this key yet/)).toBeNull();
    // The lock holder is the row's own fact, not part of the hint (D35).
    expect(screen.getByRole('article').querySelector('[data-slot="lock-holder"]')).toHaveTextContent('57M...3Sz');
    rerender(
      <AccountRow
        account={account(SECOND, 1_700_000_000n)}
        activation="active"
        protection="unprotected"
        managedByService={false}
        secondKeyKnown
        wasProtected
      />,
    );
    const hint = screen.getByText(/^This stake was protected, but its lock has ended/);
    expect(hint).toHaveClass('text-muted');
    expect(hint).not.toHaveClass('text-danger');
  });

  it('a lock that ends within 30 days shows its date in warning with a clock icon, also for a key this browser does not know', () => {
    const { rerender } = render(
      <AccountRow account={account(SECOND)} activation="active" protection="expiring" managedByService={false} secondKeyKnown />,
    );
    const end = () => screen.getByText('until 12 April 2027');
    expect(end()).toHaveClass('text-warning');
    expect(end().querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    rerender(<AccountRow account={account(OTHER)} activation="active" protection="locked-by-other" managedByService={false} secondKeyKnown={false} />);
    expect(end()).not.toHaveClass('text-warning');
    rerender(
      <AccountRow account={account(OTHER)} activation="active" protection="locked-by-other" managedByService={false} secondKeyKnown={false} lockEndsSoon />,
    );
    expect(end()).toHaveClass('text-warning');
  });
});

describe('AccountList', () => {
  it('rows in one named list, one item each', () => {
    render(
      <AccountList label="Stake accounts">
        <AccountListItem>
          <AccountRow account={account(SECOND)} activation="active" protection="protected" managedByService={false} secondKeyKnown />
        </AccountListItem>
        <AccountListItem>
          <AccountRowError address={OTHER} detail="HTTP 500" onRetry={vi.fn()} />
        </AccountListItem>
      </AccountList>,
    );
    const list = screen.getByRole('list', { name: 'Stake accounts' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getAllByRole('article')).toHaveLength(2);
  });

  it('the error row: one line saying the account could not be read, its address, Try again and Details', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<AccountRowError address={OTHER} detail="HTTP 500" onRetry={onRetry} />);
    const row = screen.getByRole('article', { name: 'Stake account 57M...3Sz' });
    expect(row).toHaveAttribute('data-status', 'unknown');
    expect(within(row).getByText('Could not read this account.')).toHaveClass('text-danger');
    expect(within(row).getByText('57M...3Sz')).toBeInTheDocument();
    expect(within(row).getByText('Details').closest('details')).toHaveTextContent('HTTP 500');
    await user.click(within(row).getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('the loading list is decorative, in the rows\' shape', () => {
    const { container } = render(<AccountListSkeleton rows={3} />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('[data-slot="account-row-skeleton"]')).toHaveLength(3);
  });
});
