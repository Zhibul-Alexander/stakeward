import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['gate/**/*.test.ts', 'dev-accounts/**/*.test.ts', 'recovery-cli/**/*.test.ts', 'deploy/**/*.test.ts', 'live-demo/**/*.test.ts', 'ledger-sim/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
