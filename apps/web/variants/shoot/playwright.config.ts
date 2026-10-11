import { defineConfig, devices } from '@playwright/test';

/**
 * Screenshots of one UI variant (VITE_UI_VARIANT) on every main route, at 1280 and 360, with the e2e mock API.
 * Build first: `VITE_CLUSTER=devnet VITE_UI_VARIANT=v1 pnpm exec vite build`, then
 * `VITE_CLUSTER=devnet VITE_UI_VARIANT=v1 SHOOT_PORT=4301 pnpm exec playwright test -c variants/shoot/playwright.config.ts`.
 * Pass VITE_UI_VARIANT= (empty) to shoot the current site. PNGs land in variants-shots/<variant>/.
 */
const PORT = Number(process.env['SHOOT_PORT'] ?? '4300');
export default defineConfig({
  testDir: '.',
  testMatch: 'shoot.spec.ts',
  reporter: [['list']],
  workers: 2,
  use: { baseURL: `http://localhost:${String(PORT)}`, colorScheme: process.env['SHOOT_SCHEME'] === 'dark' ? 'dark' : 'light', launchOptions: process.env['SHOOT_CHROMIUM'] ? { executablePath: process.env['SHOOT_CHROMIUM'] } : {} },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 740 } } },
  ],
  webServer: {
    command: `pnpm exec vite preview --port ${String(PORT)}`,
    url: `http://localhost:${String(PORT)}`,
    cwd: new URL('../..', import.meta.url).pathname,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
