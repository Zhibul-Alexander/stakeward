import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from './app.ts';

/**
 * Rate limiting with the Workers rate limiting binding (wrangler.jsonc `ratelimits`; limits are documented there).
 * The binding is a best-effort, per-location counter: if it fails, the request goes through rather than the site
 * going down with it.
 */

export type RateLimitBinding = 'RPC_RATE_LIMIT' | 'LOOKUP_RATE_LIMIT' | 'WATCH_RATE_LIMIT' | 'TELEGRAM_RATE_LIMIT';

/** True while `key` is under the binding's limit, or when the limiter fails (fail-open). The key is never logged. */
export async function allowRequest(
  env: Pick<Env, RateLimitBinding>,
  binding: RateLimitBinding,
  key: string,
): Promise<boolean> {
  try {
    return (await env[binding].limit({ key })).success;
  } catch (error) {
    const name = error instanceof Error ? error.name : 'unknown';
    console.warn(JSON.stringify({ msg: 'rate limiter failed', binding, error: name }));
    return true;
  }
}

/**
 * Per-IP limit for an API route. The key is CF-Connecting-IP, which Cloudflare sets on every request and clients
 * cannot override.
 */
export function rateLimit(
  binding: RateLimitBinding,
  periodSeconds: number,
  onLimited: (c: Context<AppEnv>) => Response,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const key = c.req.header('CF-Connecting-IP') ?? 'unknown';
    if (await allowRequest(c.env, binding, key)) {
      await next();
      return;
    }
    const response = onLimited(c);
    response.headers.set('Retry-After', String(periodSeconds));
    return response;
  };
}
