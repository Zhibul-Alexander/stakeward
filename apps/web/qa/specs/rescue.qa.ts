// F4 Rescue, end to end: the main key is presumed stolen; both authorities move to a new wallet with three signatures
// on a durable nonce the new wallet owns and pays for (CLAUDE.md section 7).
import type { Page } from '@playwright/test';
import { expect, connect, signAll, test, type Role } from '../support/fixtures.ts';
import type { QaWallet } from '../support/wallet.ts';

async function throughKeys(page: Page, main: QaWallet, newWallet: QaWallet): Promise<void> {
  await page.goto('/rescue');
  await expect(page.getByRole('heading', { name: 'Which main key may be stolen?' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Main key address' }).fill(main.address);
  await page.getByRole('button', { name: 'Find its stake' }).click();
  await page.getByRole('button', { name: 'Next: new wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Connect a new wallet' })).toBeVisible();
  await connect(page, 'New wallet', newWallet.name);
  await page.getByRole('checkbox', { name: 'My new wallet comes from a new seed phrase that no one else has seen' }).check();
  await expect(page.getByText(/^Balance /)).toBeVisible();
  await page.getByRole('button', { name: 'Next: who signs' }).click();
  await expect(page.getByRole('heading', { name: 'Who signs the move' })).toBeVisible();
  for (const role of ['Main key', 'Second key'] as const) {
    await page.getByRole('radiogroup', { name: `Where does your ${role} sign?` }).getByRole('radio', { name: 'This browser' }).check();
  }
  await page.getByRole('button', { name: 'Next: move the stake' }).click();
  await expect(page.getByRole('heading', { name: 'Move your stake' })).toBeVisible();
}

test.describe('F4 rescue', () => {
  test('moves a protected account to a new wallet; staker = withdrawer = new wallet; the lock is kept', async ({ page, qa, wallets }) => {
    const main = await wallets.create('QA Main');
    const second = await wallets.create('QA Second', 0.01);
    const fresh = await wallets.create('QA New', 0.05);
    const stake = await qa.createStake(main.signer);
    const lockUntil = await qa.protect(main.signer, second.signer, stake, 3600);

    await throughKeys(page, main, fresh);
    // The new owner is shown in full before anything is signed (CLAUDE.md section 11).
    await expect(page.getByText(fresh.address).first()).toBeVisible();
    await page.getByRole('button', { name: 'Create the link-signing account' }).click();
    await signAll(page, [{ wallet: fresh, role: 'New wallet' }]);
    const signers: { wallet: QaWallet; role: Role }[] = [
      { wallet: fresh, role: 'New wallet' },
      { wallet: main, role: 'Main key' },
      { wallet: second, role: 'Second key' },
    ];
    await signAll(page, signers);
    await expect(page.getByRole('heading', { name: 'Your stake account is safe' })).toBeVisible();

    const account = await qa.stake(stake);
    expect(account?.staker).toBe(fresh.address);
    expect(account?.withdrawer).toBe(fresh.address);
    expect(account?.lockup.custodian).toBe(second.address);
    expect(account?.lockup.unixTimestamp).toBe(lockUntil);
    // The compromised main key never pays (CLAUDE.md section 5): only its signature is asked for, once.
    expect(main.requests).toHaveLength(1);
  });
});
