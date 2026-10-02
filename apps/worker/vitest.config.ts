import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    // Resolve packages the way wrangler's esbuild bundles them for production: export conditions (`workerd` first)
    // decide, the package.json "browser" field does not. The pool adds "browser" to mainFields, which makes Vite swap
    // @solana/kit's workerd (node) build for its browser build, so tests would run code production never runs. The
    // browser build even refuses Web Crypto in workerd (no globalThis.isSecureContext); the node build needs
    // nodejs_compat for Buffer (wrangler.jsonc).
    {
      name: 'stakeward:resolve-like-wrangler',
      configEnvironment(_name, config) {
        if (config.resolve?.mainFields) {
          config.resolve.mainFields = config.resolve.mainFields.filter((field) => field !== 'browser');
        }
      },
    },
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
      const staticHeaders = await readFile(path.join(import.meta.dirname, '../web/public/_headers'), 'utf8');
      return {
        wrangler: { configPath: './wrangler.jsonc', environment: 'dev' },
        miniflare: {
          // RPC_URL is a placeholder: tests intercept fetch, nothing leaves the test runtime.
          bindings: {
            TEST_MIGRATIONS: migrations,
            TEST_STATIC_HEADERS_FILE: staticHeaders,
            RPC_URL: 'https://primary.rpc.test/?api-key=test-primary-key',
          },
        },
      };
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/apply-migrations.ts'],
  },
});
