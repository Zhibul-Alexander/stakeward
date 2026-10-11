// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { generateKeyPairSigner, type Address, type KeyPairSigner } from '@solana/kit';
import { formatSol, formatUtcDate, shortAddress, type StakeAccount, type StakeAccountFilter } from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { LAMPORTS_PER_SOL, START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { Route, Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { Health } from '@/api/health';
import en from '@/i18n/en.json';
import { AppPage } from '@/pages/AppPage';
import { ProofPage } from '@/pages/ProofPage';
import {
  createProtectedAccountMemory,
  createSecondKeyMemory,
  createSlotStore,
  PortsProvider,
  StaticWalletRegistry,
  type Ports,
} from '@/ports';
import { createFakeApi } from './support/fake-api.ts';

// The public proof page (/proof/:wallet, D124) on the real stake program: accounts are created in LiteSVM and the page
// reads them through LiteSvmChain, as it reads HttpChain in production. No wallet is connected.

const DAY = 86_400n;
const NOW = START_UNIX_TIMESTAMP;
const freshHealth = (): Promise<Health> => Promise.resolve({ lastMonitorRunAt: new Date(Date.now() - 150_000) });

/** Counts the searches, so the page is seen to search by main key only. */
class CountingChain extends LiteSvmChain {
  readonly searches: StakeAccountFilter[] = [];

  override findStakeAccounts(filter: StakeAccountFilter): Promise<{ slot: bigint; accounts: readonly StakeAccount[] }> {
    this.searches.push(filter);
    return super.findStakeAccounts(filter);
  }
}

function renderAt(path: string, chain: LiteSvmChain, page: ReactNode) {
  const location = memoryLocation({ path, record: true });
  const ports: Ports = {
    chain,
    wallets: new StaticWalletRegistry([]),
    slots: createSlotStore(null),
    secondKeys: createSecondKeyMemory(null),
    protectedAccounts: createProtectedAccountMemory(null),
    api: createFakeApi(),
  };
  render(
    <Router hook={location.hook} searchHook={location.searchHook}>
      <PortsProvider ports={ports}>
        {page}
      </PortsProvider>
    </Router>,
  );
}

function renderProof(path: string, chain: LiteSvmChain) {
  renderAt(
    path,
    chain,
    <Route path="/proof/:wallet">
      <ProofPage loadHealth={freshHealth} />
    </Route>,
  );
}

const row = (account: Address) => screen.getByRole('article', { name: `Stake account ${shortAddress(account)}` });
const summary = () => screen.getByRole('region', { name: 'Summary' });
const sol = (lamports: bigint) => formatSol(lamports).replace(/ SOL$/, '');

describe('/proof/:wallet on LiteSvmChain', () => {
  let testChain: TestChain;
  let chain: CountingChain;
  let main: KeyPairSigner;
  let K: Address;
  let otherOwner: Address;
  let emptyWallet: Address;
  const stake = {} as Record<'open' | 'locked' | 'soon' | 'secondKeyFor', Address>;

  beforeAll(async () => {
    testChain = await TestChain.create();
    chain = new CountingChain(testChain);
    main = await generateKeyPairSigner();
    [K, otherOwner, emptyWallet] = (await Promise.all([1, 2, 3].map(() => generateKeyPairSigner()))).map((k) => k.address) as [
      Address,
      Address,
      Address,
    ];
    const A = main.address;
    const lock = (days: bigint, custodian: Address) => ({ unixTimestamp: NOW + days * DAY, epoch: 0n, custodian });
    const vote = await testChain.createVoteAccount();
    stake.open = await testChain.createStakeAccount({
      staker: A,
      withdrawer: A,
      lamports: 3n * LAMPORTS_PER_SOL,
      delegateTo: { voteAccount: vote, stakerKey: main },
    });
    stake.locked = await testChain.createStakeAccount({ staker: A, withdrawer: A, lamports: 40n * LAMPORTS_PER_SOL, lockup: lock(100n, K) });
    stake.soon = await testChain.createStakeAccount({ staker: A, withdrawer: A, lamports: 5n * LAMPORTS_PER_SOL, lockup: lock(10n, K) });
    // The wallet is only the second key of this one: not its own stake, so not on its proof.
    stake.secondKeyFor = await testChain.createStakeAccount({
      staker: otherOwner,
      withdrawer: otherOwner,
      lamports: 7n * LAMPORTS_PER_SOL,
      lockup: lock(100n, A),
    });
  });

  const lamportsOf = (account: Address) => testChain.stakeAccount(account)?.lamports ?? 0n;

  it('shows the totals, the earliest lock end and each account with its lock, from the network only', async () => {
    chain.searches.length = 0;
    renderProof(`/proof/${main.address}`, chain);
    expect(screen.getByRole('heading', { level: 1, name: en.proof.title })).toBeInTheDocument();
    await screen.findByRole('article', { name: `Stake account ${shortAddress(stake.locked)}` });

    // The wallet's own stake only, by main key: no search by second key, and the account it only locks is left out.
    expect(chain.searches).toEqual([{ withdrawer: main.address }]);
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.queryByRole('article', { name: `Stake account ${shortAddress(stake.secondKeyFor)}` })).toBeNull();

    const lockedLamports = lamportsOf(stake.locked) + lamportsOf(stake.soon);
    const total = lockedLamports + lamportsOf(stake.open);
    const bar = summary();
    expect(within(bar).getByText(`${sol(lockedLamports)} SOL locked of ${sol(total)} SOL staked`)).toBeInTheDocument();
    expect(within(bar).getByText('2 of 3 stake accounts locked')).toBeInTheDocument();
    expect(within(bar).getByText(`Earliest lock end: ${formatUtcDate(NOW + 10n * DAY) ?? ''}`)).toBeInTheDocument();
    expect(bar.querySelector('[data-slot="monitoring"]')).toHaveAttribute('data-state', 'fresh');

    // The wallet, short, with copy and explorer.
    expect(screen.getByRole('link', { name: `View ${shortAddress(main.address)} on Solana Explorer (opens in a new tab)` })).toBeInTheDocument();

    // Without a lock first; locks by end date, each with its second key and date; never "Protected" (D14).
    expect(screen.getAllByRole('article').map((article) => article.getAttribute('aria-label'))).toEqual(
      [stake.open, stake.soon, stake.locked].map((a) => `Stake account ${shortAddress(a)}`),
    );
    expect(row(stake.open)).toHaveAttribute('data-status', 'unprotected');
    expect(within(row(stake.open)).getByText(en.status.unprotected)).toBeInTheDocument();
    for (const [account, days] of [
      [stake.locked, 100n],
      [stake.soon, 10n],
    ] as const) {
      expect(row(account)).toHaveAttribute('data-status', 'locked-by-other');
      expect(within(row(account)).getByText(en.status.lockedByOther)).toBeInTheDocument();
      expect(within(row(account)).getByText(`until ${formatUtcDate(NOW + days * DAY) ?? ''}`)).toBeInTheDocument();
      expect(row(account).querySelector('[data-slot="lock-holder"]')).toHaveTextContent(shortAddress(K));
    }
    expect(within(row(stake.soon)).getByText(`until ${formatUtcDate(NOW + 10n * DAY) ?? ''}`)).toHaveClass('text-warning');
    expect(screen.queryByText(en.status.protected)).toBeNull();
    // Read only: no action on any row, no wallet asked for.
    expect(screen.queryByRole('button', { name: /More for stake account/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Connect/ })).toBeNull();

    // The honest lines.
    expect(screen.getByText(en.proof.fresh)).toBeInTheDocument();
    expect(screen.getByText(en.proof.limits)).toBeInTheDocument();
    expect(screen.getByText(en.proof.whoHolds)).toBeInTheDocument();

    // Ask your AI, with the totals and each lock end in the question.
    const ask = screen.getByRole('region', { name: en.askAi.title });
    const question = ask.querySelector('pre')?.textContent ?? '';
    expect(question).toContain(en.proof.ai.task);
    expect(question).toContain(`- SOL locked: ${formatSol(lockedLamports)} of ${formatSol(total)}`);
    expect(question).toContain('- Stake accounts locked: 2 of 3');
    expect(question).toContain(`- Stake account ${stake.soon}: ${formatSol(lamportsOf(stake.soon))}, locked until ${formatUtcDate(NOW + 10n * DAY) ?? ''} by second key ${K}`);
    expect(question).toContain(`- Stake account ${stake.open}: ${formatSol(lamportsOf(stake.open))}, not locked`);
    expect(within(ask).getByRole('link', { name: /Ask Claude/ }).getAttribute('href')).toMatch(/^https:\/\/claude\.ai\/new\?q=/);
  });

  it('says plainly that a wallet without stake has nothing to prove', async () => {
    renderProof(`/proof/${emptyWallet}`, chain);
    expect(await screen.findByRole('heading', { level: 2, name: en.proof.emptyTitle })).toBeInTheDocument();
    expect(screen.getByText(en.proof.emptyBody)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.proof.emptyAction })).toHaveAttribute('href', '/app');
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.queryByRole('region', { name: en.askAi.title })).toBeNull();
  });

  it('says a link without a Solana address is broken, and reads nothing', () => {
    chain.searches.length = 0;
    renderProof('/proof/not-an-address', chain);
    expect(screen.getByRole('heading', { level: 2, name: en.proof.invalidTitle })).toBeInTheDocument();
    expect(chain.searches).toEqual([]);
  });

  it('says what went wrong when the network fails, with details and a retry', async () => {
    chain.failNext('findStakeAccounts', new TypeError('Failed to fetch'));
    renderProof(`/proof/${main.address}`, chain);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(en.proof.errorTitle);
    expect(within(alert).getByText(/Failed to fetch/)).toBeInTheDocument();
    expect(screen.queryByRole('article')).toBeNull();
    expect(within(summary()).getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('article', { name: `Stake account ${shortAddress(stake.locked)}` })).toBeInTheDocument();
    expect(screen.queryByText(en.proof.errorTitle)).toBeNull();
  });

  it('/app offers the proof page of a main key with stake', async () => {
    renderAt(`/app?address=${main.address}`, chain, <AppPage loadHealth={freshHealth} />);
    await screen.findByRole('article', { name: `Stake account ${shortAddress(stake.locked)}` });
    expect(within(summary()).getByRole('link', { name: en.app.results.shareProof })).toHaveAttribute('href', `/proof/${main.address}`);
  });

  it('/app shows no proof link for an address with no stake of its own', async () => {
    renderAt(`/app?address=${emptyWallet}`, chain, <AppPage loadHealth={freshHealth} />);
    await screen.findByRole('heading', { level: 2, name: en.components.empty.noAccountsTitle });
    expect(screen.queryByRole('link', { name: en.app.results.shareProof })).toBeNull();
  });
});
