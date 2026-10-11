// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import type { Address, KeyPairSigner } from '@solana/kit';
import { networkFeeFor, STAKE_ACCOUNT_SIZE, ZERO_ADDRESS } from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { TestChain } from '@stakeward/core/test/svm';
import { createTestWalletPort } from '@stakeward/core/test/test-wallet-port';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ValidatorDirectory } from '@/ports';
import { parseSolAmount, solInputText } from '@/pages/stake/plan';
import { click, renderStakePage, SCENARIO_TIMEOUT, summarySigners, WAIT } from './support/stake-pages.tsx';

// /stake (DECISIONS.md D138) end to end on the real stake program: the main key stakes SOL in a new stake account,
// delegated to the validator chosen at the start, then goes on to protect it.

type World = { testChain: TestChain; chain: LiteSvmChain; A: KeyPairSigner; vote: Address };

async function world(): Promise<World> {
  const testChain = await TestChain.create();
  const [A, vote] = await Promise.all([testChain.fundedKey(), testChain.createVoteAccount()]);
  return { testChain, chain: new LiteSvmChain(testChain), A, vote };
}

function directory(offered: readonly Address[]): ValidatorDirectory {
  return {
    offer: (limit) =>
      Promise.resolve(offered.slice(0, limit).map((voteAccount) => ({ voteAccount, commission: 5, activatedStake: 1_000_000_000_000n }))),
    risks: () => Promise.resolve([]),
  };
}

describe('/stake: stake SOL in a new stake account (D138)', () => {
  it(
    'the main key stakes 1.5 SOL with the preselected validator, then is led to protect the new account',
    async () => {
      const w = await world();
      const main = await createTestWalletPort({ name: 'Main Wallet', signers: [w.A] });
      const { user, location } = renderStakePage(w.chain, '/stake', [main], { validators: directory([w.vote]) });

      await click(user, 'Connect main key');
      await click(user, 'Main Wallet');
      await screen.findByRole('heading', { name: 'Amount and validator' }, WAIT);
      // The first offered validator is chosen at the start.
      const offered = await screen.findByRole('radio', { name: new RegExp(w.vote.slice(0, 4)) }, WAIT);
      await waitFor(() => {
        expect(offered).toBeChecked();
      });
      expect(screen.getByRole('button', { name: 'Review' })).toBeDisabled();
      const field = screen.getByRole('textbox', { name: 'Amount to stake, in SOL' });
      await user.type(field, 'abc');
      expect(await screen.findByText('Enter an amount in SOL, such as 1.5.')).toBeInTheDocument();
      await user.clear(field);
      await user.type(field, '100000');
      expect(await screen.findByText(/more than your wallet holds/)).toBeInTheDocument();
      await user.clear(field);
      await user.type(field, '1.5');
      await click(user, 'Review');

      const summary = await waitFor(() => {
        const found = document.querySelector<HTMLElement>('[data-slot="transaction-summary"]');
        expect(found).not.toBeNull();
        return found as HTMLElement;
      }, WAIT);
      expect(summary).toHaveAttribute('data-kind', 'create-stake');
      expect(within(summary).getAllByText(w.vote).length).toBeGreaterThan(0);
      expect(summarySigners(summary)).toEqual(['main']);

      const before = w.testChain.balance(w.A.address);
      await click(user, 'Sign in Main Wallet as Main key');
      await screen.findByRole('heading', { name: 'Your SOL is staked' }, WAIT);

      const accounts = await w.chain.findStakeAccounts({ withdrawer: w.A.address });
      expect(accounts.accounts).toHaveLength(1);
      const created = accounts.accounts[0];
      const rent = w.testChain.minimumBalanceForRentExemption(BigInt(STAKE_ACCOUNT_SIZE));
      expect(created).toMatchObject({ staker: w.A.address, withdrawer: w.A.address, lamports: rent + 1_500_000_000n });
      expect(created?.delegation?.voter).toBe(w.vote);
      expect(created?.lockup.custodian).toBe(ZERO_ADDRESS);
      expect(w.testChain.balance(w.A.address)).toBe(before - rent - 1_500_000_000n - networkFeeFor(1));

      await user.click(screen.getByRole('link', { name: 'Protect it now' }));
      expect(location.history.at(-1)).toBe(`/protect?account=${created?.address ?? ''}`);
    },
    SCENARIO_TIMEOUT,
  );

  it('asks for the main key before anything else', async () => {
    const w = await world();
    renderStakePage(w.chain, '/stake', [], { validators: directory([w.vote]) });
    expect(await screen.findByText(/Connect the wallet whose SOL you want to stake/, undefined, WAIT)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Amount to stake, in SOL' })).toBeNull();
  });
});

describe('SOL amounts', () => {
  it.each([
    ['1', 1_000_000_000n],
    ['1.5', 1_500_000_000n],
    ['0,25', 250_000_000n],
    [' 2. ', 2_000_000_000n],
    ['0.000000001', 1n],
  ])('reads %j', (text, lamports) => {
    expect(parseSolAmount(text)).toBe(lamports);
  });

  it.each(['', '0', '-1', '1e3', '1.0000000001', 'abc', '.5'])('refuses %j', (text) => {
    expect(parseSolAmount(text)).toBeNull();
  });

  it('writes lamports back without trailing zeros', () => {
    expect([1_500_000_000n, 2_000_000_000n, 2_282_880n].map(solInputText)).toEqual(['1.5', '2', '0.00228288']);
  });
});
