import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readStaticHeaders } from '../static-headers.ts';
import { expect, test } from './fixtures.ts';
import { mockApi, rememberOnDevice, SECOND, SMOKE_FIXTURE, SMOKE_STAKE } from './mock-api.ts';

/**
 * The entry routes under the production headers (CLAUDE.md sections 11 and 13), with the worker's API mocked
 * (e2e/mock-api.ts). One test walks every route, so the Playwright suite stays at 10 tests or fewer as routes are
 * added. With UPDATE_SCREENS=1 a route with a screen goes to docs/screens/<screen>-{1280,360}.png.
 */
const SCREENS_DIR = fileURLToPath(new URL('../../../docs/screens/', import.meta.url));
const UPDATE_SCREENS = process.env['UPDATE_SCREENS'] === '1';
const STATIC_HEADERS = readStaticHeaders();

type SmokeRoute = {
  path: string;
  /** The page's h1. */
  heading: string;
  /** A stake account page: the h2 that shows it has read the account and says what can be done; null otherwise. */
  ready: string | null;
  screen: string | null;
};

const ROUTES: readonly SmokeRoute[] = [
  { path: '/', heading: 'Protect your staked SOL', ready: null, screen: null },
  { path: '/app', heading: 'Your stake accounts', ready: null, screen: null },
  { path: '/protect', heading: 'Protect your stake', ready: null, screen: 'protect-start' },
  { path: `/withdraw/${SMOKE_STAKE}`, heading: 'Withdraw', ready: 'Withdraw 1,250.5 SOL to your main key', screen: 'withdraw' },
  { path: `/extend/${SMOKE_STAKE}`, heading: 'Extend the lock', ready: 'New end of the lock', screen: 'extend' },
];

test('every entry route renders under the production headers, without console errors or axe violations', async ({
  page,
  expectNoA11yViolations,
}) => {
  // Five pages, each checked by axe in two themes.
  test.setTimeout(120_000);
  const width = page.viewportSize()?.width ?? 0;
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url());
  });
  await mockApi(page, SMOKE_FIXTURE);
  // This device protected the stake, so it knows the second key (the account row reads Protected, not someone else's).
  await rememberOnDevice(page, { secondKeys: [SECOND] });

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
      if (route.ready !== null) {
        // A stake account page reads its own account, never the search (step 6 spec 4.3).
        await expect(page.getByRole('heading', { level: 2, name: route.ready, exact: true })).toBeVisible();
        await expect(page.locator('article[data-slot="account-row"]')).toHaveAttribute('data-status', 'protected');
        expect(apiRequests.filter((url) => new URL(url).pathname === '/api/stake-accounts')).toEqual([]);
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
