import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page, Route } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/**
 * /app on the built site with the worker's API mocked (CLAUDE.md section 13, layer 4): the stake account search, the
 * Clock sysvar through the RPC proxy and /api/health answer as the worker does. Screenshots go to docs/screens only
 * with UPDATE_SCREENS=1.
 */
const SCREENS_DIR = fileURLToPath(new URL('../../../docs/screens/', import.meta.url));
const UPDATE_SCREENS = process.env['UPDATE_SCREENS'] === '1';

const MAIN = 'B1agBSrGRgub2jXMJEozYkRLRzFc9HLd5hHjSrCtuXu8';
const SECOND = '9DpLwZiYboWcwYFVtSjSksfaP9EqVoSuZw7Jofet96fi';
const STRANGER = '57M4tyxx6Rk1gz3uYVvfoB3KdQGQkyveqqmZzJUdw3Sz';
const SERVICE = 'B4LfFcz7EuD8wWFM9qxMswgryP36jbGvKWhzLGXBR5t9';
const OTHER_OWNER = '21KaHQkRg8ntwcEF3Q1Y5wooZ1GC372Eu4yFQc5LRRFH';
const VOTE = '2YH4Dt2o14vVVS9wW8q1UkfodZLpE2Fj6cjTqCLFi4Tv';
const STAKE = {
  protected: 'AYA9kYsn7XVDTPARBfAuASypyyDGFJw1Xds2vHgW9DfW',
  expiring: '2Xtq6iZ2mXjxTNsv5FrYCzayG5qYRJwZ6837A1X3TjF6',
  open: '8EoRwu9o1xqJ68N1ECPGoGN3DG8hrFwZPN3pxpdEGNpe',
  foreign: '5RA1fUbNMm4rdu5EuQhiBMGsCFfspRzCscfojXZFWAXU',
  ended: 'ERPac8FPHDCFd6Nr8z9FFYJVzj1XptzQ6uxN1praU9wz',
  service: 'CQDtFDsjfViMT8Sgfe3TbeiAFaDgZfzGsiLsQCqa4tpE',
  secondKeyFor: '9g4dYJmEszBwLq4itZhnatz9BPWCkcFT4ni5CkNMDHAy',
} as const;

/** Cluster time of the mocked Clock sysvar: 2 October 2026 12:00 UTC, epoch 850. */
const NOW = 1_790_942_400n;
const EPOCH = 850n;
const DAY = 86_400n;
const SOL = 1_000_000_000n;
const ZERO = '11111111111111111111111111111111';
const U64_MAX = '18446744073709551615';

type Mock = { lamports: bigint; staker?: string; withdrawer?: string; lockEnd?: bigint; custodian?: string; delegated?: boolean };

function stakeJson(address: string, mock: Mock) {
  const withdrawer = mock.withdrawer ?? MAIN;
  return {
    address,
    lamports: mock.lamports.toString(),
    kind: mock.delegated === false ? 'initialized' : 'delegated',
    rentExemptReserve: '1666240',
    staker: mock.staker ?? withdrawer,
    withdrawer,
    lockup: { unixTimestamp: (mock.lockEnd ?? 0n).toString(), epoch: '0', custodian: mock.custodian ?? ZERO },
    delegation:
      mock.delegated === false
        ? null
        : { voter: VOTE, stake: (mock.lamports - 1_666_240n).toString(), activationEpoch: '700', deactivationEpoch: U64_MAX },
  };
}

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

/** The Clock sysvar as getAccountInfo returns it: slot, epoch start, epoch, leader schedule epoch, unix time. */
function clockData(): string {
  const data = Buffer.alloc(40);
  data.writeBigUInt64LE(EPOCH * 432_000n + 1_000n, 0);
  data.writeBigInt64LE(NOW - 3_600n, 8);
  data.writeBigUInt64LE(EPOCH, 16);
  data.writeBigUInt64LE(EPOCH + 1n, 24);
  data.writeBigInt64LE(NOW, 32);
  return data.toString('base64');
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/** The worker's API for one main key; `requests` records the stake account searches. */
async function mockApi(page: Page, requests: string[] = []) {
  await page.route('**/api/stake-accounts?*', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.search);
    const accounts = url.searchParams.get('withdrawer') === MAIN ? BY_MAIN_KEY : url.searchParams.get('custodian') === MAIN ? BY_SECOND_KEY : [];
    await json(route, { slot: '367201000', accounts });
  });
  await page.route('**/api/rpc', async (route) => {
    const request = route.request().postDataJSON() as { id: number; method: string; params: unknown[] };
    if (request.method !== 'getAccountInfo' || request.params[0] !== 'SysvarC1ock11111111111111111111111111111111') {
      await json(route, { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not mocked' } }, 400);
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
    await json(route, { ok: true, lastMonitorRunAt: new Date(Date.now() - 2 * 60_000).toISOString() });
  });
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
  await mockApi(page, requests);
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
  await mockApi(page);
  // This device knows the second key and saw STAKE.ended protected (F6).
  await page.addInitScript(
    ({ second, ended }) => {
      localStorage.setItem('stakeward:second-keys:v1', JSON.stringify([second]));
      localStorage.setItem('stakeward:protected-accounts:v1', JSON.stringify([ended]));
    },
    { second: SECOND, ended: STAKE.ended },
  );
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
