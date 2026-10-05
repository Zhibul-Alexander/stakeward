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
 * Real inspector output rendered in the product components section: protect, a batch of two protects, extend,
 * withdraw, rescue, unlock and one rejected link. The flows sections below it render more (signing panel phases).
 */
const SUMMARIES = 7;

test('/dev/ui shows every token and component without console errors, axe violations or horizontal scroll', async ({
  page,
  expectNoA11yViolations,
}) => {
  // The page holds every component and flow; axe over all of it in two themes takes longer than the default 30 s.
  test.setTimeout(90_000);
  const width = page.viewportSize()?.width ?? 0;
  await page.emulateMedia({ colorScheme: 'light' });
  const response = await page.goto('/dev/ui');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Design system' })).toBeVisible();

  // The transaction summaries are built with core and inspected in the browser (Web Crypto), then rendered.
  await expect(page.locator('#components [data-slot="transaction-summary"]')).toHaveCount(SUMMARIES);
  await expect(page.locator('[data-slot="transaction-summary"][data-kind="protect"]').first()).toContainText(
    'This transaction cannot move your SOL.',
  );
  // The flows: the signing panel in its 14 samples (built with core and inspected like the summaries above) and the
  // protect wizard's Done screen (all, partial, none).
  await expect(page.locator('#signing figure')).toHaveCount(14);
  await expect(page.locator('#signing [data-slot="transaction-summary"][data-kind="protect"]').first()).toBeVisible();
  await expect(page.locator('#protect-result [data-slot="protect-done"]')).toHaveCount(3);

  // Signing by link: the link card's QR code is one SVG path, drawn under the production CSP (no style attribute, no
  // <style> element, no data: URI; a refused inline style would also fail the fixture's console check). The components
  // section has one more (the QR code on its own) and the too-long state, which shows text instead.
  // Three signing panels, then the link-signing account's five cards.
  await expect(page.locator('#link figure')).toHaveCount(8);
  await expect(page.locator('#link svg[data-slot="qr-code"] path')).toHaveCount(2);
  await expect(page.locator('#components svg[data-slot="qr-code"] path')).toHaveCount(4);
  await expect(page.getByText('This link is too long for a QR code. Copy it instead.')).toBeVisible();
  for (const d of await page.locator('svg[data-slot="qr-code"] path').evaluateAll((paths) => paths.map((p) => p.getAttribute('d')))) {
    expect(d).toMatch(/^M\d/);
  }
  await expect(page.locator('svg[data-slot="qr-code"][style], svg[data-slot="qr-code"] [style], svg[data-slot="qr-code"] style')).toHaveCount(0);
  const qrColours = () =>
    page
      .locator('#link svg[data-slot="qr-code"]')
      .first()
      .evaluate((svg) => ({
        modules: getComputedStyle(svg.querySelector('path') ?? svg).fill,
        ground: getComputedStyle(svg.querySelector('rect') ?? svg).fill,
      }));
  // The qr-dark and qr-light tokens, the same in both themes (cameras need dark modules on a light ground).
  const QR_COLOURS = { modules: 'rgb(16, 19, 26)', ground: 'rgb(255, 255, 255)' };
  expect(await qrColours()).toEqual(QR_COLOURS);

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

  // The recovery card's pieces: three command blocks (idle, copied, copy failed), every support verdict, and a
  // FAQ item that the browser opens and closes from the keyboard (a native <details>, DECISIONS.md D3; jsdom cannot
  // check this).
  await expect(page.locator('#components [data-slot="command-block"]')).toHaveCount(3);
  await expect(page.locator('#components [data-verdict]')).toHaveCount(5);
  await expect(page.locator('#components details[data-slot="faq-item"]')).toHaveCount(2);
  const faq = page.locator('#dev-ui-faq-lock-ends');
  await expect(faq).not.toHaveAttribute('open');
  await faq.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(faq).toHaveAttribute('open', '');
  await page.keyboard.press('Space');
  await expect(faq).not.toHaveAttribute('open');

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
  expect(await qrColours()).toEqual(QR_COLOURS);

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
    // The flows on their own, for review against the mockups: the signing panel phases, signing by link and the
    // protect Done screen.
    for (const section of ['signing', 'link', 'protect-result']) {
      await page
        .locator(`#${section}`)
        .screenshot({ path: `${SCREENS_DIR}dev-ui-${section}-${String(width)}.png`, animations: 'disabled' });
    }
  }
});
