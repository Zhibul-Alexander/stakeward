import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const CLUSTERS = ['devnet', 'mainnet'] as const;
type Cluster = (typeof CLUSTERS)[number];

/**
 * The cluster is fixed at build time (VITE_CLUSTER). `vite build` must be told which one (scripts build:devnet,
 * build:mainnet), so a production bundle never falls back to devnet by accident; the dev server, preview and tests
 * default to devnet.
 */
function clusterFor(command: 'build' | 'serve'): Cluster {
  const value = process.env['VITE_CLUSTER'];
  if (value === undefined || value === '') {
    if (command === 'serve') return 'devnet';
    throw new Error('Set VITE_CLUSTER=devnet or VITE_CLUSTER=mainnet for `vite build` (pnpm build:devnet / build:mainnet).');
  }
  if (!(CLUSTERS as readonly string[]).includes(value)) {
    throw new Error(`VITE_CLUSTER must be devnet or mainnet, got "${value}".`);
  }
  return value as Cluster;
}

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  // `@/` alias comes from tsconfig `paths` (TypeScript 6 rejects `baseUrl`).
  resolve: { tsconfigPaths: true },
  define: { 'import.meta.env.VITE_CLUSTER': JSON.stringify(clusterFor(command)) },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
}));
