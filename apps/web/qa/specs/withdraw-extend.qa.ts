// F3 Withdraw and F5 Extend / remove the lock, end to end (CLAUDE.md section 7).
import type { Page } from '@playwright/test';
import { formatSol } from '@stakeward/core';
import { connect, expect, lockOf, requires, signAll, test } from '../support/fixtures.ts';

const heading = (page: Page, name: string | RegExp) => expect(page.getByRole('heading', { name })).toBeVisible();

test.describe('F3 withdraw', () => {
  test('a protected, undelegated account: both keys sign; all of it goes to the main key; the account closes', async ({ page, qa, wallets }) => {
    const main = await wallets.create('QA Main');
    const second = await wallets.create('QA Second', 0.01);
    const stake = await qa.createStake(main.signer);
    await qa.protect(main.signer, second.signer, stake, 3600);
    const lamports = (await qa.stake(stake))?.lamports ?? 0n;
    const before = await qa.balance(main.signer.address);

    await page.goto(`/withdraw/${stake}`);
    await heading(page, `Withdraw ${formatSol(lamports)} to your main key`);
    // UX rule 6 and F3.3: the risk is said before the action, with the way out (Rescue).
    await expect(page.locator('[data-risk="withdraw-compromised"]')).toBeVisible();
    await page.getByRole('button', { name: 'Review withdrawal' }).click();
    await signAll(page, [
      { wallet: main, role: 'Main key' },
      { wallet: second, role: 'Second key' },
    ]);
    await heading(page, `${formatSol(lamports)} went to your main key`);

    expect(await qa.stake(stake)).toBeNull();
    const after = await qa.balance(main.signer.address);
    // Everything arrived, minus at most the network fee for two signatures (and a small priority fee).
    expect(after - before).toBeGreaterThan(lamports - 100_000n);
    expect(after - before).toBeLessThanOrEqual(lamports);
  });

  test('negative: the second key declines; nothing moves; the account stays locked', async ({ page, qa, wallets }) => {
    const main = await wallets.create('QA Main');
    const second = await wallets.create('QA Second', 0.01);
    const stake = await qa.createStake(main.signer);
    const lockUntil = await qa.protect(main.signer, second.signer, stake, 3600);
    second.behaviour = { reject: true };

    await page.goto(`/withdraw/${stake}`);
    await page.getByRole('button', { name: 'Review withdrawal' }).click();
    await signAll(page, [
      { wallet: main, role: 'Main key' },
      { wallet: second, role: 'Second key' },
    ]);
    await expect(page.getByText('The request was declined in the wallet. Nothing was sent; you can try again.')).toBeVisible();
    const account = await qa.stake(stake);
    expect(account).not.toBeNull();
    expect(account?.lockup.unixTimestamp).toBe(lockUntil);
  });

  test('a delegated account: stop staking first (main key alone), then withdraw after the epoch', async ({ page, qa, wallets }) => {
    requires('local-controls'); // waiting out an epoch takes days on devnet
    const main = await wallets.create('QA Main', 2);
    const second = await wallets.create('QA Second', 0.01);
    const stake = await qa.createStake(main.signer, 1.1);
    await qa.delegate(main.signer, stake);
    await qa.warpEpoch(); // activating -> active
    await qa.protect(main.signer, second.signer, stake, 3600);

    await page.goto(`/withdraw/${stake}`);
    await heading(page, 'First, stop staking');
    await page.getByRole('button', { name: 'Review: stop staking' }).click();
    await signAll(page, [{ wallet: main, role: 'Main key' }]);
    await heading(page, 'Waiting for the epoch to end');
    expect(second.requests).toHaveLength(0);

    await qa.warpEpoch();
    await page.getByRole('button', { name: 'Check again' }).click();
    const lamports = (await qa.stake(stake))?.lamports ?? 0n;
    await heading(page, `Withdraw ${formatSol(lamports)} to your main key`);
    await page.getByRole('button', { name: 'Review withdrawal' }).click();
    await signAll(page, [
      { wallet: main, role: 'Main key' },
      { wallet: second, role: 'Second key' },
    ]);
    await heading(page, `${formatSol(lamports)} went to your main key`);
    expect(await qa.stake(stake)).toBeNull();
  });
});

test.describe('F5 extend and remove the lock', () => {
  test('the second key alone extends the lock and pays the fee', async ({ page, qa, wallets }) => {
    const main = await wallets.create('QA Main');
    const second = await wallets.create('QA Second', 0.01);
    const stake = await qa.createStake(main.signer);
    const lockUntil = await qa.protect(main.signer, second.signer, stake, 600);
    const secondBefore = await qa.balance(second.signer.address);

    await page.goto(`/extend/${stake}`);
    await page.getByRole('radio', { name: /^1 hour/ }).check();
    await page.getByRole('button', { name: 'Review new end date' }).click();
    await signAll(page, [{ wallet: second, role: 'Second key' }]);
    await heading(page, /^The lock now ends on /);

    const lock = await lockOf(qa, stake);
    expect(lock.custodian).toBe(second.address);
    expect(lock.unixTimestamp).toBeGreaterThan(lockUntil);
    expect(await qa.balance(second.signer.address)).toBeLessThan(secondBefore);
    expect(main.requests).toHaveLength(0);
  });

  test('remove the lock early (second key, after a confirmation box), then the main key withdraws alone', async ({ page, qa, wallets }) => {
    const main = await wallets.create('QA Main');
    const second = await wallets.create('QA Second', 0.01);
    const stake = await qa.createStake(main.signer);
    await qa.protect(main.signer, second.signer, stake, 3600);
    const lamports = (await qa.stake(stake))?.lamports ?? 0n;

    await page.goto(`/extend/${stake}?remove`);
    await expect(page.getByRole('radio', { name: 'Remove the lock now' })).toBeChecked();
    await page.getByRole('button', { name: 'Review lock removal' }).click();
    // Negative: Sign stays inert until the box is ticked.
    const box = page.getByRole('checkbox', {
      name: 'I understand that after this, anyone with my main key can withdraw this stake right away',
    });
    await expect(page.getByText('Connect your Second key to sign.')).toBeVisible();
    await connect(page, 'Second key', second.name);
    await page.getByRole('button', { name: 'Use this wallet' }).click();
    const signButton = page.getByRole('button', { name: `Sign in ${second.name} as Second key` });
    await expect(signButton).toHaveAttribute('aria-disabled', 'true');
    await signButton.click({ force: true });
    await expect(page.getByText('Tick the box above to continue.')).toBeVisible();
    expect(second.requests).toHaveLength(0);
    await box.check();
    await signButton.click();
    await heading(page, 'The lock is removed');
    expect((await lockOf(qa, stake)).unixTimestamp).toBe(0n);

    await page.getByRole('link', { name: 'Withdraw now' }).click();
    await expect(page.getByText('No lock, so your main key signs alone.')).toBeVisible();
    await page.getByRole('button', { name: 'Review withdrawal' }).click();
    await signAll(page, [{ wallet: main, role: 'Main key' }]);
    await heading(page, `${formatSol(lamports)} went to your main key`);
    expect(await qa.stake(stake)).toBeNull();
    expect(second.requests).toHaveLength(1);
  });
});
