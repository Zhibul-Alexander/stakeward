import { ZERO_ADDRESS } from '@stakeward/core';
import type { Context, MiddlewareHandler } from 'hono';
import * as z from 'zod';
import { isAddressText } from '../address.ts';
import { botUsernameOf, siteOriginOf, webhookSecretOf } from '../monitor/config.ts';
import {
  lastPassAtOf,
  linkCounterKey,
  linkStateOf,
  linkStateStatement,
  linkWalletStatements,
  SQL,
  type LinkState,
} from '../monitor/store.ts';
import { allowRequest } from '../rate-limit.ts';
import { kitStartToken, kitTokenHash, parseRescueKitCallback, rescueFromButton } from '../rescue-kits.ts';
import type { UpstreamOptions } from '../upstream.ts';
import type { AppEnv } from '../app.ts';
import { answerCallbackQuery, inlineKeyboard, siteUrl } from './api.ts';
import {
  chatLinkBudgetText,
  helpText,
  kitLinkedText,
  kitLinkInvalidText,
  linkBudgetText,
  linkedText,
  linkLimitText,
  MAX_LINK_WRITES_PER_CHAT_PER_DAY,
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
 * 6. /start <address>, /start kit-<token>, /status, /stop, /help. The reply goes in the response body (a sendMessage
 *    the Bot API runs for us): no outgoing request and no token needed. /start kit-<token> (rescue-kits.ts) binds the
 *    chat to that rescue kit, once (the token hash is cleared), and links the kit's main key like /start <address>.
 *    /stop and a blocked bot also let go of the chat's kits.
 * 7. callback_query `rk:<stake account>`, the "Rescue now" button (D118; the one callback button, CLAUDE.md section 8
 *    otherwise has none): rescueFromButton sends the kit only for the chat bound to it. The toast goes out as
 *    answerCallbackQuery, after a send the outcome as a message in the response body. Only a /start that adds a link counts against
 *    MAX_LINK_WRITES_PER_DAY and MAX_LINK_WRITES_PER_CHAT_PER_DAY; a wallet the chat already follows is confirmed
 *    without a write. The per-chat count is kept under an HMAC of the day and the chat id (linkCounterKey), so the
 *    chat id lives only in alert_links and /stop forgets it, while the count survives /stop.
 * A D1 failure is thrown to app.onError -> 500, and Telegram retries; every command is idempotent.
 * Logged: the kind of update only. Never the body, the chat id, the wallet or the headers.
 */

export const MAX_TELEGRAM_UPDATE_BYTES = 64 * 1024;

/** The path of this webhook, the one setWebhook gives Telegram (after SITE_ORIGIN); the monitor checks it daily. */
export const TELEGRAM_WEBHOOK_PATH = '/api/telegram/webhook';

/**
 * Links /start may add per UTC day, for every chat together. The per-chat rate limit does not bound writes: any user
 * can open more chats (a group is free), and a /start and /stop churn of distinct wallets writes about 4 rows per new
 * link. The free D1 write quota (100 000 rows a day) is shared by dev and prod, and the monitor's lease is a write:
 * once it is used up no pass runs anywhere until 00:00 UTC. Only a link actually added counts (LINK_COUNT), so
 * repeated /start of a followed wallet cannot use the budget up, and one chat adds at most
 * MAX_LINK_WRITES_PER_CHAT_PER_DAY of them. A /stop deletes only links some /start added. Past a budget /start writes
 * nothing; /status and /stop still work.
 */
export const MAX_LINK_WRITES_PER_DAY = 1_000;

const LINK_LIMITS = {
  linksPerChat: MAX_LINKS_PER_CHAT,
  writesPerDay: MAX_LINK_WRITES_PER_DAY,
  writesPerChatPerDay: MAX_LINK_WRITES_PER_CHAT_PER_DAY,
} as const;

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
  callback_query: z
    .looseObject({
      id: z.string().max(256),
      data: z.string().max(64).optional(),
      message: z.looseObject({ chat: z.looseObject({ id: z.number().int().refine(Number.isSafeInteger) }) }).optional(),
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

type UpdateKind = Command['command'] | 'member' | 'callback' | 'ignored';

function logUpdate(kind: UpdateKind): void {
  console.log(JSON.stringify({ msg: 'telegram update', kind }));
}

/**
 * Steps 3 to 7, after the secret and the body limit. `now` is the worker clock (unix ms); `upstream` the RPC options
 * of the "Rescue now" send, whose fetch also carries answerCallbackQuery.
 */
export function telegramWebhookHandler(now: () => number, upstream: UpstreamOptions) {
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
    const callback = parsed.success ? parsed.data.callback_query : undefined;
    const chat = member?.chat ?? message?.chat ?? callback?.message?.chat;
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
      await db.batch(stopStatements(db, chatId));
      logUpdate('member');
      return noReply(c);
    }
    if (callback !== undefined) {
      logUpdate('callback');
      return rescueButton(c, chatId, callback, { upstream, now });
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
        const kitToken = kitStartToken(wallet);
        if (kitToken !== null) {
          const bound = await db.prepare(SQL.KIT_BIND).bind(await kitTokenHash(kitToken), chatId).first<KitBound>();
          if (bound === null) return reply(c, chatId, kitLinkInvalidText());
          const alerts = await linkWallet(c, chatId, bound.main_key, now);
          return reply(c, chatId, `${kitLinkedText(bound.stake_account)}\n\n${alerts}`);
        }
        if (!isAddressText(wallet) || wallet === ZERO_ADDRESS) return reply(c, chatId, notAnAddressText(origin));
        return reply(c, chatId, await linkWallet(c, chatId, wallet, now));
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
        await db.batch(stopStatements(db, chatId));
        return reply(c, chatId, stopText());
    }
  };
}

type KitBound = { stake_account: string; main_key: string };

/** /stop and a blocked bot: the chat's links and its rescue kit bindings. */
function stopStatements(db: D1Database, chatId: string): D1PreparedStatement[] {
  return [db.prepare(SQL.STOP).bind(chatId), db.prepare(SQL.KIT_UNBIND_CHAT).bind(chatId)];
}

/**
 * /start <address> (and the alerts part of /start kit-<token>): links the wallet within the limits; the reply text,
 * that it is linked or why not.
 */
async function linkWallet(c: Context<AppEnv>, chatId: string, wallet: string, now: () => number): Promise<string> {
  const db = c.env.DB;
  const origin = siteOriginOf(c.env);
  const today = new Date(now()).toISOString().slice(0, 10);
  const secret = webhookSecretOf(c.env);
  // telegramSecret() answers 503 before this handler runs without one.
  if (secret === null) throw new Error('TELEGRAM_WEBHOOK_SECRET is not set');
  const counterKey = await linkCounterKey(secret, chatId, today);
  const before = linkStateOf(await linkStateStatement(db, wallet, chatId, today, counterKey).all());
  if (before?.linked === true) return linkedText(wallet, before.watched, origin);
  const refused = before === null ? null : linkRefusal(before);
  if (refused !== null) return refused;
  const statements = linkWalletStatements(db, {
    wallet,
    chatId,
    today,
    counterKey,
    nowMs: now(),
    token: crypto.randomUUID(),
    limits: LINK_LIMITS,
  });
  const after = linkStateOf((await db.batch(statements))[2]);
  if (after === null) return linkBudgetText();
  if (!after.linked) return linkRefusal(after) ?? linkBudgetText();
  return linkedText(wallet, after.watched, origin);
}

/** A tap on a callback button (step 7). Only `rk:<stake account>` does anything. */
async function rescueButton(
  c: Context<AppEnv>,
  chatId: string,
  callback: { id: string; data?: string | undefined },
  deps: { upstream: UpstreamOptions; now: () => number },
): Promise<Response> {
  const stakeAccount = callback.data === undefined ? null : parseRescueKitCallback(callback.data);
  if (stakeAccount === null) return c.json({ method: 'answerCallbackQuery', callback_query_id: callback.id });
  const result = await rescueFromButton(c.env, deps, chatId, stakeAccount);
  if (result.message === null) {
    return c.json({ method: 'answerCallbackQuery', callback_query_id: callback.id, text: result.answer });
  }
  // Two answers: the toast first (best effort: without it the button only spins a while), the outcome in the body.
  await answerCallbackQuery({
    token: c.env.TELEGRAM_BOT_TOKEN,
    callbackQueryId: callback.id,
    text: result.answer,
    fetch: deps.upstream.fetch ?? fetch,
    timeoutMs: deps.upstream.timeoutMs,
  });
  const origin = siteOriginOf(c.env);
  const { text, button } = result.message;
  return c.json({
    method: 'sendMessage',
    chat_id: chatId,
    text,
    link_preview_options: { is_disabled: true },
    ...(button === null || origin === null
      ? {}
      : { reply_markup: inlineKeyboard({ label: button.label, url: siteUrl(origin, button.path) }) }),
  });
}

/** Why a link not there yet cannot be added now (the first limit reached), or null when it can. */
function linkRefusal(state: LinkState): string | null {
  if (state.links >= LINK_LIMITS.linksPerChat) return linkLimitText();
  if (state.chatWrites >= LINK_LIMITS.writesPerChatPerDay) return chatLinkBudgetText();
  if (state.dayWrites >= LINK_LIMITS.writesPerDay) return linkBudgetText();
  return null;
}

/** The reply as a Bot API method in the webhook response: plain text, link previews off. */
function reply(c: Context<AppEnv>, chatId: string, text: string): Response {
  return c.json({ method: 'sendMessage', chat_id: chatId, text, link_preview_options: { is_disabled: true } });
}
