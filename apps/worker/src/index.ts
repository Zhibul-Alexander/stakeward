import { Hono } from 'hono';
import { securityHeaders } from './security-headers.ts';

type AppEnv = { Bindings: Env };

export const app = new Hono<AppEnv>().basePath('/api');

app.use(securityHeaders());

// Real semantics (last successful monitor pass, HTTP 503 when older than 10 minutes) arrive with the monitor in step 5.
app.get('/health', (c) => c.json({ ok: true, lastMonitorRunAt: null }));

app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
