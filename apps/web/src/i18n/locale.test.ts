import { afterEach, describe, expect, it } from 'vitest';
import es from './es.json';
import ka from './ka.json';
import { changeLocale, currentLocale, formatDate, formatDateTime, formatList, loadLocale, t } from './index.ts';
import { LOCALE_STORAGE_KEY, readStoredLocale, storeLocale } from './locales.ts';
import { errorMessage } from './errors.ts';

const APRIL_12_2027 = 1_807_488_000n;

afterEach(async () => {
  await loadLocale('en');
  localStorage.clear();
});

describe('the interface language (D140)', () => {
  it('is English until the viewer picks another one', () => {
    expect(readStoredLocale()).toBe('en');
    expect(currentLocale()).toBe('en');
    expect(t('common.roles.second')).toBe('Second key');
  });

  it('switches t(), the page language and the dates to the catalog loaded', async () => {
    await loadLocale('es');
    expect(currentLocale()).toBe('es');
    expect(document.documentElement.lang).toBe('es');
    expect(t('common.roles.second')).toBe(es.common.roles.second);
    expect(t('status.lockedUntil', { date: 'X' })).toBe(es.status.lockedUntil.replace('{date}', 'X'));
    expect(formatDate(APRIL_12_2027)).toBe('12 de abril de 2027');
    expect(formatDateTime(APRIL_12_2027)).toBe('12 de abril de 2027, 00:00 UTC');
    expect(formatList(['A', 'B', 'C'])).toBe('A, B y C');
    expect(errorMessage({ code: 'lockup-in-force' }, APRIL_12_2027)).toContain('12 de abril de 2027');

    await loadLocale('ka');
    expect(document.documentElement.lang).toBe('ka');
    expect(t('common.roles.main')).toBe(ka.common.roles.main);
    expect(formatDate(APRIL_12_2027)).toBe('12 აპრილი, 2027');
    expect(formatList(['A', 'B'])).toBe('A და B');

    await loadLocale('en');
    expect(document.documentElement.lang).toBe('en');
    // English dates are core's, the same text as the alerts and the recovery card.
    expect(formatDate(APRIL_12_2027)).toBe('12 April 2027');
    expect(formatDateTime(APRIL_12_2027)).toBe('12 April 2027, 00:00 UTC');
  });

  it('keeps a date outside the range of a JavaScript Date null in every language', async () => {
    await loadLocale('es');
    expect(formatDate(2n ** 62n)).toBeNull();
    expect(formatDateTime(2n ** 62n)).toBeNull();
  });

  it('remembers a choice on this device; English needs no entry', async () => {
    await changeLocale('ka');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('ka');
    expect(readStoredLocale()).toBe('ka');
    await changeLocale('en');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });

  it('reads anything else, or a storage that throws, as English', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
    expect(readStoredLocale()).toBe('en');
    // Spanish is not offered for now (D144): a viewer who chose it before gets English.
    localStorage.setItem(LOCALE_STORAGE_KEY, 'es');
    expect(readStoredLocale()).toBe('en');
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
    expect(readStoredLocale(blocked)).toBe('en');
    expect(() => {
      storeLocale('es', blocked);
    }).not.toThrow();
  });
});
