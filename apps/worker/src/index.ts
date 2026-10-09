import { createApp } from './app.ts';
import { monitorDepsFromEnv, runMonitorPass } from './monitor/pass.ts';
import { startWarmUp } from './warm-up.ts';

export const app = createApp();

// The hot paths run on synthetic data while the isolate loads, outside every invocation's CPU limit (warm-up.ts).
void startWarmUp();

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
