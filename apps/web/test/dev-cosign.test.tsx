// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { generateKeyPairSigner, type Address, type KeyPairSigner } from '@solana/kit';
import { LIGHTHOUSE_PROGRAM_ADDRESS, shortAddress } from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { createTestWalletPort, type TestWalletPort } from '@stakeward/core/test/test-wallet-port';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DevCosign } from '@/pages/dev-cosign/DevCosign';
import { createReportStore, type ReportStore } from '@/pages/dev-cosign/report';
import { createSlotStore, StaticWalletRegistry } from '@/ports';

// /dev/cosign on the real stake program: LiteSvmChain answers like HttpChain, test wallets sign like Wallet Standard
// wallets (and misbehave on request), the page runs the whole matrix flow and writes its report.

const TIMEOUT = 60_000;
/** The page builds the lock from the cluster clock: 10 minutes after LiteSVM's start time. */
const LOCK_UNTIL = START_UNIX_TIMESTAMP + 600n;
const REPORT_DATE = new Date('2026-10-02T12:00:00Z');

type World = {
  testChain: TestChain;
  chain: LiteSvmChain;
  mainKey: KeyPairSigner;
  secondKey: KeyPairSigner;
  stake: Address;
  reports: ReportStore;
  user: UserEvent;
};

async function world(): Promise<Omit<World, 'reports' | 'user'>> {
  const testChain = await TestChain.create();
  const [mainKey, secondKey] = await Promise.all([testChain.fundedKey(), testChain.fundedKey()]);
  const stake = await testChain.createStakeAccount({ staker: mainKey.address, withdrawer: mainKey.address });
  return { testChain, chain: new LiteSvmChain(testChain), mainKey, secondKey, stake };
}

function renderPage(base: Omit<World, 'reports' | 'user'>, wallets: readonly TestWalletPort[]): World {
  const reports = createReportStore(null);
  const user = userEvent.setup();
  render(
    <DevCosign
      chain={base.chain}
      wallets={new StaticWalletRegistry(wallets)}
      slots={createSlotStore(null)}
      reports={reports}
      cluster="devnet"
      confirmOptions={{ pollIntervalMs: 1 }}
      now={() => REPORT_DATE}
    />,
  );
  return { ...base, reports, user };
}

async function twoWallets(base: Omit<World, 'reports' | 'user'>) {
  return Promise.all([
    createTestWalletPort({ name: 'Main Wallet', signers: [base.mainKey] }),
    createTestWalletPort({ name: 'Second Wallet', signers: [base.secondKey] }),
  ]);
}

async function connect(user: UserEvent, role: 'Main key' | 'Second key', walletName: string) {
  const slot = screen.getByRole('group', { name: role });
  await user.click(within(slot).getByRole('button', { name: `Connect a wallet as ${role}` }));
  await user.click(within(slot).getByRole('button', { name: walletName }));
  await waitFor(() => {
    expect(within(screen.getByRole('group', { name: role })).getByText('Connected')).toBeInTheDocument();
  });
}

async function chooseAccount(user: UserEvent, stake: Address) {
  await user.click(await screen.findByRole('radio', { name: `Use ${shortAddress(stake)}` }));
}

async function clickWhenReady(user: UserEvent, name: string | RegExp) {
  await user.click(await screen.findByRole('button', { name }, { timeout: 10_000 }));
}

function runSection() {
  return within(screen.getByRole('region', { name: '4. Run' }));
}

/** The report of the run that just ended, as shown on the page and as stored for "Copy all". */
async function lastReport(reports: ReportStore): Promise<string> {
  const block = await screen.findByLabelText('Report of this run', {}, { timeout: 10_000 });
  const stored = reports.getSnapshot().at(-1);
  expect(block.textContent).toBe(stored);
  return stored ?? '';
}

async function protectRun(w: World, mainWallet: string, secondWallet: string, order: 'main-first' | 'second-first') {
  await w.user.click(screen.getByRole('button', { name: 'Start run' }));
  const [first, second] =
    order === 'main-first' ? [`Sign in ${mainWallet} as Main key`, `Sign in ${secondWallet} as Second key`] : [`Sign in ${secondWallet} as Second key`, `Sign in ${mainWallet} as Main key`];
  await clickWhenReady(w.user, first);
  await clickWhenReady(w.user, second);
  await clickWhenReady(w.user, 'Send to devnet');
}

describe('/dev/cosign on LiteSvmChain', () => {
  it.each(['main-first', 'second-first'] as const)(
    'a blockhash run with %s signing sets the lock, re-reads it and reports it; Reset lifts it again',
    async (order) => {
      const base = await world();
      const w = renderPage(base, await twoWallets(base));
      await connect(w.user, 'Main key', 'Main Wallet');
      await connect(w.user, 'Second key', 'Second Wallet');
      await chooseAccount(w.user, w.stake);
      if (order === 'second-first') await w.user.click(screen.getByRole('radio', { name: 'Second key first' }));
      expect(runSection().getByText(/^Ready: the Main key and the Second key sign one transaction/)).toBeInTheDocument();

      await protectRun(w, 'Main Wallet', 'Second Wallet', order);

      expect(await runSection().findByText(/^Lock set: Second key/, {}, { timeout: 10_000 })).toBeInTheDocument();
      const lockup = w.testChain.stakeAccount(w.stake)?.lockup;
      expect(lockup?.custodian).toBe(w.secondKey.address);
      expect(lockup?.unixTimestamp).toBe(LOCK_UNTIL);

      const report = await lastReport(w.reports);
      const lines = report.split('\n');
      expect(lines).toContain('Date: 2026-10-02T12:00:00Z');
      expect(lines).toContain('Cluster: devnet');
      expect(lines).toContain(`Main key: Main Wallet (Wallet Standard n/a, accounts offered: 1), ${shortAddress(w.mainKey.address)}`);
      expect(lines).toContain(`Order: ${order === 'main-first' ? 'main key first' : 'second key first'}`);
      expect(lines).toContain('Lifetime: blockhash');
      const [one, two] = order === 'main-first' ? ['Main key, Main Wallet', 'Second key, Second Wallet'] : ['Second key, Second Wallet', 'Main key, Main Wallet'];
      expect(lines).toContain(`Signer 1 (${one}): changed: none; checkSigningStep: ok`);
      expect(lines).toContain(`Signer 2 (${two}): changed: none; checkSigningStep: ok`);
      expect(lines).toContain('verifyAllSignatures: ok');
      expect(lines.some((line) => /^Send: confirmed, signature \w+, https:\/\/explorer\.solana\.com\/tx\/\w+\?cluster=devnet$/.test(line))).toBe(true);
      expect(lines).toContain(`Lock after: second key ${shortAddress(w.secondKey.address)}, until 2026-10-01T00:10:00Z (as expected)`);
      expect(lines.slice(-3)).toEqual(['Wallet warnings shown:', 'Ledger showed fields (yes/no):', 'Notes:']);

      // The account list was re-read: the same account is now locked, so a new run waits for Reset.
      await w.user.click(runSection().getByRole('button', { name: 'New run' }));
      expect(await runSection().findByText(/^This stake account is locked until/)).toBeInTheDocument();
      expect(runSection().getByRole('button', { name: 'Start run' })).toBeDisabled();

      // Reset: the second key lifts the lock alone and pays.
      await clickWhenReady(w.user, 'Remove the lock with the Second key');
      await clickWhenReady(w.user, 'Sign in Second Wallet as Second key');
      await clickWhenReady(w.user, 'Send to devnet');
      await waitFor(() => {
        expect(w.testChain.stakeAccount(w.stake)?.lockup.unixTimestamp).toBe(0n);
      });
      await w.user.click(await within(screen.getByRole('region', { name: '5. Reset' })).findByRole('button', { name: 'Close' }));
      await waitFor(() => {
        expect(runSection().getByRole('button', { name: 'Start run' })).toBeEnabled();
      });
      // Reset is not a matrix run: still one report.
      expect(w.reports.getSnapshot()).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    'a Lighthouse tail from the first wallet is accepted and reported; LiteSVM cannot run Lighthouse, so the send fails',
    async () => {
      const base = await world();
      const [main, second] = await twoWallets(base);
      main.behaviour = { lighthouseTail: true };
      const w = renderPage(base, [main, second]);
      await connect(w.user, 'Main key', 'Main Wallet');
      await connect(w.user, 'Second key', 'Second Wallet');
      await chooseAccount(w.user, w.stake);
      await protectRun(w, 'Main Wallet', 'Second Wallet', 'main-first');

      const report = await lastReport(w.reports);
      expect(report).toContain(
        `Signer 1 (Main key, Main Wallet): changed: lighthouse-tail(1, ${LIGHTHOUSE_PROGRAM_ADDRESS}); checkSigningStep: ok`,
      );
      expect(report).toContain('Signer 2 (Second key, Second Wallet): changed: none; checkSigningStep: ok');
      expect(report).toContain('verifyAllSignatures: ok');
      expect(report).toMatch(/^Send: failed: /m);
      expect(runSection().getByText('Lighthouse checks added at the end: 1 instructions.')).toBeInTheDocument();
      expect(w.testChain.stakeAccount(w.stake)?.lockup.unixTimestamp).toBe(0n);
    },
    TIMEOUT,
  );

  it(
    'a Lighthouse tail from the second wallet voids the first signature: the run stops before sending',
    async () => {
      const base = await world();
      const [main, second] = await twoWallets(base);
      second.behaviour = { lighthouseTail: true };
      const w = renderPage(base, [main, second]);
      await connect(w.user, 'Main key', 'Main Wallet');
      await connect(w.user, 'Second key', 'Second Wallet');
      await chooseAccount(w.user, w.stake);
      await w.user.click(screen.getByRole('button', { name: 'Start run' }));
      await clickWhenReady(w.user, 'Sign in Main Wallet as Main key');
      await clickWhenReady(w.user, 'Sign in Second Wallet as Second key');

      const report = await lastReport(w.reports);
      expect(report).toContain(
        `Signer 2 (Second key, Second Wallet): changed: lighthouse-tail(1, ${LIGHTHOUSE_PROGRAM_ADDRESS}); checkSigningStep: tail-not-first-signer`,
      );
      expect(report).toContain('verifyAllSignatures: not run');
      expect(report).toContain('Send: not sent');
      expect(runSection().queryByRole('button', { name: 'Send to devnet' })).not.toBeInTheDocument();
    },
    TIMEOUT,
  );

  it(
    'a wallet that changes the message is stopped with message-changed and the change is described',
    async () => {
      const base = await world();
      const [main, second] = await twoWallets(base);
      main.behaviour = { modifyMessage: true };
      const w = renderPage(base, [main, second]);
      await connect(w.user, 'Main key', 'Main Wallet');
      await connect(w.user, 'Second key', 'Second Wallet');
      await chooseAccount(w.user, w.stake);
      await w.user.click(screen.getByRole('button', { name: 'Start run' }));
      await clickWhenReady(w.user, 'Sign in Main Wallet as Main key');

      const report = await lastReport(w.reports);
      expect(report).toContain('Signer 1 (Main key, Main Wallet): changed: other: instructions; checkSigningStep: message-changed');
      expect(report).toContain('  Instructions: 3; changed: 3');
      expect(report).toContain('Signer 2 (Second key, Second Wallet): not asked');
      expect(report).toContain('Send: not sent');
      expect(runSection().getByText(/^The wallet changed the transaction\. Nothing was sent\./)).toBeInTheDocument();
      expect(second.requests).toHaveLength(0);
      expect(w.testChain.stakeAccount(w.stake)?.lockup.unixTimestamp).toBe(0n);
    },
    TIMEOUT,
  );

  it(
    'a wallet rejection ends the run with a translated error and a report',
    async () => {
      const base = await world();
      const [main, second] = await twoWallets(base);
      second.behaviour = { reject: true };
      const w = renderPage(base, [main, second]);
      await connect(w.user, 'Main key', 'Main Wallet');
      await connect(w.user, 'Second key', 'Second Wallet');
      await chooseAccount(w.user, w.stake);
      await w.user.click(screen.getByRole('button', { name: 'Start run' }));
      await clickWhenReady(w.user, 'Sign in Main Wallet as Main key');
      await clickWhenReady(w.user, 'Sign in Second Wallet as Second key');

      const report = await lastReport(w.reports);
      expect(report).toContain('Signer 1 (Main key, Main Wallet): changed: none; checkSigningStep: ok');
      expect(report).toContain(
        'Signer 2 (Second key, Second Wallet): not signed: wallet-rejected: The request was declined in the wallet. Nothing was sent; you can try again.',
      );
      expect(report).toContain('Send: not sent');
      expect(runSection().getByText('The request was declined in the wallet. Nothing was sent; you can try again.')).toBeInTheDocument();
    },
    TIMEOUT,
  );

  it(
    'a durable-nonce run: create the nonce account, run on it, close it again',
    async () => {
      const base = await world();
      const w = renderPage(base, await twoWallets(base));
      await connect(w.user, 'Main key', 'Main Wallet');
      await connect(w.user, 'Second key', 'Second Wallet');
      await chooseAccount(w.user, w.stake);
      await w.user.click(screen.getByRole('radio', { name: 'Durable nonce' }));
      expect(runSection().getByRole('button', { name: 'Start run' })).toBeDisabled();

      const options = within(screen.getByRole('region', { name: '3. Options' }));
      await w.user.click(await options.findByRole('button', { name: 'Create nonce account' }));
      await clickWhenReady(w.user, 'Sign in Main Wallet as Main key');
      await clickWhenReady(w.user, 'Send to devnet');
      await w.user.click(await options.findByRole('button', { name: 'Close' }, { timeout: 10_000 }));
      expect(await options.findByText(/^Ready\. Current nonce value:/)).toBeInTheDocument();

      await waitFor(() => {
        expect(runSection().getByRole('button', { name: 'Start run' })).toBeEnabled();
      });
      await protectRun(w, 'Main Wallet', 'Second Wallet', 'main-first');
      expect(await runSection().findByText(/^Lock set: Second key/, {}, { timeout: 10_000 })).toBeInTheDocument();
      const report = await lastReport(w.reports);
      expect(report).toContain('Lifetime: durable nonce');
      expect(report).toMatch(/^Send: confirmed, signature /m);
      expect(w.testChain.stakeAccount(w.stake)?.lockup.custodian).toBe(w.secondKey.address);

      const balanceBefore = w.testChain.balance(w.mainKey.address);
      await w.user.click(await options.findByRole('button', { name: /^Close nonce account \(returns / }));
      await clickWhenReady(w.user, 'Sign in Main Wallet as Main key');
      await clickWhenReady(w.user, 'Send to devnet');
      await w.user.click(await options.findByRole('button', { name: 'Close' }, { timeout: 10_000 }));
      expect(await options.findByRole('button', { name: 'Create nonce account' })).toBeInTheDocument();
      expect(w.testChain.balance(w.mainKey.address)).toBeGreaterThan(balanceBefore);
    },
    TIMEOUT,
  );

  it(
    'one wallet holding both keys: the page asks to switch accounts before each signature',
    async () => {
      const base = await world();
      const wallet = await createTestWalletPort({
        name: 'One Wallet',
        signers: [base.mainKey, base.secondKey],
        exposed: [base.mainKey.address],
      });
      const w = renderPage(base, [wallet]);
      await connect(w.user, 'Main key', 'One Wallet');

      const secondSlot = screen.getByRole('group', { name: 'Second key' });
      await w.user.click(within(secondSlot).getByRole('button', { name: 'Connect a wallet as Second key' }));
      await w.user.click(within(secondSlot).getByRole('button', { name: 'One Wallet' }));
      expect(await within(secondSlot).findByText('Switch to your second account in the wallet, then press Continue.')).toBeInTheDocument();
      expect(within(secondSlot).getByText('This account is already your Main key.')).toBeInTheDocument();
      wallet.setExposedAccounts([base.secondKey.address]);
      await w.user.click(within(secondSlot).getByRole('button', { name: 'Continue' }));
      await waitFor(() => {
        expect(within(screen.getByRole('group', { name: 'Second key' })).getByText('Connected')).toBeInTheDocument();
      });

      await chooseAccount(w.user, w.stake);
      await w.user.click(screen.getByRole('button', { name: 'Start run' }));
      // The wallet shows the second account: the main key's request asks to switch first.
      await clickWhenReady(w.user, 'Sign in One Wallet as Main key');
      expect(await runSection().findByText('Switch to your main account in the wallet, then press Continue.')).toBeInTheDocument();
      wallet.setExposedAccounts([base.mainKey.address]);
      await w.user.click(runSection().getByRole('button', { name: 'Continue' }));
      expect(await runSection().findByText(/^One Wallet holds both keys\./)).toBeInTheDocument();
      wallet.setExposedAccounts([base.secondKey.address]);
      await clickWhenReady(w.user, 'Sign in One Wallet as Second key');
      await clickWhenReady(w.user, 'Send to devnet');
      expect(await runSection().findByText(/^Lock set: Second key/, {}, { timeout: 10_000 })).toBeInTheDocument();
      const report = await lastReport(w.reports);
      expect(report).toContain(`Main key: One Wallet (Wallet Standard n/a, accounts offered: 1), ${shortAddress(base.mainKey.address)}`);
      expect(report).toContain(`Second key: One Wallet (Wallet Standard n/a, accounts offered: 1), ${shortAddress(base.secondKey.address)}`);
    },
    TIMEOUT,
  );

  it(
    'Phantom holding both roles: Disconnect the second key, select another account, Connect: that account (D109 review)',
    async () => {
      const base = await world();
      const third = await generateKeyPairSigner();
      const wallet = await createTestWalletPort({ name: 'Phantom', signers: [base.mainKey, base.secondKey, third], sticky: true });
      const w = renderPage(base, [wallet]);
      await connect(w.user, 'Main key', 'Phantom');
      wallet.select(base.secondKey.address);
      await connect(w.user, 'Second key', 'Phantom');
      const secondSlot = screen.getByRole('group', { name: 'Second key' });
      expect(within(secondSlot).getByText(shortAddress(base.secondKey.address))).toBeInTheDocument();
      await w.user.click(within(secondSlot).getByRole('button', { name: 'Disconnect Phantom from Second key' }));
      wallet.select(third.address);
      await connect(w.user, 'Second key', 'Phantom');
      expect(within(screen.getByRole('group', { name: 'Second key' })).getByText(shortAddress(third.address))).toBeInTheDocument();
    },
    TIMEOUT,
  );

  it(
    'Phantom keeps the site on the first account: select in the wallet, then Connect or Sign, without a reload (D109)',
    async () => {
      const base = await world();
      const wallet = await createTestWalletPort({ name: 'Phantom', signers: [base.mainKey, base.secondKey], sticky: true });
      const w = renderPage(base, [wallet]);
      await connect(w.user, 'Main key', 'Phantom');
      // The user switches to the second account in Phantom, then connects it as the Second key: no reload, no Continue.
      wallet.select(base.secondKey.address);
      await connect(w.user, 'Second key', 'Phantom');

      await chooseAccount(w.user, w.stake);
      await w.user.click(screen.getByRole('button', { name: 'Start run' }));
      wallet.select(base.mainKey.address);
      await clickWhenReady(w.user, 'Sign in Phantom as Main key');
      expect(await runSection().findByText(/^Phantom holds both keys\./)).toBeInTheDocument();
      wallet.select(base.secondKey.address);
      await clickWhenReady(w.user, 'Sign in Phantom as Second key');
      await clickWhenReady(w.user, 'Send to devnet');
      expect(await runSection().findByText(/^Lock set: Second key/, {}, { timeout: 10_000 })).toBeInTheDocument();
      expect(wallet.requests.map((request) => request.address)).toEqual([base.mainKey.address, base.secondKey.address]);
    },
    TIMEOUT,
  );

  it(
    'Reset with a second key that holds no SOL: the main key pays and co-signs (F5)',
    async () => {
      const testChain = await TestChain.create();
      const [mainKey, secondKey] = await Promise.all([testChain.fundedKey(), generateKeyPairSigner()]);
      const stake = await testChain.createStakeAccount({
        staker: mainKey.address,
        withdrawer: mainKey.address,
        lockup: { unixTimestamp: LOCK_UNTIL, epoch: 0n, custodian: secondKey.address },
      });
      const base = { testChain, chain: new LiteSvmChain(testChain), mainKey, secondKey, stake };
      const w = renderPage(base, await twoWallets(base));
      await connect(w.user, 'Main key', 'Main Wallet');
      await connect(w.user, 'Second key', 'Second Wallet');
      await chooseAccount(w.user, stake);
      expect(await runSection().findByText(/^This stake account is locked until 00:10:00 UTC on 1 October 2026 by/)).toBeInTheDocument();

      await clickWhenReady(w.user, 'Remove the lock with the Second key');
      expect(await screen.findByText('The Second key has no SOL for the fee: the Main key pays and signs too.')).toBeInTheDocument();
      await clickWhenReady(w.user, 'Sign in Main Wallet as Main key');
      await clickWhenReady(w.user, 'Sign in Second Wallet as Second key');
      await clickWhenReady(w.user, 'Send to devnet');
      await waitFor(() => {
        expect(testChain.stakeAccount(stake)?.lockup.unixTimestamp).toBe(0n);
      });
      expect(testChain.balance(secondKey.address)).toBe(0n);
    },
    TIMEOUT,
  );

  it(
    'explains what is missing and offers the dev-accounts command when the main key has no stake',
    async () => {
      const base = await world();
      const empty = await base.testChain.fundedKey();
      const w = renderPage(base, [await createTestWalletPort({ name: 'Empty Wallet', signers: [empty] })]);
      expect(runSection().getByText('Connect the Main key.')).toBeInTheDocument();
      expect(runSection().getByText('Connect the Second key.')).toBeInTheDocument();
      expect(runSection().getByRole('button', { name: 'Start run' })).toBeDisabled();
      expect(screen.getByText('No reports yet')).toBeInTheDocument();
      await connect(w.user, 'Main key', 'Empty Wallet');
      expect(await screen.findByText(`pnpm dev-accounts ${empty.address}`)).toBeInTheDocument();
    },
    TIMEOUT,
  );
});
