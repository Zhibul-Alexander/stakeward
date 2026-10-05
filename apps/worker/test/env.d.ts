import type { D1Migration } from 'cloudflare:test';

declare global {
  namespace Cloudflare {
    interface Env {
      /** Read from ./migrations on the Node side (vitest.config.ts). */
      TEST_MIGRATIONS: D1Migration[];
      /** Contents of apps/web/public/_headers, read on the Node side (vitest.config.ts). */
      TEST_STATIC_HEADERS_FILE: string;
      /** Every .ts file under src/, path relative to src/ -> contents, read on the Node side (vitest.config.ts). */
      TEST_WORKER_SOURCES: Record<string, string>;
    }
  }
}
