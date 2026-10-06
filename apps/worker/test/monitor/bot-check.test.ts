// The daily bot check (SECURITY-CHECK П17): whoever holds the bot token can point the webhook at their own server and
// answer users with phishing "Open Rescue" links while sendMessage keeps working for us. Once a day from 06:00 UTC
// the pass asks Telegram for the webhook (getWebhookInfo) and the bot (getMe) and alerts the admin when either is not
// this deployment's.
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { key, LOCK_UNTIL, type StakeAccountSpec } from '../transactions.ts';
import { ADMIN_CHAT, createHarness, type Harness } from './harness.ts';

const MAIN = key(1);
const SECOND = key(2);
const STAKE = key(10);
const SPEC: StakeAccountSpec = { state: 'delegated', staker: MAIN, withdrawer: MAIN, custodian: SECOND, unixTimestamp: LOCK_UNTIL };
const ADVICE =
  'If you did not change it, the bot token may be stolen. Revoke it with BotFather and put the new one with wrangler ' +
  'secret put TELEGRAM_BOT_TOKEN --env dev. Then put a new webhook secret with wrangler secret put ' +
  'TELEGRAM_WEBHOOK_SECRET --env dev and call setWebhook with SITE_ORIGIN/api/telegram/webhook and that same secret ' +
  'as secret_token: while the two differ, the webhook refuses every update.';

afterEach(() => {
  vi.restoreAllMocks();
});

async function watched(): Promise<Harness> {
  const h = createHarness();
  h.at('2026-10-05T01:00:00Z');
  h.chain.putStake(STAKE, SPEC);
  await h.seedWatched([STAKE]);
  return h;
}

const methods = (h: Harness) => h.telegram.identityCalls.map((call) => call.method);

describe('the daily bot check', () => {
  it('once a day from 06:00 UTC: the webhook and the bot match, no alert, two requests', async () => {
    const h = await watched();
    h.at('2026-10-05T05:58:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'ok', botCheck: null });
    expect(methods(h)).toEqual([]);

    h.at('2026-10-05T06:00:00Z');
    const report = await h.pass();
    expect(report).toMatchObject({ outcome: 'ok', botCheck: 'ok' });
    // One getMultipleAccounts, the two Bot API calls and the day's search of (MAIN, SECOND).
    expect(report).toMatchObject({ chunks: 1, rescans: 1, fetches: 4 });
    expect(methods(h)).toEqual(['getWebhookInfo', 'getMe']);
    expect(h.telegram.identityCalls.every((call) => call.token === env.TELEGRAM_BOT_TOKEN)).toBe(true);
    expect((await h.readMeta()).bot_check_day).toBe('2026-10-05');
    expect(h.adminMessages()).toEqual([]);

    h.at('2026-10-05T06:02:00Z');
    expect(await h.pass()).toMatchObject({ botCheck: null });
    h.at('2026-10-05T23:58:00Z');
    expect(await h.pass()).toMatchObject({ botCheck: null });
    h.at('2026-10-06T06:00:00Z');
    expect(await h.pass()).toMatchObject({ botCheck: 'ok' });
    expect(methods(h)).toEqual(['getWebhookInfo', 'getMe', 'getWebhookInfo', 'getMe']);
  });

  it('a webhook on another server: one admin alert without the URL, then again the next day', async () => {
    const h = await watched();
    h.telegram.identity = { ...h.telegram.identity, webhookUrl: 'https://thief.example/api/telegram/webhook' };
    h.at('2026-10-05T06:00:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'ok', botCheck: 'mismatch' });
    expect(h.adminMessages()).toEqual([
      "Stakeward devnet monitor: Telegram sends this bot's updates to another address than " +
        `SITE_ORIGIN/api/telegram/webhook. ${ADVICE}`,
    ]);
    expect((await h.readMeta()).bot_check_day).toBe('2026-10-05');
    expect(JSON.stringify(h.logs)).not.toContain('thief.example');

    h.at('2026-10-05T06:02:00Z');
    expect(await h.pass()).toMatchObject({ botCheck: null });
    h.at('2026-10-06T06:00:00Z');
    expect(await h.pass()).toMatchObject({ botCheck: 'mismatch' });
    expect(h.adminMessages()).toHaveLength(2);
  });

  it('a webhook that was deleted (empty URL) and a token of another bot: one alert names both', async () => {
    const h = await watched();
    h.telegram.identity = { webhookUrl: '', username: 'Some_Other_Bot', reply: 200 };
    h.at('2026-10-05T06:00:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'ok', botCheck: 'mismatch' });
    expect(h.adminMessages()).toEqual([
      "Stakeward devnet monitor: Telegram sends this bot's updates to another address than " +
        'SITE_ORIGIN/api/telegram/webhook, and the bot token belongs to another bot than TELEGRAM_BOT_USERNAME. ' +
        ADVICE,
    ]);
  });

  it('the username is compared without case, like Telegram does', async () => {
    const h = await watched();
    h.telegram.identity = { ...h.telegram.identity, username: 'Stakeward_Test_Bot' };
    h.at('2026-10-05T06:00:00Z');
    expect(await h.pass()).toMatchObject({ botCheck: 'ok' });
    expect(h.adminMessages()).toEqual([]);
  });

  it('an alert that did not go out: the next pass checks and alerts again; the day is recorded once it went out', async () => {
    const h = await watched();
    h.telegram.identity = { ...h.telegram.identity, webhookUrl: 'https://thief.example/hook' };
    h.telegram.replyTo(ADMIN_CHAT, 500);
    h.at('2026-10-05T06:00:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'ok', botCheck: 'mismatch' });
    expect(h.telegram.delivered(ADMIN_CHAT)).toEqual([]);
    expect((await h.readMeta()).bot_check_day).toBeUndefined();

    h.at('2026-10-05T06:02:00Z');
    expect(await h.pass()).toMatchObject({ botCheck: 'mismatch' });
    expect(h.telegram.delivered(ADMIN_CHAT)).toHaveLength(1);
    expect((await h.readMeta()).bot_check_day).toBe('2026-10-05');
    h.at('2026-10-05T06:04:00Z');
    expect(await h.pass()).toMatchObject({ botCheck: null });
  });

  it('Telegram down: no alert, the next pass asks again', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = await watched();
    h.telegram.identity = { ...h.telegram.identity, reply: 500 };
    h.at('2026-10-05T06:00:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'ok', botCheck: 'retry' });
    expect(methods(h)).toEqual(['getWebhookInfo']);
    expect((await h.readMeta()).bot_check_day).toBeUndefined();
    expect(h.adminMessages()).toEqual([]);

    h.telegram.identity = { ...h.telegram.identity, reply: 200 };
    h.at('2026-10-05T06:02:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'ok', botCheck: 'ok' });
    expect((await h.readMeta()).bot_check_day).toBe('2026-10-05');
  });

  it('a token Telegram refuses: the pass fails like a refused sendMessage, the marker stays old', async () => {
    const h = await watched();
    h.telegram.identity = { ...h.telegram.identity, reply: 401 };
    h.at('2026-10-05T06:00:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'telegram-config', botCheck: 'config' });
    expect((await h.readMeta()).last_pass_at).toBeUndefined();
    expect(h.logs).toContainEqual({ level: 'error', msg: 'telegram rejected the bot token or the site origin is invalid' });
  });

  it('the pass log has the outcome only: no token, no URL, no username', async () => {
    const h = await watched();
    h.telegram.identity = { webhookUrl: 'https://thief.example/hook', username: 'thief_bot', reply: 200 };
    h.at('2026-10-05T06:00:00Z');
    await h.pass();
    const logged = JSON.stringify(h.logs);
    for (const secret of [env.TELEGRAM_BOT_TOKEN, 'thief.example', 'thief_bot', 'api.telegram.org']) {
      expect(logged).not.toContain(secret);
    }
    expect(logged).toContain('"botCheck":"mismatch"');
  });
});
