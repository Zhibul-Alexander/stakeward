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
  let builder = new AxeBuilder({ page }).withTags(AXE_TAGS);
  if (options.include !== undefined) builder = builder.include(options.include);
  const { violations } = await builder.analyze();
  const summary = violations.map((v) => `${v.id} (${v.impact ?? 'n/a'}): ${v.help} -> ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(summary, 'axe violations').toEqual([]);
}

export { expect };
