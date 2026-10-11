// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { generateKeyPairSigner, type Address, type KeyPairSigner } from '@solana/kit';
import { shortAddress } from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { LAMPORTS_PER_SOL, START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { Health } from '@/api/health';
import type { RescueKitPort, RescueKitStatus } from '@/api/rescue-kits';
import { AppPage } from '@/pages/AppPage';
import { MAX_KIT_LOOKUPS } from '@/pages/app/ProtectionCheckSection';
import {
  createProtectedAccountMemory,
  createSecondKeyMemory,
  createSlotStore,
  PortsProvider,
  StaticWalletRegistry,
  type Ports,
} from '@/ports';
import { createFakeApi } from './support/fake-api.ts';

// The "Protection check" of /app (D125) on the real stake program: the checklist comes from the accounts the page
// reads through LiteSvmChain, the second keys this browser knows and a fake of GET /api/rescue-kits.

const DAY = 86_400n;
const NOW = START_UNIX_TIMESTAMP;
const freshHealth = (): Promise<Health> => Promise.resolve({ lastMonitorRunAt: new Date(Date.now() - 150_000) });

function kitPort(ready: readonly Address[], asked: Address[], fail = false): RescueKitPort {
  return {
    store: () => Promise.reject(new Error('not in this test')),
    status: (stakeAccount) => {
      asked.push(stakeAccount);
      if (fail) return Promise.reject(new Error('HTTP 429'));
      const status: RescueKitStatus = {
        stakeAccount,
        status: ready.includes(stakeAccount) ? 'ready' : 'none',
        newWallet: null,
        signature: null,
        sentAt: null,
        telegramLinked: false,
        autoMode: null,
      };
      return Promise.resolve(status);
    },
  };
}

function renderApp(chain: LiteSvmChain, path: string, options: { secondKeys?: Address[]; rescueKits: RescueKitPort }) {
  const location = memoryLocation({ path, record: true });
  const ports: Ports = {
    chain,
    wallets: new StaticWalletRegistry([]),
    slots: createSlotStore(null),
    secondKeys: createSecondKeyMemory(null),
    protectedAccounts: createProtectedAccountMemory(null),
    api: createFakeApi(),
    rescueKits: options.rescueKits,
  };
  for (const key of options.secondKeys ?? []) ports.secondKeys.remember(key);
  render(
    <Router hook={location.hook} searchHook={location.searchHook}>
      <PortsProvider ports={ports}>
        <AppPage loadHealth={freshHealth} />
      </PortsProvider>
    </Router>,
  );
}

const checkSection = async () => {
  const heading = await screen.findByRole('heading', { level: 2, name: 'Protection check' });
  const region = heading.closest('section');
  if (region === null) throw new Error('no Protection check section');
  return region;
};
const checkRow = (region: HTMLElement, id: string) => {
  const found = region.querySelector<HTMLElement>(`[data-check="${id}"]`);
  if (found === null) throw new Error(`no check ${id}`);
  return found;
};
const isOpen = (row: HTMLElement) => row.querySelector('details')?.open === true;

describe('/app protection check on LiteSvmChain', () => {
  let testChain: TestChain;
  let chain: LiteSvmChain;
  let main: KeyPairSigner;
  let K: KeyPairSigner;
  const stake = {} as Record<'open' | 'locked' | 'expiring' | 'service', Address>;

  beforeAll(async () => {
    testChain = await TestChain.create();
    chain = new LiteSvmChain(testChain);
    [main, K] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    const serviceStaker = (await generateKeyPairSigner()).address;
    const A = main.address;
    const lock = (days: bigint) => ({ unixTimestamp: NOW + days * DAY, epoch: 0n, custodian: K.address });
    stake.open = await testChain.createStakeAccount({ staker: A, withdrawer: A, lamports: 3n * LAMPORTS_PER_SOL });
    stake.locked = await testChain.createStakeAccount({ staker: A, withdrawer: A, lamports: 40n * LAMPORTS_PER_SOL, lockup: lock(100n) });
    stake.expiring = await testChain.createStakeAccount({ staker: A, withdrawer: A, lamports: 5n * LAMPORTS_PER_SOL, lockup: lock(10n) });
    stake.service = await testChain.createStakeAccount({ staker: serviceStaker, withdrawer: A, lamports: 4n * LAMPORTS_PER_SOL });
  });

  it('scores the checks, opens the failing ones with their fix, and asks the AI with the result', async () => {
    const asked: Address[] = [];
    renderApp(chain, `/app?address=${main.address}`, { secondKeys: [K.address], rescueKits: kitPort([stake.locked], asked) });
    const region = await checkSection();

    // locked: fail, not ending: fail, second key: pass, alerts: unknown (not scored), kit: fail, staker: fail.
    expect(await within(region).findByText('1 of 5 checks pass')).toBeInTheDocument();
    expect(asked.sort()).toEqual([stake.locked, stake.expiring].sort());

    const locked = checkRow(region, 'locked');
    expect(locked).toHaveAttribute('data-status', 'fail');
    expect(isOpen(locked)).toBe(true);
    expect(within(locked).getByText('Fix')).toBeInTheDocument();
    const protect = within(locked).getByRole('link', { name: 'Protect these accounts' });
    const href = protect.getAttribute('href') ?? '';
    expect(href.startsWith('/protect?')).toBe(true);
    expect(new URLSearchParams(href.slice('/protect?'.length)).getAll('account').sort()).toEqual([stake.open, stake.service].sort());

    const ending = checkRow(region, 'not-ending');
    expect(within(ending).getByRole('link', { name: `Extend for stake account ${shortAddress(stake.expiring)}` })).toHaveAttribute(
      'href',
      `/extend/${stake.expiring}`,
    );

    const second = checkRow(region, 'second-key');
    expect(second).toHaveAttribute('data-status', 'pass');
    expect(isOpen(second)).toBe(false);

    const alerts = checkRow(region, 'alerts');
    expect(alerts).toHaveAttribute('data-status', 'unknown');
    expect(within(alerts).getByText('Not scored')).toBeInTheDocument();
    expect(within(alerts).getByRole('link', { name: /Connect Telegram alerts/ })).toHaveAttribute(
      'href',
      `/api/telegram/link?wallet=${main.address}`,
    );

    const kit = checkRow(region, 'rescue-kit');
    expect(kit).toHaveAttribute('data-status', 'fail');
    expect(within(kit).getByText('Optional')).toBeInTheDocument();
    // Advice, not a hole in the lock: Check, not Fix.
    expect(within(kit).getByText('Check')).toBeInTheDocument();
    expect(within(kit).getByRole('link', { name: 'Set up one-tap rescue' })).toHaveAttribute('href', '/rescue-kit');

    // Another key manages staking on an account without a lock: a service, so a warning with no Rescue.
    const staker = checkRow(region, 'staker');
    expect(staker).toHaveAttribute('data-status', 'fail');
    expect(within(staker).queryByRole('link', { name: 'Open Rescue' })).toBeNull();

    const card = checkRow(region, 'recovery-card');
    expect(card).toHaveAttribute('data-status', 'info');
    expect(within(card).getByRole('link', { name: `Recovery card for stake account ${shortAddress(stake.locked)}` })).toHaveAttribute(
      'href',
      `/recovery/${stake.locked}`,
    );

    // Ask your AI: the task and the results, in the person's own account.
    const ask = screen.getByRole('link', { name: /Ask ChatGPT/ });
    const question = decodeURIComponent((ask.getAttribute('href') ?? '').slice('https://chatgpt.com/?q='.length));
    expect(question).toContain('Review my Stakeward protection setup and tell me in plain words what to fix first.');
    expect(question).toContain('- Score: 1 of 5 checks pass');
    expect(question).toContain('- Stake accounts of this main key: 4');
    expect(question).toContain('- Check “Every stake account is locked”: Fix.');
  });

  it('a new device: the second key and the kits are unknown, and neither counts in the score', async () => {
    const asked: Address[] = [];
    renderApp(chain, `/app?address=${main.address}`, { rescueKits: kitPort([], asked, true) });
    const region = await checkSection();
    // locked: fail, not ending: fail, staker: fail; second key, alerts and kits unknown.
    expect(await within(region).findByText('0 of 3 checks pass')).toBeInTheDocument();
    expect(checkRow(region, 'second-key')).toHaveAttribute('data-status', 'unknown');
    expect(checkRow(region, 'rescue-kit')).toHaveAttribute('data-status', 'unknown');
    expect(asked.length).toBeLessThanOrEqual(MAX_KIT_LOOKUPS);
  });
});
