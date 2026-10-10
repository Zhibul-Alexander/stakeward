// The bot check (SECURITY-CHECK П17): whoever holds the bot token can point the webhook at their own server and
// answer users with phishing "Open Rescue" links while sendMessage keeps working for us. Every pass asks Telegram for
// the webhook (getWebhookInfo): a check at a known hour only would be dodged by putting our URL back around it. Once a
// day from 06:00 UTC it also asks for the bot (getMe). Either one not this deployment's is an admin alert, at most one
// an hour.
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
const ELSEWHERE = "Stakeward devnet monitor: Telegram sends this bot's updates to another address than SITE_ORIGIN/api/telegram/webhook.";
const REFUSED =
  'Stakeward devnet monitor: this worker refused Telegram\'s updates with 401 in the last 10 minutes: Telegram does ' +
  'not send TELEGRAM_WEBHOOK_SECRET with them.';
const OURS = 'https://stakeward.test/api/telegram/webhook';
const THIEF = 'https://thief.example/api/telegram/webhook';

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
const unixAt = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe('the bot check', () => {
  it('every pass asks for the webhook; the bot (getMe) once a day from 06:00 UTC; all match: no alert', async () => {
    const h = await watched();
    h.at('2026-10-05T05:58:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'ok', botCheck: 'ok' });
    expect(methods(h)).toEqual(['getWebhookInfo']);

    h.at('2026-10-05T06:00:00Z');
    const report = await h.pass();
    expect(report).toMatchObject({ outcome: 'ok', botCheck: 'ok' });
    // One getMultipleAccounts, the day's validator check (one more), the two Bot API calls and the day's search of
    // (MAIN, SECOND).
    expect(report).toMatchObject({ chunks: 1, rescans: 1, validators: 1, fetches: 5 });
    expect(methods(h)).toEqual(['getWebhookInfo', 'getWebhookInfo', 'getMe']);
    expect(h.telegram.identityCalls.every((call) => call.token === env.TELEGRAM_BOT_TOKEN)).toBe(true);
    expect((await h.readMeta()).bot_check_day).toBe('2026-10-05');

    h.at('2026-10-05T06:02:00Z');
    expect(await h.pass()).toMatchObject({ botCheck: 'ok', fetches: 2 });
    h.at('2026-10-05T23:58:00Z');
    expect(await h.pass()).toMatchObject({ botCheck: 'ok' });
    h.at('2026-10-06T06:00:00Z');
    expect(await h.pass()).toMatchObject({ botCheck: 'ok' });
    expect(methods(h)).toEqual([
      'getWebhookInfo',
      'getWebhookInfo',
      'getMe',
      'getWebhookInfo',
      'getWebhookInfo',
      'getWebhookInfo',
      'getMe',
    ]);
    expect(h.adminMessages()).toEqual([]);
  });

  it('a webhook moved away and back around the daily hour is still caught: every pass checks it', async () => {
    const h = await watched();
    // The thief puts our URL back just before 06:00 and takes the webhook again right after the first pass.
    h.telegram.identity = { ...h.telegram.identity, webhookUrl: THIEF };
    h.at('2026-10-05T05:56:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'ok', botCheck: 'mismatch' });
    expect(h.adminMessages()).toEqual([`${ELSEWHERE} ${ADVICE}`]);

    h.telegram.identity = { ...h.telegram.identity, webhookUrl: OURS };
    h.at('2026-10-05T06:00:00Z');
    expect(await h.pass()).toMatchObject({ botCheck: 'ok' });

    h.telegram.identity = { ...h.telegram.identity, webhookUrl: THIEF };
    h.at('2026-10-05T06:02:00Z');
    expect(await h.pass()).toMatchObject({ botCheck: 'mismatch' });
    // At most one alert of a kind an hour; the next one as soon as the hour is over.
    expect(h.adminMessages()).toHaveLength(1);
    h.at('2026-10-05T06:56:00Z');
    expect(await h.pass()).toMatchObject({ botCheck: 'mismatch' });
    expect(h.adminMessages()).toHaveLength(2);
    expect(JSON.stringify(h.logs)).not.toContain('thief.example');
  });

  it('our URL set back without our secret: Telegram reports 401 from the webhook, an alert while it is recent', async () => {
    const h = await watched();
    h.at('2026-10-05T03:00:00Z');
    h.telegram.identity = {
      ...h.telegram.identity,
      lastError: { date: unixAt('2026-10-05T02:58:30Z'), message: 'Wrong response from the webhook: 401 Unauthorized' },
    };
    expect(await h.pass()).toMatchObject({ outcome: 'ok', botCheck: 'mismatch' });
    expect(h.adminMessages()).toEqual([`${REFUSED} ${ADVICE}`]);

    // Ten minutes after the last refused update it no longer counts.
    h.at('2026-10-05T03:08:31Z');
    expect(await h.pass()).toMatchObject({ botCheck: 'ok' });
    expect(h.adminMessages()).toHaveLength(1);
  });

  it('other delivery errors are not a sign of a stolen token: no alert', async () => {
    const h = await watched();
    h.at('2026-10-05T03:00:00Z');
    for (const message of ['Wrong response from the webhook: 500 Internal Server Error', 'Connection timed out', 'Read timeout expired']) {
      h.telegram.identity = { ...h.telegram.identity, lastError: { date: unixAt('2026-10-05T02:59:00Z'), message } };
      expect(await h.pass()).toMatchObject({ botCheck: 'ok' });
      h.advance(120_000);
    }
    expect(h.adminMessages()).toEqual([]);
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

  it('a username alert that did not go out: the next pass asks for the bot again; the day is recorded once it went out', async () => {
    const h = await watched();
    h.telegram.identity = { ...h.telegram.identity, username: 'thief_bot' };
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
    expect(await h.pass()).toMatchObject({ botCheck: 'ok' });
    expect(methods(h)).toEqual(['getWebhookInfo', 'getMe', 'getWebhookInfo', 'getMe', 'getWebhookInfo']);
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

  it('a token Telegram refuses: the pass fails like a refused sendMessage, at any hour; the marker stays old', async () => {
    const h = await watched();
    h.telegram.identity = { ...h.telegram.identity, reply: 401 };
    for (const at of ['2026-10-05T03:00:00Z', '2026-10-05T06:00:00Z']) {
      h.at(at);
      expect(await h.pass()).toMatchObject({ outcome: 'telegram-config', botCheck: 'config' });
    }
    expect((await h.readMeta()).last_pass_at).toBeUndefined();
    expect(h.logs).toContainEqual({ level: 'error', msg: 'telegram rejected the bot token or the site origin is invalid' });
  });

  it('the pass log has the outcome only: no token, no URL, no username, no error message', async () => {
    const h = await watched();
    h.telegram.identity = {
      webhookUrl: 'https://thief.example/hook',
      username: 'thief_bot',
      reply: 200,
      lastError: { date: unixAt('2026-10-05T05:59:00Z'), message: 'Wrong response from the webhook: 401 Unauthorized' },
    };
    h.at('2026-10-05T06:00:00Z');
    await h.pass();
    const logged = JSON.stringify(h.logs);
    for (const secret of [env.TELEGRAM_BOT_TOKEN, 'thief.example', 'thief_bot', 'api.telegram.org', 'Wrong response']) {
      expect(logged).not.toContain(secret);
    }
    expect(logged).toContain('"botCheck":"mismatch"');
  });
});
