import { describe, expect, it, vi } from 'vitest';
import { getBotIdentity, sendTelegramMessage, siteUrl } from '../../src/telegram/api.ts';
import { FakeTelegram, type TelegramReply } from '../monitor/fake-telegram.ts';

const TOKEN = '123456789:test-token';

function client(telegram: FakeTelegram) {
  const calls: string[] = [];
  const fetchFn: typeof fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.href);
    return telegram.handle(url, typeof init?.body === 'string' ? init.body : '', init?.signal);
  };
  return { fetch: fetchFn, calls };
}

describe('sendTelegramMessage', () => {
  it('posts plain text with previews off and one link button', async () => {
    const telegram = new FakeTelegram();
    const { fetch, calls } = client(telegram);
    const button = { label: 'Open Rescue', url: 'https://stakeward.test/rescue' };
    expect(await sendTelegramMessage({ token: TOKEN, chatId: '-100500', text: 'Hi', button, fetch, timeoutMs: 50 })).toBe('sent');
    expect(calls).toEqual([`https://api.telegram.org/bot${TOKEN}/sendMessage`]);
    expect(telegram.requests).toEqual([
      { token: TOKEN, method: 'sendMessage', chatId: '-100500', text: 'Hi', button, linkPreviewDisabled: true, reply: 200 },
    ]);
    await sendTelegramMessage({ token: TOKEN, chatId: '42', text: 'No button', fetch, timeoutMs: 50 });
    expect(telegram.requests[1]?.button).toBeNull();
  });

  it('maps the answer: 403 blocked, 400 rejected, 401/404 config, 429 rate-limited, the rest retry', async () => {
    const cases: [TelegramReply, string][] = [
      [403, 'blocked'],
      [400, 'rejected'],
      [401, 'config'],
      [404, 'config'],
      [429, 'rate-limited'],
      [500, 'retry'],
      ['network-error', 'retry'],
      ['hang', 'retry'],
    ];
    for (const [reply, outcome] of cases) {
      const telegram = new FakeTelegram();
      telegram.replyNext(reply);
      const { fetch } = client(telegram);
      expect(await sendTelegramMessage({ token: TOKEN, chatId: '42', text: 'x', fetch, timeoutMs: 50 })).toBe(outcome);
    }
  });

  it('no token: config without a request', async () => {
    const telegram = new FakeTelegram();
    const { fetch, calls } = client(telegram);
    expect(await sendTelegramMessage({ token: null, chatId: '42', text: 'x', fetch, timeoutMs: 50 })).toBe('config');
    expect(calls).toEqual([]);
  });
});

describe('getBotIdentity', () => {
  it('reads the webhook URL (getWebhookInfo) and the username (getMe)', async () => {
    const telegram = new FakeTelegram();
    telegram.identity = { webhookUrl: 'https://elsewhere.example/hook', username: 'other_bot', reply: 200 };
    const { fetch, calls } = client(telegram);
    expect(await getBotIdentity({ token: TOKEN, fetch, timeoutMs: 50 })).toEqual({
      outcome: 'ok',
      webhookUrl: 'https://elsewhere.example/hook',
      username: 'other_bot',
    });
    expect(calls).toEqual([`https://api.telegram.org/bot${TOKEN}/getWebhookInfo`, `https://api.telegram.org/bot${TOKEN}/getMe`]);
    expect(telegram.requests).toEqual([]);
  });

  it('401/404 config (the second call is not made), the rest retry; no token: config without a request', async () => {
    const cases: [TelegramReply, string, number][] = [
      [401, 'config', 1],
      [404, 'config', 1],
      [429, 'retry', 1],
      [500, 'retry', 1],
      ['network-error', 'retry', 1],
      ['hang', 'retry', 1],
    ];
    for (const [reply, outcome, requests] of cases) {
      const telegram = new FakeTelegram();
      telegram.identity = { ...telegram.identity, reply };
      const { fetch, calls } = client(telegram);
      expect(await getBotIdentity({ token: TOKEN, fetch, timeoutMs: 50 })).toEqual({ outcome });
      expect(calls).toHaveLength(requests);
    }
    const { fetch, calls } = client(new FakeTelegram());
    expect(await getBotIdentity({ token: null, fetch, timeoutMs: 50 })).toEqual({ outcome: 'config' });
    expect(calls).toEqual([]);
  });

  it('an answer that is not a Bot API result: retry', async () => {
    for (const body of ['not json', '{"ok":false}', '{"ok":true,"result":{"url":5}}', '{"ok":true}', '[]']) {
      const fetchFn: typeof fetch = () => Promise.resolve(new Response(body, { status: 200 }));
      expect(await getBotIdentity({ token: TOKEN, fetch: fetchFn, timeoutMs: 50 })).toEqual({ outcome: 'retry' });
    }
  });

  it('logs nothing (the URL carries the token)', async () => {
    const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const spies = methods.map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    for (const reply of [200, 401, 500, 'network-error'] as const) {
      const telegram = new FakeTelegram();
      telegram.identity = { ...telegram.identity, reply };
      await getBotIdentity({ token: TOKEN, fetch: client(telegram).fetch, timeoutMs: 50 });
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe('siteUrl', () => {
  const origin = 'https://stakeward.test';

  it('a site path on the origin', () => {
    expect(siteUrl(origin, '/rescue')).toBe('https://stakeward.test/rescue');
    expect(siteUrl(origin, '/app?address=abc')).toBe('https://stakeward.test/app?address=abc');
  });

  it('refuses anything that could leave the site', () => {
    for (const path of ['rescue', '//evil.test/x', '/\\evil.test/x', 'https://evil.test/', '']) {
      expect(() => siteUrl(origin, path)).toThrow();
    }
  });
});
