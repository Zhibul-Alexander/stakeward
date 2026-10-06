import { defineConfig, devices } from '@playwright/test';

const CI = Boolean(process.env['CI']);
const MAINNET = process.env['E2E_CLUSTER'] === 'mainnet';
/**
 * Port of `vite preview`. Locally Playwright reuses a server already listening on it, so two checkouts (parallel
 * worktrees) on one machine would test each other's build: give each its own with E2E_PORT.
 */
const PORT = Number(process.env['E2E_PORT'] ?? '4173');
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65_535) throw new Error('E2E_PORT must be a TCP port number.');
const BASE_URL = `http://localhost:${String(PORT)}`;

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
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 740 } } },
  ],
  webServer: {
    // strictPort comes from vite.config.ts: a taken port fails instead of moving the server elsewhere.
    command: `pnpm exec vite preview --port ${String(PORT)}`,
    url: BASE_URL,
    reuseExistingServer: !CI,
    timeout: 30_000,
  },
});
