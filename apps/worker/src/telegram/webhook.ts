import { ZERO_ADDRESS } from '@stakeward/core';
import type { Context, MiddlewareHandler } from 'hono';
import * as z from 'zod';
import { isAddressText } from '../address.ts';
import { botUsernameOf, siteOriginOf, webhookSecretOf } from '../monitor/config.ts';
import { lastPassAtOf, SQL } from '../monitor/store.ts';
import { allowRequest } from '../rate-limit.ts';
import type { AppEnv } from '../app.ts';
import {
  helpText,
  linkedText,
  linkLimitText,
  MAX_LINKS_PER_CHAT,
  notAnAddressText,
  statusText,
  stopText,
} from './texts.ts';

/**
 * POST /api/telegram/webhook (CLAUDE.md section 8; step 5 spec section 8.1). In order:
 * 1. `telegramSecret()`: the X-Telegram-Bot-Api-Secret-Token header must equal TELEGRAM_WEBHOOK_SECRET (compared as
 *    SHA-256 digests in constant time), else 401; an empty secret is 503. Nothing reads the body or D1 before.
 * 2. bodyLimit(64 KiB) in app.ts; a larger update is answered 200 {} so Telegram does not resend it forever.
 * 3. The update is parsed loosely; anything else is 200 {}.
 * 4. At most TELEGRAM_RATE_LIMIT updates per chat (the IP is always Telegram's); over it, 200 {} without a reply.
 * 5. `my_chat_member` kicked or left (the user blocked the bot or removed it from a group) forgets the chat at once.
 * 6. /start <address>, /status, /stop, /help. The reply goes in the response body (a sendMessage the Bot API runs
 *    for us): no outgoing request and no token needed.
 * A D1 failure is thrown to app.onError -> 500, and Telegram retries; every command is idempotent.
 * Logged: the kind of update only. Never the body, the chat id, the wallet or the headers.
 */

export const MAX_TELEGRAM_UPDATE_BYTES = 64 * 1024;

const SECRET_HEADER = 'X-Telegram-Bot-Api-Secret-Token';

const update = z.looseObject({
  update_id: z.number().int(),
  message: z
    .looseObject({
      chat: z.looseObject({ id: z.number().int().refine(Number.isSafeInteger), type: z.string() }),
      text: z.string().max(4096).optional(),
    })
    .optional(),
  my_chat_member: z
    .looseObject({
      chat: z.looseObject({ id: z.number().int() }),
      new_chat_member: z.looseObject({ status: z.string() }),
    })
    .optional(),
});

export type Command = { command: 'start' | 'status' | 'stop' | 'help'; arg: string | null };

const COMMAND = /^\/(start|status|stop|help)(?:@([A-Za-z0-9_]{5,32}))?(?:\s+(\S+))?\s*$/;

/**
 * The bot command in `text`, with its one argument. A command addressed to another bot (`/status@OtherBot` in a
 * group) is null, and so is any `@bot` suffix while our username is not configured.
 */
export function parseCommand(text: string, botUsername: string | null): Command | null {
  const match = COMMAND.exec(text.trim());
  if (match === null) return null;
  const [, command, suffix, arg] = match;
  if (suffix !== undefined && (botUsername === null || suffix.toLowerCase() !== botUsername.toLowerCase())) return null;
  return { command: command as Command['command'], arg: arg ?? null };
}

/** Step 1: the secret Telegram was given in setWebhook. Runs before the body limit and the handler. */
export function telegramSecret(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const secret = webhookSecretOf(c.env);
    if (secret === null) {
      return c.json({ error: 'telegram-not-configured', message: 'Telegram alerts are not set up yet' }, 503);
    }
    const given = c.req.header(SECRET_HEADER);
    if (given === undefined || !(await sameSecret(given, secret))) return c.json({ error: 'unauthorized' }, 401);
    await next();
    return;
  };
}

/** Constant-time equality of two strings of any length: their SHA-256 digests always have the same length. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(given)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

/** The answer to an update that needs none, including garbage and an over-limit body. */
export function noReply(c: Context<AppEnv>): Response {
  return c.json({});
}

type UpdateKind = Command['command'] | 'member' | 'ignored';

function logUpdate(kind: UpdateKind): void {
  console.log(JSON.stringify({ msg: 'telegram update', kind }));
}

/** Steps 3 to 6, after the secret and the body limit. `now` is the worker clock (unix ms). */
export function telegramWebhookHandler(now: () => number) {
  return async (c: Context<AppEnv>): Promise<Response> => {
    let json: unknown;
    try {
      json = JSON.parse(await c.req.text());
    } catch {
      logUpdate('ignored');
      return noReply(c);
    }
    const parsed = update.safeParse(json);
    const message = parsed.success ? parsed.data.message : undefined;
    const member = parsed.success ? parsed.data.my_chat_member : undefined;
    const chat = member?.chat ?? message?.chat;
    if (chat === undefined) {
      logUpdate('ignored');
      return noReply(c);
    }
    // Telegram chat ids fit in 52 bits: the decimal text is exact.
    const chatId = String(chat.id);
    if (!(await allowRequest(c.env, 'TELEGRAM_RATE_LIMIT', `chat:${chatId}`))) {
      logUpdate('ignored');
      return noReply(c);
    }
    const db = c.env.DB;

    if (member !== undefined) {
      const { status } = member.new_chat_member;
      if (status !== 'kicked' && status !== 'left') {
        logUpdate('ignored');
        return noReply(c);
      }
      await db.prepare(SQL.STOP).bind(chatId).run();
      logUpdate('member');
      return noReply(c);
    }
    if (message === undefined) {
      logUpdate('ignored');
      return noReply(c);
    }

    const origin = siteOriginOf(c.env);
    const command = message.text === undefined ? null : parseCommand(message.text, botUsernameOf(c.env));
    if (command === null) {
      // In a group the bot sees commands only (privacy mode) and stays quiet on anything else.
      if (message.chat.type !== 'private') {
        logUpdate('ignored');
        return noReply(c);
      }
      logUpdate('help');
      return reply(c, chatId, helpText(origin));
    }
    logUpdate(command.command);

    switch (command.command) {
      case 'help':
        return reply(c, chatId, helpText(origin));
      case 'start': {
        const wallet = command.arg;
        if (wallet === null) return reply(c, chatId, helpText(origin));
        if (!isAddressText(wallet) || wallet === ZERO_ADDRESS) return reply(c, chatId, notAnAddressText(origin));
        const [, state] = await db.batch([
          db.prepare(SQL.LINK_WALLET).bind(wallet, chatId, now(), MAX_LINKS_PER_CHAT),
          db.prepare(SQL.LINK_STATE).bind(wallet, chatId),
        ]);
        const row = state?.results[0] as { linked: unknown; watched: unknown } | undefined;
        if (row === undefined || Number(row.linked) !== 1) return reply(c, chatId, linkLimitText());
        return reply(c, chatId, linkedText(wallet, Number(row.watched), origin));
      }
      case 'status': {
        const [links, marker] = await db.batch([db.prepare(SQL.STATUS).bind(chatId), db.prepare(SQL.LAST_PASS_AT)]);
        const wallets = ((links?.results ?? []) as { wallet: string; watched: unknown }[]).map((row) => ({
          wallet: row.wallet,
          watched: Number(row.watched),
        }));
        const lastPassAt = lastPassAtOf(marker?.results[0] as { value: unknown } | undefined);
        return reply(c, chatId, statusText(wallets, lastPassAt, now()));
      }
      case 'stop':
        await db.prepare(SQL.STOP).bind(chatId).run();
        return reply(c, chatId, stopText());
    }
  };
}

/** The reply as a Bot API method in the webhook response: plain text, link previews off. */
function reply(c: Context<AppEnv>, chatId: string, text: string): Response {
  return c.json({ method: 'sendMessage', chat_id: chatId, text, link_preview_options: { is_disabled: true } });
}
