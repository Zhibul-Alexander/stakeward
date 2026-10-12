import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { mockApi, SMOKE_FIXTURE } from './mock-api.ts';

/**
 * The theme menu in the header (D151) on the built site under the real CSP: the system theme by default, a chosen theme
 * whatever the system says, kept after a reload, and paper light whatever was chosen.
 */

/** The page background (tokens.css --color-background) in each theme. */
const LIGHT = 'rgb(240, 238, 234)';
const DARK = 'rgb(24, 22, 20)';

const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

async function choose(page: Page, current: string, option: string) {
  const header = page.getByRole('banner');
  await header.getByRole('button', { name: `Theme: ${current}` }).click();
  await header.getByRole('list', { name: 'Theme' }).getByRole('button', { name: option, exact: true }).click();
  await expect(header.getByRole('button', { name: `Theme: ${option}` })).toBeVisible();
}

test('the header switches the theme: system by default, then light or dark whatever the system says, kept after a reload', async ({
  page,
  expectNoA11yViolations,
}) => {
  await mockApi(page, SMOKE_FIXTURE);
  await page.emulateMedia({ media: 'screen', colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.getByRole('banner').getByRole('button', { name: 'Theme: System' })).toBeVisible();
  expect(await background(page)).toBe(DARK);

  // Light on a dark system, also after a reload.
  await choose(page, 'System', 'Light');
  expect(await background(page)).toBe(LIGHT);
  await page.reload();
  await expect(page.getByRole('banner').getByRole('button', { name: 'Theme: Light' })).toBeVisible();
  expect(await background(page)).toBe(LIGHT);
  await expectNoA11yViolations();

  // Dark on a light system; paper stays light (the recovery card is printed dark on white).
  await page.emulateMedia({ media: 'screen', colorScheme: 'light' });
  await choose(page, 'Light', 'Dark');
  expect(await background(page)).toBe(DARK);
  await expectNoA11yViolations();
  await page.emulateMedia({ media: 'print', colorScheme: 'light' });
  expect(await background(page)).toBe(LIGHT);
  await page.emulateMedia({ media: 'screen', colorScheme: 'light' });

  // Back to the system theme: it follows the system again.
  await choose(page, 'Dark', 'System');
  expect(await background(page)).toBe(LIGHT);
  await page.emulateMedia({ media: 'screen', colorScheme: 'dark' });
  expect(await background(page)).toBe(DARK);
});
