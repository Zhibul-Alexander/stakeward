import { LanguagesIcon } from 'lucide-react';
import { changeLocale, LOCALE_NAMES, LOCALES, t, useLocale } from '@/i18n';

/**
 * The interface language, in the footer of every page (D140): each language named in itself and marked with its own
 * `lang`, so a screen reader reads "ქართული" in Georgian. The current one is pressed. Switching keeps the page and
 * what it holds; it never reloads. A translated page says that English is the reference.
 */
export function LanguageSwitch() {
  const locale = useLocale();
  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label={t('footer.language')} className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <LanguagesIcon aria-hidden="true" className="size-4" />
        {LOCALES.map((option) => (
          <button
            key={option}
            type="button"
            lang={option}
            aria-pressed={option === locale}
            onClick={() => {
              // A catalog that fails to load (network) leaves the page as it was; pressing again retries.
              changeLocale(option).catch(() => undefined);
            }}
            className="rounded-sm underline underline-offset-4 hover:text-foreground aria-pressed:font-medium aria-pressed:text-foreground aria-pressed:no-underline"
          >
            {LOCALE_NAMES[option]}
          </button>
        ))}
      </div>
      {locale === 'en' ? null : <p>{t('footer.translated')}</p>}
    </div>
  );
}
