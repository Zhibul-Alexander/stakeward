import { isAddress, type Address } from '@solana/kit';

/**
 * "Explain this alert" (DECISIONS.md D125). A Telegram alert's button opens a page of the Stakeward site (alerts link
 * only there, CLAUDE.md section 11). Two query parameters say which alert it was, so the page can show the account's
 * recent events and explain this one: `event` (the stored event type, e.g. DEACTIVATED or REMINDER_7) and `stake`
 * (the stake account). Both are public data; the page treats them as text and checks the account against the worker.
 */

/** An event type as the worker stores it: upper case letters, digits and `_`. */
const EVENT_TYPE = /^[A-Z][A-Z0-9_]{0,39}$/;

export type AlertLink = { event: string; stake: Address };

/** `path` (a site path, possibly with a query) with the alert's `event` and `stake` added. */
export function alertLinkPath(path: string, alert: AlertLink): string {
  if (!EVENT_TYPE.test(alert.event)) throw new Error('alertLinkPath: not an event type');
  const query = new URLSearchParams({ event: alert.event, stake: alert.stake }).toString();
  const [base, hash] = splitHash(path);
  return `${base}${base.includes('?') ? '&' : '?'}${query}${hash}`;
}

/** The alert a page was opened from, or null when the query names none (or names it badly). */
export function parseAlertLink(search: string | URLSearchParams): AlertLink | null {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const event = params.get('event');
  const stake = params.get('stake');
  if (event === null || stake === null || !EVENT_TYPE.test(event) || !isAddress(stake)) return null;
  return { event, stake };
}

function splitHash(path: string): [string, string] {
  const at = path.indexOf('#');
  return at === -1 ? [path, ''] : [path.slice(0, at), path.slice(at)];
}
