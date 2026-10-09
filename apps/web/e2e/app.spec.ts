import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { DAY, MAIN, mockApi, NOW, rememberOnDevice, SECOND, SOL, stakeJson, type ApiFixture } from './mock-api.ts';
import { recordScreenMetrics } from './screen-metrics.ts';

/**
 * /app on the built site with the worker's API mocked (CLAUDE.md section 13, layer 4; e2e/mock-api.ts): the stake
 * account search, the Clock sysvar and the stake accounts themselves through the RPC proxy, and /api/health answer as
 * the worker does. Screenshots go to docs/screens only with UPDATE_SCREENS=1.
 */
const SCREENS_DIR = fileURLToPath(new URL('../../../docs/screens/', import.meta.url));
const UPDATE_SCREENS = process.env['UPDATE_SCREENS'] === '1';

const STRANGER = '57M4tyxx6Rk1gz3uYVvfoB3KdQGQkyveqqmZzJUdw3Sz';
const SERVICE = 'B4LfFcz7EuD8wWFM9qxMswgryP36jbGvKWhzLGXBR5t9';
const OTHER_OWNER = '21KaHQkRg8ntwcEF3Q1Y5wooZ1GC372Eu4yFQc5LRRFH';
const STAKE = {
  protected: 'AYA9kYsn7XVDTPARBfAuASypyyDGFJw1Xds2vHgW9DfW',
  expiring: '2Xtq6iZ2mXjxTNsv5FrYCzayG5qYRJwZ6837A1X3TjF6',
  open: '8EoRwu9o1xqJ68N1ECPGoGN3DG8hrFwZPN3pxpdEGNpe',
  foreign: '5RA1fUbNMm4rdu5EuQhiBMGsCFfspRzCscfojXZFWAXU',
  ended: 'ERPac8FPHDCFd6Nr8z9FFYJVzj1XptzQ6uxN1praU9wz',
  service: 'CQDtFDsjfViMT8Sgfe3TbeiAFaDgZfzGsiLsQCqa4tpE',
  secondKeyFor: '9g4dYJmEszBwLq4itZhnatz9BPWCkcFT4ni5CkNMDHAy',
} as const;

const BY_MAIN_KEY = [
  stakeJson(STAKE.protected, { lamports: 1_250n * SOL + 500_000_000n, lockEnd: NOW + 190n * DAY, custodian: SECOND }),
  stakeJson(STAKE.expiring, { lamports: 42n * SOL + 750_000_000n, lockEnd: NOW + 12n * DAY, custodian: SECOND }),
  stakeJson(STAKE.open, { lamports: 3n * SOL + 200_000_000n }),
  stakeJson(STAKE.foreign, { lamports: 10n * SOL, lockEnd: NOW + 300n * DAY, custodian: STRANGER, delegated: false }),
  stakeJson(STAKE.ended, { lamports: 120n * SOL, lockEnd: NOW - 2n * DAY, custodian: SECOND }),
  stakeJson(STAKE.service, { lamports: 64n * SOL, staker: SERVICE }),
];
const BY_SECOND_KEY = [
  stakeJson(STAKE.secondKeyFor, { lamports: 7n * SOL, withdrawer: OTHER_OWNER, lockEnd: NOW + 90n * DAY, custodian: MAIN }),
];

/** The cluster for one main key; `searches` records the stake account searches. */
function fixture(searches: string[] = []): ApiFixture {
  return { accounts: [...BY_MAIN_KEY, ...BY_SECOND_KEY], searches };
}

/** Visible filled buttons (primary and danger), as e2e/screen-metrics.ts counts them. */
const filledButtons = (page: Page) =>
  page.locator('[data-slot="button"][data-variant="primary"]:visible, [data-slot="button"][data-variant="danger"]:visible');

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
}

async function screenshot(page: Page, name: string) {
  await recordScreenMetrics(page, name);
  if (!UPDATE_SCREENS) return;
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  mkdirSync(SCREENS_DIR, { recursive: true });
  await page.screenshot({ path: `${SCREENS_DIR}${name}-${String(page.viewportSize()?.width ?? 0)}.png`, fullPage: true, animations: 'disabled' });
}

test('/app without an address: a form, then the stake of the address it checked', async ({ page, expectNoA11yViolations }) => {
  const requests: string[] = [];
  await mockApi(page, fixture(requests));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/app');
  await expect(page.getByRole('heading', { level: 1, name: 'Your stake accounts' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Wallet address' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Main key' }).getByRole('button', { name: 'Connect main key' })).toBeVisible();
  // One filled button: Check, while nothing is shown yet (D109).
  await expect(filledButtons(page)).toHaveCount(1);
  await expect(filledButtons(page)).toHaveText('Check');
  expect(requests).toEqual([]);

  await noHorizontalScroll(page);
  await expectNoA11yViolations();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectNoA11yViolations();
  await screenshot(page, 'app-empty');

  // A wrong paste is caught on the page; a right one goes into the URL and is read.
  const field = page.getByRole('textbox', { name: 'Wallet address' });
  await field.fill('not an address');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('This is not a Solana address.');
  await field.fill(MAIN);
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page).toHaveURL(`/app?address=${MAIN}`);
  await expect(page.getByRole('article')).toHaveCount(BY_MAIN_KEY.length + BY_SECOND_KEY.length);
  expect(requests.sort()).toEqual([`?custodian=${MAIN}`, `?withdrawer=${MAIN}`]);
});

test('/app?address= shows every status, the red banner and the second-key list', async ({ page, expectNoA11yViolations }) => {
  await mockApi(page, fixture());
  // This device knows the second key and saw STAKE.ended protected (F6).
  await rememberOnDevice(page, { secondKeys: [SECOND], protectedAccounts: [STAKE.ended] });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(`/app?address=${MAIN}`);

  const row = (address: string) => page.locator('article[data-slot="account-row"]').filter({ has: page.locator(`[title="${address}"]`) });
  await expect(row(STAKE.protected)).toHaveAttribute('data-status', 'protected');
  await expect(row(STAKE.expiring)).toHaveAttribute('data-status', 'expiring');
  await expect(row(STAKE.open)).toHaveAttribute('data-status', 'unprotected');
  await expect(row(STAKE.foreign)).toHaveAttribute('data-status', 'locked-by-other');
  await expect(row(STAKE.ended)).toHaveAttribute('data-status', 'was-protected');
  await expect(row(STAKE.service)).toContainText('A staking service may manage this stake.');
  await expect(row(STAKE.protected)).toContainText('until 10 April 2027');

  const banner = page.getByRole('alert');
  await expect(banner).toContainText('1 stake account is no longer protected');
  await expect(banner.getByRole('link', { name: 'Protect again' })).toHaveAttribute('href', `/protect?account=${STAKE.ended}`);

  // The banner is the page's one filled button; the group's "Protect 2 accounts" (the F6 account and the open one, not
  // the one a staking service may manage) is outline while it shows (D109).
  await expect(filledButtons(page)).toHaveCount(1);
  await expect(filledButtons(page)).toHaveText('Protect again');
  const section = (name: string) => page.locator('section', { has: page.getByRole('heading', { level: 2, name, exact: true }) });
  const attention = section('Needs attention');
  await expect(attention.getByRole('article')).toHaveCount(4);
  await expect(attention.getByRole('link', { name: 'Protect 2 accounts' })).toHaveAttribute(
    'href',
    `/protect?account=${STAKE.ended}&account=${STAKE.open}`,
  );
  await expect(section('Protected').getByRole('article')).toHaveCount(1);
  await expect(section('Locked by another key').getByRole('article')).toHaveCount(1);
  const secondList = section('You are the second key for');
  await expect(secondList.getByRole('article')).toHaveCount(1);

  // The SOL of one list stands in one column whether a row has an action, More, both or neither: right-aligned from
  // 640 px, first on its own line below.
  const wide = (page.viewportSize()?.width ?? 0) >= 640;
  const amountEdges = await page.locator('[data-slot="account-list"]').evaluateAll(
    (lists, right) =>
      lists.map((list) =>
        [...list.querySelectorAll('article[data-slot="account-row"] > [data-slot="sol-amount"]')].map((amount) => {
          const box = amount.getBoundingClientRect();
          return Math.round(right ? box.right : box.left);
        }),
      ),
    wide,
  );
  expect(amountEdges.map((edges) => edges.length)).toEqual([4, 1, 1, 1]);
  for (const edges of amountEdges) expect(new Set(edges).size, edges.join(', ')).toBe(1);

  // The answer first: SOL and accounts under the viewer's own lock, out of all of them.
  const summary = page.getByRole('region', { name: 'Summary' });
  await expect(summary).toContainText('1,293.25 of 1,490.45 SOL protected');
  await expect(summary.getByText('2 of 6 stake accounts', { exact: true })).toBeVisible();
  // The answer starts on the first screen of a phone, without scrolling (D109).
  const headline = await summary.getByText('1,293.25 of 1,490.45 SOL protected').boundingBox();
  expect(headline?.y ?? Infinity).toBeLessThan(740);
  await expect(page.locator('[data-slot="monitoring"]')).toHaveText('Last checked 2 min ago');
  // "Main key stolen? Rescue your stake" in one line: beside the answer from 640 px, under it at 360.
  const rescueLines = await summary.getByRole('link', { name: 'Rescue your stake' }).evaluate((link) => {
    const line = link.parentElement ?? link;
    const style = getComputedStyle(line);
    const content = line.getBoundingClientRect().height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    return Math.round(content / parseFloat(style.lineHeight));
  });
  expect(rescueLines).toBe(1);
  // Alerts for this main key: the worker redirects to its bot with /start <address>, in a new tab.
  const telegram = page.getByRole('link', { name: 'Get alerts in Telegram (opens in a new tab)' });
  await expect(telegram).toHaveAttribute('href', `/api/telegram/link?wallet=${MAIN}`);
  await expect(telegram).toHaveAttribute('target', '_blank');
  await expect(telegram).toHaveAttribute('rel', /\bnoreferrer\b/);

  await noHorizontalScroll(page);
  await expectNoA11yViolations();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectNoA11yViolations();
  await screenshot(page, 'app-accounts');

  // Actions are links to their pages; a row's own Protect is behind its More, as the group's button covers it.
  await row(STAKE.open).getByRole('button', { name: /^More for stake account/ }).click();
  await row(STAKE.open).getByRole('link', { name: /^Protect stake account/ }).click();
  await expect(page).toHaveURL(`/protect?account=${STAKE.open}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Protect your stake' })).toBeVisible();
});
