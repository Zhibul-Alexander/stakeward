// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { getBase58Decoder } from '@solana/kit';
import { formatSol } from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { TestChain } from '@stakeward/core/test/svm';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import ChallengePage from '@/pages/challenge/ChallengePage';
import { CHALLENGE } from '@/pages/challenge/wallet';
import {
  createProtectedAccountMemory,
  createSecondKeyMemory,
  createSlotStore,
  PortsProvider,
  StaticWalletRegistry,
  type Ports,
} from '@/ports';
import { createFakeApi } from './support/fake-api.ts';

// /challenge (D133, D154) on the real stake program: the challenge wallet's stake account is created in LiteSVM with
// the page's main key and second key (Initialize takes both as data, so neither has to sign), and the hero reads it
// through LiteSvmChain, as it reads HttpChain in production. Tests run as the devnet build.

// 64 bytes shaped like a keypair file; not a real key.
const SECRET = getBase58Decoder().decode(Uint8Array.from({ length: 64 }, (_, i) => i + 1));
const LOCK = { unixTimestamp: CHALLENGE.lockUntil, epoch: 0n, custodian: CHALLENGE.secondKey };

function renderPage(chain: LiteSvmChain, load: () => Promise<string> = () => Promise.resolve(SECRET)) {
  const location = memoryLocation({ path: '/challenge', record: true });
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
        <ChallengePage load={load} />
      </PortsProvider>
    </Router>,
  );
}

const hero = () => screen.getByRole('region', { name: 'Try to steal it' });
/** The value under a label of the hero's figures. */
const figure = (label: string) => within(hero()).getByText(label, { selector: 'dt' }).nextElementSibling;

describe('/challenge on LiteSvmChain', () => {
  let testChain: TestChain;
  let chain: LiteSvmChain;

  beforeEach(async () => {
    testChain = await TestChain.create();
    chain = new LiteSvmChain(testChain);
  });

  /** A stake account of the challenge's main key under its lock, holding `lamports` in all. */
  const lockedStake = (lamports: bigint) => {
    const reserve = testChain.minimumBalanceForRentExemption(200n);
    return testChain.createStakeAccount({ staker: CHALLENGE.mainKey, withdrawer: CHALLENGE.mainKey, lamports: lamports - reserve, lockup: LOCK });
  };

  it('leads with the live stake, Taken 0 SOL, the lock date and the simulation, then the key to copy', async () => {
    await lockedStake(CHALLENGE.startLamports);
    renderPage(chain);
    expect(screen.getByRole('heading', { level: 1, name: 'Try to steal it' })).toBeInTheDocument();
    expect(within(hero()).getByText('Live on Solana devnet')).toBeInTheDocument();
    expect(await within(hero()).findByText(formatSol(CHALLENGE.startLamports))).toBeInTheDocument();
    expect(figure('Taken')).toHaveTextContent('0 SOL');
    expect(figure('Locked until')).toHaveTextContent('12 October 2027');
    expect(within(hero()).getByText('Taken counts only the stake. SOL in the wallet itself is not under the lock.')).toBeInTheDocument();
    // The first thing to do needs no wallet: the simulation of /try-steal.
    expect(within(hero()).getByRole('link', { name: 'Try to steal it here' })).toHaveAttribute('href', `/try-steal/${CHALLENGE.stakeAccount}`);

    expect(await screen.findByText(SECRET)).toBeInTheDocument();
    expect(screen.getByText(/^Never send SOL or any other token to this address/)).toBeInTheDocument();
    // No one has to fund the key to try: the simulation costs nothing and in the CLI the visitor's own wallet pays.
    // How another wallet pays the fee: the flag set as code, so it never breaks at its hyphens.
    const feeHint = screen.getByText('--fee-payer', { selector: 'code' }).parentElement;
    expect(feeHint).toHaveTextContent(/^You need no SOL on this key to try\. .* your own wallet pays with --fee-payer, as the commands below do\.$/);
    expect(screen.getByText('In Phantom, Solflare or Backpack, choose Add account, then Import private key.')).toBeInTheDocument();
    expect(screen.getByText('Switch the wallet to devnet.')).toBeInTheDocument();
    // The QR code opens this page on a phone, not the key: wallets do not import a key from a QR code.
    expect(screen.getByRole('img', { name: 'QR code of the link to this page' })).toBeInTheDocument();
    expect(screen.getByText('https://dev.stakeward.com/challenge')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See the lock live' })).toHaveAttribute('href', `/proof/${CHALLENGE.mainKey}`);
    expect(screen.getByRole('link', { name: 'Open in Solana Explorer' })).toHaveAttribute(
      'href',
      `https://explorer.solana.com/address/${CHALLENGE.stakeAccount}?cluster=devnet`,
    );
  });

  it('copies the key with Copy key', async () => {
    await lockedStake(CHALLENGE.startLamports);
    const user = userEvent.setup();
    renderPage(chain);
    await user.click(await screen.findByRole('button', { name: 'Copy key' }));
    expect(await navigator.clipboard.readText()).toBe(SECRET);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('counts as Taken what left the stake accounts, across a split, and not the rewards', async () => {
    // Split in two and 0.01 SOL short of the start: 0.01 SOL taken, the rest still counted as held.
    const short = 10_000_000n;
    const half = CHALLENGE.startLamports / 2n;
    await lockedStake(half);
    await lockedStake(CHALLENGE.startLamports - half - short);
    renderPage(chain);
    expect(await within(hero()).findByText(formatSol(CHALLENGE.startLamports - short))).toBeInTheDocument();
    expect(figure('Taken')).toHaveTextContent(formatSol(short));
  });

  it('never shows more than the start as Taken nor less than 0 SOL: rewards only add', async () => {
    await lockedStake(CHALLENGE.startLamports + 1_234_567n);
    renderPage(chain);
    expect(await within(hero()).findByText(formatSol(CHALLENGE.startLamports + 1_234_567n))).toBeInTheDocument();
    expect(figure('Taken')).toHaveTextContent('0 SOL');
  });

  it('says so when the network cannot be read, and reads it again on Try again', async () => {
    await lockedStake(CHALLENGE.startLamports);
    chain.failNext('findStakeAccounts', new Error('fetch failed'));
    const user = userEvent.setup();
    renderPage(chain);
    expect(await within(hero()).findByText('Could not read the network just now.')).toBeInTheDocument();
    expect(within(hero()).queryByText('Taken', { selector: 'dt' })).toBeNull();
    await user.click(within(hero()).getByRole('button', { name: 'Try again' }));
    expect(await within(hero()).findByText(formatSol(CHALLENGE.startLamports))).toBeInTheDocument();
  });

  it('holds the commands until the key has loaded, says why the key failed, and loads it again on retry', async () => {
    await lockedStake(CHALLENGE.startLamports);
    const load = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error('HTTP 503')).mockResolvedValue(SECRET);
    const user = userEvent.setup();
    renderPage(chain, load);
    expect(await screen.findByText('Could not load the key')).toBeInTheDocument();
    await user.click(screen.getByText('Show the commands'));
    expect(screen.getByText('The commands appear once the key has loaded.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText(SECRET)).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
    for (const name of ['Try to withdraw all the SOL to your wallet', 'Try to make your wallet the new owner', 'Try to remove the lock']) {
      expect(screen.getByRole('group', { name })).toBeInTheDocument();
    }
    expect(screen.getAllByText(/Expected: refused/)).toHaveLength(3);
  });
});
