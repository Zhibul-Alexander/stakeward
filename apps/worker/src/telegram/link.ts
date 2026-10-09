import { ZERO_ADDRESS } from '@stakeward/core';
import type { Context } from 'hono';
import * as z from 'zod';
import { isAddressText } from '../address.ts';
import { botUsernameOf } from '../monitor/config.ts';
import type { AppEnv } from '../app.ts';

/**
 * GET /api/telegram/link?wallet=<address> (step 5 spec section 8.4): 302 to the bot's deep link
 * `https://t.me/<bot>?start=<wallet>`, so the site needs no bot name and the bot changes with the TELEGRAM_BOT_USERNAME
 * secret alone. A base58 address (32 to 44 of [A-Za-z0-9]) fits the start parameter (up to 64 of [A-Za-z0-9_-]).
 * Neither D1 nor the RPC is touched, so there is no rate limit.
 */

const query = z.strictObject({
  wallet: z
    .string()
    .refine(isAddressText, 'Expected a base58 address')
    .refine((a) => a !== ZERO_ADDRESS, 'The all-zero address is not a wallet'),
});

/** The bot's deep link that starts alerts for `wallet`. */
export function telegramStartUrl(botUsername: string, wallet: string): string {
  return `https://t.me/${botUsername}?start=${wallet}`;
}

export function telegramLinkHandler() {
  return (c: Context<AppEnv>): Response => {
    const entries = [...new URL(c.req.url).searchParams.entries()];
    const parsed = query.safeParse(Object.fromEntries(entries));
    if (!parsed.success || entries.length !== 1) {
      return c.json({ error: 'invalid-query', message: 'Pass exactly one wallet=<address>' }, 400);
    }
    const bot = botUsernameOf(c.env);
    if (bot === null) {
      return c.json({ error: 'telegram-not-configured', message: 'Telegram alerts are not set up yet' }, 503);
    }
    return c.redirect(telegramStartUrl(bot, parsed.data.wallet), 302);
  };
}
