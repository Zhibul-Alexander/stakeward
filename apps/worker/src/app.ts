import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { accountsHandler, healthHandler, noStore, statsHandler } from './public-api.ts';
import { securityHeaders } from './security-headers.ts';
import { rateLimit } from './rate-limit.ts';
import { JSON_RPC_ERRORS, jsonRpcError, MAX_RPC_BODY_BYTES, rpcHandler } from './rpc.ts';
import { stakeAccountsHandler } from './stake-accounts.ts';
import { telegramLinkHandler } from './telegram/link.ts';
import { MAX_TELEGRAM_UPDATE_BYTES, noReply, telegramSecret, telegramWebhookHandler } from './telegram/webhook.ts';
import { DEFAULT_UPSTREAM_OPTIONS, type UpstreamOptions } from './upstream.ts';
import { MAX_WATCH_BODY_BYTES, watchHandler } from './watch.ts';

export type AppEnv = { Bindings: Env };

/** Rate limit periods; the limits themselves live with the bindings in wrangler.jsonc. */
const RPC_RATE_LIMIT_PERIOD_SECONDS = 10;
const LOOKUP_RATE_LIMIT_PERIOD_SECONDS = 60;
const WATCH_RATE_LIMIT_PERIOD_SECONDS = 60;

export type AppOptions = {
  upstream?: Partial<UpstreamOptions>;
  /** The worker clock, unix ms (default Date.now): health, accounts, stats and the webhook. */
  now?: () => number;
};

/** The API under /api. Tests build it with a fake upstream fetch, short timeouts and a test clock. */
export function createApp(options: AppOptions = {}) {
  const upstream: UpstreamOptions = { ...DEFAULT_UPSTREAM_OPTIONS, ...options.upstream };
  const now = options.now ?? (() => Date.now());
  const app = new Hono<AppEnv>().basePath('/api');

  app.use(securityHeaders());

  const lookupLimit = rateLimit('LOOKUP_RATE_LIMIT', LOOKUP_RATE_LIMIT_PERIOD_SECONDS, (c) =>
    c.json({ error: 'rate-limited', message: 'Too many requests, try again in a minute' }, 429),
  );

  // No rate limit: one D1 read, and an external uptime check may poll it.
  app.get('/health', noStore(), healthHandler(now));

  app.get('/stake-accounts', lookupLimit, stakeAccountsHandler(upstream));

  app.get('/accounts', noStore(), lookupLimit, accountsHandler(now));

  app.get('/stats', noStore(), lookupLimit, statsHandler(now));

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

  // The secret first: nothing reads the body or D1 for a request that is not from Telegram. An oversized update is
  // answered 200 {} so that Telegram does not resend it forever.
  app.post(
    '/telegram/webhook',
    telegramSecret(),
    bodyLimit({ maxSize: MAX_TELEGRAM_UPDATE_BYTES, onError: noReply }),
    telegramWebhookHandler(now),
  );

  app.get('/telegram/link', noStore(), telegramLinkHandler());

  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  app.onError((error, c) => {
    console.error(JSON.stringify({ msg: 'unhandled error', path: c.req.path, error: error.name }));
    return c.json({ error: 'Internal error' }, 500);
  });

  return app;
}
