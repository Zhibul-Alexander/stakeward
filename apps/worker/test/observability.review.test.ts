// Review (CLAUDE.md sections 2.7, 8 and 11): the worker keeps public chain data and Telegram chat ids, nothing more.
// Workers Logs store each request URL next to the client IP and country, so the query strings that name a wallet
// (/api/stake-accounts?withdrawer=, /api/accounts?wallet=, /api/telegram/link?wallet=) must be redacted. Traces stay
// off: the URLs of outbound requests carry the Helius API key and the bot token. The config is read as wrangler
// resolves it for each environment (vitest.config.ts), so a named environment cannot quietly override the top level.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

type Observability = {
  enabled?: boolean;
  redact_query_string?: boolean;
  logs?: { enabled?: boolean };
  traces?: { enabled?: boolean };
};

describe('review: Workers observability settings', () => {
  it.each(['dev', 'prod'] as const)('%s: logs on, query strings redacted, traces off', (name) => {
    const resolved = JSON.parse(env.TEST_OBSERVABILITY) as Partial<Record<'dev' | 'prod', Observability>>;
    const observability = resolved[name];
    expect(observability).toBeDefined();
    expect(observability?.enabled).toBe(true);
    expect(observability?.redact_query_string).toBe(true);
    expect(observability?.logs?.enabled).not.toBe(false);
    expect(observability?.traces?.enabled).not.toBe(true);
  });
});
