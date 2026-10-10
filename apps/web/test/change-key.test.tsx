// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { generateKeyPairSigner, type Address, type KeyPairSigner } from '@solana/kit';
import { networkFeeFor, type Lockup } from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { LAMPORTS_PER_SOL, START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { createTestWalletPort } from '@stakeward/core/test/test-wallet-port';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { click, connect, connectAndContinue, renderStakePage, SCENARIO_TIMEOUT, summarySigners, WAIT } from './support/stake-pages.tsx';

// /change-key/:account (F7, live signing) end to end on the real stake program: the second key that holds the lock and
// a new wallet hand the lock to the new wallet, which pays; the end stays and the old key loses the lock.

const DAY = 86_400n;
const T = START_UNIX_TIMESTAMP + 100n * DAY;

type World = { testChain: TestChain; chain: LiteSvmChain; A: KeyPairSigner; K: KeyPairSigner; K2: KeyPairSigner };

async function world(): Promise<World> {
  const testChain = await TestChain.create();
  const [A, K, K2] = await Promise.all([testChain.fundedKey(), generateKeyPairSigner(), generateKeyPairSigner()]);
  // The old second key holds nothing: it never pays. The new one holds enough for the fee.
  testChain.airdrop(K2.address, LAMPORTS_PER_SOL / 100n);
  return { testChain, chain: new LiteSvmChain(testChain), A, K, K2 };
}

function stake(w: World, lockup: Lockup = { unixTimestamp: T, epoch: 0n, custodian: w.K.address }): Promise<Address> {
  return w.testChain.createStakeAccount({ staker: w.A.address, withdrawer: w.A.address, lockup });
}

async function theSummary(): Promise<HTMLElement> {
  return waitFor(() => {
    const found = document.querySelectorAll<HTMLElement>('[data-slot="transaction-summary"]');
    expect(found).toHaveLength(1);
    return found[0] as HTMLElement;
  }, WAIT);
}

describe('/change-key/:account: hand the lock to a new second key (F7)', () => {
  it(
    'the old and the new second key sign, the new one pays; the end stays and the new key is remembered',
    async () => {
      const w = await world();
      const S = await stake(w);
      const second = await createTestWalletPort({ name: 'Second Wallet', signers: [w.K] });
      const fresh = await createTestWalletPort({ name: 'Fresh Wallet', signers: [w.K2] });
      const { user, ports } = renderStakePage(w.chain, `/change-key/${S}`, [second, fresh]);

      await screen.findByRole('heading', { name: 'Your new second key' }, WAIT);
      expect(screen.getByText('Stakeward never asks for your seed phrase.')).toBeInTheDocument();
      // Nothing to review until the new key is here and the seed phrase box is ticked.
      await click(user, 'Review the change');
      expect(screen.getAllByText('Connect the new wallet first.').length).toBeGreaterThan(0);
      expect(document.querySelector('[data-slot="transaction-summary"]')).toBeNull();

      await connect(user, 'New wallet', 'Fresh Wallet');
      await user.click(screen.getByRole('checkbox', { name: /comes from a new seed phrase/ }));
      await click(user, 'Review the change');

      const summary = await theSummary();
      expect(summary).toHaveAttribute('data-kind', 'change-second-key');
      expect(within(summary).getByText('Hand the lock to a new second key')).toBeInTheDocument();
      expect(within(summary).getAllByText(w.K2.address).length).toBeGreaterThan(0);
      expect(summarySigners(summary)).toEqual(['new', 'second']);
      expect(within(summary.querySelector('[data-signer="new"]') as HTMLElement).getByText('Pays the network fee')).toBeInTheDocument();

      const before = w.testChain.balance(w.K2.address);
      // The fee payer signs first; then the old second key, connected when its turn comes.
      await click(user, 'Sign in Fresh Wallet as New wallet');
      await connectAndContinue(user, 'Second key', 'Second Wallet');
      await click(user, 'Sign in Second Wallet as Second key');
      await screen.findByRole('heading', { name: 'Your new second key holds the lock' }, WAIT);
      expect(w.testChain.stakeAccount(S)?.lockup).toEqual({ unixTimestamp: T, epoch: 0n, custodian: w.K2.address });
      expect(w.testChain.balance(w.K2.address)).toBe(before - networkFeeFor(2));
      expect(w.testChain.balance(w.K.address)).toBe(0n);
      expect(ports.secondKeys.getSnapshot()).toContain(w.K2.address);
      const done = document.querySelector<HTMLElement>('[data-slot="change-key-done"]') as HTMLElement;
      expect(within(done).getByRole('link', { name: 'Print the new recovery card' })).toHaveAttribute('href', `/recovery/${S}`);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'refuses the main key as the new second key',
    async () => {
      const w = await world();
      const S = await stake(w);
      const main = await createTestWalletPort({ name: 'Main Wallet', signers: [w.A] });
      const { user } = renderStakePage(w.chain, `/change-key/${S}`, [main]);
      await screen.findByRole('heading', { name: 'Your new second key' }, WAIT);
      const slot = await screen.findByRole('group', { name: 'New wallet' }, WAIT);
      await user.click(within(slot).getByRole('button', { name: 'Connect a wallet as New wallet' }));
      await user.click(within(slot).getByRole('button', { name: 'Main Wallet' }));
      // One address, one role: the slot does not take the main key.
      await waitFor(() => {
        expect(screen.getByRole('group', { name: 'New wallet' })).not.toHaveAttribute('data-status', 'connected');
        expect(screen.getByRole('group', { name: 'New wallet' })).toHaveTextContent(/Main key/);
      }, WAIT);
      await click(user, 'Review the change');
      expect(document.querySelector('[data-slot="transaction-summary"]')).toBeNull();
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'an account without a lock offers Protect instead',
    async () => {
      const w = await world();
      const S = await stake(w, { unixTimestamp: 0n, epoch: 0n, custodian: w.A.address });
      renderStakePage(w.chain, `/change-key/${S}`, []);
      const offer = await waitFor(() => {
        const found = document.querySelector<HTMLElement>('[data-slot="change-key-not-locked"]');
        expect(found).not.toBeNull();
        return found as HTMLElement;
      }, WAIT);
      expect(within(offer).getByRole('link', { name: 'Protect this stake' })).toHaveAttribute('href', `/protect?account=${S}`);
    },
    SCENARIO_TIMEOUT,
  );
});
