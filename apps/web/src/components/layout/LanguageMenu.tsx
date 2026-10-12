import { LanguagesIcon } from 'lucide-react';
import { changeLocale, LOCALE_NAMES, SELECTABLE_LOCALES, t, useLocale, type Locale } from '@/i18n';
import { HeaderMenu } from './HeaderMenu.tsx';

/**
 * The short form on the closed button. Georgian shows GE, the form people in Georgia know (D148); its ISO 639-1 code
 * 'ka' stays the locale and the `lang` attribute.
 */
const CODES: Readonly<Record<Locale, string>> = { en: 'EN', es: 'ES', ka: 'GE' };

/**
 * The interface language in the site header (D140, D143): the language icon and the current language's code, opening a
 * list with each language it offers (D144) named in itself and marked with its own `lang` (a screen reader reads
 * "ქართული" in Georgian). Switching keeps the page and what it holds.
 */
export function LanguageMenu({ className }: { className?: string | undefined }) {
  const locale = useLocale();
  return (
    <HeaderMenu
      className={className}
      label={t('nav.language')}
      buttonLabel={`${t('nav.language')}: ${LOCALE_NAMES[locale]}`}
      buttonContent={
        <>
          <LanguagesIcon aria-hidden="true" />
          {CODES[locale]}
        </>
      }
      items={SELECTABLE_LOCALES.map((option) => ({
        id: option,
        label: LOCALE_NAMES[option],
        lang: option,
        current: option === locale,
        // A catalog that fails to load (network) leaves the page as it was; choosing again retries.
        onSelect: () => {
          changeLocale(option).catch(() => undefined);
        },
      }))}
    />
  );
}
