import { readStaticHeaders } from '../static-headers.ts';
import { expect, test } from './fixtures.ts';

const STATIC_HEADERS = readStaticHeaders();

for (const path of ['/', '/app']) {
  test(`${path} renders under the production headers, without console errors or axe violations`, async ({
    page,
    expectNoA11yViolations,
  }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    const headers = response?.headers() ?? {};
    for (const [name, value] of Object.entries(STATIC_HEADERS)) {
      expect(headers[name.toLowerCase()], name).toBe(value);
    }

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Stakeward home' })).toBeVisible();
    const footer = page.getByRole('contentinfo');
    await expect(footer.getByRole('link', { name: 'Source code' })).toHaveAttribute(
      'href',
      'https://github.com/Zhibul-Alexander/stakeward',
    );
    await expect(footer.getByRole('link', { name: 'What Stakeward cannot do' })).toHaveAttribute('href', '/#cannot-do');
    await expect(footer.getByText('No warranty. MIT license.')).toBeVisible();

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
  });
}
