import { appendFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

/**
 * Size of a screen for the before/after table of docs/UI-AUDIT.md: page height, words in <main>, and visible filled
 * buttons (primary and danger, links styled as buttons included). Written as one JSON line per screen to the file named
 * by SCREEN_METRICS; without it this does nothing.
 */
export async function recordScreenMetrics(page: Page, name: string): Promise<void> {
  const out = process.env['SCREEN_METRICS'];
  if (out === undefined || out === '') return;
  const metrics = await page.evaluate(() => {
    const main = document.querySelector('main');
    const words = (main?.innerText ?? '').split(/\s+/).filter((word) => /\w/.test(word)).length;
    const filled = [...document.querySelectorAll<HTMLElement>('[data-slot="button"]')].filter(
      (el) => ['primary', 'danger'].includes(el.dataset['variant'] ?? '') && el.offsetParent !== null,
    ).length;
    return { height: document.documentElement.scrollHeight, words, filled };
  });
  appendFileSync(out, `${JSON.stringify({ name, width: page.viewportSize()?.width ?? 0, ...metrics })}\n`);
}
