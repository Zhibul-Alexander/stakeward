import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { securityHeaders } from './security-headers.ts';
import { rateLimit } from './rate-limit.ts';
import { JSON_RPC_ERRORS, jsonRpcError, MAX_RPC_BODY_BYTES, rpcHandler } from './rpc.ts';
import { stakeAccountsHandler } from './stake-accounts.ts';
import { DEFAULT_UPSTREAM_OPTIONS, type UpstreamOptions } from './upstream.ts';
import { MAX_WATCH_BODY_BYTES, watchHandler } from './watch.ts';

export type AppEnv = { Bindings: Env };

/** Rate limit periods; the limits themselves live with the bindings in wrangler.jsonc. */
const RPC_RATE_LIMIT_PERIOD_SECONDS = 10;
const LOOKUP_RATE_LIMIT_PERIOD_SECONDS = 60;
const WATCH_RATE_LIMIT_PERIOD_SECONDS = 60;

export type AppOptions = { upstream?: Partial<UpstreamOptions> };

/** The API under /api. Tests build it with a fake upstream fetch and short timeouts. */
export function createApp(options: AppOptions = {}) {
  const upstream: UpstreamOptions = { ...DEFAULT_UPSTREAM_OPTIONS, ...options.upstream };
  const app = new Hono<AppEnv>().basePath('/api');

  app.use(securityHeaders());

  // Real semantics (last successful monitor pass, HTTP 503 when older than 10 minutes) arrive with the monitor in step 5.
  // `now` is the worker's clock: the site measures the age with it, not with the visitor's device clock.
  app.get('/health', (c) => c.json({ ok: true, lastMonitorRunAt: null, now: new Date().toISOString() }));

  app.get(
    '/stake-accounts',
    rateLimit('LOOKUP_RATE_LIMIT', LOOKUP_RATE_LIMIT_PERIOD_SECONDS, (c) =>
      c.json({ error: 'rate-limited', message: 'Too many requests, try again in a minute' }, 429),
    ),
    stakeAccountsHandler(upstream),
  );

  app.post(
    '/rpc',
    rateLimit('RPC_RATE_LIMIT', RPC_RATE_LIMIT_PERIOD_SECONDS, (c) =>
      jsonRpcError(c, 429, null, JSON_RPC_ERRORS.rateLimited, 'Too many requests'),
    ),
    bodyLimit({
      maxSize: MAX_RPC_BODY_BYTES,
      onError: (c) => jsonRpcError(c, 413, null, JSON_RPC_ERRORS.invalidRequest, 'Request body too large'),
    }),
    rpcHandler(upstream),
  );

  app.post(
    '/watch',
    rateLimit('WATCH_RATE_LIMIT', WATCH_RATE_LIMIT_PERIOD_SECONDS, (c) =>
      c.json({ error: 'rate-limited', message: 'Too many requests, try again in a minute' }, 429),
    ),
    bodyLimit({
      maxSize: MAX_WATCH_BODY_BYTES,
      onError: (c) => c.json({ error: 'too-large', message: 'Request body too large' }, 413),
    }),
    watchHandler(upstream),
  );

  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  app.onError((error, c) => {
    console.error(JSON.stringify({ msg: 'unhandled error', path: c.req.path, error: error.name }));
    return c.json({ error: 'Internal error' }, 500);
  });

  return app;
}
