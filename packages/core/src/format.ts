/**
 * Plain-text formatting shared by alert texts (diff.ts) and error titles (errors.ts). Pure and locale-independent:
 * the same output in the browser, the worker and tests.
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

/**
 * A unix timestamp (seconds) as a UTC calendar date in English: `1_807_488_000n` -> `12 April 2027`.
 * Null when the value is outside the range of a JavaScript Date (a lockup can hold any i64).
 */
export function formatUtcDate(unixSeconds: bigint): string | null {
  if (unixSeconds > MAX_DATE_SECONDS || unixSeconds < -MAX_DATE_SECONDS) return null;
  const date = new Date(Number(unixSeconds) * 1000);
  const month = MONTHS[date.getUTCMonth()];
  if (month === undefined) return null;
  return `${String(date.getUTCDate())} ${month} ${String(date.getUTCFullYear())}`;
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
