import { defineConfig, devices } from '@playwright/test';

const CI = Boolean(process.env['CI']);
const MAINNET = process.env['E2E_CLUSTER'] === 'mainnet';

/**
 * Browser tests on the built site (CLAUDE.md section 13, layer 4). `pnpm e2e` builds for devnet first and runs every
 * spec; `pnpm e2e:mainnet` builds for mainnet (the build prod serves) and runs the smoke loop over every route
 * (E2E_CLUSTER=mainnet). `vite preview` serves dist/ with the headers of public/_headers, so the production CSP is
 * enforced. Two widths: 1280 and 360. Local sandbox without system libraries: see scripts/playwright-local-libs.sh.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: MAINNET ? '**/smoke.spec.ts' : '**/*.spec.ts',
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 740 } } },
  ],
  webServer: {
    command: 'pnpm exec vite preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !CI,
    timeout: 30_000,
  },
});
