// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { generateKeyPairSigner, type Address, type KeyPairSigner } from '@solana/kit';
import {
  buildTransaction,
  formatSol,
  formatUtcDate,
  formatUtcDateTime,
  lockupEnd,
  networkFeeFor,
  shortAddress,
  ZERO_ADDRESS,
  type Lockup,
} from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { LAMPORTS_PER_SOL, START_EPOCH, START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { createTestWalletPort, type TestWalletPort } from '@stakeward/core/test/test-wallet-port';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createSlotStore } from '@/ports';
import {
  click,
  connect,
  connectAndContinue,
  renderStakePage,
  SCENARIO_TIMEOUT,
  summarySigners,
  WAIT,
} from './support/stake-pages.tsx';

// /extend/:account (F5, live signing) end to end on the real stake program, and the early unlock followed by a
// withdrawal with the main key alone (F3.4). The second key pays when it holds enough SOL; otherwise the main key pays
// and signs too.

const DAY = 86_400n;
/** The lock now: 100 days from the start, so 1 and 3 months are not later. */
const T = START_UNIX_TIMESTAMP + 100n * DAY;
const TWELVE_MONTHS = lockupEnd(START_UNIX_TIMESTAMP, '12-months', 'devnet');
const SIX_MONTHS = lockupEnd(START_UNIX_TIMESTAMP, '6-months', 'devnet');
const ONE_SIGNER_FEE = networkFeeFor(1);

type World = { testChain: TestChain; chain: LiteSvmChain; A: KeyPairSigner; K: KeyPairSigner };

/** The second key K holds `secondLamports`; the main key A holds 10 SOL, or `mainLamports` when given. */
async function world(secondLamports: bigint, mainLamports?: bigint): Promise<World> {
  const testChain = await TestChain.create();
  const [A, K] = await Promise.all([mainLamports === undefined ? testChain.fundedKey() : generateKeyPairSigner(), generateKeyPairSigner()]);
  if (mainLamports !== undefined && mainLamports > 0n) testChain.airdrop(A.address, mainLamports);
  if (secondLamports > 0n) testChain.airdrop(K.address, secondLamports);
  return { testChain, chain: new LiteSvmChain(testChain), A, K };
}

function stake(w: World, lockup: Lockup = { unixTimestamp: T, epoch: 0n, custodian: w.K.address }): Promise<Address> {
  return w.testChain.createStakeAccount({ staker: w.A.address, withdrawer: w.A.address, lockup });
}

function mainWallet(w: World): Promise<TestWalletPort> {
  return createTestWalletPort({ name: 'Main Wallet', signers: [w.A] });
}

function secondWallet(w: World): Promise<TestWalletPort> {
  return createTestWalletPort({ name: 'Second Wallet', signers: [w.K] });
}

const radio = (name: string | RegExp) => screen.findByRole('radio', { name }, WAIT);
const heading = (name: string | RegExp) => screen.findByRole('heading', { name }, WAIT);

/** A period's radio card: named by its period, described by its end date (DECISIONS.md D112). */
async function periodRadio(title: string, until: bigint): Promise<HTMLElement> {
  const found = await radio(title);
  expect(found).toHaveAccessibleDescription(`until ${formatUtcDate(until) ?? ''}`);
  return found;
}

async function theSummary(): Promise<HTMLElement> {
  return waitFor(() => {
    const found = document.querySelectorAll<HTMLElement>('[data-slot="transaction-summary"]');
    expect(found).toHaveLength(1);
    return found[0] as HTMLElement;
  }, WAIT);
}

describe('/extend/:account: move or remove the lock with the second key (F5)', () => {
  it(
    'DW6-2 (E1): the second key alone, as in a phone wallet, extends the lock by 12 months and pays the fee',
    async () => {
      const w = await world(LAMPORTS_PER_SOL / 100n);
      const S = await stake(w);
      const second = await secondWallet(w);
      const { user, ports } = renderStakePage(w.chain, `/extend/${S}`, [second]);

      // Only the periods that end later than the lock now; 6 months is the default and says it is recommended.
      const six = await periodRadio('6 months', SIX_MONTHS);
      expect(six).toBeChecked();
      expect(within(six.closest('[data-slot="radio-card"]') as HTMLElement).getByText('Recommended')).toBeInTheDocument();
      await periodRadio('12 months', TWELVE_MONTHS);
      expect(screen.getByRole('radio', { name: 'Remove the lock now' })).toBeInTheDocument();
      expect(screen.queryByRole('radio', { name: /^1 month/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('radio', { name: /^3 months/ })).not.toBeInTheDocument();
      // The lock's end now, on the account row right above the choices.
      expect(document.querySelector('[data-slot="lock-end"]')).toHaveTextContent(`until ${formatUtcDate(T) ?? ''}`);
      expect(screen.getByText('Stakeward never asks for your seed phrase.')).toBeInTheDocument();
      expect(document.querySelector('[data-risk="lose-second-key"]')).toHaveTextContent(formatUtcDate(SIX_MONTHS) ?? '');

      await user.click(screen.getByRole('radio', { name: '12 months' }));
      expect(document.querySelector('[data-risk="lose-second-key"]')).toHaveTextContent(formatUtcDate(TWELVE_MONTHS) ?? '');
      const balanceBefore = w.testChain.balance(w.K.address);
      await click(user, 'Review new end date');
      await connectAndContinue(user, 'Second key', 'Second Wallet');
      await screen.findByRole('button', { name: 'Sign in Second Wallet as Second key' }, WAIT);
      const summary = await theSummary();
      expect(summary).toHaveAttribute('data-kind', 'extend');
      // The second key in full before it signs (UX rule 9): in the summary's signers.
      expect(within(summary).getAllByText(w.K.address).length).toBeGreaterThan(0);
      expect(summarySigners(summary)).toEqual(['second']);
      expect(within(summary.querySelector('[data-signer="second"]') as HTMLElement).getByText('Pays the network fee')).toBeInTheDocument();
      expect(screen.queryByText(/so your main key pays and signs too/)).not.toBeInTheDocument();

      await click(user, 'Sign in Second Wallet as Second key');
      await heading(`The lock now ends on ${formatUtcDate(TWELVE_MONTHS) ?? ''}`);
      expect(w.testChain.stakeAccount(S)?.lockup).toEqual({ unixTimestamp: TWELVE_MONTHS, epoch: 0n, custodian: w.K.address });
      expect(w.testChain.balance(w.K.address)).toBe(balanceBefore - ONE_SIGNER_FEE);
      // Nothing urgent after a longer lock: the ways on are quiet (no filled button), with an updated recovery card.
      const done = document.querySelector<HTMLElement>('[data-slot="extend-done"]') as HTMLElement;
      expect(within(done).getByRole('link', { name: 'Back to your accounts' })).toHaveAttribute('href', `/app?address=${w.A.address}`);
      expect(within(done).getByRole('link', { name: 'Print the updated recovery card' })).toHaveAttribute('href', `/recovery/${S}`);
      expect(done.querySelectorAll('[data-variant="primary"], [data-variant="danger"]')).toHaveLength(0);
      expect(second.requests).toHaveLength(1);
      expect(ports.secondKeys.getSnapshot()).toContain(w.K.address);
      // Nothing else is written on this device (D37).
      expect(ports.protectedAccounts.getSnapshot()).toEqual([]);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'E2a: a second key without SOL: the page says the main key pays; after funding it, Check again lets it sign alone',
    async () => {
      const w = await world(0n);
      const S = await stake(w);
      const [main, second] = await Promise.all([mainWallet(w), secondWallet(w)]);
      const { user } = renderStakePage(w.chain, `/extend/${S}`, [main, second]);
      const rent0 = await w.chain.getMinimumBalanceForRentExemption(0);

      await periodRadio('6 months', SIX_MONTHS);
      await click(user, 'Review new end date');
      await screen.findByText('Your second key has too little SOL for the fee, so your main key pays and signs too.', undefined, WAIT);
      expect(
        screen.getByText(`To sign with the second key alone, send it ${formatSol(ONE_SIGNER_FEE + rent0)}, then press Check again.`),
      ).toBeInTheDocument();
      // SECURITY-CHECK П16: never a reason to fund a main key that may be stolen.
      expect(screen.getByText('If your main key may be stolen, send SOL to the second key instead.')).toBeInTheDocument();
      expect(summarySigners(await theSummary())).toEqual(['main', 'second']);

      w.testChain.airdrop(w.K.address, LAMPORTS_PER_SOL / 100n);
      await click(user, 'Check again');
      await connectAndContinue(user, 'Second key', 'Second Wallet');
      await screen.findByRole('button', { name: 'Sign in Second Wallet as Second key' }, WAIT);
      expect(summarySigners(await theSummary())).toEqual(['second']);
      expect(screen.queryByText(/so your main key pays and signs too/)).not.toBeInTheDocument();
      await click(user, 'Sign in Second Wallet as Second key');

      await heading(`The lock now ends on ${formatUtcDate(SIX_MONTHS) ?? ''}`);
      expect(w.testChain.stakeAccount(S)?.lockup.unixTimestamp).toBe(SIX_MONTHS);
      expect(main.requests).toHaveLength(0);
      expect(second.requests).toHaveLength(1);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'E2c: the "main key pays" Check again is gone once the transaction may be in flight: it never builds a second one',
    async () => {
      const w = await world(0n);
      const S = await stake(w);
      const [main, second] = await Promise.all([mainWallet(w), secondWallet(w)]);
      const { user } = renderStakePage(w.chain, `/extend/${S}`, [main, second]);

      await periodRadio('6 months', SIX_MONTHS);
      await click(user, 'Review new end date');
      await connectAndContinue(user, 'Main key', 'Main Wallet');
      await screen.findByText(/so your main key pays and signs too/, undefined, WAIT);
      expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
      await click(user, 'Sign in Main Wallet as Main key');
      await connectAndContinue(user, 'Second key', 'Second Wallet');
      // Before the last signature nothing was sent: Check again may still start over.
      expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
      w.chain.holdTransactions();
      await click(user, 'Sign in Second Wallet as Second key');
      await screen.findByText('Waiting for the network to confirm. This usually takes a few seconds, at most 2 minutes.', undefined, WAIT);
      expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument();

      w.chain.landHeld();
      await heading(`The lock now ends on ${formatUtcDate(SIX_MONTHS) ?? ''}`);
      expect(main.requests).toHaveLength(1);
      expect(second.requests).toHaveLength(1);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'E2d: neither key holds SOL for the fee: the error names the second key, and the main key is never asked to pay',
    async () => {
      const w = await world(0n, 0n);
      const S = await stake(w);
      const [main, second] = await Promise.all([mainWallet(w), secondWallet(w)]);
      const { user } = renderStakePage(w.chain, `/extend/${S}`, [main, second]);

      await periodRadio('6 months', SIX_MONTHS);
      await click(user, 'Review new end date');
      const error = await screen.findByText(/^Your Second key has 0 SOL\. It needs at least .* Add a little SOL to it, then press Try again\.$/, undefined, WAIT);
      expect(error.closest('[role="alert"]') ?? error.parentElement).toHaveTextContent(w.K.address);
      expect(screen.queryByText(/so your main key pays and signs too/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Your Main key has/)).not.toBeInTheDocument();
      expect(main.requests).toHaveLength(0);
      expect(second.requests).toHaveLength(0);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'E2b: a second key without SOL: the main key signs first and pays for both signatures',
    async () => {
      const w = await world(0n);
      const S = await stake(w);
      const [main, second] = await Promise.all([mainWallet(w), secondWallet(w)]);
      const { user } = renderStakePage(w.chain, `/extend/${S}`, [main, second]);
      const mainBefore = w.testChain.balance(w.A.address);

      await periodRadio('6 months', SIX_MONTHS);
      await click(user, 'Review new end date');
      await connectAndContinue(user, 'Main key', 'Main Wallet');
      const summary = await theSummary();
      expect(summarySigners(summary)).toEqual(['main', 'second']);
      expect(within(summary.querySelector('[data-signer="main"]') as HTMLElement).getByText('Pays the network fee')).toBeInTheDocument();
      await click(user, 'Sign in Main Wallet as Main key');
      await connectAndContinue(user, 'Second key', 'Second Wallet');
      await click(user, 'Sign in Second Wallet as Second key');

      await heading(`The lock now ends on ${formatUtcDate(SIX_MONTHS) ?? ''}`);
      expect(w.testChain.balance(w.A.address)).toBe(mainBefore - networkFeeFor(2));
      expect(w.testChain.balance(w.K.address)).toBe(0n);
      expect(main.requests).toHaveLength(1);
      expect(second.requests).toHaveLength(1);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'DW6-3 (E3): ?remove: a ticked confirmation, the second key removes the lock, then the main key withdraws alone',
    async () => {
      const w = await world(LAMPORTS_PER_SOL / 100n);
      const S = await stake(w);
      const [main, second] = await Promise.all([mainWallet(w), secondWallet(w)]);
      const lamports = w.testChain.account(S)?.lamports ?? 0n;
      const { user, location } = renderStakePage(w.chain, `/extend/${S}?remove`, [main, second]);

      const remove = await radio('Remove the lock now');
      expect(remove).toBeChecked();
      // Opened to remove: the title says so, the option stands apart in danger, and its risk is right above the button.
      expect(screen.getByRole('heading', { level: 1, name: 'Remove the lock' })).toBeInTheDocument();
      // The choice's heading names what the page was opened for, then the other way (not "New end of the lock").
      expect(screen.getByRole('heading', { level: 2, name: 'Remove the lock now, or extend it' })).toBeInTheDocument();
      expect(screen.getByRole('radiogroup', { name: 'Remove the lock now, or extend it' })).toBeInTheDocument();
      expect(remove.closest('[data-slot="radio-card"]')).toHaveAttribute('data-tone', 'danger');
      const risk = document.querySelector('[data-risk="unlock-opens-window"]');
      expect(risk).toHaveAttribute('data-tone', 'danger');
      expect(document.querySelector('[data-risk="lose-second-key"]')).toBeNull();
      const bar = (risk as HTMLElement).closest<HTMLElement>('[data-slot="action-bar"]') as HTMLElement;
      expect(within(bar).getByRole('button', { name: 'Review lock removal' })).toHaveAttribute('data-variant', 'danger');

      await click(user, 'Review lock removal');
      await connectAndContinue(user, 'Second key', 'Second Wallet');
      const sign = await screen.findByRole('button', { name: 'Sign in Second Wallet as Second key' }, WAIT);
      expect((await theSummary()).getAttribute('data-kind')).toBe('unlock');
      expect(sign).toHaveAttribute('aria-disabled', 'true');
      await user.click(sign);
      expect(await screen.findByText('Tick the box above to continue.')).toBeInTheDocument();
      const box = screen.getByRole('checkbox', {
        name: 'I understand that after this, anyone with my main key can withdraw this stake right away',
      });
      expect(box).toHaveFocus();
      expect(second.requests).toHaveLength(0);
      await user.click(box);
      await user.click(screen.getByRole('button', { name: 'Sign in Second Wallet as Second key' }));

      await heading('The lock is removed');
      expect(w.testChain.stakeAccount(S)?.lockup.unixTimestamp).toBe(0n);
      expect(document.querySelector('[data-slot="extend-done"] [data-risk="unlock-opens-window"]')).toHaveAttribute('data-tone', 'danger');
      const withdrawNow = screen.getByRole('link', { name: 'Withdraw now' });
      expect(withdrawNow).toHaveAttribute('href', `/withdraw/${S}`);
      // The way on after a removal from a "second key may be stolen" alert (SECURITY-CHECK П9): a new second key.
      expect(screen.getByRole('link', { name: 'Protect again' })).toHaveAttribute('href', `/protect?account=${S}`);

      await user.click(withdrawNow);
      expect(location.history.at(-1)).toBe(`/withdraw/${S}`);
      await screen.findByText('No lock, so your main key signs alone.', undefined, WAIT);
      await click(user, 'Review withdrawal');
      await connectAndContinue(user, 'Main key', 'Main Wallet');
      expect(summarySigners(await theSummary())).toEqual(['main']);
      await click(user, 'Sign in Main Wallet as Main key');
      await heading(`${formatSol(lamports)} went to your main key`);
      expect(w.testChain.account(S)).toBeNull();
      expect(second.requests).toHaveLength(1);
      expect(main.requests).toHaveLength(1);
    },
    SCENARIO_TIMEOUT,
  );
});

describe('/extend/:account: a custom end date (D119)', () => {
  it(
    'the second key moves the lock to 00:00 UTC of a date it picks; never to or before the current end, never past five years',
    async () => {
      const w = await world(LAMPORTS_PER_SOL / 100n);
      const S = await stake(w);
      const second = await secondWallet(w);
      const { user } = renderStakePage(w.chain, `/extend/${S}`, [second]);
      await periodRadio('6 months', SIX_MONTHS);
      await user.click(screen.getByRole('radio', { name: 'Custom date' }));
      const field = screen.getByLabelText('Lock until');
      // The lock ends on 9 January 2027 (START + 100 days): the day after it is the earliest; five years from 1 October 2026 the latest.
      expect(field).toHaveAttribute('min', '2027-01-10');
      expect(field).toHaveAttribute('max', '2031-10-01');
      expect(screen.getByRole('button', { name: 'Review new end date' })).toBeDisabled();
      expect(screen.getByText('Pick the date the lock ends.')).toBeInTheDocument();
      fireEvent.change(field, { target: { value: '2027-01-09' } });
      expect(screen.getByRole('alert')).toHaveTextContent('Pick a date from 10 January 2027 on: a new end must be later than the current one.');
      fireEvent.change(field, { target: { value: '2031-10-02' } });
      expect(screen.getByRole('alert')).toHaveTextContent(/^Pick a date no later than 1 October 2031\./);
      fireEvent.change(field, { target: { value: '2027-05-20' } });
      expect(screen.queryByRole('alert')).toBeNull();
      const until = BigInt(Date.UTC(2027, 4, 20) / 1000);
      expect(document.querySelector('[data-risk="lose-second-key"]')).toHaveTextContent(formatUtcDate(until) ?? '');

      await click(user, 'Review new end date');
      await connectAndContinue(user, 'Second key', 'Second Wallet');
      await click(user, 'Sign in Second Wallet as Second key');
      await heading(`The lock now ends on ${formatUtcDate(until) ?? ''}`);
      expect(w.testChain.stakeAccount(S)?.lockup).toEqual({ unixTimestamp: until, epoch: 0n, custodian: w.K.address });
    },
    SCENARIO_TIMEOUT,
  );
});

describe('/extend/:account: after a removal (SECURITY-CHECK П9)', () => {
  it(
    'Protect again opens the wizard for this stake, and the wizard warns that the second key still connected held its lock',
    async () => {
      const w = await world(LAMPORTS_PER_SOL / 100n);
      const S = await stake(w);
      const [main, second] = await Promise.all([mainWallet(w), secondWallet(w)]);
      const { user, location } = renderStakePage(w.chain, `/extend/${S}?remove`, [main, second]);

      expect(await radio('Remove the lock now')).toBeChecked();
      await click(user, 'Review lock removal');
      await connectAndContinue(user, 'Second key', 'Second Wallet');
      await user.click(
        await screen.findByRole(
          'checkbox',
          { name: 'I understand that after this, anyone with my main key can withdraw this stake right away' },
          WAIT,
        ),
      );
      await click(user, 'Sign in Second Wallet as Second key');
      await heading('The lock is removed');
      expect(w.testChain.stakeAccount(S)?.lockup).toEqual({ unixTimestamp: 0n, epoch: 0n, custodian: w.K.address });
      expect(screen.getByText('Use a new second key if this one may be stolen.')).toBeInTheDocument();

      await user.click(screen.getByRole('link', { name: 'Protect again' }));
      expect(location.history.at(-1)).toBe(`/protect?account=${S}`);
      await connect(user, 'Main key', 'Main Wallet');
      await waitFor(() => {
        expect(screen.getByRole('checkbox', { name: `Protect stake account ${shortAddress(S)}` })).toBeChecked();
      }, WAIT);
      await click(user, 'Continue with 1 account');
      await heading('Connect your second key');
      // The second key slot still holds the key that just removed the lock: the wizard says to use a new one.
      expect(within(screen.getByRole('group', { name: 'Second key' })).getByText('Connected')).toBeInTheDocument();
      const warning = document.querySelector('[data-slot="former-second-key"]');
      expect(warning).toHaveAttribute('data-tone', 'warning');
      expect(warning).toHaveTextContent(
        `This second key held the lock on stake account ${shortAddress(S)} before. If it may be stolen, use a new second key from a new seed phrase.`,
      );
      expect(second.requests).toHaveLength(1);
      expect(main.requests).toHaveLength(0);
    },
    SCENARIO_TIMEOUT,
  );
});

describe('/extend/:account: gates', () => {
  it(
    'П12: a network clock more than a day off this device: no new end is offered, the error names both clocks; Try again reads again',
    async () => {
      const w = await world(LAMPORTS_PER_SOL / 100n);
      const S = await stake(w);
      const second = await secondWallet(w);
      // The device is two days ahead of the cluster clock the worker passed on.
      let ahead = 2n * DAY;
      const { user } = renderStakePage(w.chain, `/extend/${S}`, [second], { deviceClock: () => w.testChain.clock().unixTimestamp + ahead });

      const title = await screen.findByText('The network time does not match this device', undefined, WAIT);
      const alert = title.closest('[data-slot="alert"]') as HTMLElement;
      expect(alert).toHaveTextContent(
        `The network says it is ${formatUtcDateTime(START_UNIX_TIMESTAMP) ?? ''}, but this device says ${formatUtcDateTime(START_UNIX_TIMESTAMP + 2n * DAY) ?? ''}.`,
      );
      expect(alert).toHaveTextContent('They differ by 172800 seconds; at most 86400 are allowed.');
      expect(screen.queryByRole('radio')).toBeNull();
      expect(screen.queryByRole('button', { name: /^Review/ })).toBeNull();

      ahead = 0n;
      await user.click(within(alert).getByRole('button', { name: 'Try again' }));
      expect(await periodRadio('6 months', SIX_MONTHS)).toBeChecked();
      expect(screen.queryByText('The network time does not match this device')).toBeNull();
      expect(second.requests).toHaveLength(0);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'E4a: no lock: a link to protect it, and nothing to sign',
    async () => {
      const w = await world(0n);
      const S = await stake(w, { unixTimestamp: 0n, epoch: 0n, custodian: ZERO_ADDRESS });
      renderStakePage(w.chain, `/extend/${S}`, []);
      await screen.findByText('This stake has no lock to change. Protect it first.', undefined, WAIT);
      const protect = screen.getByRole('link', { name: 'Protect it' });
      expect(protect).toHaveAttribute('href', `/protect?account=${S}`);
      expect(protect).toHaveAttribute('data-variant', 'primary');
      expect(screen.queryByRole('button', { name: /^Review/ })).not.toBeInTheDocument();
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'E4a2: a lock in force that no second key holds (the zero key): said so, the command line under Details, no Protect it',
    async () => {
      const w = await world(0n);
      const S = await stake(w, { unixTimestamp: T, epoch: 0n, custodian: ZERO_ADDRESS });
      renderStakePage(w.chain, `/extend/${S}`, []);
      await screen.findByText('Stakeward cannot change this lock: it is held by the main key itself or by no key.', undefined, WAIT);
      const details = screen.getByText('Details').closest('details') as HTMLElement;
      expect(details).toHaveTextContent('solana stake-set-lockup --help names that option');
      // Not "no lock", and no way into a wizard that would refuse this account.
      expect(screen.queryByText('This stake has no lock to change. Protect it first.')).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Protect it' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Review/ })).not.toBeInTheDocument();
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'E4a3: no period ends later than the lock: a custom date or removing; removing is the default',
    async () => {
      const w = await world(LAMPORTS_PER_SOL / 100n);
      const S = await stake(w, { unixTimestamp: START_UNIX_TIMESTAMP + 400n * DAY, epoch: 0n, custodian: w.K.address });
      renderStakePage(w.chain, `/extend/${S}`, []);
      await heading('New end of the lock');
      expect(screen.getByText('No fixed period ends later than the current lock. Pick a later date, or remove the lock.')).toBeInTheDocument();
      expect(screen.getAllByRole('radio')).toHaveLength(2);
      expect(screen.getByRole('radio', { name: 'Custom date' })).not.toBeChecked();
      expect(screen.getByRole('radio', { name: 'Remove the lock now' })).toBeChecked();
      expect(document.querySelector('[data-risk="unlock-opens-window"]')).toHaveAttribute('data-tone', 'danger');
      expect(screen.getByRole('button', { name: 'Review lock removal' })).toHaveAttribute('data-variant', 'danger');
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'E4b: a lock an epoch holds is explained and never signed here',
    async () => {
      const w = await world(0n);
      const S = await stake(w, { unixTimestamp: 0n, epoch: START_EPOCH + 5n, custodian: w.K.address });
      renderStakePage(w.chain, `/extend/${S}`, []);
      await screen.findByText(
        `This lock is held until epoch ${String(START_EPOCH + 5n)}. Stakeward can only move a lock's date, so it cannot change this one.`,
        undefined,
        WAIT,
      );
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Review/ })).not.toBeInTheDocument();
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'E4c: another second key in the slot: the slot names the key this lock needs, offers only Disconnect, asks nothing',
    async () => {
      const w = await world(LAMPORTS_PER_SOL / 100n);
      const S = await stake(w);
      const K2 = await generateKeyPairSigner();
      const other = await createTestWalletPort({ name: 'Other Wallet', signers: [K2], connected: true });
      const slots = createSlotStore(null);
      expect(slots.assign('second', { walletId: other.id, address: K2.address }).ok).toBe(true);
      const { user } = renderStakePage(w.chain, `/extend/${S}`, [other], { slots });

      await periodRadio('6 months', SIX_MONTHS);
      await click(user, 'Review new end date');
      await screen.findByText('Connect your Second key to sign.', undefined, WAIT);
      const slot = screen.getByRole('group', { name: 'Second key' });
      expect(within(slot).getByText('This step needs this account. Disconnect, then connect again with this account:')).toBeInTheDocument();
      expect(within(slot).getByText(w.K.address)).toBeInTheDocument();
      expect(within(slot).getByRole('button', { name: /^Disconnect/ })).toBeInTheDocument();
      expect(within(slot).queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
      expect(other.requests).toHaveLength(0);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'E4d: the chosen end came too close before Review: refused in plain words, nothing asked, Back to choose again',
    async () => {
      const w = await world(LAMPORTS_PER_SOL / 100n);
      const S = await stake(w, { unixTimestamp: START_UNIX_TIMESTAMP + 570n, epoch: 0n, custodian: w.K.address });
      const second = await secondWallet(w);
      const { user } = renderStakePage(w.chain, `/extend/${S}`, [second]);

      const T2 = START_UNIX_TIMESTAMP + 600n;
      await user.click(await periodRadio('10 minutes (devnet test)', T2));
      w.testChain.advanceTime(545n); // past T2 - 60, the lock still in force
      await click(user, 'Review new end date');
      await heading('Lock change not sent');
      const list = screen.getByRole('list', { name: 'Lock change' });
      expect(within(list).getByText('The chosen end is too close or has passed. Choose again.')).toBeInTheDocument();
      expect(second.requests).toHaveLength(0);
      await click(user, 'Back');
      await heading('New end of the lock');
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'E4e: the change landed meanwhile (another tab, a reload): the plan finds it done and asks no wallet',
    async () => {
      const w = await world(LAMPORTS_PER_SOL / 100n);
      const S = await stake(w);
      const second = await secondWallet(w);
      const { user, ports } = renderStakePage(w.chain, `/extend/${S}`, [second]);

      await user.click(await periodRadio('12 months', TWELVE_MONTHS));
      const { bytes } = buildTransaction(
        { kind: 'extend', stakeAccount: S, secondKey: w.K.address, lockUntil: TWELVE_MONTHS },
        { feePayer: w.K.address, lifetime: w.testChain.blockhashLifetime() },
      );
      expect((await w.testChain.send(bytes, [w.K])).ok).toBe(true);

      await click(user, 'Review new end date');
      await heading(`The lock now ends on ${formatUtcDate(TWELVE_MONTHS) ?? ''}`);
      expect(second.requests).toHaveLength(0);
      expect(ports.secondKeys.getSnapshot()).toContain(w.K.address);
    },
    SCENARIO_TIMEOUT,
  );
});
