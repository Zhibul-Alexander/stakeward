// F1 Protect, end to end: real site, real worker, real stake program, headless wallets (CLAUDE.md section 7).
import type { Page } from '@playwright/test';
import type { Address } from '@solana/kit';
import { shortAddress, ZERO_ADDRESS } from '@stakeward/core';
import { connect, expect, lockOf, sign, test } from '../support/fixtures.ts';
import type { QaWallet } from '../support/wallet.ts';

/** /protect for `accounts`: main key, Continue, second key, the seed-phrase box, the 10-minute period, Review. */
async function toSigning(page: Page, accounts: readonly Address[], main: QaWallet, second: QaWallet): Promise<void> {
  await page.goto(`/protect?${accounts.map((account) => `account=${account}`).join('&')}`);
  await connect(page, 'Main key', main.name);
  for (const account of accounts) {
    await expect(page.getByRole('checkbox', { name: `Protect stake account ${shortAddress(account)}` })).toBeChecked();
  }
  const n = accounts.length;
  await page.getByRole('button', { name: `Continue with ${String(n)} account${n === 1 ? '' : 's'}` }).click();
  await expect(page.getByRole('heading', { name: 'Connect your second key' })).toBeVisible();
  await connect(page, 'Second key', second.name);
  await page.getByRole('checkbox', { name: 'My second key comes from a different seed phrase' }).check();
  await page.getByRole('button', { name: 'Use this second key' }).click();
  await expect(page.getByRole('heading', { name: 'How long should the lock hold?' })).toBeVisible();
  await page.getByRole('radio', { name: '10 minutes (devnet test)' }).check();
  await page.getByRole('button', { name: `Review ${String(n)} transaction${n === 1 ? '' : 's'}` }).click();
  await expect(page.getByRole('heading', { name: 'Review and sign' })).toBeVisible();
}

const done = (page: Page) => expect(page.getByRole('heading', { name: /(?:is|are) protected$/ })).toBeVisible();

test.describe('F1 protect', () => {
  test('two accounts in one wallet request each; the chain holds both locks; /app shows them locked', async ({ page, qa, wallets }) => {
    const main = await wallets.create('QA Main');
    const second = await wallets.create('QA Second', 0.01);
    const accounts = [await qa.createStake(main.signer), await qa.createStake(main.signer)];

    await toSigning(page, accounts, main, second);
    // The summary is read from the bytes about to be signed and names each account in full (UX rule 9).
    const summary = page.locator('[data-slot="transaction-summary"]');
    for (const account of accounts) await expect(summary.getByText(account)).toBeVisible();
    await expect(page.getByText('Stakeward never asks for your seed phrase').first()).toBeVisible();
    await expect(page.locator('[data-risk="lose-second-key"]')).toContainText('If you lose the second key, you wait until');
    await sign(page, main, 'Main key');
    await sign(page, second, 'Second key');
    await done(page);

    // The chain is the truth (CLAUDE.md section 12): custodian = second key, an end about 10 minutes away.
    const now = BigInt(Math.floor(Date.now() / 1000));
    for (const account of accounts) {
      const lock = await lockOf(qa, account);
      expect(lock.custodian).toBe(second.address);
      expect(lock.unixTimestamp).toBeGreaterThan(now + 300n);
      expect(lock.unixTimestamp).toBeLessThan(now + 1200n);
    }
    // Several accounts are one request per wallet (CLAUDE.md section 5).
    expect(main.requests.map((request) => request.transactions.length)).toEqual([2]);
    expect(second.requests.map((request) => request.transactions.length)).toEqual([2]);

    await page.getByRole('link', { name: 'Back to your accounts' }).click();
    for (const account of accounts) {
      // 10 minutes is under 30 days, so the row says Expiring soon rather than Protected.
      await expect(page.getByRole('article', { name: `Stake account ${shortAddress(account)}` })).toHaveAttribute(
        'data-status',
        /^(?:protected|expiring)$/,
      );
    }
  });

  test('negative: the second key declines; nothing lands; Try again protects', async ({ page, qa, wallets }) => {
    const main = await wallets.create('QA Main');
    const second = await wallets.create('QA Second', 0.01);
    const stake = await qa.createStake(main.signer);
    second.once({ reject: true });

    await toSigning(page, [stake], main, second);
    await sign(page, main, 'Main key');
    await sign(page, second, 'Second key');
    await expect(page.getByText('The request was declined in the wallet. Nothing was sent; you can try again.')).toBeVisible();
    expect((await lockOf(qa, stake)).custodian).toBe(ZERO_ADDRESS);

    await page.getByRole('button', { name: 'Try again' }).click();
    await done(page);
    expect((await lockOf(qa, stake)).custodian).toBe(second.address);
  });

  test('negative: a wallet that changes the message is caught before anything is sent', async ({ page, qa, wallets }) => {
    const main = await wallets.create('QA Main');
    const second = await wallets.create('QA Second', 0.01);
    const stake = await qa.createStake(main.signer);
    main.once({ tamper: true });

    await toSigning(page, [stake], main, second);
    await sign(page, main, 'Main key');
    await expect(page.getByText('The wallet changed the transaction. Nothing was sent.')).toBeVisible();
    expect(second.requests).toHaveLength(0);
    expect((await lockOf(qa, stake)).custodian).toBe(ZERO_ADDRESS);

    await page.getByRole('button', { name: 'Start again' }).click();
    await sign(page, main, 'Main key');
    await sign(page, second, 'Second key');
    await done(page);
    expect((await lockOf(qa, stake)).custodian).toBe(second.address);
  });

  test('negative: the blockhash expires between the signatures; Sign again rebuilds', async ({ page, qa, wallets }) => {
    test.skip(qa.target !== 'local', 'expiring the blockhash on demand needs the local chain');
    const main = await wallets.create('QA Main');
    const second = await wallets.create('QA Second', 0.01);
    const stake = await qa.createStake(main.signer);

    await toSigning(page, [stake], main, second);
    await sign(page, main, 'Main key');
    await expect(page.getByRole('button', { name: `Sign in ${second.name} as Second key` })).toBeVisible();
    await qa.control('expire-blockhash');
    await sign(page, second, 'Second key');
    await expect(page.getByText('The transaction expired before every wallet signed')).toBeVisible();
    await page.getByRole('button', { name: 'Sign again' }).click();
    await sign(page, main, 'Main key');
    await sign(page, second, 'Second key');
    await done(page);
    expect((await lockOf(qa, stake)).custodian).toBe(second.address);
  });

  test('negative: the main key cannot be its own second key; the seed-phrase box is required', async ({ page, qa, wallets }) => {
    const main = await wallets.create('QA Main');
    // The same key under another wallet name, as when one seed phrase backs both wallets.
    const sameKey = await wallets.wrap('QA Same Key', main.signer);
    const second = await wallets.create('QA Second', 0.01);
    const stake = await qa.createStake(main.signer);

    await page.goto(`/protect?account=${stake}`);
    await connect(page, 'Main key', main.name);
    await page.getByRole('button', { name: 'Continue with 1 account' }).click();
    await expect(page.getByRole('heading', { name: 'Connect your second key' })).toBeVisible();
    const slot = page.getByRole('group', { name: 'Second key' });
    const next = page.getByRole('button', { name: 'Use this second key' });
    const box = page.getByRole('checkbox', { name: 'My second key comes from a different seed phrase' });

    await slot.getByRole('button', { name: 'Connect a wallet as Second key' }).click();
    await slot.getByRole('button', { name: sameKey.name, exact: true }).click();
    await expect(slot.getByText('This account is already your Main key.')).toBeVisible();
    await box.check();
    await expect(next).toBeDisabled();

    await slot.getByRole('button', { name: `Disconnect ${sameKey.name} from Second key` }).click();
    await box.uncheck();
    await connect(page, 'Second key', second.name);
    await expect(next).toBeDisabled();
    await box.check();
    await expect(next).toBeEnabled();
    expect(main.requests).toHaveLength(0);
    expect((await lockOf(qa, stake)).custodian).toBe(ZERO_ADDRESS);
  });
});
