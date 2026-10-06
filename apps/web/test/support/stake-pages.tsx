// Test-only rendering of the stake account pages (/withdraw/:account, /extend/:account, /second-key/:account, /cosign,
// /rescue and the recovery card) for scenario tests: the real routes and pages over a LiteSvmChain and test wallets, in
// StrictMode as in main.tsx. Never imported from src.
import { getSignatureFromTransaction, getTransactionDecoder, type Signature } from '@solana/kit';
import type { ChainPort } from '@stakeward/core';
import type { TestWalletPort } from '@stakeward/core/test/test-wallet-port';
import { render, screen, waitFor, within, type BoundFunctions, type queries } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { StrictMode } from 'react';
import { expect } from 'vitest';
import { Route, Router, Switch } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { CosignPage } from '@/pages/CosignPage';
import { ExtendPage } from '@/pages/ExtendPage';
import { RecoveryPage } from '@/pages/RecoveryPage';
import { RescuePage } from '@/pages/RescuePage';
import { SecondKeyPage } from '@/pages/SecondKeyPage';
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

/** Queries over the whole document (`screen`) or over one React root (`within(container)`). */
export type Scope = BoundFunctions<typeof queries>;

export type StakePage = { ports: Ports; location: ReturnType<typeof memoryLocation>; user: UserEvent; view: Scope };

/** Fresh ports for one browser: these wallets, no key slot filled, nothing remembered. */
export function testPorts(chain: ChainPort, wallets: readonly TestWalletPort[], ports: Partial<Ports> = {}): Ports {
  return {
    chain,
    wallets: new StaticWalletRegistry(wallets),
    slots: createSlotStore(null),
    secondKeys: createSecondKeyMemory(null),
    protectedAccounts: createProtectedAccountMemory(null),
    api: createFakeApi(chain),
    ...ports,
  };
}

/**
 * Renders the site's stake account routes at `path` with these wallets in the browser and no key slot filled. `signing`
 * replaces FAST_SIGNING (e.g. a link watch that waits, so a test acts before the page polls).
 */
export function renderStakePage(
  chain: ChainPort,
  path: string,
  wallets: readonly TestWalletPort[],
  ports: Partial<Ports> = {},
  signing: SigningTestOptions = FAST_SIGNING,
): StakePage {
  const page = testPorts(chain, wallets, ports);
  const location = memoryLocation({ path, record: true });
  const user = userEvent.setup();
  const { container } = render(
    <StrictMode>
      <Router hook={location.hook} searchHook={location.searchHook}>
        <PortsProvider ports={page}>
          <Switch>
            <Route path="/withdraw/:account">
              <WithdrawPage signing={signing} />
            </Route>
            <Route path="/extend/:account">
              <ExtendPage signing={signing} />
            </Route>
            <Route path="/second-key/:account">
              <SecondKeyPage signing={signing} />
            </Route>
            <Route path="/rescue">
              <RescuePage signing={signing} />
            </Route>
            <Route path="/recovery/:account">
              <RecoveryPage />
            </Route>
          </Switch>
        </PortsProvider>
      </Router>
    </StrictMode>,
  );
  return { ports: page, location, user, view: within(container) };
}

export type RoleName = 'Main key' | 'Second key' | 'New wallet' | 'New second key';

/** One /cosign page in its own React root (the other device): its own ports, wallets and key slots. */
/** `container`: this root's own element, for DOM queries that must not reach another root on the page. */
export type CosignRoot = { ports: Ports; user: UserEvent; view: Scope; container: HTMLElement; unmount: () => void };

/** Renders /cosign for `fragment` (`#tx=...`) in a root of its own, with these wallets and no key slot filled. */
export function renderCosignPage(
  chain: ChainPort,
  fragment: string,
  wallets: readonly TestWalletPort[],
  ports: Partial<Ports> = {},
): CosignRoot {
  const page = testPorts(chain, wallets, ports);
  const location = memoryLocation({ path: '/cosign', record: true });
  const user = userEvent.setup();
  const { container, unmount } = render(
    <StrictMode>
      <Router hook={location.hook} searchHook={location.searchHook}>
        <PortsProvider ports={page}>
          <CosignPage fragment={fragment} signing={FAST_SIGNING} />
        </PortsProvider>
      </Router>
    </StrictMode>,
  );
  return { ports: page, user, view: within(container), container, unmount };
}

/** Connects `walletName` in the key slot of `role` that the page shows now. */
export async function connect(user: UserEvent, role: RoleName, walletName: string, scope: Scope = screen) {
  const slot = await scope.findByRole('group', { name: role }, WAIT);
  await user.click(within(slot).getByRole('button', { name: `Connect a wallet as ${role}` }));
  await user.click(within(slot).getByRole('button', { name: walletName }));
  await waitFor(() => {
    expect(within(scope.getByRole('group', { name: role })).getByText('Connected')).toBeInTheDocument();
  });
}

export async function click(user: UserEvent, name: string | RegExp, scope: Scope = screen) {
  await user.click(await scope.findByRole('button', { name }, WAIT));
}

/** The engine asks for a key that is not connected here: connect it, then Continue to its turn. */
export async function connectAndContinue(user: UserEvent, role: RoleName, walletName: string, scope: Scope = screen) {
  await scope.findByText(`Connect your ${role} to continue: it must sign these transactions.`, undefined, WAIT);
  await connect(user, role, walletName, scope);
  await user.click(scope.getByRole('button', { name: 'Continue' }));
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
