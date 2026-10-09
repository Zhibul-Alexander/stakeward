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
/** SummaryBar samples: ready, loading, error, stale monitoring, new device, second key only, and the dark preview. */
const SUMMARY_BARS = 7;
/** AccountRow samples (samples.ts sampleRows): one per status and case, shown again in the dark preview. */
const SAMPLE_ROWS = 8;
/** RadioCardGroup samples: lock period (4 cards), extend with Remove (4) and the dark preview's extend (4). */
const RADIO_CARDS = 12;

test('/dev/ui shows every token and component without console errors, axe violations or horizontal scroll', async ({
  page,
  expectNoA11yViolations,
}) => {
  // The page holds every component and flow; axe over all of it in two themes takes longer than the default 30 s:
  // about 75 s on a developer machine, so a slower CI runner gets room.
  test.setTimeout(150_000);
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
  // The recovery card of the sample keys: two accounts, its commands wrap at 360 (the overflow check below).
  await expect(page.locator('#recovery [data-slot="recovery-account"]')).toHaveCount(2);
  await expect(page.locator('#recovery [data-slot="command-block"]')).toHaveCount(13);

  // Signing by link: the link card's QR code is one SVG path, drawn under the production CSP (no style attribute, no
  // <style> element, no data: URI; a refused inline style would also fail the fixture's console check). The components
  // section has one more (the QR code on its own) and the too-long state, which shows text instead.
  // Three signing panels, then the link-signing account's six cards.
  await expect(page.locator('#link figure')).toHaveCount(9);
  await expect(page.locator('#link svg[data-slot="qr-code"] path')).toHaveCount(2);
  await expect(page.locator('#components svg[data-slot="qr-code"] path')).toHaveCount(4);
  // /cosign's request (protect, rescue with its check) and "Do not sign" panel (with addresses, rejected bytes).
  await expect(page.locator('#components [data-slot="cosign-ask"]')).toHaveCount(2);
  await expect(page.locator('#components [data-slot="stop-panel"]')).toHaveCount(2);
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

  // The Collapsible primitive (a row's "More" actions, DECISIONS.md D109): closed, its content is hidden and holds
  // nothing; the trigger opens and closes it from the keyboard, and Radix sizes it through CSSOM (a refused inline
  // style would fail the fixture's console check).
  const more = page.locator('#primitives').getByRole('button', { name: 'More actions for this row' });
  const moreContent = page.locator('#primitives [data-slot="collapsible-content"]');
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(moreContent).toBeHidden();
  await expect(moreContent.locator('*')).toHaveCount(0);
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(moreContent.getByRole('button')).toHaveCount(2);
  await expect(moreContent.getByRole('button').first()).toBeVisible();
  await page.keyboard.press('Space');
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(moreContent).toBeHidden();
  await expect(moreContent.locator('*')).toHaveCount(0);

  // The page frame (D109): one PageHeader sample with its back link, meta, progress and action; two ActionBars, one
  // with a blocked step button whose first reason shows before any click.
  await expect(page.locator('#layout [data-slot="page-header"]')).toHaveCount(1);
  await expect(page.locator('#layout [data-slot="section"]')).toHaveCount(1);
  await expect(page.locator('#layout [data-slot="action-bar"]')).toHaveCount(2);
  const blocked = page.locator('#layout').getByRole('button', { name: 'Continue with 2 accounts' });
  await expect(blocked).toHaveAttribute('aria-disabled', 'true');
  await expect(blocked).toHaveAccessibleDescription('Connect your main key first.');

  // The product samples (D109): the summary bar in six states and the dark preview, monitoring and Refresh in every
  // one; every sample row in one list and once more in the dark preview; the lock period and extend choices as cards.
  const bars = page.locator('#components [data-slot="summary-bar"]');
  await expect(bars).toHaveCount(SUMMARY_BARS);
  for (const bar of await bars.all()) {
    await expect(bar.locator('[data-slot="monitoring"]')).toHaveCount(1);
    await expect(bar.getByRole('button', { name: 'Refresh' })).toHaveCount(1);
  }
  await expect(page.locator('[data-dark-preview] article[data-slot="account-row"]')).toHaveCount(SAMPLE_ROWS);
  await expect(page.locator('#components [data-slot="radio-card"]')).toHaveCount(RADIO_CARDS);
  await expect(page.locator('#components [data-slot="radio-card"][data-tone="danger"]')).toHaveCount(2);
  await expect(page.locator('#components [data-slot="disclosure"]')).not.toHaveCount(0);

  // A row's More opens from the keyboard and shows the actions behind it; closed, they are not in the page.
  const expiringRow = page.locator('#components article[data-slot="account-row"][data-status="expiring"]').first();
  const rowMore = expiringRow.getByRole('button', { name: /^More for stake account / });
  await expect(rowMore).toHaveAttribute('aria-expanded', 'false');
  await expect(expiringRow.getByRole('button', { name: 'Withdraw' })).toHaveCount(0);
  await rowMore.focus();
  await page.keyboard.press('Enter');
  await expect(rowMore).toHaveAttribute('aria-expanded', 'true');
  await expect(expiringRow.getByRole('button', { name: 'Withdraw' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(expiringRow.getByRole('button', { name: 'Withdraw' })).toHaveCount(0);

  // Compact rows (D109): a row without warnings and with an action is at most 72 px tall at 1280 and 112 px at 360
  // (the row itself, without its list item's padding). At 360 that holds where the status badge and the address share
  // line 1; the two longest badges (No longer protected, Locked by …) push the address to a line of its own.
  const rowHeights = await page
    .getByRole('list', { name: 'In a list, the hint said once per group' })
    .locator('article[data-slot="account-row"]')
    .evaluateAll((rows) =>
      rows
        .filter((row) => row.querySelector('[data-slot="row-actions"]') !== null && row.querySelector('[data-slot="row-warning"]') === null)
        .map((row) => ({ status: row.getAttribute('data-status') ?? '', height: row.getBoundingClientRect().height })),
    );
  const measured = width < 640 ? rowHeights.filter((row) => ['protected', 'expiring', 'unprotected'].includes(row.status)) : rowHeights;
  expect(measured.map((row) => row.status)).toEqual(
    width < 640 ? ['protected', 'expiring', 'unprotected'] : ['protected', 'expiring', 'unprotected', 'was-protected'],
  );
  for (const row of measured) expect(row.height, row.status).toBeLessThanOrEqual(width < 640 ? 112 : 72);

  // WCAG 2.4.3: in every sample row Tab goes the way the row reads, left to right on a line, then down. Nothing in a
  // row is moved with CSS order, so the action and More on line 1 come before a warning's Open Rescue below it.
  const rowFocusOrder = await page.locator('#components article[data-slot="account-row"]').evaluateAll((rows) =>
    rows.flatMap((row) => {
      const boxes = [...row.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')]
        .map((element) => ({ name: element.getAttribute('aria-label') ?? element.textContent, box: element.getBoundingClientRect() }))
        .filter(({ box }) => box.width > 0 && box.height > 0);
      return boxes.slice(1).flatMap((next, index) => {
        const previous = boxes[index];
        if (previous === undefined) return [];
        const centre = (box: DOMRect) => box.top + box.height / 2;
        const sameLine = Math.abs(centre(next.box) - centre(previous.box)) < 12;
        const inOrder = sameLine ? next.box.left >= previous.box.right - 1 : centre(next.box) > centre(previous.box);
        return inOrder ? [] : [`${row.getAttribute('aria-label') ?? ''}: ${previous.name} before ${next.name}`];
      });
    }),
  );
  expect(rowFocusOrder).toEqual([]);

  // Keyboard: the wallet list opens from its button. Exact: the connectLabel sample is named "or connect a wallet as
  // Main key".
  const connect = page.getByRole('button', { name: 'Connect a wallet as Main key', exact: true });
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

  // A theme switch starts colour transitions (transition-colors, 150 ms). Halfway, a button's text and background are
  // both in between and fail contrast: a slow CI runner had axe measure that, on a different button each run. axe must
  // check the theme, not the transition, so frozen halfway it still passes. The transitions are slowed through CSSOM
  // (the CSP allows it) so that they are surely running when frozen.
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--motion-duration-fast', '10s');
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => document.getAnimations().some((animation) => animation.playState === 'running'));
  const frozen = await page.evaluate(() => {
    const finite = document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity);
    for (const animation of finite) {
      animation.pause();
      animation.currentTime = Number(animation.effect?.getComputedTiming().endTime) / 2;
    }
    return finite.length;
  });
  expect(frozen).toBeGreaterThan(0);
  // The primitives hold every button variant; axe over the whole page a third time would not fit the timeout.
  await expectNoA11yViolations({ include: '#primitives' });
  await page.evaluate(() => document.documentElement.style.removeProperty('--motion-duration-fast'));

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
    // The flows on their own, for review against the mockups: the signing panel phases, signing by link, the
    // protect Done screen and the recovery card.
    for (const section of ['signing', 'link', 'protect-result', 'recovery']) {
      await page
        .locator(`#${section}`)
        .screenshot({ path: `${SCREENS_DIR}dev-ui-${section}-${String(width)}.png`, animations: 'disabled' });
    }
  }
});
