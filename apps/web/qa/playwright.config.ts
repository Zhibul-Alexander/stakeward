import { defineConfig, devices } from '@playwright/test';
import { QA } from './support/env.ts';

/**
 * End-to-end QA against a running Stakeward with real transactions (.claude/skills/qa-e2e/SKILL.md). Not part of CI:
 * the suite needs a chain (the local LiteSVM stack, or devnet) and spends devnet SOL on dev.
 *   QA_TARGET=local (default): starts qa/local/stack.ts (LiteSVM RPC + the real worker under wrangler dev).
 *   QA_TARGET=dev: https://stakeward-dev.stakeward.workers.dev and devnet. Never prod.
 * One worker: the scenarios send transactions, and LiteSVM keeps a single valid blockhash.
 */
export default defineConfig({
  testDir: './specs',
  testMatch: '**/*.qa.ts',
  outputDir: '../.cache/qa-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: QA.target === 'local' ? 120_000 : 300_000,
  expect: { timeout: QA.target === 'local' ? 15_000 : 60_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: '../.cache/qa-report/html' }],
    ['json', { outputFile: '../.cache/qa-report/results.json' }],
    ['./support/summary-reporter.ts'],
  ],
  use: {
    baseURL: QA.baseUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: QA.target === 'local' ? 15_000 : 45_000,
    // A preinstalled Chromium instead of Playwright's own download (e.g. /opt/pw-browsers/chromium in cloud sessions).
    ...(QA.chromium === undefined ? {} : { launchOptions: { executablePath: QA.chromium } }),
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    // Pixel 5 (Chromium, touch, mobile user agent) at the narrowest width the site supports (UX rule 10).
    { name: 'mobile', use: { ...devices['Pixel 5'], viewport: { width: 360, height: 740 } } },
  ],
  ...(QA.target === 'local'
    ? {
        webServer: {
          command: `node qa/local/stack.ts${process.env['QA_NO_BUILD'] === '1' ? ' --no-build' : ''}`,
          cwd: '..',
          url: `${QA.baseUrl}/api/health`,
          // /api/health answers 503 until the stack's first monitor pass, then 200.
          reuseExistingServer: true,
          timeout: 240_000,
          stdout: 'pipe',
          stderr: 'pipe',
          gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
        },
      }
    : {}),
});
