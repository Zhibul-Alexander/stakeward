import { defineConfig, devices } from '@playwright/test';

const CI = Boolean(process.env['CI']);
/** Port of `vite preview`. Another checkout's preview on the same port would be reused locally: give each its own. */
const PORT = Number(process.env['E2E_PORT'] ?? '4173');

/**
 * Browser tests on the built site (CLAUDE.md section 13, layer 4). `pnpm e2e` builds for devnet first; `vite preview`
 * serves dist/ with the headers of public/_headers, so the production CSP is enforced. Two widths: 1280 and 360.
 * Local sandbox without system libraries: see scripts/playwright-local-libs.sh.
 */
export default defineConfig({
  testDir: './e2e',
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 740 } } },
  ],
  webServer: {
    command: `pnpm exec vite preview --port ${String(PORT)} --strictPort`,
    url: `http://localhost:${String(PORT)}`,
    reuseExistingServer: !CI,
    timeout: 30_000,
  },
});
