import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from './app.ts';

/**
 * Per-IP rate limiting with the Workers rate limiting binding (wrangler.jsonc `ratelimits`; limits are documented
 * there). The key is CF-Connecting-IP, which Cloudflare sets on every request and clients cannot override.
 * The binding is a best-effort, per-location counter: if it fails, the request goes through rather than the site
 * going down with it.
 */
export function rateLimit(
  binding: 'RPC_RATE_LIMIT' | 'LOOKUP_RATE_LIMIT',
  periodSeconds: number,
  onLimited: (c: Context<AppEnv>) => Response,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const key = c.req.header('CF-Connecting-IP') ?? 'unknown';
    let allowed = true;
    try {
      allowed = (await c.env[binding].limit({ key })).success;
    } catch (error) {
      const name = error instanceof Error ? error.name : 'unknown';
      console.warn(JSON.stringify({ msg: 'rate limiter failed', binding, error: name }));
    }
    if (allowed) {
      await next();
      return;
    }
    const response = onLimited(c);
    response.headers.set('Retry-After', String(periodSeconds));
    return response;
  };
}
