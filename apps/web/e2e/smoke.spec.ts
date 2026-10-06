import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { readStaticHeaders } from '../static-headers.ts';
import { expect, test } from './fixtures.ts';
import { MAIN, mockApi, rememberOnDevice, SECOND, SMOKE_FIXTURE, SMOKE_STAKE } from './mock-api.ts';

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
  /** What else the route must show once it has read what it needs (before axe and the screenshot). */
  shows?: ((page: Page) => Promise<void>) | undefined;
  /** The route reads nothing from the API (a page that needs no wallet and no chain read to say what it says). */
  noApi?: boolean | undefined;
  /** The API paths the route reads, and no others (a page of the worker's numbers reads no chain). */
  apiPaths?: readonly string[] | undefined;
  screen: string | null;
};

const ROUTES: readonly SmokeRoute[] = [
  {
    // The landing page (step 8): three steps, what Stakeward cannot do, and every question opened from the keyboard,
    // so axe checks the answers too and the screenshot holds the whole text.
    path: '/',
    heading: 'Protect your staked SOL',
    ready: null,
    shows: async (page) => {
      // The footer's /#cannot-do, followed from another page, loads this page fresh: the section comes into view.
      await page.evaluate(() => {
        window.location.hash = 'cannot-do';
      });
      await page.reload();
      await expect(page.getByRole('heading', { level: 2, name: 'What Stakeward cannot do', exact: true })).toBeInViewport();

      const steps = page.locator('#how-it-works ol > li');
      await expect(steps).toHaveCount(3);
      for (const step of await steps.all()) await expect(step).toBeVisible();
      await expect(page.locator('#cannot-do')).toBeVisible();

      const questions = page.locator('#faq details');
      const count = await questions.count();
      expect(count).toBeGreaterThanOrEqual(12);
      await questions.first().locator('summary').focus();
      for (let i = 0; i < count; i += 1) {
        const question = questions.nth(i);
        const summary = question.locator('summary');
        // Tab from the question before (past any link in its answer) to this one, then Enter opens it.
        for (let presses = 0; presses < 4 && !(await summary.evaluate((node) => node === document.activeElement)); presses += 1) {
          await page.keyboard.press('Tab');
        }
        await expect(summary).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(question).toHaveAttribute('open', '');
        await expect(question.locator('[data-slot="faq-answer"]')).toBeVisible();
      }
      // Keeps the last question's focus ring out of the screenshot; the loop above has checked the keyboard path.
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
    },
    noApi: true,
    screen: 'landing',
  },
  { path: '/app', heading: 'Your stake accounts', ready: null, screen: null },
  {
    // The worker's public numbers and the monitor's freshness (CLAUDE.md section 8): no wallet, no chain read.
    path: '/stats',
    heading: 'Stakeward in numbers',
    ready: null,
    shows: async (page) => {
      await expect(page.locator('[data-slot="stat-value"]')).toHaveText(['3', '2,750.5 SOL', '5']);
      await expect(page.getByText('Accounts and SOL counted on 2 October 2026, 12:00 UTC.')).toBeVisible();
      await expect(page.locator('[data-slot="monitoring"]')).toHaveAttribute('data-state', 'fresh');
    },
    apiPaths: ['/api/health', '/api/stats'],
    screen: 'stats',
  },
  { path: '/protect', heading: 'Protect your stake', ready: null, screen: 'protect-start' },
  { path: `/withdraw/${SMOKE_STAKE}`, heading: 'Withdraw', ready: 'Withdraw 1,250.5 SOL to your main key', screen: 'withdraw' },
  { path: `/extend/${SMOKE_STAKE}`, heading: 'Extend the lock', ready: 'New end of the lock', screen: 'extend' },
  {
    // Telegram's "Open Rescue" lands here with the main key filled in: step 1 reads its stake with no wallet.
    path: `/rescue?address=${MAIN}`,
    heading: 'Rescue your stake',
    ready: null,
    shows: async (page) => {
      await expect(page.getByRole('heading', { level: 2, name: 'Which main key may be stolen?' })).toBeVisible();
      await expect(page.getByText(/^Your stake is locked until /)).toBeVisible();
      await expect(page.locator('[data-slot="rescue-movable"] article[data-slot="account-row"]')).toHaveCount(1);
    },
    screen: 'rescue-start',
  },
  {
    // The printable card of a protected account: both keys in full, the lock end, the commands with this account.
    path: `/recovery/${SMOKE_STAKE}`,
    heading: 'Recovery card',
    ready: null,
    shows: async (page) => {
      const facts = page.getByRole('region', { name: 'This stake account' });
      await expect(facts.getByText(SECOND, { exact: true })).toBeVisible();
      await expect(facts.getByText(MAIN, { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Print or save as PDF' })).toBeVisible();
      await expect(page.locator('[data-slot="command-block"]')).toHaveCount(13);
      // The stolen-key steps keep their numbers (a flex list item would lose its marker).
      const steps = page.getByRole('region', { name: 'If your main key is stolen' }).locator('ol > li');
      await expect(steps).toHaveCount(5);
      for (const step of await steps.all()) await expect(step).toHaveCSS('display', 'list-item');
      await expect(page.locator('[data-slot="command-block"]').first()).toContainText(MAIN);
      // On paper: no site frame and no buttons, and the light theme even when the screen is dark.
      await page.emulateMedia({ media: 'print', colorScheme: 'dark' });
      await expect(page.getByRole('banner')).toBeHidden();
      await expect(page.getByRole('button', { name: 'Print or save as PDF' })).toBeHidden();
      await expect(page.getByRole('button', { name: /^Copy the command/ }).first()).toBeHidden();
      await expect(facts.getByText(SECOND, { exact: true })).toBeVisible();
      const paper = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      await page.emulateMedia({ media: 'screen', colorScheme: 'dark' });
      const screenDark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      await page.emulateMedia({ colorScheme: 'light' });
      const screenLight = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(paper).toBe(screenLight);
      expect(screenDark).not.toBe(screenLight);
    },
    screen: 'recovery',
  },
  {
    // A broken link: said before anything is read or asked (step 7 spec 8.3).
    path: '/cosign#tx=@@',
    heading: 'Co-sign a transaction',
    ready: null,
    shows: async (page) => {
      await expect(page.getByRole('heading', { name: 'This link is broken' })).toBeVisible();
    },
    noApi: true,
    screen: 'cosign-broken',
  },
];

test('every entry route renders under the production headers, without console errors or axe violations', async ({
  page,
  expectNoA11yViolations,
}) => {
  // Every route above, each checked by axe in two themes.
  test.setTimeout(240_000);
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
      await route.shows?.(page);
      if (route.noApi === true) expect(apiRequests).toEqual([]);
      if (route.apiPaths !== undefined) {
        expect([...new Set(apiRequests.map((url) => new URL(url).pathname))].sort()).toEqual([...route.apiPaths].sort());
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
