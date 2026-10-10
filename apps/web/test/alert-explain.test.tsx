// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { generateKeyPairSigner, type Address, type KeyPairSigner } from '@solana/kit';
import { alertLinkPath, formatUtcDate } from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { LAMPORTS_PER_SOL, START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { WatchedAccounts } from '@/api/accounts';
import type { Health } from '@/api/health';
import { AppPage } from '@/pages/AppPage';
import { RescuePage } from '@/pages/RescuePage';
import {
  createProtectedAccountMemory,
  createSecondKeyMemory,
  createSlotStore,
  PortsProvider,
  StaticWalletRegistry,
  type Ports,
} from '@/ports';
import { createFakeApi } from './support/fake-api.ts';

// "Explain this alert" (D125): the page an alert's button opens reads `event` and `stake` from the link, shows the
// account's recent events from GET /api/accounts (a fake here) and offers Ask your AI with them.

const DAY = 86_400n;
const NOW = START_UNIX_TIMESTAMP;
const LOCK_UNTIL = NOW + 100n * DAY;
const freshHealth = (): Promise<Health> => Promise.resolve({ lastMonitorRunAt: new Date(Date.now() - 150_000) });

function renderAt(chain: LiteSvmChain, path: string, watchedAccounts: Ports['watchedAccounts'], page: ReactNode) {
  const location = memoryLocation({ path, record: true });
  const ports: Ports = {
    chain,
    wallets: new StaticWalletRegistry([]),
    slots: createSlotStore(null),
    secondKeys: createSecondKeyMemory(null),
    protectedAccounts: createProtectedAccountMemory(null),
    api: createFakeApi(),
    watchedAccounts,
  };
  render(
    <Router hook={location.hook} searchHook={location.searchHook}>
      <PortsProvider ports={ports}>{page}</PortsProvider>
    </Router>,
  );
}

const explanation = async () => {
  const heading = await screen.findByRole('heading', { level: 2, name: 'About this alert' });
  const region = heading.closest('section');
  if (region === null) throw new Error('no alert section');
  return region;
};

describe('Explain this alert', () => {
  let chain: LiteSvmChain;
  let main: KeyPairSigner;
  let stake: Address;
  let other: Address;

  beforeAll(async () => {
    const testChain = await TestChain.create();
    chain = new LiteSvmChain(testChain);
    main = await generateKeyPairSigner();
    const K = await generateKeyPairSigner();
    const A = main.address;
    const lockup = { unixTimestamp: LOCK_UNTIL, epoch: 0n, custodian: K.address };
    stake = await testChain.createStakeAccount({ staker: A, withdrawer: A, lamports: 10n * LAMPORTS_PER_SOL, lockup });
    other = await testChain.createStakeAccount({ staker: A, withdrawer: A, lamports: 2n * LAMPORTS_PER_SOL, lockup });
  });

  const watched = (): WatchedAccounts => ({
    accounts: [
      { address: stake, roles: ['main'], lockUntil: LOCK_UNTIL, lock: 'in-force', daysLeft: 100, lamports: 10n * LAMPORTS_PER_SOL, state: 'delegated' },
    ],
    events: [
      { stakeAccount: stake, type: 'DEACTIVATED', detectedAt: new Date('2026-10-10T10:30:00Z') },
      { stakeAccount: other, type: 'BALANCE_DECREASED', detectedAt: new Date('2026-10-10T10:00:00Z') },
      { stakeAccount: stake, type: 'DELEGATION_CHANGED', detectedAt: new Date('2026-10-09T08:00:00Z') },
    ],
  });

  it('/rescue from Open Rescue: the event in plain words, its time, the account now, its earlier changes and Ask your AI', async () => {
    const asked: Address[] = [];
    const path = alertLinkPath(`/rescue?address=${main.address}`, { event: 'DEACTIVATED', stake });
    renderAt(
      chain,
      path,
      (wallet) => {
        asked.push(wallet);
        return Promise.resolve(watched());
      },
      <RescuePage />,
    );
    const region = await explanation();
    expect(await within(region).findByText('10 October 2026, 10:30 UTC')).toBeInTheDocument();
    expect(asked).toEqual([main.address]);
    expect(within(region).getByText('The stake was deactivated: unstaking started.')).toBeInTheDocument();
    expect(within(region).getByText('Locked · delegated')).toBeInTheDocument();
    expect(within(region).getByText(formatUtcDate(LOCK_UNTIL) ?? '')).toBeInTheDocument();
    // Only this account's other events, not the alert itself and not another account's.
    const recent = within(region).getByRole('list');
    expect(within(recent).getAllByRole('listitem')).toHaveLength(1);
    expect(within(recent).getByText('The validator this stake is delegated to changed.')).toBeInTheDocument();

    const ask = screen.getByRole('link', { name: /Ask Claude/ });
    const question = decodeURIComponent((ask.getAttribute('href') ?? '').slice('https://claude.ai/new?q='.length));
    expect(question).toContain('Explain what this stake alert means for me and what I should do now.');
    expect(question).toContain('- Event: The stake was deactivated: unstaking started. (DEACTIVATED)');
    expect(question).toContain(`- Stake account: ${stake}`);
    expect(question).toContain('- Seen at: 10 October 2026, 10:30 UTC');
    expect(question).toContain('- Current status: Locked · delegated');
  });

  it('/app: a failed read says so and tries again; the alert itself still shows', async () => {
    let calls = 0;
    const path = alertLinkPath(`/app?address=${main.address}`, { event: 'STAKER_CHANGED', stake });
    renderAt(
      chain,
      path,
      () => {
        calls += 1;
        return calls === 1 ? Promise.reject(new Error('HTTP 429')) : Promise.resolve(watched());
      },
      <AppPage loadHealth={freshHealth} />,
    );
    const region = await explanation();
    expect(await within(region).findByText("Could not read this account's recent changes")).toBeInTheDocument();
    expect(within(region).getByText('The key that can deactivate and delegate this stake changed.')).toBeInTheDocument();
    await userEvent.click(within(region).getByRole('button', { name: /Try again/ }));
    // STAKER_CHANGED has no record here: its time is not known, the account's events are listed.
    expect(await within(region).findByText('Not known')).toBeInTheDocument();
    expect(within(region).getAllByRole('listitem')).toHaveLength(2);
  });

  it('an unknown event type (a newer worker) reads as a change', async () => {
    renderAt(
      chain,
      `/app?address=${main.address}&event=VALIDATOR_SOMETHING&stake=${stake}`,
      () => Promise.resolve(watched()),
      <AppPage loadHealth={freshHealth} />,
    );
    const region = await explanation();
    expect(within(region).getByText('The monitor saw a change on this stake account.')).toBeInTheDocument();
  });

  it('a link with a bad stake parameter shows no alert block', async () => {
    renderAt(chain, `/app?address=${main.address}&event=DEACTIVATED&stake=x`, () => Promise.resolve(watched()), <AppPage loadHealth={freshHealth} />);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('heading', { name: 'About this alert' })).toBeNull();
  });
});
