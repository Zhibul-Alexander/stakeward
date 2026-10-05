import { describe, expect, it } from 'vitest';
import { sendTelegramMessage, siteUrl } from '../../src/telegram/api.ts';
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
