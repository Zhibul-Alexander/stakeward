import { attemptPost } from '../upstream.ts';

/**
 * Telegram Bot API sendMessage on plain fetch (CLAUDE.md section 8): plain text without markup, link previews off, at
 * most one link button and never a callback button. The URL carries the bot token, so neither it nor the chat id is
 * ever logged; the answer body (and Telegram's error description) is not read at all, only the status.
 */

export type TelegramOutcome = 'sent' | 'blocked' | 'rejected' | 'rate-limited' | 'retry' | 'config';

/**
 * Sends one message and maps the answer:
 * - 2xx -> `sent`;
 * - 403 -> `blocked` (the user blocked the bot or left the chat): the caller removes the chat's links;
 * - 400 -> `rejected` (Telegram will never take this message): skipped, not retried;
 * - 401, 404 -> `config` (the token is wrong or revoked), and a null token -> `config` without a request;
 * - 429 -> `rate-limited`;
 * - anything else, a timeout or a network error -> `retry`.
 */
export async function sendTelegramMessage(opts: {
  token: string | null;
  chatId: string;
  text: string;
  button?: { label: string; url: string };
  fetch: typeof fetch;
  timeoutMs: number;
}): Promise<TelegramOutcome> {
  if (opts.token === null) return 'config';
  const body = {
    chat_id: opts.chatId,
    text: opts.text,
    link_preview_options: { is_disabled: true },
    ...(opts.button === undefined
      ? {}
      : { reply_markup: { inline_keyboard: [[{ text: opts.button.label, url: opts.button.url }]] } }),
  };
  const result = await attemptPost(`https://api.telegram.org/bot${opts.token}/sendMessage`, JSON.stringify(body), {
    timeoutMs: opts.timeoutMs,
    fetch: opts.fetch,
  });
  if (typeof result === 'string') return 'retry';
  const { status } = result;
  if (status >= 200 && status < 300) return 'sent';
  switch (status) {
    case 403:
      return 'blocked';
    case 400:
      return 'rejected';
    case 401:
    case 404:
      return 'config';
    case 429:
      return 'rate-limited';
    default:
      return 'retry';
  }
}

/**
 * The absolute URL of a site path for an alert button: alerts link only to Stakeward's own origin (CLAUDE.md
 * section 11). Throws unless `path` starts with a single '/' and stays on `origin`.
 */
export function siteUrl(origin: string, path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('siteUrl: not a site path');
  const url = new URL(path, origin);
  if (url.origin !== origin) throw new Error('siteUrl: the path leaves the site');
  return url.toString();
}
