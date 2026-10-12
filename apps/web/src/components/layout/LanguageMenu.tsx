import { cn } from 'cn';
import { CheckIcon, LanguagesIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { changeLocale, LOCALE_NAMES, SELECTABLE_LOCALES, t, useLocale, type Locale } from '@/i18n';

/**
 * The short form on the closed button. Georgian shows GE, the form people in Georgia know (D148); its ISO 639-1 code
 * 'ka' stays the locale and the `lang` attribute.
 */
const CODES: Readonly<Record<Locale, string>> = { en: 'EN', es: 'ES', ka: 'GE' };

/**
 * The interface language in the site header (D140, D143): a small button with the language icon and the current
 * language's code (no chevron: the header has no room for one at 640 px; `aria-expanded` says it opens), opening a list
 * under it with each language it offers (D144) named in itself and marked with its own `lang` (a screen reader reads "ქართული" in
 * Georgian). Not Radix DropdownMenu, which the CSP rules out (D3): a disclosure with a list of buttons. Choosing,
 * Escape, a click elsewhere and a page change close it; switching keeps the page and what it holds.
 */
export function LanguageMenu({ className }: { className?: string | undefined }) {
  const locale = useLocale();
  const listId = useId();
  const [location] = useLocation();
  // The page the list was opened on: a page change closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === location;
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || root.current?.contains(event.target) !== true) setOpenOn(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const close = () => {
    setOpenOn(null);
    button.current?.focus();
  };

  return (
    <div
      ref={root}
      className={cn('relative', className)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <Button
        ref={button}
        variant="ghost"
        size="sm"
        aria-label={`${t('nav.language')}: ${LOCALE_NAMES[locale]}`}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        className="gap-1.5 px-2"
        onClick={() => {
          setOpenOn(open ? null : location);
        }}
      >
        <LanguagesIcon aria-hidden="true" />
        {CODES[locale]}
      </Button>
      {open ? (
        <ul
          id={listId}
          role="list"
          aria-label={t('nav.language')}
          className="animate-reveal absolute top-full right-0 z-50 mt-1 flex min-w-40 flex-col gap-0.5 rounded-md border border-border bg-surface p-1 shadow-md"
        >
          {SELECTABLE_LOCALES.map((option) => (
            <li key={option}>
              <button
                type="button"
                lang={option}
                aria-current={option === locale ? 'true' : undefined}
                className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-sm px-3 py-2 text-left text-sm hover:bg-subtle aria-[current=true]:font-medium max-sm:min-h-11 pointer-coarse:min-h-11"
                onClick={() => {
                  // A catalog that fails to load (network) leaves the page as it was; choosing again retries.
                  changeLocale(option).catch(() => undefined);
                  close();
                }}
              >
                {LOCALE_NAMES[option]}
                {option === locale ? <CheckIcon aria-hidden="true" className="size-4 shrink-0 text-primary" /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
