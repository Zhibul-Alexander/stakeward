// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { generateKeyPairSigner, type Address, type KeyPairSigner } from '@solana/kit';
import { formatSol, formatUtcDate, shortAddress, type ChainPort } from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { LAMPORTS_PER_SOL, START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { createTestWalletPort, type TestWalletPort } from '@stakeward/core/test/test-wallet-port';
import { changeStaker } from '@stakeward/core/test/thief';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import type { Health } from '@/api/health';
import { AppPage } from '@/pages/AppPage';
import {
  createProtectedAccountMemory,
  createSecondKeyMemory,
  createSlotStore,
  PortsProvider,
  StaticWalletRegistry,
  type Ports,
} from '@/ports';
import { createFakeApi } from './support/fake-api.ts';

// The accounts page (/app) on the real stake program: accounts are created in LiteSVM, the page reads them through
// LiteSvmChain exactly as it reads HttpChain in production, and test wallets fill the key slots.

const DAY = 86_400n;
const NOW = START_UNIX_TIMESTAMP;
const freshHealth = (): Promise<Health> => Promise.resolve({ lastMonitorRunAt: new Date(Date.now() - 150_000) });

type Setup = {
  path: string;
  chain?: ChainPort;
  wallets?: TestWalletPort[];
  /** Fill the main slot with this wallet's first key (the wallet must be connected to offer it). */
  mainSlot?: TestWalletPort;
  /** Fill the second slot with this wallet's first key (the wallet must be connected to offer it). */
  secondSlot?: TestWalletPort;
  rememberedSecondKeys?: Address[];
  loadHealth?: () => Promise<Health>;
};

function renderApp(setup: Setup, defaultChain: ChainPort) {
  const location = memoryLocation({ path: setup.path, record: true });
  const ports: Ports = {
    chain: setup.chain ?? defaultChain,
    wallets: new StaticWalletRegistry(setup.wallets ?? []),
    slots: createSlotStore(null),
    secondKeys: createSecondKeyMemory(null),
    protectedAccounts: createProtectedAccountMemory(null),
    api: createFakeApi(),
  };
  for (const [role, wallet] of [['main', setup.mainSlot], ['second', setup.secondSlot]] as const) {
    const address = wallet?.accounts[0];
    if (wallet !== undefined && address !== undefined) ports.slots.assign(role, { walletId: wallet.id, address });
  }
  for (const key of setup.rememberedSecondKeys ?? []) ports.secondKeys.remember(key);
  render(
    <Router hook={location.hook} searchHook={location.searchHook}>
      <PortsProvider ports={ports}>
        <AppPage loadHealth={setup.loadHealth ?? freshHealth} />
      </PortsProvider>
    </Router>,
  );
  return { ports, location };
}

const row = (account: Address) => screen.getByRole('article', { name: `Stake account ${shortAddress(account)}` });
const findRow = (account: Address) => screen.findByRole('article', { name: `Stake account ${shortAddress(account)}` });
const rowStatus = (account: Address) => row(account).getAttribute('data-status');
/** The short address of the key that holds a lock, as the row shows it (with copy and explorer). */
const lockHolder = (account: Address) =>
  row(account).querySelector('[data-slot="lock-holder"] [data-slot="address-text"]')?.textContent.match(/\w+\.\.\.\w+/)?.[0];
const section = (name: string) => {
  const heading = screen.getByRole('heading', { level: 2, name });
  const region = heading.closest('section');
  if (region === null) throw new Error(`no section for ${name}`);
  return region;
};

describe('/app on LiteSvmChain', () => {
  let testChain: TestChain;
  let chain: LiteSvmChain;
  let main: KeyPairSigner;
  let K: KeyPairSigner;
  let stranger: Address;
  let serviceStaker: Address;
  let otherOwner: Address;
  const stake = {} as Record<'open' | 'locked' | 'expiring' | 'foreign' | 'service' | 'secondKeyFor', Address>;

  beforeAll(async () => {
    testChain = await TestChain.create();
    chain = new LiteSvmChain(testChain);
    [main, K] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    [stranger, serviceStaker, otherOwner] = (await Promise.all([1, 2, 3].map(() => generateKeyPairSigner()))).map((k) => k.address) as [
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
    stake.locked = await testChain.createStakeAccount({ staker: A, withdrawer: A, lamports: 40n * LAMPORTS_PER_SOL, lockup: lock(100n, K.address) });
    stake.expiring = await testChain.createStakeAccount({ staker: A, withdrawer: A, lamports: 5n * LAMPORTS_PER_SOL, lockup: lock(10n, K.address) });
    stake.foreign = await testChain.createStakeAccount({ staker: A, withdrawer: A, lockup: lock(100n, stranger) });
    stake.service = await testChain.createStakeAccount({ staker: serviceStaker, withdrawer: A, lamports: 4n * LAMPORTS_PER_SOL });
    // The main key is only the second key here: another wallet's stake, locked by A.
    stake.secondKeyFor = await testChain.createStakeAccount({
      staker: otherOwner,
      withdrawer: otherOwner,
      lamports: 7n * LAMPORTS_PER_SOL,
      lockup: lock(100n, A),
    });
  });

  const lamportsOf = (account: Address) => testChain.stakeAccount(account)?.lamports ?? 0n;

  it('shows every status of a main key with its second key connected', async () => {
    const second = await createTestWalletPort({ name: 'Second Wallet', signers: [K], connected: true });
    const { ports } = renderApp({ path: `/app?address=${main.address}`, wallets: [second], secondSlot: second }, chain);

    await findRow(stake.locked);
    const mainList = section('Stake accounts');

    // Most urgent first: expiring, then not protected (bigger first), protected, someone else's lock.
    expect(within(mainList).getAllByRole('article').map((article) => article.getAttribute('aria-label'))).toEqual(
      [stake.expiring, stake.service, stake.open, stake.locked, stake.foreign].map((a) => `Stake account ${shortAddress(a)}`),
    );

    // Not protected, staking: offered protection.
    expect(rowStatus(stake.open)).toBe('unprotected');
    expect(within(row(stake.open)).getByText('Not protected')).toBeInTheDocument();
    expect(within(row(stake.open)).getByText('Activating')).toBeInTheDocument();
    expect(within(row(stake.open)).getByRole('link', { name: `Protect stake account ${shortAddress(stake.open)}` })).toHaveAttribute(
      'href',
      `/protect?account=${stake.open}`,
    );

    // Protected by the connected second key: lock end date, extend and withdraw.
    const lockedRow = within(row(stake.locked));
    expect(lockedRow.getByText('Protected')).toBeInTheDocument();
    expect(lockedRow.getByText(`until ${formatUtcDate(NOW + 100n * DAY) ?? ''}`)).toBeInTheDocument();
    expect(lockedRow.getByRole('link', { name: `Extend stake account ${shortAddress(stake.locked)}` })).toHaveAttribute(
      'href',
      `/extend/${stake.locked}`,
    );
    expect(lockedRow.getByRole('link', { name: `Withdraw stake account ${shortAddress(stake.locked)}` })).toHaveAttribute(
      'href',
      `/withdraw/${stake.locked}`,
    );
    // The recovery card of the keys that lock it (D74): on protected and expiring rows, never on someone else's lock.
    const recoveryLink = (account: Address) => within(row(account)).queryByRole('link', { name: `Recovery card stake account ${shortAddress(account)}` });
    expect(recoveryLink(stake.locked)).toHaveAttribute('href', `/recovery/${stake.locked}`);
    expect(recoveryLink(stake.expiring)).toHaveAttribute('href', `/recovery/${stake.expiring}`);
    expect(recoveryLink(stake.foreign)).toBeNull();
    expect(recoveryLink(stake.open)).toBeNull();

    // Less than 30 days left.
    expect(within(row(stake.expiring)).getByText('Expiring soon')).toBeInTheDocument();
    expect(
      within(row(stake.expiring)).getByText(`The lock ends on ${formatUtcDate(NOW + 10n * DAY) ?? ''}. Extend it to stay protected.`),
    ).toBeInTheDocument();

    // Locked by a key that is not the viewer's second key: view only.
    expect(within(row(stake.foreign)).getByText('Locked by a second key')).toBeInTheDocument();
    expect(lockHolder(stake.foreign)).toBe(shortAddress(stranger));
    expect(within(row(stake.foreign)).queryAllByRole('link', { name: /stake account/ })).toEqual([]);

    // Another staker than the main key: a service may manage it.
    expect(within(row(stake.service)).getByText('A staking service may manage this stake.')).toBeInTheDocument();
    expect(within(row(stake.open)).queryByText('A staking service may manage this stake.')).toBeNull();

    // The address as second key: a separate list, not mixed into the main one.
    const secondList = section('You are the second key for');
    expect(within(mainList).queryByRole('article', { name: `Stake account ${shortAddress(stake.secondKeyFor)}` })).toBeNull();
    const secondKeyRow = within(secondList).getByRole('article', { name: `Stake account ${shortAddress(stake.secondKeyFor)}` });
    expect(within(secondKeyRow).getByText('Protected')).toBeInTheDocument();
    expect(within(secondKeyRow).getByRole('link', { name: /^Extend/ })).toHaveAttribute('href', `/extend/${stake.secondKeyFor}`);
    expect(within(secondKeyRow).getByRole('link', { name: /^Recovery card/ })).toHaveAttribute('href', `/recovery/${stake.secondKeyFor}`);

    // Totals of the main list: count, all SOL, SOL under a lock.
    const all = [stake.open, stake.locked, stake.expiring, stake.foreign, stake.service].map(lamportsOf);
    const totals = mainList.querySelector('[data-slot="totals"]');
    expect(within(mainList).getByText('5 stake accounts')).toBeInTheDocument();
    expect(totals).toHaveTextContent(`${formatSol(all.reduce((a, b) => a + b, 0n))} in total`);
    expect(totals).toHaveTextContent(`${formatSol(lamportsOf(stake.locked) + lamportsOf(stake.expiring))} protected`);

    // Rescue for the whole main key; monitoring freshness; the second key slot shows the connected wallet.
    expect(screen.getByRole('link', { name: 'Rescue your stake' })).toHaveAttribute('href', `/rescue?address=${main.address}`);
    expect(screen.getByText('Last checked 2 min ago')).toBeInTheDocument();
    expect(within(section('Is this lock yours?')).getByText('Connected')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();

    // Alerts for this address: the worker's redirect to the Telegram bot, in a new tab.
    const telegram = screen.getByRole('link', { name: 'Get alerts in Telegram (opens in a new tab)' });
    expect(telegram).toHaveAttribute('href', `/api/telegram/link?wallet=${main.address}`);
    expect(telegram).toHaveAttribute('target', '_blank');
    // noreferrer implies noopener (HTML standard): the bot page gets neither this page's address nor a handle to it.
    expect(telegram).toHaveAttribute('rel', 'noreferrer');

    // F6 memory: a view by address writes nothing (the main key is not connected here).
    expect(ports.protectedAccounts.getSnapshot()).toEqual([]);
  });

  it('remembers the locks of the connected main key that its second key holds (F6 memory)', async () => {
    const mainWallet = await createTestWalletPort({ name: 'Main Wallet', signers: [main], connected: true });
    const second = await createTestWalletPort({ name: 'Second Wallet', signers: [K], connected: true });
    const { ports } = renderApp(
      { path: `/app?address=${main.address}`, wallets: [mainWallet, second], mainSlot: mainWallet, secondSlot: second },
      chain,
    );
    await findRow(stake.locked);
    await waitFor(() => {
      expect([...ports.protectedAccounts.getSnapshot()].sort()).toEqual([stake.locked, stake.expiring].sort());
    });
  });

  it('calls every lock Locked by a second key, view only, when no second key is known (D14)', async () => {
    const { ports } = renderApp({ path: `/app?address=${main.address}` }, chain);
    await findRow(stake.locked);

    // The owner's own lock on a new device: not called someone else's, and the row says how to confirm it.
    const own = within(row(stake.locked));
    expect(own.getByText('Locked by a second key')).toBeInTheDocument();
    expect(
      own.getByText(
        'This browser does not know this key yet. If it is your second key, connect it to manage the lock; if not, only that key can change it.',
      ),
    ).toBeInTheDocument();
    expect(section('Stake accounts')).not.toHaveTextContent(/another key/i);

    // The chain cannot say whose key holds a lock: none is called Protected or counted as protected SOL.
    for (const [account, holder] of [[stake.locked, K.address], [stake.expiring, K.address], [stake.foreign, stranger]] as const) {
      expect(rowStatus(account)).toBe('locked-by-other');
      expect(lockHolder(account)).toBe(shortAddress(holder));
      expect(within(row(account)).queryAllByRole('link', { name: /stake account/ })).toEqual([]);
    }
    expect(within(section('Stake accounts')).queryByText('Protected')).toBeNull();
    expect(section('Stake accounts').querySelector('[data-slot="totals"]')).toHaveTextContent(`${formatSol(0n)} protected`);
    // Rescue all the same: the recovery card sends a victim to another computer, and that one knows no second key.
    expect(within(section('Stake accounts')).getByRole('link', { name: 'Rescue your stake' })).toHaveAttribute(
      'href',
      `/rescue?address=${main.address}`,
    );
    // A way to confirm: connect the second key (no wallets here, so the list says how to get one).
    await userEvent.click(within(section('Is this lock yours?')).getByRole('button', { name: 'Connect a wallet as Second key' }));
    expect(within(section('Is this lock yours?')).getByText(/No Solana wallet found in this browser/)).toBeVisible();
    // Locks not confirmed as the viewer's are not remembered for F6.
    expect(ports.protectedAccounts.getSnapshot()).toEqual([]);
  });

  it('calls a lock held by an unknown key Locked by a second key once a second key is known', async () => {
    const otherSecondKey = (await generateKeyPairSigner()).address;
    renderApp({ path: `/app?address=${main.address}`, rememberedSecondKeys: [otherSecondKey] }, chain);
    await findRow(stake.locked);
    for (const account of [stake.locked, stake.expiring, stake.foreign]) expect(rowStatus(account)).toBe('locked-by-other');
    expect(lockHolder(stake.locked)).toBe(shortAddress(K.address));
    expect(within(row(stake.open)).getByText('Not protected')).toBeInTheDocument();
  });

  it('shows the red banner when a lock this device saw ends (F6), until the account is protected again', async () => {
    const f6Chain = await TestChain.create();
    const owner = await generateKeyPairSigner();
    const A = owner.address;
    const account = await f6Chain.createStakeAccount({
      staker: A,
      withdrawer: A,
      lockup: { unixTimestamp: NOW + 600n, epoch: 0n, custodian: K.address },
    });
    const liteChain = new LiteSvmChain(f6Chain);
    const mainWallet = await createTestWalletPort({ name: 'Main Wallet', signers: [owner], connected: true });
    const { ports } = renderApp(
      { path: `/app?address=${A}`, chain: liteChain, wallets: [mainWallet], mainSlot: mainWallet, rememberedSecondKeys: [K.address] },
      chain,
    );

    await findRow(account);
    expect(rowStatus(account)).toBe('expiring');
    await waitFor(() => {
      expect(ports.protectedAccounts.getSnapshot()).toEqual([account]);
    });

    f6Chain.advanceTime(601n); // the ten-minute devnet lock ran out
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => {
      expect(rowStatus(account)).toBe('was-protected');
    });
    const banner = screen.getByRole('alert');
    expect(banner).toHaveTextContent('1 stake account is no longer protected');
    expect(banner).toHaveTextContent('Anyone with your main key can withdraw them now.');
    expect(within(banner).getByRole('link', { name: 'Protect again' })).toHaveAttribute('href', `/protect?account=${account}`);
    expect(within(row(account)).getByText('No longer protected')).toBeInTheDocument();
    expect(within(row(account)).getByRole('link', { name: `Protect again stake account ${shortAddress(account)}` })).toBeInTheDocument();
  });

  // SECURITY-CHECK П6: a thief with the main key changed the stake key of a locked account (CLAUDE.md section 4). The
  // row says the main key may be stolen and leads to Rescue for that main key, instead of the staking-service hint.
  it('a protected account whose stake key is another key: the main key may be stolen, with Open Rescue', async () => {
    const theftChain = await TestChain.create();
    const owner = await theftChain.fundedKey();
    const thief = await theftChain.fundedKey();
    const A = owner.address;
    const account = await theftChain.createStakeAccount({
      staker: A,
      withdrawer: A,
      lockup: { unixTimestamp: NOW + 100n * DAY, epoch: 0n, custodian: K.address },
    });
    await changeStaker(theftChain, { stake: account, withdrawer: owner, newStaker: thief });
    expect(theftChain.stakeAccount(account)?.staker).toBe(thief.address);
    renderApp({ path: `/app?address=${A}`, chain: new LiteSvmChain(theftChain), rememberedSecondKeys: [K.address] }, chain);

    await findRow(account);
    expect(rowStatus(account)).toBe('protected');
    const theRow = within(row(account));
    expect(theRow.getByText('Another key can stop or move this stake. If you did not set this up, your main key may be stolen.')).toBeInTheDocument();
    expect(theRow.getByRole('link', { name: 'Open Rescue' })).toHaveAttribute('href', `/rescue?address=${A}`);
    expect(theRow.queryByText('A staking service may manage this stake.')).toBeNull();
  });

  it('offers Rescue for a main key whose stake has no lock at all (D70 moves those too)', async () => {
    const owner = await generateKeyPairSigner();
    const open = await testChain.createStakeAccount({ staker: owner.address, withdrawer: owner.address });
    renderApp({ path: `/app?address=${owner.address}` }, chain);
    await findRow(open);
    expect(rowStatus(open)).toBe('unprotected');
    expect(within(section('Stake accounts')).getByRole('link', { name: 'Rescue your stake' })).toHaveAttribute(
      'href',
      `/rescue?address=${owner.address}`,
    );
  });

  it('explains an address without stake accounts (UX rule 13)', async () => {
    const empty = (await generateKeyPairSigner()).address;
    renderApp({ path: `/app?address=${empty}` }, chain);
    expect(await screen.findByRole('heading', { level: 3, name: 'No stake accounts found' })).toBeInTheDocument();
    expect(screen.getByText('Checked address:')).toBeInTheDocument();
    expect(screen.getByText(/Liquid staking tokens \(LSTs\)/)).toBeInTheDocument();
    expect(document.querySelector('[data-slot="totals"]')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'You are the second key for' })).toBeNull();
    // Nothing for a rescue to move.
    expect(screen.queryByRole('link', { name: 'Rescue your stake' })).toBeNull();
  });

  it('lists only the second-key accounts when the address is no main key', async () => {
    renderApp({ path: `/app?address=${K.address}` }, chain);
    const locked = await findRow(stake.locked);
    expect(section('You are the second key for')).toContainElement(locked);
    expect(screen.getByText('No stake account has this address as its main key.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No stake accounts found' })).toBeNull();
    // A rescue moves the stake of a main key; this address is none.
    expect(screen.queryByRole('link', { name: 'Rescue your stake' })).toBeNull();
  });

  it('says what went wrong when the network fails, with details and a retry', async () => {
    chain.failNext('findStakeAccounts', new TypeError('Failed to fetch'));
    renderApp({ path: `/app?address=${main.address}` }, chain);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load the stake accounts');
    expect(alert).toHaveTextContent('The Solana network did not respond. Check your connection and try again.');
    expect(within(alert).getByText('Details')).toBeInTheDocument();
    expect(within(alert).getByText(/Failed to fetch/)).toBeInTheDocument();
    expect(screen.queryByRole('article')).toBeNull();

    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await findRow(stake.locked)).toBeInTheDocument();
    expect(screen.queryByText('Could not load the stake accounts')).toBeNull();
  });

  it('checks the pasted address before it reads anything and keeps it in the URL', async () => {
    const { location } = renderApp({ path: '/app' }, chain);
    expect(screen.queryByRole('article')).toBeNull();
    const field = screen.getByRole('textbox', { name: 'Main key address' });

    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Paste a wallet address first.');

    await userEvent.type(field, 'not-a-solana-address');
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(screen.getByRole('alert')).toHaveTextContent('This is not a Solana address.');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveFocus();
    expect(location.history).toEqual(['/app']);

    await userEvent.clear(field);
    await userEvent.type(field, `  ${main.address} `);
    await userEvent.click(screen.getByRole('button', { name: 'Check' }));
    expect(location.history).toEqual(['/app', `/app?address=${main.address}`]);
    expect(await findRow(stake.locked)).toBeInTheDocument();
    expect(field).toHaveValue(main.address);
    expect(screen.getByRole('button', { name: 'Check' })).toHaveFocus();
  });

  it('flags a wrong address in the URL instead of reading it', () => {
    renderApp({ path: '/app?address=0OIl-not-base58' }, chain);
    expect(screen.getByRole('alert')).toHaveTextContent('This is not a Solana address.');
    expect(screen.getByRole('textbox', { name: 'Main key address' })).toHaveValue('0OIl-not-base58');
    expect(screen.queryByText('Reading stake accounts from the network')).toBeNull();
  });

  it('refuses the all-zero address: no wallet, and nearly every stake account would match it', () => {
    renderApp({ path: '/app?address=11111111111111111111111111111111' }, chain);
    expect(screen.getByRole('alert')).toHaveTextContent('This is the System Program, not a wallet.');
    expect(screen.queryByText('Reading stake accounts from the network')).toBeNull();
  });

  it('shows the stake of a connected main key', async () => {
    const wallet = await createTestWalletPort({ name: 'Main Wallet', signers: [main] });
    const { location, ports } = renderApp({ path: '/app', wallets: [wallet] }, chain);

    await userEvent.click(screen.getByRole('button', { name: 'Connect a wallet as Main key' }));
    await userEvent.click(screen.getByRole('button', { name: 'Main Wallet' }));

    expect(await findRow(stake.locked)).toBeInTheDocument();
    expect(ports.slots.getSnapshot().main).toEqual({ walletId: 'Main Wallet', address: main.address });
    expect(location.history).toEqual(['/app', `/app?address=${main.address}`]);
    expect(screen.getByRole('group', { name: 'Main key' })).toHaveTextContent('Connected');
  });

  it('refuses the main key as the second key and asks to switch accounts', async () => {
    // A wallet that shows one account at a time: the main key, then (after the switch) the second key.
    const wallet = await createTestWalletPort({ name: 'One Account', signers: [main, K], exposed: [main.address], connected: true });
    const { ports } = renderApp({ path: `/app?address=${main.address}`, wallets: [wallet], mainSlot: wallet }, chain);
    await findRow(stake.locked);

    const confirm = section('Is this lock yours?');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Connect a wallet as Second key' }));
    await userEvent.click(within(confirm).getByRole('button', { name: 'One Account' }));
    expect(await within(confirm).findByText('This account is already your Main key.')).toBeInTheDocument();
    expect(within(confirm).getByText('Switch to your second account in the wallet, then press Continue.')).toBeInTheDocument();

    wallet.setExposedAccounts([K.address]);
    await userEvent.click(within(confirm).getByRole('button', { name: 'Continue' }));
    expect(ports.slots.getSnapshot().second).toEqual({ walletId: 'One Account', address: K.address });
    // Now the second key is known: the locks it holds are confirmed, the stranger's is someone else's.
    await waitFor(() => {
      expect(rowStatus(stake.foreign)).toBe('locked-by-other');
    });
    expect(rowStatus(stake.locked)).toBe('protected');
  });
});

describe('/app monitoring line (UX rule 12)', () => {
  let chain: LiteSvmChain;
  let address: Address;

  beforeAll(async () => {
    chain = new LiteSvmChain(await TestChain.create());
    address = (await generateKeyPairSigner()).address;
  });

  it.each([
    ['fresh', () => Promise.resolve({ lastMonitorRunAt: new Date(Date.now() - 20_000) }), 'Last checked less than a minute ago', 'fresh'],
    ['stale', () => Promise.resolve({ lastMonitorRunAt: new Date(Date.now() - 15 * 60_000) }), 'Last checked 15 min ago. Alerts may be late.', 'stale'],
    ['days old', () => Promise.resolve({ lastMonitorRunAt: new Date(Date.now() - 3 * 86_400_000) }), 'Last checked 3 days ago. Alerts may be late.', 'stale'],
    ['never run', () => Promise.resolve({ lastMonitorRunAt: null }), 'Monitoring has not run yet', 'not-yet'],
    ['unreachable', () => Promise.reject(new TypeError('Failed to fetch')), 'Monitoring status unavailable. Press Refresh to try again.', 'unavailable'],
  ] as const)('%s', async (_name, loadHealth, text, state) => {
    renderApp({ path: `/app?address=${address}`, loadHealth }, chain);
    const line = await screen.findByText(text);
    expect(line).toHaveAttribute('data-state', state);
    expect(line.className.includes('text-danger')).toBe(state === 'stale');
  });
});
