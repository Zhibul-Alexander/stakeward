// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { generateKeyPairSigner, type Address, type KeyPairSigner } from '@solana/kit';
import { buildTransaction, formatSol, formatUtcDate, lockupEnd, networkFeeFor, ZERO_ADDRESS, type Lockup } from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { LAMPORTS_PER_SOL, START_EPOCH, START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { createTestWalletPort, type TestWalletPort } from '@stakeward/core/test/test-wallet-port';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createSlotStore } from '@/ports';
import {
  click,
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

/** A funded main key A; the second key K holds `secondSol` lamports. */
async function world(secondLamports: bigint): Promise<World> {
  const testChain = await TestChain.create();
  const [A, K] = await Promise.all([testChain.fundedKey(), generateKeyPairSigner()]);
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
const period = (label: string, until: bigint) => `${label}: until ${formatUtcDate(until) ?? ''}`;

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

      // Only the periods that end later than the lock now.
      expect(await radio(period('6 months (recommended)', SIX_MONTHS))).toBeChecked();
      expect(screen.getByRole('radio', { name: period('12 months', TWELVE_MONTHS) })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Remove the lock now' })).toBeInTheDocument();
      expect(screen.queryByRole('radio', { name: /^1 month/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('radio', { name: /^3 months/ })).not.toBeInTheDocument();
      expect(screen.getByText(`Locked until ${formatUtcDate(T) ?? ''}. Held by this second key:`)).toBeInTheDocument();
      expect(screen.getAllByText(w.K.address).length).toBeGreaterThan(0);
      expect(document.querySelector('[data-risk="lose-second-key"]')).toHaveTextContent(formatUtcDate(SIX_MONTHS) ?? '');

      await user.click(screen.getByRole('radio', { name: period('12 months', TWELVE_MONTHS) }));
      expect(document.querySelector('[data-risk="lose-second-key"]')).toHaveTextContent(formatUtcDate(TWELVE_MONTHS) ?? '');
      const balanceBefore = w.testChain.balance(w.K.address);
      await click(user, 'Review and sign');
      await connectAndContinue(user, 'Second key', 'Second Wallet');
      await screen.findByRole('button', { name: 'Sign in Second Wallet as Second key' }, WAIT);
      const summary = await theSummary();
      expect(summary).toHaveAttribute('data-kind', 'extend');
      expect(summarySigners(summary)).toEqual(['second']);
      expect(within(summary.querySelector('[data-signer="second"]') as HTMLElement).getByText('Pays the network fee')).toBeInTheDocument();
      expect(screen.queryByText(/so your main key pays and signs too/)).not.toBeInTheDocument();

      await click(user, 'Sign in Second Wallet as Second key');
      await heading(`The lock now ends on ${formatUtcDate(TWELVE_MONTHS) ?? ''}`);
      expect(w.testChain.stakeAccount(S)?.lockup).toEqual({ unixTimestamp: TWELVE_MONTHS, epoch: 0n, custodian: w.K.address });
      expect(w.testChain.balance(w.K.address)).toBe(balanceBefore - ONE_SIGNER_FEE);
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

      await radio(period('6 months (recommended)', SIX_MONTHS));
      await click(user, 'Review and sign');
      await screen.findByText(
        `Your second key has too little SOL for the network fee, so your main key pays and signs too. To sign with the second key alone, send it at least ${formatSol(ONE_SIGNER_FEE + rent0)}, then press Check again.`,
        undefined,
        WAIT,
      );
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
    'E2b: a second key without SOL: the main key signs first and pays for both signatures',
    async () => {
      const w = await world(0n);
      const S = await stake(w);
      const [main, second] = await Promise.all([mainWallet(w), secondWallet(w)]);
      const { user } = renderStakePage(w.chain, `/extend/${S}`, [main, second]);
      const mainBefore = w.testChain.balance(w.A.address);

      await radio(period('6 months (recommended)', SIX_MONTHS));
      await click(user, 'Review and sign');
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

      expect(await radio('Remove the lock now')).toBeChecked();
      expect(screen.getByRole('radio', { name: 'Remove the lock now' })).toHaveAccessibleDescription(
        'Anyone with your main key can then withdraw this stake.',
      );
      const risk = document.querySelector('[data-risk="unlock-opens-window"]');
      expect(risk).toHaveAttribute('data-tone', 'danger');
      expect(document.querySelector('[data-risk="lose-second-key"]')).toBeNull();

      await click(user, 'Review and sign');
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

      await user.click(withdrawNow);
      expect(location.history.at(-1)).toBe(`/withdraw/${S}`);
      await screen.findByText('The lock has ended, so your main key signs alone.', undefined, WAIT);
      await click(user, 'Review and sign');
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

describe('/extend/:account: gates', () => {
  it(
    'E4a: no lock: a link to protect it, and nothing to sign',
    async () => {
      const w = await world(0n);
      const S = await stake(w, { unixTimestamp: 0n, epoch: 0n, custodian: ZERO_ADDRESS });
      renderStakePage(w.chain, `/extend/${S}`, []);
      await screen.findByText('This stake account has no lock that a second key holds.', undefined, WAIT);
      expect(screen.getByRole('link', { name: 'Protect it' })).toHaveAttribute('href', `/protect?account=${S}`);
      expect(screen.queryByRole('button', { name: 'Review and sign' })).not.toBeInTheDocument();
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
      expect(screen.queryByRole('button', { name: 'Review and sign' })).not.toBeInTheDocument();
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

      await radio(period('6 months (recommended)', SIX_MONTHS));
      await click(user, 'Review and sign');
      await screen.findByText('Connect your Second key to continue: it must sign these transactions.', undefined, WAIT);
      const slot = screen.getByRole('group', { name: 'Second key' });
      expect(within(slot).getByText('This step needs this account. Switch to it in the wallet:')).toBeInTheDocument();
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
      await user.click(await radio(period('10 minutes (devnet test)', T2)));
      w.testChain.advanceTime(545n); // past T2 - 60, the lock still in force
      await click(user, 'Review and sign');
      await heading('Lock change');
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

      await user.click(await radio(period('12 months', TWELVE_MONTHS)));
      const { bytes } = buildTransaction(
        { kind: 'extend', stakeAccount: S, secondKey: w.K.address, lockUntil: TWELVE_MONTHS },
        { feePayer: w.K.address, lifetime: w.testChain.blockhashLifetime() },
      );
      expect((await w.testChain.send(bytes, [w.K])).ok).toBe(true);

      await click(user, 'Review and sign');
      await heading(`The lock now ends on ${formatUtcDate(TWELVE_MONTHS) ?? ''}`);
      expect(second.requests).toHaveLength(0);
      expect(ports.secondKeys.getSnapshot()).toContain(w.K.address);
    },
    SCENARIO_TIMEOUT,
  );
});
