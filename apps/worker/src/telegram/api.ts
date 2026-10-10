import { attemptPost } from '../upstream.ts';

/**
 * Telegram Bot API sendMessage on plain fetch (CLAUDE.md section 8): plain text without markup, link previews off.
 * Alerts carry one button: a link, or the callback button D118 allows ("Rescue now" of a rescue kit,
 * `rk:<stake account>`, only in the chat bound to the kit). The kit cards of /kits (D120) carry a small keyboard of
 * such callbacks; the webhook checks the chat again before it acts on any. The URL carries the bot token, so neither
 * it nor the chat id is ever logged; the answer body (and Telegram's error description) is not read at all, only the
 * status.
 */

export type TelegramOutcome = 'sent' | 'blocked' | 'rejected' | 'rate-limited' | 'retry' | 'config';

/** One inline keyboard button: a link to the site, or a rescue kit's callback (D118). */
export type TelegramButton = { label: string; url: string } | { label: string; callbackData: string };

/** The Bot API inline keyboard of one button, or of rows of buttons. */
export function inlineKeyboard(buttons: TelegramButton | readonly (readonly TelegramButton[])[]): {
  inline_keyboard: Record<string, string>[][];
} {
  const rows: readonly (readonly TelegramButton[])[] = 'label' in buttons ? [[buttons]] : buttons;
  const key = (button: TelegramButton) =>
    'url' in button ? { text: button.label, url: button.url } : { text: button.label, callback_data: button.callbackData };
  return { inline_keyboard: rows.map((row) => row.map(key)) };
}

/**
 * editMessageText as a Bot API method for a webhook response (the kit cards of /kits, D120): plain text, link previews
 * off, the keyboard replaced (none: removed).
 */
export function editMessageText(opts: {
  chatId: string;
  messageId: number;
  text: string;
  keyboard: readonly (readonly TelegramButton[])[];
}): Record<string, unknown> {
  return {
    method: 'editMessageText',
    chat_id: opts.chatId,
    message_id: opts.messageId,
    text: opts.text,
    link_preview_options: { is_disabled: true },
    reply_markup: inlineKeyboard(opts.keyboard),
  };
}

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
  button?: TelegramButton;
  /** Rows of buttons instead of `button`. */
  keyboard?: readonly (readonly TelegramButton[])[];
  fetch: typeof fetch;
  timeoutMs: number;
}): Promise<TelegramOutcome> {
  if (opts.token === null) return 'config';
  const body = {
    chat_id: opts.chatId,
    text: opts.text,
    link_preview_options: { is_disabled: true },
    ...(opts.keyboard !== undefined
      ? { reply_markup: inlineKeyboard(opts.keyboard) }
      : opts.button === undefined
        ? {}
        : { reply_markup: inlineKeyboard(opts.button) }),
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
 * answerCallbackQuery: the toast under a tapped callback button (the rescue kit's "Rescue now", D118). Best effort,
 * never throws; like sendMessage, nothing is logged.
 */
export async function answerCallbackQuery(opts: {
  token: string;
  callbackQueryId: string;
  text: string;
  fetch: typeof fetch;
  timeoutMs: number;
}): Promise<boolean> {
  if (opts.token === '') return false;
  const body = JSON.stringify({ callback_query_id: opts.callbackQueryId, text: opts.text });
  const result = await attemptPost(`https://api.telegram.org/bot${opts.token}/answerCallbackQuery`, body, {
    timeoutMs: opts.timeoutMs,
    fetch: opts.fetch,
  });
  return typeof result !== 'string' && result.status >= 200 && result.status < 300;
}

/**
 * What Telegram reports about the bot behind a token (getBotIdentity): the webhook URL ('' when none is set), the last
 * error Telegram had delivering an update to it (null: none reported), and the bot's username (null: not asked).
 */
export type BotIdentity =
  | {
      outcome: 'ok';
      webhookUrl: string;
      /** getWebhookInfo last_error_date (unix s) and last_error_message, e.g. "Wrong response from the webhook: 401 Unauthorized". */
      lastError: { date: number; message: string } | null;
      username: string | null;
    }
  | { outcome: 'config' | 'retry' };

/** Bot API answers this small; anything longer is not read on. */
const MAX_IDENTITY_BODY_BYTES = 64 * 1024;

/**
 * getWebhookInfo and, with `withUsername`, getMe: for the monitor's bot check (SECURITY-CHECK П17), the webhook on
 * every pass and the bot once a day. One request after the other; a refused token (401, 404, or none set) is `config`
 * and stops after the first, anything else that is not a Bot API result is `retry`. Like sendMessage: the URL carries
 * the token, so nothing here is logged.
 */
export async function getBotIdentity(opts: {
  token: string | null;
  fetch: typeof fetch;
  timeoutMs: number;
  withUsername: boolean;
}): Promise<BotIdentity> {
  const { token } = opts;
  if (token === null) return { outcome: 'config' };
  const webhook = await botApiResult(token, 'getWebhookInfo', opts);
  if (webhook.outcome !== 'ok') return webhook;
  const webhookUrl = webhook.result.url;
  if (typeof webhookUrl !== 'string') return { outcome: 'retry' };
  const date = webhook.result.last_error_date;
  const message = webhook.result.last_error_message;
  const lastError = Number.isSafeInteger(date) && typeof message === 'string' ? { date: date as number, message } : null;
  if (!opts.withUsername) return { outcome: 'ok', webhookUrl, lastError, username: null };
  const me = await botApiResult(token, 'getMe', opts);
  if (me.outcome !== 'ok') return me;
  const username = me.result.username;
  if (typeof username !== 'string') return { outcome: 'retry' };
  return { outcome: 'ok', webhookUrl, lastError, username };
}

async function botApiResult(
  token: string,
  method: 'getWebhookInfo' | 'getMe',
  opts: { fetch: typeof fetch; timeoutMs: number },
): Promise<{ outcome: 'ok'; result: Record<string, unknown> } | { outcome: 'config' | 'retry' }> {
  const answer = await attemptPost(`https://api.telegram.org/bot${token}/${method}`, '{}', {
    timeoutMs: opts.timeoutMs,
    fetch: opts.fetch,
    maxBodyBytes: MAX_IDENTITY_BODY_BYTES,
  });
  if (typeof answer === 'string') return { outcome: 'retry' };
  if (answer.status === 401 || answer.status === 404) return { outcome: 'config' };
  if (answer.body === null) return { outcome: 'retry' };
  let json: unknown;
  try {
    json = JSON.parse(answer.body);
  } catch {
    return { outcome: 'retry' };
  }
  if (typeof json !== 'object' || json === null || !('ok' in json) || json.ok !== true || !('result' in json)) {
    return { outcome: 'retry' };
  }
  const { result } = json;
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return { outcome: 'retry' };
  return { outcome: 'ok', result: result as Record<string, unknown> };
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
