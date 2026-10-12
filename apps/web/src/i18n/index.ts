import { formatUtcDate } from '@stakeward/core';
import { useSyncExternalStore } from 'react';
import en from './en.json';
import { DEFAULT_LOCALE, storeLocale, type Locale } from './locales.ts';

export { DEFAULT_LOCALE, LOCALE_NAMES, LOCALES, SELECTABLE_LOCALES, isLocale, readStoredLocale, type Locale } from './locales.ts';

/**
 * UI strings (CLAUDE.md section 9). en.json is the source and the default; es.json and ka.json hold the same keys
 * (DECISIONS.md D140, checked by i18n.test.ts). `t('status.protected')` returns the text in the current language;
 * `{name}` placeholders are filled from `params`. Keys are checked at compile time against en.json, so a typo or a
 * removed key fails `pnpm typecheck`.
 */
export type Messages = typeof en;

type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** Every dotted key of en.json that holds a string, e.g. `'common.roles.main'`. */
export type MessageKey = Leaves<Messages>;

export type MessageParams = Readonly<Record<string, string | number>>;

/**
 * English ships in the main bundle; the other catalogs are chunks of their own, loaded only for a viewer who picked
 * them. The annotation makes `pnpm typecheck` fail when a translation lacks a key of en.json.
 */
const CATALOGS: Readonly<Record<Exclude<Locale, 'en'>, () => Promise<{ default: Messages }>>> = {
  es: () => import('./es.json'),
  ka: () => import('./ka.json'),
};

let locale: Locale = DEFAULT_LOCALE;
let messages: Messages = en;
const listeners = new Set<() => void>();

/** The language `t()` writes in. */
export function currentLocale(): Locale {
  return locale;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The current language, re-rendering the component when it changes. App reads it, so a new language re-renders the
 * whole site from the top (no component is memoised) and what a wizard holds stays as it was.
 */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, currentLocale);
}

/**
 * Switches `t()` to `next`, loading its catalog first, and marks the page's language (`<html lang>`, for screen
 * readers, hyphenation and fonts). A catalog that fails to load (network) leaves the language as it was and rejects.
 * main.tsx calls it before the first render; the footer's language switch calls it and then re-renders the site.
 */
export async function loadLocale(next: Locale): Promise<void> {
  const catalog = next === 'en' ? en : (await CATALOGS[next]()).default;
  locale = next;
  messages = catalog;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  for (const listener of [...listeners]) listener();
}

/** The viewer picked `next` in the footer: load it, remember it on this device, re-render the site in it. */
export async function changeLocale(next: Locale): Promise<void> {
  await loadLocale(next);
  storeLocale(next);
}

const PLACEHOLDER = /\{(\w+)\}/g;

export function t(key: MessageKey, params?: MessageParams): string {
  const text = lookup(messages, key) ?? lookup(en, key) ?? key;
  if (params === undefined) return text;
  return text.replace(PLACEHOLDER, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

function lookup(catalog: Messages, key: string): string | undefined {
  let node: unknown = catalog;
  for (const part of key.split('.')) {
    node = typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined;
  }
  // Unreachable for a typed key in a complete catalog; the caller falls back to English, then to the key itself.
  return typeof node === 'string' ? node : undefined;
}

/**
 * A unix timestamp (seconds) as a UTC calendar date in the current language: `12 April 2027` (core `formatUtcDate`,
 * the same text as the alerts and the recovery card), `12 de abril de 2027`, `12 აპრილი, 2027`. Null outside the
 * range of a JavaScript Date (a lockup can hold any i64).
 */
export function formatDate(unixSeconds: bigint): string | null {
  const english = formatUtcDate(unixSeconds);
  if (english === null || locale === 'en') return english;
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Number(unixSeconds) * 1000),
  );
}

/**
 * The date and the UTC time to the minute, on the 24-hour clock: `12 April 2027, 00:00 UTC` (as core
 * `formatUtcDateTime`), `12 de abril de 2027, 00:00 UTC`. Null outside the range of a JavaScript Date.
 */
export function formatDateTime(unixSeconds: bigint): string | null {
  const day = formatDate(unixSeconds);
  if (day === null) return null;
  const date = new Date(Number(unixSeconds) * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${day}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

/** "A, B and C" in the current language (`A, B y C`, `A, B და C`). */
export function formatList(items: readonly string[]): string {
  return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items);
}
