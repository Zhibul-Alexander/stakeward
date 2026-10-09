import type { Page, Route } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/**
 * Review: /app in its loading, error and empty states and with stale monitoring (CLAUDE.md section 9: UX rules 7, 8,
 * 10, 11, 12, 13), on the built site with the worker's API mocked. app.spec.ts covers only the loaded list.
 */
const MAIN = 'B1agBSrGRgub2jXMJEozYkRLRzFc9HLd5hHjSrCtuXu8';

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

function clockData(): string {
  const data = Buffer.alloc(40);
  data.writeBigUInt64LE(367_201_000n, 0);
  data.writeBigInt64LE(1_790_938_800n, 8);
  data.writeBigUInt64LE(850n, 16);
  data.writeBigUInt64LE(851n, 24);
  data.writeBigInt64LE(1_790_942_400n, 32);
  return data.toString('base64');
}

async function mockApi(page: Page, options: { clockFails?: boolean; hold?: Promise<void>; healthAgeMin: number }) {
  await page.route('**/api/stake-accounts?*', async (route) => {
    if (options.hold !== undefined) await options.hold;
    await json(route, { slot: '367201000', accounts: [] });
  });
  await page.route('**/api/rpc', async (route) => {
    const request = route.request().postDataJSON() as { id: number };
    if (options.clockFails === true) {
      // A JSON-RPC error inside HTTP 200, so the browser logs no failed resource.
      await json(route, { jsonrpc: '2.0', id: request.id, error: { code: -32005, message: 'Node is behind by 1200 slots' } });
      return;
    }
    await json(route, {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        context: { slot: 367_201_000 },
        value: { data: [clockData(), 'base64'], executable: false, lamports: 1_169_280, owner: 'Sysvar1111111111111111111111111111111111111', space: 40 },
      },
    });
  });
  await page.route('**/api/health', async (route) => {
    await json(route, { ok: options.healthAgeMin <= 10, lastMonitorRunAt: new Date(Date.now() - options.healthAgeMin * 60_000).toISOString() });
  });
}

async function checkPage(page: Page, expectNoA11yViolations: () => Promise<void>) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
  await page.emulateMedia({ colorScheme: 'light' });
  await expectNoA11yViolations();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectNoA11yViolations();
  await page.emulateMedia({ colorScheme: 'light' });
}

test('/app loading: explained, with a way out, accessible', async ({ page, expectNoA11yViolations }) => {
  let release = () => {};
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mockApi(page, { hold, healthAgeMin: 2 });
  await page.goto(`/app?address=${MAIN}`);
  await expect(page.getByRole('status').filter({ hasText: 'Reading stake accounts from the network' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  await checkPage(page, expectNoA11yViolations);
  release();
  await expect(page.getByRole('heading', { name: 'No stake accounts found' })).toBeVisible();
});

test('/app error + stale monitoring: what happened, Details by keyboard, Try again, red line', async ({ page, expectNoA11yViolations }) => {
  await mockApi(page, { clockFails: true, healthAgeMin: 15 });
  await page.goto(`/app?address=${MAIN}`);
  const error = page.getByRole('alert').filter({ hasText: 'Could not load the stake accounts' });
  await expect(error).toContainText('The Solana network did not respond.');
  const monitoring = page.locator('[data-slot="monitoring"]');
  await expect(monitoring).toHaveAttribute('data-state', 'stale');
  await expect(monitoring).toContainText('Alerts may be late.');
  await checkPage(page, expectNoA11yViolations);

  // Keyboard only: reach "Details", open it, read the raw text, then "Try again".
  const details = error.locator('summary');
  await details.focus();
  await page.keyboard.press('Enter');
  await expect(error.locator('details')).toHaveAttribute('open', '');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeFocused();
});

test('/app error: "Details" carries the original error text in the built site (UX rule 8)', async ({ page }) => {
  await mockApi(page, { clockFails: true, healthAgeMin: 2 });
  await page.goto(`/app?address=${MAIN}`);
  const error = page.getByRole('alert').filter({ hasText: 'Could not load the stake accounts' });
  await error.locator('summary').click();
  // Fails today: the production build shows "SolanaError: Solana error #-32005; Decode this error by running
  // `npx @solana/errors decode -- -32005`" and the node's message is gone.
  await expect(error.locator('details')).toContainText('Node is behind by 1200 slots');
});

test('/app empty: explains native stake vs LSTs (UX rule 13)', async ({ page, expectNoA11yViolations }) => {
  await mockApi(page, { healthAgeMin: 2 });
  await page.goto(`/app?address=${MAIN}`);
  await expect(page.getByRole('heading', { name: 'No stake accounts found' })).toBeVisible();
  await expect(page.getByText(/Liquid staking tokens \(LSTs\)/)).toBeVisible();
  await checkPage(page, expectNoA11yViolations);
});
