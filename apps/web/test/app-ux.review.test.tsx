// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { generateKeyPairSigner, type Address } from '@solana/kit';
import { U64_MAX, type ChainClock, type ChainPort, type StakeAccount } from '@stakeward/core';
import { createTestWalletPort, type TestWalletPort } from '@stakeward/core/test/test-wallet-port';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { fetchHealth, monitorFreshness, type Health } from '@/api/health';
import { AccountRow } from '@/components/product/account-row';
import { AppPage } from '@/pages/AppPage';
import { buildAccountsView } from '@/pages/app/view';
import {
  createProtectedAccountMemory,
  createSecondKeyMemory,
  createSlotStore,
  PortsProvider,
  StaticWalletRegistry,
  type Ports,
} from '@/ports';

// Adversarial review of the step-3 accounts page (/app): UX rules 11 and 12, CLAUDE.md section 5 and D14.

const DAY = 86_400n;
const SOL = 1_000_000_000n;
const ZERO = '11111111111111111111111111111111' as Address;
const CLOCK: ChainClock = { unixTimestamp: 1_790_942_400n, epoch: 850n, slot: 367_201_000n };

async function newAddress(): Promise<Address> {
  return (await generateKeyPairSigner()).address;
}

function stakeAccount(address: Address, withdrawer: Address, lamports: bigint, lock?: { days: bigint; custodian: Address }): StakeAccount {
  return {
    address,
    lamports,
    kind: 'delegated',
    rentExemptReserve: 2_282_880n,
    staker: withdrawer,
    withdrawer,
    lockup:
      lock === undefined
        ? { unixTimestamp: 0n, epoch: 0n, custodian: ZERO }
        : { unixTimestamp: CLOCK.unixTimestamp + lock.days * DAY, epoch: 0n, custodian: lock.custodian },
    delegation: { voter: ZERO, stake: lamports - 2_282_880n, activationEpoch: 700n, deactivationEpoch: U64_MAX },
  };
}

/** A chain that knows a fixed set of stake accounts; only what /app reads. */
function stubChain(accounts: readonly StakeAccount[]): ChainPort {
  const chain: Partial<ChainPort> = {
    getClock: () => Promise.resolve(CLOCK),
    findStakeAccounts: (filter) =>
      Promise.resolve({
        slot: CLOCK.slot,
        accounts: accounts.filter((account) =>
          'withdrawer' in filter ? account.withdrawer === filter.withdrawer : account.lockup.custodian === filter.custodian,
        ),
      }),
  };
  return chain as ChainPort;
}

function renderApp(path: string, chain: ChainPort, loadHealth: () => Promise<Health>, wallets: TestWalletPort[] = []) {
  const location = memoryLocation({ path, record: true });
  const ports: Ports = {
    chain,
    wallets: new StaticWalletRegistry(wallets),
    slots: createSlotStore(null),
    secondKeys: createSecondKeyMemory(null),
    protectedAccounts: createProtectedAccountMemory(null),
  };
  render(
    <Router hook={location.hook} searchHook={location.searchHook}>
      <PortsProvider ports={ports}>
        <AppPage loadHealth={loadHealth} />
      </PortsProvider>
    </Router>,
  );
  return { ports };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('/app "Last checked N min ago" (UX rule 12)', () => {
  it('stays fresh while the page is open and the monitor keeps running every 2 minutes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const main = await newAddress();
    // The worker's monitor runs every 2 minutes: whenever /api/health is asked, its last pass is at most 2 min old.
    const loadHealth = vi.fn(() => Promise.resolve<Health>({ lastMonitorRunAt: new Date(Date.now() - 60_000) }));
    renderApp(`/app?address=${main}`, stubChain([]), loadHealth);
    expect(await screen.findByText('Last checked 1 min ago')).toBeInTheDocument();

    // The owner leaves the tab open for 15 minutes. Monitoring never stopped.
    await act(async () => {
      vi.advanceTimersByTime(15 * 60_000);
      await Promise.resolve();
    });

    const line = document.querySelector('[data-slot="monitoring"]');
    // Fails today: /api/health is read once per Refresh, so the age grows with the local clock and the line turns red
    // ("Last checked 16 min ago. Alerts may be late.") although the monitor checked a minute ago.
    expect(line).not.toHaveAttribute('data-state', 'stale');
    expect(loadHealth.mock.calls.length).toBeGreaterThan(1);
  });

  const SERVER_NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
  const respond = (status: number, body: unknown) => () =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

  it('shows red when the worker itself says monitoring is stale (HTTP 503), even if this device clock lags', async () => {
    // Worker: last pass 12 minutes ago -> 503 { ok: false } (CLAUDE.md section 8).
    const health = await fetchHealth({
      fetch: respond(503, { ok: false, lastMonitorRunAt: new Date(SERVER_NOW - 12 * 60_000).toISOString() }),
    });
    // The device clock is 15 minutes behind the worker's.
    const deviceNow = SERVER_NOW - 15 * 60_000;
    // Fails today: `ok` and the 503 are dropped, the age is computed from the device clock (clamped to 0), and the
    // page says "Last checked less than a minute ago" while alerts are in fact 12 minutes late.
    expect(monitorFreshness(health, deviceNow)).toMatchObject({ kind: 'checked', stale: true });
  });

  it('does not turn red when the worker says monitoring is fine (HTTP 200), even if this device clock runs ahead', async () => {
    const health = await fetchHealth({
      fetch: respond(200, { ok: true, lastMonitorRunAt: new Date(SERVER_NOW - 60_000).toISOString() }),
    });
    const deviceNow = SERVER_NOW + 15 * 60_000;
    // Fails today: "Last checked 16 min ago. Alerts may be late." in red, on a healthy monitor.
    expect(monitorFreshness(health, deviceNow)).toMatchObject({ kind: 'checked', stale: false });
  });
});

describe('/app statuses without a known second key (CLAUDE.md section 5, D14)', () => {
  it('connecting the real second key never lowers the "protected" total', async () => {
    const [A, K, thief] = await Promise.all([newAddress(), newAddress(), newAddress()]);
    const [mine, planted] = await Promise.all([newAddress(), newAddress()]);
    const accounts = [
      stakeAccount(mine, A, 40n * SOL, { days: 100n, custodian: K }),
      // A lock whose second key is not the owner's (e.g. set through a fake Stakeward site, CLAUDE.md section 11).
      stakeAccount(planted, A, 500n * SOL, { days: 365n, custodian: thief }),
    ];
    const view = (knownSecondKeys: Address[]) =>
      buildAccountsView({ address: A, accounts, clock: CLOCK, knownSecondKeys, rememberedProtected: [] });

    const before = view([]); // by address on a phone, or a fresh browser
    const after = view([K]); // the owner connects the second key
    // Fails today: with no key known the thief's lock is "Protected" (green) and counted: "540 SOL protected";
    // after connecting K it is "Locked by another key" and the total drops to 40 SOL.
    expect(before.totals.protectedLamports).toBeLessThanOrEqual(after.totals.protectedLamports);
    const plantedRow = before.owned.find((row) => row.account.address === planted);
    // Fix round of step 3: AccountView has no secondKeyConfirmed any more; a lock held by an unknown key is someone else's.
    expect(plantedRow?.protection).toBe('locked-by-other');
  });
});

describe('/app announcements (UX rule 11, WCAG 4.1.3 status messages)', () => {
  it('announces the result of a check to screen readers', async () => {
    const [A, K] = await Promise.all([newAddress(), newAddress()]);
    const accounts = [
      stakeAccount(await newAddress(), A, 3n * SOL),
      stakeAccount(await newAddress(), A, 40n * SOL, { days: 100n, custodian: K }),
    ];
    renderApp(`/app?address=${A}`, stubChain(accounts), () => Promise.resolve({ lastMonitorRunAt: new Date() }));
    await screen.findAllByRole('article');
    // The "Reading stake accounts from the network" status is removed when the list arrives; nothing in a live region
    // says what was found. Fails today.
    const live = [...document.querySelectorAll('[role="status"], [role="alert"], [aria-live]')].map((el) => el.textContent);
    expect(live.some((text) => /stake account/i.test(text))).toBe(true);
  });
});

describe('/app "Is this lock yours?" by address (CLAUDE.md section 6, F1: K must differ from A)', () => {
  it('refuses the viewed main key as the second key', async () => {
    const mainSigner = await generateKeyPairSigner();
    const A = mainSigner.address;
    const K = await newAddress();
    const locked = await newAddress();
    const accounts = [stakeAccount(locked, A, 40n * SOL, { days: 100n, custodian: K })];
    // The owner checks by address (main slot empty) and connects the wallet that holds A in the second-key slot.
    const wallet = await createTestWalletPort({ name: 'Main Wallet', signers: [mainSigner], connected: true });
    const { ports } = renderApp(`/app?address=${A}`, stubChain(accounts), () => Promise.resolve({ lastMonitorRunAt: new Date() }), [
      wallet,
    ]);
    const heading = await screen.findByRole('heading', { level: 2, name: 'Is this lock yours?' });
    const confirm = heading.closest('section');
    if (confirm === null) throw new Error('no section');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Connect a wallet as Second key' }));
    await userEvent.click(within(confirm).getByRole('button', { name: 'Main Wallet' }));

    // Fails today: A fills the Second key slot, and the owner's own lock (held by K) flips to "Locked by another key".
    await waitFor(() => {
      expect(ports.slots.getSnapshot().second?.address).not.toBe(A);
    });
    // The slot says why and how to go on (CLAUDE.md section 6). The row stays Locked by another key: with no second key
    // known, no lock is called the viewer's (D14, fix round of step 3), but never because A became the second key.
    expect(within(confirm).getByText('This account is already your Main key.')).toBeInTheDocument();
    expect(within(confirm).getByText('Switch to your second account in the wallet, then press Continue.')).toBeInTheDocument();
    expect(ports.slots.getSnapshot().second).toBeNull();
  });
});

describe('AccountRow lock date', () => {
  it('does not show an end date in the past for a lock its epoch still holds', async () => {
    const custodian = await newAddress();
    // In force by epoch (900 > 850); its unix timestamp passed in 2020.
    const lockup = { unixTimestamp: 1_600_000_000n, epoch: 900n, custodian };
    render(
      <AccountRow
        account={{ address: await newAddress(), lamports: 10n * SOL, lockup }}
        activation="active"
        protection="locked-by-other"
        managedByService={false}
      />,
    );
    // Fails today: "Locked by another key  until 13 September 2020".
    expect(screen.queryByText(/until .*2020/)).toBeNull();
  });
});
