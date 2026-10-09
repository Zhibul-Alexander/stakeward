import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from './fixtures.ts';

/** Screenshots for review (CLAUDE.md section 13), written only with UPDATE_SCREENS=1 so ordinary runs leave them be. */
const SCREENS_DIR = fileURLToPath(new URL('../../../docs/screens/', import.meta.url));
const UPDATE_SCREENS = process.env['UPDATE_SCREENS'] === '1';

// /dev/cosign in a browser with no wallet installed (headless Chromium has none): every step explains what it needs,
// nothing is read from the network before a wallet is connected, and the page passes the console, axe and 360 px checks.
test('/dev/cosign without wallets: empty slots and explanations, no requests, no console errors or axe violations', async ({
  page,
  expectNoA11yViolations,
}) => {
  const width = page.viewportSize()?.width ?? 0;
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
  });
  await page.emulateMedia({ colorScheme: 'light' });
  const response = await page.goto('/dev/cosign');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Wallet co-signing test' })).toBeVisible();

  // Step 1: both slots are empty; the wallet list explains how to get a wallet. Opened from the keyboard.
  for (const role of ['Main key', 'Second key']) {
    await expect(page.getByRole('group', { name: role }).getByText('Not connected')).toBeVisible();
  }
  const connect = page.getByRole('button', { name: 'Connect a wallet as Main key' });
  await connect.focus();
  await page.keyboard.press('Enter');
  await expect(connect).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('group', { name: 'Main key' }).getByText(/^No Solana wallet found in this browser\./)).toBeVisible();

  // Steps 2-6 say what they wait for; the run cannot start.
  await expect(page.getByText('Connect the Main key first: the list shows its stake accounts.')).toBeVisible();
  const run = page.getByRole('region', { name: '4. Run' });
  await expect(run.getByText('Connect the Main key.')).toBeVisible();
  await expect(run.getByText('Connect the Second key.')).toBeVisible();
  await expect(run.getByText('Choose a stake account.')).toBeVisible();
  await expect(run.getByRole('button', { name: 'Start run' })).toBeDisabled();
  await expect(page.getByRole('region', { name: '5. Reset' }).getByText('Choose a stake account first.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No reports yet' })).toBeVisible();

  // Options: a durable nonce needs the main key's nonce account, and says so.
  await page.getByRole('radio', { name: 'Durable nonce' }).click();
  await expect(page.getByText('Connect the Main key first: the nonce account belongs to it.')).toBeVisible();
  await expect(run.getByText('Create the Main key\'s nonce account in Options, or choose a recent blockhash.')).toBeVisible();

  // Works at 360 px: nothing wider than the viewport.
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(width);

  // WCAG AA in both themes.
  await expectNoA11yViolations();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectNoA11yViolations();
  await page.emulateMedia({ colorScheme: 'light' });

  // Without a wallet nothing is read: no /api requests at all.
  expect(apiRequests).toEqual([]);

  if (UPDATE_SCREENS) {
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    mkdirSync(SCREENS_DIR, { recursive: true });
    await page.screenshot({ path: `${SCREENS_DIR}dev-cosign-${String(width)}.png`, fullPage: true, animations: 'disabled' });
  }
});
