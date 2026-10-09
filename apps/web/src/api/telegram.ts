import type { Address } from '@solana/kit';

/**
 * Where "Get alerts in Telegram" points: the worker answers GET /api/telegram/link with a redirect to the Stakeward bot
 * and `/start <wallet>` (CLAUDE.md section 8: a base58 address fits the start parameter, no one-time codes). The bot's
 * username lives in the worker's configuration only, so the site never links to a guessed bot.
 */
export function telegramLinkPath(wallet: Address): string {
  return `/api/telegram/link?wallet=${wallet}`;
}
