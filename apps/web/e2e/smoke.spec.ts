import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readStaticHeaders } from '../static-headers.ts';
import { expect, test } from './fixtures.ts';

/**
 * The entry routes under the production headers (CLAUDE.md sections 11 and 13). One test walks every route, so the
 * Playwright suite stays at 10 tests or fewer as routes are added. With UPDATE_SCREENS=1 the first step of the protect
 * wizard goes to docs/screens/protect-start-{1280,360}.png.
 */
const SCREENS_DIR = fileURLToPath(new URL('../../../docs/screens/', import.meta.url));
const UPDATE_SCREENS = process.env['UPDATE_SCREENS'] === '1';
const STATIC_HEADERS = readStaticHeaders();

const ROUTES: readonly { path: string; heading: string; screen: string | null }[] = [
  { path: '/', heading: 'Protect your staked SOL', screen: null },
  { path: '/app', heading: 'Your stake accounts', screen: null },
  { path: '/protect', heading: 'Protect your stake', screen: 'protect-start' },
];

test('/, /app and /protect render under the production headers, without console errors or axe violations', async ({
  page,
  expectNoA11yViolations,
}) => {
  // Three pages, each checked by axe in two themes.
  test.setTimeout(60_000);
  const width = page.viewportSize()?.width ?? 0;
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
  });

  for (const route of ROUTES) {
    await test.step(route.path, async () => {
      await page.emulateMedia({ colorScheme: 'light' });
      apiRequests.length = 0;
      const response = await page.goto(route.path);
      expect(response?.status()).toBe(200);
      const headers = response?.headers() ?? {};
      for (const [name, value] of Object.entries(STATIC_HEADERS)) {
        expect(headers[name.toLowerCase()], name).toBe(value);
      }

      await expect(page.getByRole('heading', { level: 1, name: route.heading, exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Stakeward home' })).toBeVisible();
      const footer = page.getByRole('contentinfo');
      await expect(footer.getByRole('link', { name: 'Source code' })).toHaveAttribute(
        'href',
        'https://github.com/Zhibul-Alexander/stakeward',
      );
      await expect(footer.getByRole('link', { name: 'What Stakeward cannot do' })).toHaveAttribute('href', '/#cannot-do');
      await expect(footer.getByText('No warranty. MIT license.')).toBeVisible();

      if (route.path === '/protect') {
        // Step 1 of 5 asks for the main key; without it the wizard reads nothing from the network (UX rule 1).
        await expect(page.getByRole('heading', { level: 2, name: 'Choose the stake accounts to protect' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Connect a wallet as Main key' })).toBeVisible();
        expect(apiRequests).toEqual([]);
      }

      // Works at 360 px: nothing wider than the viewport.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBe(0);

      // Geist comes from the site itself (no CDN) and actually loads under the CSP.
      const geistLoaded = await page.evaluate(async () => {
        await document.fonts.ready;
        return [...document.fonts].some((face) => face.family.includes('Geist') && face.status === 'loaded');
      });
      expect(geistLoaded).toBe(true);

      // WCAG AA in both themes (tokens.css switches on prefers-color-scheme).
      await page.emulateMedia({ colorScheme: 'light' });
      await expectNoA11yViolations();
      await page.emulateMedia({ colorScheme: 'dark' });
      await expectNoA11yViolations();

      if (UPDATE_SCREENS && route.screen !== null) {
        await page.emulateMedia({ colorScheme: 'light' });
        mkdirSync(SCREENS_DIR, { recursive: true });
        await page.screenshot({ path: `${SCREENS_DIR}${route.screen}-${String(width)}.png`, fullPage: true, animations: 'disabled' });
      }
    });
  }
});
