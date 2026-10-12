import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme, readStoredTheme, storeTheme, THEME_STORAGE_KEY } from './theme.ts';

/** A Storage stand-in: a map, or one that throws like a blocked or private-mode localStorage. */
function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

const blocked = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

describe('theme (D151)', () => {
  afterEach(() => {
    delete document.documentElement.dataset['theme'];
  });

  it('reads the stored choice, and the system theme for nothing, junk or blocked storage', () => {
    expect(readStoredTheme(memoryStorage({ [THEME_STORAGE_KEY]: 'dark' }))).toBe('dark');
    expect(readStoredTheme(memoryStorage({ [THEME_STORAGE_KEY]: 'light' }))).toBe('light');
    expect(readStoredTheme(memoryStorage())).toBe('system');
    expect(readStoredTheme(memoryStorage({ [THEME_STORAGE_KEY]: 'sepia' }))).toBe('system');
    expect(readStoredTheme(blocked)).toBe('system');
    expect(readStoredTheme(null)).toBe('system');
  });

  it('stores light and dark, and forgets the choice for the system theme; blocked storage does not throw', () => {
    const storage = memoryStorage();
    storeTheme('dark', storage);
    expect(storage.items.get(THEME_STORAGE_KEY)).toBe('dark');
    storeTheme('system', storage);
    expect(storage.items.has(THEME_STORAGE_KEY)).toBe(false);
    expect(() => {
      storeTheme('light', blocked);
    }).not.toThrow();
  });

  it('marks the page with a chosen theme and leaves it to the system otherwise', () => {
    const root = document.documentElement;
    applyTheme('dark', root);
    expect(root).toHaveAttribute('data-theme', 'dark');
    applyTheme('light', root);
    expect(root).toHaveAttribute('data-theme', 'light');
    applyTheme('system', root);
    expect(root).not.toHaveAttribute('data-theme');
  });
});
