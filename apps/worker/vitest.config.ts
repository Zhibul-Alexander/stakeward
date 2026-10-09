import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';
import { unstable_readConfig } from 'wrangler';

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
      // The worker's own sources for the review tests that read code (test/sql-literals.review.test.ts).
      const srcDir = path.join(import.meta.dirname, 'src');
      const srcFiles = (await readdir(srcDir, { recursive: true })).filter((file) => file.endsWith('.ts')).sort();
      const sources: Record<string, string> = Object.fromEntries(
        await Promise.all(
          srcFiles.map(async (file): Promise<[string, string]> => [
            file.split(path.sep).join('/'),
            await readFile(path.join(srcDir, file), 'utf8'),
          ]),
        ),
      );
      // `observability` of each environment as wrangler resolves it (test/observability.review.test.ts). The return
      // type of readConfig lives in a package wrangler does not ship types for: only this one field is read.
      const readConfig = unstable_readConfig as unknown as (args: { config: string; env: string }) => {
        observability?: unknown;
      };
      const configPath = path.join(import.meta.dirname, 'wrangler.jsonc');
      const observability = Object.fromEntries(
        (['dev', 'prod'] as const).map((name) => [name, readConfig({ config: configPath, env: name }).observability]),
      );
      return {
        wrangler: { configPath: './wrangler.jsonc', environment: 'dev' },
        miniflare: {
          // RPC_URL and the Telegram values are placeholders: tests intercept fetch, nothing leaves the test runtime.
          bindings: {
            TEST_MIGRATIONS: migrations,
            TEST_STATIC_HEADERS_FILE: staticHeaders,
            TEST_WORKER_SOURCES: sources,
            TEST_OBSERVABILITY: JSON.stringify(observability),
            RPC_URL: 'https://primary.rpc.test/?api-key=test-primary-key',
            TELEGRAM_BOT_TOKEN: '123456789:test-token',
            TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret',
            ADMIN_CHAT_ID: '700000001',
            TELEGRAM_BOT_USERNAME: 'stakeward_test_bot',
            SITE_ORIGIN: 'https://stakeward.test',
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
