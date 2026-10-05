// Test-only rendering of the stake account pages (/withdraw/:account, /extend/:account) for scenario tests: the real
// routes and pages over a LiteSvmChain and test wallets, in StrictMode as in main.tsx. Never imported from src.
import { getSignatureFromTransaction, getTransactionDecoder, type Signature } from '@solana/kit';
import type { ChainPort } from '@stakeward/core';
import type { TestWalletPort } from '@stakeward/core/test/test-wallet-port';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { StrictMode } from 'react';
import { expect } from 'vitest';
import { Route, Router, Switch } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { WithdrawPage } from '@/pages/WithdrawPage';
import {
  createProtectedAccountMemory,
  createSecondKeyMemory,
  createSlotStore,
  PortsProvider,
  StaticWalletRegistry,
  type Ports,
} from '@/ports';
import type { SigningTestOptions } from '@/signing/create';
import { createFakeApi } from './fake-api.ts';

export const SCENARIO_TIMEOUT = 60_000;
export const WAIT = { timeout: 20_000 };

/** Polls, re-reads and link polls as fast as the tests can go (step 7 spec 13). */
export const FAST_SIGNING: SigningTestOptions = { pollIntervalMs: 1, rereadDelayMs: 1, link: { firstPollMs: 1, maxPollMs: 1 } };

export type StakePage = { ports: Ports; location: ReturnType<typeof memoryLocation>; user: UserEvent };

/** Renders the site's stake account routes at `path` with these wallets in the browser and no key slot filled. */
export function renderStakePage(chain: ChainPort, path: string, wallets: readonly TestWalletPort[], ports: Partial<Ports> = {}): StakePage {
  const page: Ports = {
    chain,
    wallets: new StaticWalletRegistry(wallets),
    slots: createSlotStore(null),
    secondKeys: createSecondKeyMemory(null),
    protectedAccounts: createProtectedAccountMemory(null),
    api: createFakeApi(chain),
    ...ports,
  };
  const location = memoryLocation({ path, record: true });
  const user = userEvent.setup();
  render(
    <StrictMode>
      <Router hook={location.hook} searchHook={location.searchHook}>
        <PortsProvider ports={page}>
          <Switch>
            <Route path="/withdraw/:account">
              <WithdrawPage signing={FAST_SIGNING} />
            </Route>
          </Switch>
        </PortsProvider>
      </Router>
    </StrictMode>,
  );
  return { ports: page, location, user };
}

/** Connects `walletName` in the key slot of `role` that the page shows now. */
export async function connect(user: UserEvent, role: 'Main key' | 'Second key', walletName: string) {
  const slot = await screen.findByRole('group', { name: role }, WAIT);
  await user.click(within(slot).getByRole('button', { name: `Connect a wallet as ${role}` }));
  await user.click(within(slot).getByRole('button', { name: walletName }));
  await waitFor(() => {
    expect(within(screen.getByRole('group', { name: role })).getByText('Connected')).toBeInTheDocument();
  });
}

export async function click(user: UserEvent, name: string | RegExp) {
  await user.click(await screen.findByRole('button', { name }, WAIT));
}

/** The engine asks for a key that is not connected here: connect it, then Continue to its turn. */
export async function connectAndContinue(user: UserEvent, role: 'Main key' | 'Second key', walletName: string) {
  await screen.findByText(`Connect your ${role} to continue: it must sign these transactions.`, undefined, WAIT);
  await connect(user, role, walletName);
  await user.click(screen.getByRole('button', { name: 'Continue' }));
}

/** The transaction id of the last signed bytes a wallet returned. */
export function lastSignature(wallet: TestWalletPort): Signature {
  const transactions = wallet.responses.at(-1);
  const bytes = transactions?.[0];
  if (bytes === undefined) throw new Error(`${wallet.name} signed nothing`);
  return getSignatureFromTransaction(getTransactionDecoder().decode(bytes));
}

/** Roles of the signers the summary on screen lists, in its order. */
export function summarySigners(summary: HTMLElement): (string | null)[] {
  return [...summary.querySelectorAll('[data-signer]')].map((item) => item.getAttribute('data-signer'));
}
