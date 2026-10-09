/**
 * Plain-text formatting shared by alert texts (diff.ts), error titles (errors.ts), the recovery card and its CLI
 * commands. Pure and locale-independent: the same output in the browser, the worker, scripts and tests.
 */

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** The largest |unix seconds| a JavaScript Date can hold (8.64e15 ms). */
const MAX_DATE_SECONDS = 8_640_000_000_000n;

/** `unixSeconds` as a Date, or null outside the range of a JavaScript Date (a lockup can hold any i64). */
function toDate(unixSeconds: bigint): Date | null {
  if (unixSeconds > MAX_DATE_SECONDS || unixSeconds < -MAX_DATE_SECONDS) return null;
  const date = new Date(Number(unixSeconds) * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Two-digit zero-padded number: `7` -> `07`. */
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** The UTC calendar day of `date` in English: `12 April 2027`. */
function dayText(date: Date): string | null {
  const month = MONTHS[date.getUTCMonth()];
  if (month === undefined) return null;
  return `${String(date.getUTCDate())} ${month} ${String(date.getUTCFullYear())}`;
}

/**
 * A unix timestamp (seconds) as a UTC calendar date in English: `1_807_488_000n` -> `12 April 2027`.
 * Null when the value is outside the range of a JavaScript Date (a lockup can hold any i64).
 */
export function formatUtcDate(unixSeconds: bigint): string | null {
  const date = toDate(unixSeconds);
  return date === null ? null : dayText(date);
}

/**
 * A unix timestamp (seconds) as a UTC date and time on the 24-hour clock, to the minute:
 * `1_807_488_000n` -> `12 April 2027, 00:00 UTC` (the recovery card, whose reader may live in any time zone).
 * Seconds are dropped. Null outside the range of a JavaScript Date.
 */
export function formatUtcDateTime(unixSeconds: bigint): string | null {
  const date = toDate(unixSeconds);
  const day = date === null ? null : dayText(date);
  if (date === null || day === null) return null;
  return `${day}, ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())} UTC`;
}

/**
 * A unix timestamp (seconds) in RFC 3339 form, UTC, without fractions: `0n` -> `1970-01-01T00:00:00Z`. This is what
 * `solana stake-set-lockup --lockup-date` parses. Null outside the range of a JavaScript Date, and for years outside
 * 0000-9999, which RFC 3339 cannot write.
 */
export function rfc3339Utc(unixSeconds: bigint): string | null {
  const date = toDate(unixSeconds);
  if (date === null) return null;
  const year = date.getUTCFullYear();
  if (year < 0 || year > 9999) return null;
  // toISOString writes years 0000-9999 with four digits; the milliseconds are always .000 for whole seconds.
  return `${date.toISOString().slice(0, 19)}Z`;
}

/**
 * Shortened address for alerts (CLAUDE.md section 8 example, UX rule 9): first and last three characters,
 * `7xKTg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgA9fQ` -> `7xK...9fQ`. The full address is on the page the alert links to.
 */
export function shortAddress(address: string): string {
  return address.length <= 9 ? address : `${address.slice(0, 3)}...${address.slice(-3)}`;
}

const LAMPORTS_PER_SOL = 1_000_000_000n;

/** Lamports as SOL with a thousands separator and no trailing zeros: `1_234_500_000_000n` -> `1,234.5 SOL`. */
export function formatSol(lamports: bigint): string {
  const sign = lamports < 0n ? '-' : '';
  const abs = lamports < 0n ? -lamports : lamports;
  const whole = (abs / LAMPORTS_PER_SOL).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (abs % LAMPORTS_PER_SOL).toString().padStart(9, '0').replace(/0+$/, '');
  return `${sign}${whole}${fraction === '' ? '' : `.${fraction}`} SOL`;
}
