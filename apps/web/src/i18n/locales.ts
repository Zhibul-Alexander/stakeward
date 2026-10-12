import { browserStorage, type StorageLike } from '../ports/slots.ts';

/**
 * The interface languages (DECISIONS.md D140). English is the default for everyone: the site never guesses from the
 * browser's language, a viewer picks another one in the header menu (D143). The choice is kept in localStorage as a
 * per-viewer convenience (wrapped in try/catch; without storage the site is English).
 */
export const LOCALES = ['en', 'es', 'ka'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/**
 * The languages a viewer can pick (D144). Spanish stays translated and tested (es.json, catalogs.test.ts) but is not
 * offered for now; adding 'es' back here offers it again.
 */
export const SELECTABLE_LOCALES: readonly Locale[] = ['en', 'ka'];

/** Each language named in itself, the way a reader looks for it in a list (not translated). */
export const LOCALE_NAMES: Readonly<Record<Locale, string>> = { en: 'English', es: 'Español', ka: 'ქართული' };

export const LOCALE_STORAGE_KEY = 'stakeward:locale:v1';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** The language this viewer chose before, or English (also for a language that is no longer offered). */
export function readStoredLocale(storage: StorageLike | null = browserStorage()): Locale {
  try {
    const value = storage?.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) && SELECTABLE_LOCALES.includes(value) ? value : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function storeLocale(locale: Locale, storage: StorageLike | null = browserStorage()): void {
  try {
    if (locale === DEFAULT_LOCALE) storage?.removeItem(LOCALE_STORAGE_KEY);
    else storage?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Blocked storage: the language holds for this visit only.
  }
}
