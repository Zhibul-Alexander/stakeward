import { test } from '@playwright/test';
import { DAY, MAIN, mockApi, NOW, SECOND, SMOKE_STAKE, SOL, stakeJson } from '../../e2e/mock-api.ts';

const VARIANT = (process.env['VITE_UI_VARIANT'] || 'base') + (process.env['SHOOT_SCHEME'] === 'dark' ? '-dark' : '');
const UNPROTECTED = '5Rz9Wg3mAxJ6QeV9WbHk7K1q3sN2x8Ytq6WvGx2fVt9H';
const EXPIRING = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const FIXTURE = {
  accounts: [
    stakeJson(SMOKE_STAKE, { lamports: 1_250n * SOL + 500_000_000n, lockEnd: NOW + 190n * DAY, custodian: SECOND, delegated: false }),
    stakeJson(UNPROTECTED, { lamports: 320n * SOL }),
    stakeJson(EXPIRING, { lamports: 48n * SOL, lockEnd: NOW + 12n * DAY, custodian: SECOND }),
  ],
  balances: { [MAIN]: SOL, [SECOND]: SOL / 100n },
};

const ROUTES: [string, string][] = [
  ['landing', '/'],
  ['app', `/app?address=${MAIN}`],
  ['app-empty', `/app?address=${SECOND}1`],
  ['app-nowallet', '/app'],
  ['protect', `/protect?address=${MAIN}`],
  ['withdraw', `/withdraw/${SMOKE_STAKE}`],
  ['extend', `/extend/${SMOKE_STAKE}`],
  ['rescue', '/rescue'],
  ['cosign', '/cosign'],
  ['learn', '/learn'],
  ['recovery', `/recovery/${SMOKE_STAKE}`],
  ['stats', '/stats'],
  ['check', '/check'],
];

for (const [name, path] of ROUTES) {
  test(name, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await mockApi(page, FIXTURE);
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${new URL('../../variants-shots/', import.meta.url).pathname}${VARIANT}/${name}-${info.project.name}.png`, fullPage: true });
    if (errors.length > 0) console.log(`[${VARIANT}] ${name} ${info.project.name} console errors:\n  ${errors.join('\n  ')}`);
  });
}
