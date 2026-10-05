import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { DAY, MAIN, mockApi, NOW, rememberOnDevice, SECOND, SOL, stakeJson, type ApiFixture } from './mock-api.ts';

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

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
}

async function screenshot(page: Page, name: string) {
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
  await expect(page.getByRole('textbox', { name: 'Main key address' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect a wallet as Main key' })).toBeVisible();
  expect(requests).toEqual([]);

  await noHorizontalScroll(page);
  await expectNoA11yViolations();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectNoA11yViolations();
  await screenshot(page, 'app-empty');

  // A wrong paste is caught on the page; a right one goes into the URL and is read.
  const field = page.getByRole('textbox', { name: 'Main key address' });
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

  const secondList = page.locator('section', { has: page.getByRole('heading', { name: 'You are the second key for' }) });
  await expect(secondList.getByRole('article')).toHaveCount(1);
  await expect(page.getByText('6 stake accounts', { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="monitoring"]')).toHaveText('Last checked 2 min ago');
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

  // Actions are links to their pages.
  await row(STAKE.open).getByRole('link', { name: /^Protect stake account/ }).click();
  await expect(page).toHaveURL(`/protect?account=${STAKE.open}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Protect your stake' })).toBeVisible();
});
