import AxeBuilder from '@axe-core/playwright';
import { test as base, expect, type Page } from '@playwright/test';

/** WCAG 2.1 A and AA (CLAUDE.md section 9, UX rule 11). */
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

type Fixtures = {
  /** Console errors and uncaught page errors seen so far; the test fails at the end if any were recorded. */
  consoleErrors: string[];
  /** Runs axe on the current page (optionally one part of it) and fails on any violation. */
  expectNoA11yViolations: (options?: { include?: string }) => Promise<void>;
};

/**
 * Shared test: every test fails on a console error or a page error, which includes CSP violations ("Refused to
 * apply inline style ..."). Import `test` and `expect` from here, not from @playwright/test.
 */
export const test = base.extend<Fixtures>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(`console: ${message.text()}`);
      });
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
      await use(errors);
      expect(errors, 'console errors and page errors').toEqual([]);
    },
    { auto: true },
  ],
  expectNoA11yViolations: async ({ page }, use) => {
    await use(async (options) => {
      await expectNoA11yViolations(page, options);
    });
  },
});

export async function expectNoA11yViolations(page: Page, options: { include?: string } = {}): Promise<void> {
  await settleMotion(page);
  let builder = new AxeBuilder({ page }).withTags(AXE_TAGS);
  if (options.include !== undefined) builder = builder.include(options.include);
  const { violations } = await builder.analyze();
  const summary = violations.map((v) => `${v.id} (${v.impact ?? 'n/a'}): ${v.help} -> ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(summary, 'axe violations').toEqual([]);
}

/**
 * Waits for every finite CSS transition and animation to end. Buttons fade their colours over 150 ms
 * (`transition-colors`), so right after emulateMedia switches the theme axe could measure a half-way colour pair
 * (2.24:1 seen) and fail at random on a slow machine: 10 of 15 runs at 360 px without this wait, 0 of 15 with it.
 * Infinite animations (spinners) are left alone. getAnimations() flushes styles first, so it sees transitions the
 * theme switch has just started.
 */
async function settleMotion(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity);
    // A cancelled or replaced transition rejects `finished`; the colour it was heading to is settled either way.
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
  });
}

export { expect };
