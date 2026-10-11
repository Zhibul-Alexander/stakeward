// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { generateKeyPairSigner, type Address, type KeyPairSigner } from '@solana/kit';
import { networkFeeFor, type ValidatorRisk } from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { createTestWalletPort } from '@stakeward/core/test/test-wallet-port';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ValidatorDirectory } from '@/ports';
import { click, connectAndContinue, renderStakePage, SCENARIO_TIMEOUT, summarySigners, WAIT } from './support/stake-pages.tsx';

// /delegate/:account (DECISIONS.md D134) end to end on the real stake program: an inactive stake under a lock is
// delegated by the main key alone, to a validator from the offered list or one pasted and checked.

const T = START_UNIX_TIMESTAMP + 100n * 86_400n;

type World = { testChain: TestChain; chain: LiteSvmChain; A: KeyPairSigner; K: KeyPairSigner; vote: Address };

async function world(): Promise<World> {
  const testChain = await TestChain.create();
  const [A, K, vote] = await Promise.all([testChain.fundedKey(), generateKeyPairSigner(), testChain.createVoteAccount()]);
  return { testChain, chain: new LiteSvmChain(testChain), A, K, vote };
}

/** A directory that offers these validators and finds `risky` risky; LiteSVM vote accounts have no BLS key. */
function directory(offered: readonly Address[], risky: Record<string, ValidatorRisk[]> = {}): ValidatorDirectory {
  return {
    offer: (limit) =>
      Promise.resolve(offered.slice(0, limit).map((voteAccount) => ({ voteAccount, commission: 5, activatedStake: 1_000_000_000_000n }))),
    risks: (voteAccount) => Promise.resolve(risky[voteAccount] ?? []),
  };
}

describe('/delegate/:account: delegate an inactive stake (D134)', () => {
  it(
    'the main key alone delegates to an offered validator and pays; the lock stays',
    async () => {
      const w = await world();
      const lockup = { unixTimestamp: T, epoch: 0n, custodian: w.K.address };
      const S = await w.testChain.createStakeAccount({ staker: w.A.address, withdrawer: w.A.address, lockup });
      const main = await createTestWalletPort({ name: 'Main Wallet', signers: [w.A] });
      const { user } = renderStakePage(w.chain, `/delegate/${S}`, [main], { validators: directory([w.vote]) });

      await screen.findByRole('heading', { name: 'Choose a validator' }, WAIT);
      expect(document.querySelector('[data-slot="no-paid-placement"]')).toHaveTextContent('No paid placement');
      expect(screen.getByRole('button', { name: 'Review delegation' })).toBeDisabled();
      const offered = await screen.findByRole('radio', { name: new RegExp(w.vote.slice(0, 4)) }, WAIT);
      await user.click(offered);
      await click(user, 'Review delegation');

      const summary = await waitFor(() => {
        const found = document.querySelector<HTMLElement>('[data-slot="transaction-summary"]');
        expect(found).not.toBeNull();
        return found as HTMLElement;
      }, WAIT);
      expect(summary).toHaveAttribute('data-kind', 'delegate');
      expect(within(summary).getAllByText(w.vote).length).toBeGreaterThan(0);
      expect(summarySigners(summary)).toEqual(['main']);

      const before = w.testChain.balance(w.A.address);
      await connectAndContinue(user, 'Main key', 'Main Wallet');
      await click(user, 'Sign in Main Wallet as Main key');
      await screen.findByRole('heading', { name: 'Your stake is delegated' }, WAIT);
      const after = w.testChain.stakeAccount(S);
      expect(after?.delegation?.voter).toBe(w.vote);
      expect(after?.lockup).toEqual(lockup);
      expect(w.testChain.balance(w.A.address)).toBe(before - networkFeeFor(1));
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'a pasted validator with a risk cannot be chosen',
    async () => {
      const w = await world();
      const S = await w.testChain.createStakeAccount({ staker: w.A.address, withdrawer: w.A.address });
      const { user } = renderStakePage(w.chain, `/delegate/${S}`, [], { validators: directory([], { [w.vote]: ['NO_BLS_KEY'] }) });

      await screen.findByText('No validator to offer right now', undefined, WAIT);
      await user.click(screen.getByRole('radio', { name: /Another validator/ }));
      await user.type(screen.getByLabelText('Vote account address'), 'not-an-address');
      expect(await screen.findByText('This is not a Solana address.')).toBeInTheDocument();
      await user.clear(screen.getByLabelText('Vote account address'));
      await user.type(screen.getByLabelText('Vote account address'), w.vote);
      await screen.findByText('It has no BLS key, so the network leaves it out of consensus.', undefined, WAIT);
      expect(screen.getByRole('button', { name: 'Review delegation' })).toBeDisabled();
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'a stake that already earns is not offered delegation',
    async () => {
      const w = await world();
      const S = await w.testChain.createStakeAccount({
        staker: w.A.address,
        withdrawer: w.A.address,
        delegateTo: { voteAccount: w.vote, stakerKey: w.A },
      });
      renderStakePage(w.chain, `/delegate/${S}`, [], { validators: directory([w.vote]) });
      const notReady = await waitFor(() => {
        const found = document.querySelector<HTMLElement>('[data-slot="delegate-not-ready"]');
        expect(found).not.toBeNull();
        return found as HTMLElement;
      }, WAIT);
      expect(notReady).toHaveTextContent('This stake is already delegated and earning.');
    },
    SCENARIO_TIMEOUT,
  );
});
