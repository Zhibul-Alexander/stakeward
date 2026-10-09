import { describe, expect, it } from 'vitest';
import { ADMIN_KINDS, adminAllowed, adminKindToSend, adminText, parseAdminAlerts, safeErrorName } from '../../src/monitor/admin.ts';

const HOUR = 3_600_000;

describe('admin alerts', () => {
  it('texts name the cluster and counts only', () => {
    expect(adminText('pass-error', 'mainnet', { stage: 'chunks', errorName: 'TypeError' })).toBe(
      'Stakeward mainnet monitor: the pass failed at chunks (TypeError). Health turns red after 10 minutes. See Workers Logs.',
    );
    expect(adminText('rpc-down', 'devnet', { passes: 4 })).toBe(
      'Stakeward devnet monitor: the RPC could not be read for 4 passes in a row. Health turns red after 10 minutes.',
    );
    expect(adminText('rescan-dropped', 'devnet', { kb: 100 })).toBe('Stakeward devnet monitor: a rescan answer over 100 KB was skipped.');
    // The runbook names both secrets and the wrangler environment of the cluster: a webhook set with a new secret
    // token while the worker keeps the old TELEGRAM_WEBHOOK_SECRET refuses every update (401).
    const adviceFor = (env: string) =>
      'If you did not change it, the bot token may be stolen. Revoke it with BotFather and put the new one with ' +
      `wrangler secret put TELEGRAM_BOT_TOKEN --env ${env}. Then put a new webhook secret with wrangler secret put ` +
      `TELEGRAM_WEBHOOK_SECRET --env ${env} and call setWebhook with SITE_ORIGIN/api/telegram/webhook and that same ` +
      'secret as secret_token: while the two differ, the webhook refuses every update.';
    const advice = adviceFor('prod');
    expect(adminText('bot-mismatch', 'mainnet', { bot: ['webhook'] })).toBe(
      `Stakeward mainnet monitor: Telegram sends this bot's updates to another address than SITE_ORIGIN/api/telegram/webhook. ${advice}`,
    );
    expect(adminText('bot-mismatch', 'mainnet', { bot: ['username'] })).toBe(
      `Stakeward mainnet monitor: the bot token belongs to another bot than TELEGRAM_BOT_USERNAME. ${advice}`,
    );
    expect(adminText('bot-mismatch', 'devnet', { bot: ['webhook', 'username'] })).toBe(
      "Stakeward devnet monitor: Telegram sends this bot's updates to another address than " +
        `SITE_ORIGIN/api/telegram/webhook, and the bot token belongs to another bot than TELEGRAM_BOT_USERNAME. ${adviceFor('dev')}`,
    );
    expect(adminText('bot-mismatch', null, { bot: ['webhook'] })).toContain(adviceFor('<env>'));
    // CLUSTER itself broken: the monitor without a cluster name.
    expect(adminText('pass-error', null, { stage: 'config', errorName: 'MonitorConfigError' })).toMatch(
      /^Stakeward monitor: the pass failed at config \(MonitorConfigError\)\./,
    );
    for (const kind of ADMIN_KINDS) expect(adminText(kind, 'devnet', {})).not.toMatch(/https?:|undefined/);
  });

  it('an error name that is not a plain identifier is not passed on', () => {
    expect(safeErrorName('D1_ERROR')).toBe('D1_ERROR');
    expect(safeErrorName('Error: https://rpc.example/?api-key=secret')).toBe('Error');
    expect(safeErrorName('')).toBe('Error');
    expect(safeErrorName(undefined)).toBe('Error');
  });

  it('one per kind per hour', () => {
    const sent = { 'pass-error': 1_000 };
    expect(adminAllowed('pass-error', sent, 1_000 + HOUR - 1)).toBe(false);
    expect(adminAllowed('pass-error', sent, 1_000 + HOUR)).toBe(true);
    expect(adminAllowed('pass-died', sent, 1_001)).toBe(true);
  });

  it('one alert a pass: the first due by priority (pass-error, wrong-cluster, bot-mismatch, pass-died, rpc-down, rescan-dropped)', () => {
    const now = 10 * HOUR;
    expect(ADMIN_KINDS).toEqual(['pass-error', 'wrong-cluster', 'bot-mismatch', 'pass-died', 'rpc-down', 'rescan-dropped']);
    expect(adminKindToSend(new Set(['pass-died', 'bot-mismatch'] as const), {}, now)).toBe('bot-mismatch');
    expect(adminKindToSend(new Set(['rescan-dropped', 'rpc-down', 'pass-died'] as const), {}, now)).toBe('pass-died');
    expect(adminKindToSend(new Set(['rescan-dropped', 'wrong-cluster'] as const), {}, now)).toBe('wrong-cluster');
    // A kind sent within the hour gives way to the next one due.
    expect(adminKindToSend(new Set(['pass-died', 'rpc-down'] as const), { 'pass-died': now - 60_000 }, now)).toBe('rpc-down');
    expect(adminKindToSend(new Set(['pass-died'] as const), { 'pass-died': now - 60_000 }, now)).toBeNull();
    expect(adminKindToSend(new Set(), {}, now)).toBeNull();
  });

  it('meta.admin_alerts: known kinds with integer times; anything else reads as nothing sent', () => {
    expect(parseAdminAlerts('{"pass-error":5,"rpc-down":"6","other":7}')).toEqual({ 'pass-error': 5 });
    for (const text of [undefined, '', 'nope', '[]', 'null', '{"pass-error":1.5}']) expect(parseAdminAlerts(text)).toEqual({});
  });
});
