import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
      const staticHeaders = await readFile(path.join(import.meta.dirname, '../web/public/_headers'), 'utf8');
      return {
        wrangler: { configPath: './wrangler.jsonc', environment: 'dev' },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, TEST_STATIC_HEADERS_FILE: staticHeaders },
        },
      };
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/apply-migrations.ts'],
  },
});
