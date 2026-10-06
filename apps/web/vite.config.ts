import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { readStaticHeaders } from './static-headers.ts';

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
  // No .env files (SECURITY-CHECK P18): they are gitignored, so the deploy wrapper's clean-tree check cannot see them,
  // and NODE_ENV=development in one would ship development React. The build takes VITE_CLUSTER from the environment.
  envDir: false,
  // Same headers as production (public/_headers), so e2e tests run under the real CSP.
  preview: { port: 4173, strictPort: true, headers: readStaticHeaders() },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
}));
