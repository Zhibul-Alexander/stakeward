import { shortAddress } from '@stakeward/core';

/**
 * Replies of the Stakeward bot (step 5 spec section 8.3): plain text without markup. Key roles keep the site's words
 * (CLAUDE.md section 9, rule 4); test/telegram/texts.review.test.ts checks that no chain role name slips in.
 * `origin` is the site origin (monitor/config.ts siteOriginOf); while it is not configured the texts name "the
 * Stakeward site" instead of a link.
 */

/** Wallets one chat may follow (LINK_COUNT). */
export const MAX_LINKS_PER_CHAT = 20;

/**
 * Links one chat may add per UTC day (LINK_COUNT, telegram/webhook.ts): a /start and /stop churn of one chat cannot use
 * up the day's budget of every chat (MAX_LINK_WRITES_PER_DAY).
 */
export const MAX_LINK_WRITES_PER_CHAT_PER_DAY = 50;

const NO_SEED_PHRASE = 'Stakeward never asks for your seed phrase.';
const COMMANDS = '/status lists the wallets of this chat, /stop turns all alerts off.';

/**
 * The last line of an alert message that covers more alerts than it shows (monitor/deliver.ts, a full delivery
 * window). The message's button opens the site.
 */
export function moreAlertsText(count: number): string {
  const alerts = count === 1 ? '1 more alert' : `${String(count)} more alerts`;
  return `And ${alerts} for the wallets this chat follows. The Stakeward accounts page lists every change.`;
}

/** "1 stake account", "3 stake accounts". */
export function stakeAccountsText(count: number): string {
  return count === 1 ? '1 stake account' : `${String(count)} stake accounts`;
}

/** `origin` + `path` as a link, or "the Stakeward site" while the origin is not configured. */
function sitePlace(origin: string | null, path = ''): string {
  return origin === null ? 'the Stakeward site' : `${origin}${path}`;
}

/** /help, /start without an address, and any other text in a private chat. */
export function helpText(origin: string | null): string {
  return (
    `Send /start followed by a wallet address, or open ${sitePlace(origin, '/app')} and press Get alerts in ` +
    `Telegram. ${COMMANDS} ${NO_SEED_PHRASE}`
  );
}

/** /start with something that is not a wallet address (or the all-zero address). */
export function notAnAddressText(origin: string | null): string {
  return `That is not a wallet address. ${helpText(origin)}`;
}

/** /start <address> when the chat follows the wallet (just now or already before). */
export function linkedText(wallet: string, watched: number, origin: string | null): string {
  const text =
    `Alerts are on for ${wallet}. Stakeward watches ${String(watched)} of its stake accounts. You will get a ` +
    `message here when one of them changes, and before a lock ends. ${COMMANDS} Alerts only link to ` +
    `${sitePlace(origin)}. ${NO_SEED_PHRASE}`;
  if (watched > 0) return text;
  const protectAt = sitePlace(origin, `/app?address=${wallet}`);
  return `${text}\n\nNo stake account of this wallet is watched yet. Protect one at ${protectAt} and it is watched from then on.`;
}

/** /start <address> refused: the chat already follows MAX_LINKS_PER_CHAT wallets. */
export function linkLimitText(): string {
  return (
    `This chat already follows ${String(MAX_LINKS_PER_CHAT)} wallets, the most allowed. ` +
    'Send /stop to remove them all, then add the ones you need.'
  );
}

/** /start <address> refused: the webhook added MAX_LINK_WRITES_PER_DAY links today (telegram/webhook.ts). */
export function linkBudgetText(): string {
  return (
    'Stakeward has added as many alert links today as it allows. Try again after 00:00 UTC; the alerts you already ' +
    'have keep coming.'
  );
}

/** /start <address> refused: this chat added MAX_LINK_WRITES_PER_CHAT_PER_DAY links today. */
export function chatLinkBudgetText(): string {
  return (
    `This chat has added ${String(MAX_LINK_WRITES_PER_CHAT_PER_DAY)} alert links today, the most allowed. Try again ` +
    'after 00:00 UTC; the alerts you already have keep coming.'
  );
}

/**
 * /status: the wallets this chat follows, each with the number of its watched stake accounts, and the age of the last
 * successful monitor pass (`lastPassAt`, null = none yet) at `nowMs`.
 */
export function statusText(
  wallets: readonly { wallet: string; watched: number }[],
  lastPassAt: number | null,
  nowMs: number,
): string {
  if (wallets.length === 0) return 'This chat gets no alerts. Send /start followed by a wallet address.';
  const lines = wallets.map(({ wallet, watched }) => `${wallet}: ${stakeAccountsText(watched)} watched`);
  const minutes = lastPassAt === null ? null : Math.max(0, Math.floor((nowMs - lastPassAt) / 60_000));
  const check = minutes === null ? 'The monitor has not run yet.' : `Last check: ${String(minutes)} min ago.`;
  return ['This chat gets alerts for:', ...lines, check].join('\n');
}

/** /stop. */
export function stopText(): string {
  return (
    'Alerts are off. This chat no longer follows any wallet, and Stakeward no longer keeps its id. ' +
    'Send /start followed by a wallet address to turn them on again.'
  );
}

/** /start kit-<token>: the chat is bound to the rescue kit of `stakeAccount` (D118). */
export function kitLinkedText(stakeAccount: string): string {
  return (
    `One-tap rescue is linked for stake ${shortAddress(stakeAccount)}. If Stakeward sees a change you did not make, ` +
    'press Rescue now under the alert.'
  );
}

/** /start kit-<token> with a token no kit holds: used already, replaced by a newer kit, or never issued. */
export function kitLinkInvalidText(): string {
  return 'This link was already used or is not valid.';
}
