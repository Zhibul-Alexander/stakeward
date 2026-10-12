import { browserStorage, type StorageLike } from './ports/slots.ts';

/**
 * The colour theme (DECISIONS.md D151). By default the site follows the system theme (tokens.css, prefers-color-scheme);
 * a viewer can choose light or dark in the header. The choice marks <html data-theme>, which tokens.css reads, and is
 * kept in localStorage as a per-viewer convenience (wrapped in try/catch; without storage the system theme holds).
 */
export const THEMES = ['system', 'light', 'dark'] as const;

export type Theme = (typeof THEMES)[number];

export const THEME_STORAGE_KEY = 'stakeward:theme:v1';

function isChosen(value: unknown): value is Exclude<Theme, 'system'> {
  return value === 'light' || value === 'dark';
}

/** The theme this viewer chose before, or the system theme. */
export function readStoredTheme(storage: StorageLike | null = browserStorage()): Theme {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return isChosen(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

export function storeTheme(theme: Theme, storage: StorageLike | null = browserStorage()): void {
  try {
    if (theme === 'system') storage?.removeItem(THEME_STORAGE_KEY);
    else storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Blocked storage: the theme holds for this visit only.
  }
}

/** Marks the page with a chosen theme; without the mark tokens.css follows the system theme. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === 'system') delete root.dataset['theme'];
  else root.dataset['theme'] = theme;
}
