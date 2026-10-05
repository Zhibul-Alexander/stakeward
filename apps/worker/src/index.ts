import { createApp } from './app.ts';
import { monitorDepsFromEnv, runMonitorPass } from './monitor/pass.ts';

export const app = createApp();

export default {
  fetch: app.fetch,
  // The monitor pass, every 2 minutes (wrangler.jsonc triggers).
  async scheduled(controller, env) {
    // The next cron in 2 minutes is the retry: a runtime retry could overlap a pass and send its messages twice.
    controller.noRetry();
    // Rethrows after its own cleanup: the invocation is recorded as failed.
    await runMonitorPass(monitorDepsFromEnv(env));
  },
} satisfies ExportedHandler<Env>;
