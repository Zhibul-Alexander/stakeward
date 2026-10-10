// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { generateKeyPairSigner, type Address, type KeyPairSigner } from '@solana/kit';
import { buildTransaction, type TransactionAction } from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { Route, Router, Switch } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import en from '@/i18n/en.json';
import { StealPage } from '@/pages/StealPage';
import { PortsProvider } from '@/ports';
import { SCENARIO_TIMEOUT, testPorts, WAIT } from './support/stake-pages.tsx';

// /try-steal/:account (DECISIONS.md D123) on the real stake program: S1 is locked by the second key K, S2 has no lock.
// The page simulates, as a thief with only the main key, a withdraw of everything and removing the lock.

const T = START_UNIX_TIMESTAMP + 180n * 86_400n;

let world: { lite: LiteSvmChain; testChain: TestChain; A: KeyPairSigner; S1: Address; S2: Address };

beforeAll(async () => {
  const testChain = await TestChain.create();
  const lite = new LiteSvmChain(testChain);
  const [A, K] = await Promise.all([testChain.fundedKey(), generateKeyPairSigner()]);
  const own = { staker: A.address, withdrawer: A.address };
  const S1 = await testChain.createStakeAccount(own);
  const S2 = await testChain.createStakeAccount(own);
  const action: TransactionAction = { kind: 'protect', stakeAccount: S1, mainKey: A.address, secondKey: K.address, lockUntil: T };
  const lifetime = { kind: 'blockhash', ...(await lite.getLatestBlockhash()) } as const;
  const result = await testChain.send(buildTransaction(action, { feePayer: A.address, lifetime }).bytes, [A, K]);
  if (!result.ok) throw new Error('protect failed');
  world = { lite, testChain, A, S1, S2 };
}, SCENARIO_TIMEOUT);

function renderSteal(account: Address) {
  const location = memoryLocation({ path: `/try-steal/${account}` });
  render(
    <StrictMode>
      <Router hook={location.hook} searchHook={location.searchHook}>
        <PortsProvider ports={testPorts(world.lite, [])}>
          <Switch>
            <Route path="/try-steal/:account">
              <StealPage />
            </Route>
          </Switch>
        </PortsProvider>
      </Router>
    </StrictMode>,
  );
  return userEvent.setup();
}

const verdictOf = (attempt: string) => document.querySelector(`[data-attempt="${attempt}"] [data-verdict]`)?.getAttribute('data-verdict');

describe('/try-steal/:account on LiteSvmChain', () => {
  it(
    'a locked stake: the network blocks both attempts; nothing changes; the AI question carries the outcome',
    async () => {
      const before = world.testChain.balance(world.S1);
      const user = renderSteal(world.S1);
      await user.click(await screen.findByRole('button', { name: en.steal.run }, WAIT));
      expect(await screen.findByText(en.steal.summary.safe, undefined, WAIT)).toBeInTheDocument();
      expect(verdictOf('withdraw')).toBe('blocked');
      expect(verdictOf('remove-lock')).toBe('blocked');
      expect(screen.getAllByText(en.steal.verdicts.blocked)).toHaveLength(2);
      expect(screen.queryByRole('link', { name: en.steal.protect })).toBeNull();
      const ai = screen.getByRole('region', { name: en.askAi.title });
      expect(within(ai).getByText(/Stakeward says: Your SOL stays put/)).toBeInTheDocument();
      expect(world.testChain.balance(world.S1)).toBe(before);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'an unlocked stake: both would succeed, and the page offers Protect',
    async () => {
      const user = renderSteal(world.S2);
      await user.click(await screen.findByRole('button', { name: en.steal.run }, WAIT));
      expect(await screen.findByText(en.steal.summary.exposed, undefined, WAIT)).toBeInTheDocument();
      expect(verdictOf('withdraw')).toBe('would-succeed');
      expect(verdictOf('remove-lock')).toBe('would-succeed');
      expect(screen.getByRole('link', { name: en.steal.protect })).toHaveAttribute('href', `/protect?account=${world.S2}`);
    },
    SCENARIO_TIMEOUT,
  );
});
