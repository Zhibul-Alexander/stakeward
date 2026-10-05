import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from './fixtures.ts';

/**
 * Screenshots of /dev/ui for review and /design-sync (CLAUDE.md sections 9 and 13), written to docs/screens only with
 * UPDATE_SCREENS=1 (`UPDATE_SCREENS=1 pnpm e2e`), so ordinary runs do not rewrite tracked files.
 */
const SCREENS_DIR = fileURLToPath(new URL('../../../docs/screens/', import.meta.url));
const UPDATE_SCREENS = process.env['UPDATE_SCREENS'] === '1';

/**
 * Real inspector output rendered on the page: protect, a batch of two protects, extend, withdraw, rescue, unlock and
 * one rejected link.
 */
const SUMMARIES = 7;

test('/dev/ui shows every token and component without console errors, axe violations or horizontal scroll', async ({
  page,
  expectNoA11yViolations,
}) => {
  const width = page.viewportSize()?.width ?? 0;
  await page.emulateMedia({ colorScheme: 'light' });
  const response = await page.goto('/dev/ui');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Design system' })).toBeVisible();

  // The transaction summaries are built with core and inspected in the browser (Web Crypto), then rendered.
  await expect(page.locator('[data-slot="transaction-summary"]')).toHaveCount(SUMMARIES);
  await expect(page.locator('[data-slot="transaction-summary"][data-kind="protect"]').first()).toContainText(
    'This transaction cannot move your SOL.',
  );

  // Token tables come from tokens.css: every colour has a swatch class (a missing one would stay transparent),
  // and the dark panel really shows other values than the light one.
  const swatches = await page.evaluate(() =>
    [...document.querySelectorAll('[data-theme-preview] li > span:first-child')].map((el) => ({
      theme: el.closest('[data-theme-preview]')?.getAttribute('data-theme-preview') ?? '',
      colour: getComputedStyle(el).backgroundColor,
    })),
  );
  const light = swatches.filter((s) => s.theme === 'light');
  const dark = swatches.filter((s) => s.theme === 'dark');
  expect(light.length).toBeGreaterThan(20);
  expect(dark).toHaveLength(light.length);
  expect(swatches.filter((s) => s.colour === 'rgba(0, 0, 0, 0)' || s.colour === 'transparent')).toEqual([]);
  expect(light.map((s) => s.colour)).not.toEqual(dark.map((s) => s.colour));

  // Keyboard: the wallet list opens from its button.
  const connect = page.getByRole('button', { name: 'Connect a wallet as Main key' });
  await connect.focus();
  await page.keyboard.press('Enter');
  await expect(connect).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'Sample Wallet' }).first()).toBeVisible();

  // Works at 360 px: nothing wider than the viewport.
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(width);

  // WCAG AA in both themes.
  await expectNoA11yViolations();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectNoA11yViolations();

  await page.emulateMedia({ colorScheme: 'light' });

  // Radix positions the tooltip through element.style (CSSOM), which the strict CSP allows (DECISIONS.md D3); a
  // blocked inline style would fail the console check of the fixture.
  await page.getByRole('button', { name: 'Hover or focus for a tooltip' }).hover();
  await expect(page.getByRole('tooltip')).toHaveText('Tooltips repeat information that is also on the page.');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toBeHidden();

  if (UPDATE_SCREENS) {
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    mkdirSync(SCREENS_DIR, { recursive: true });
    await page.screenshot({ path: `${SCREENS_DIR}dev-ui-${String(width)}.png`, fullPage: true, animations: 'disabled' });
  }
});
