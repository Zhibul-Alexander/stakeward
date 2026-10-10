// The live site without signing: every route renders at this width, the security headers are served, the monitor is
// fresh, the accounts page reads real accounts by address, and /cosign refuses bad links.
import type { Page } from '@playwright/test';
import { shortAddress } from '@stakeward/core';
import { expectNoA11yViolations } from '../../e2e/fixtures.ts';
import { expect, test } from '../support/fixtures.ts';

/** No horizontal scroll (UX rule 10: works at 360 px). */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(1);
}

test.describe('site', () => {
  test('security headers on the site and the API; /api/health is fresh', async ({ request }) => {
    for (const path of ['/', '/api/health']) {
      const response = await request.get(path);
      const csp = response.headers()['content-security-policy'] ?? '';
      for (const directive of ["default-src 'self'", "script-src 'self'", "frame-ancestors 'none'", "object-src 'none'"]) {
        expect(csp, `${path} CSP`).toContain(directive);
      }
      expect(response.headers()['x-content-type-options']).toBe('nosniff');
      expect(response.headers()['referrer-policy']).toBe('no-referrer');
    }
    const health = await request.get('/api/health');
    expect(health.status(), '/api/health: the monitor ran in the last 10 minutes').toBe(200);
    const body = (await health.json()) as { ok: boolean; lastMonitorRunAt: string | null };
    expect(body.ok).toBe(true);
  });

  test('every route renders with a heading, no page errors and no horizontal scroll', async ({ page, qa, wallets }) => {
    const main = await wallets.create('QA Main', 0.05);
    const stake = await qa.createStake(main.signer);
    const routes = ['/', '/app', `/app?address=${main.address}`, '/protect', `/withdraw/${stake}`, `/extend/${stake}`, '/rescue', '/cosign', `/recovery/${stake}`, '/stats', '/no-such-page'];
    for (const route of routes) {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 }).first(), route).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
  });

  test('/app by address, without a wallet: the new account reads as Not protected; accessible', async ({ page, qa, wallets }) => {
    const main = await wallets.create('QA Main', 0.05);
    const stake = await qa.createStake(main.signer);

    await page.goto('/app');
    await page.getByRole('textbox', { name: 'Wallet address' }).fill(main.address);
    await page.getByRole('button', { name: 'Check' }).click();
    const row = page.getByRole('article', { name: `Stake account ${shortAddress(stake)}` });
    await expect(row).toHaveAttribute('data-status', 'unprotected');
    await expect(page.getByText(/^Last checked /)).toBeVisible();
    await expectNoA11yViolations(page);
  });

  test('negative: /app refuses a malformed address and explains an address without stake', async ({ page, qa }) => {
    await page.goto('/app');
    const field = page.getByRole('textbox', { name: 'Wallet address' });
    await field.fill('not-a-solana-address');
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByText('This is not a Solana address. Check it: it should be 32 to 44 letters and digits.')).toBeVisible();

    const empty = await qa.newKey(0.001);
    await field.fill(empty.address);
    await page.getByRole('button', { name: 'Check' }).click();
    await expect(page.getByRole('heading', { name: 'No stake accounts found' })).toBeVisible();
  });

  test('negative: /cosign refuses a broken link and signs nothing', async ({ page }) => {
    await page.goto('/cosign#tx=AAAA-not-a-transaction');
    await expect(page.getByRole('heading', { name: 'This link is incomplete' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Sign / })).toHaveCount(0);
  });
});
