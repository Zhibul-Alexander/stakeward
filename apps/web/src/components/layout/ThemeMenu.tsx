import { MoonIcon, SunIcon, SunMoonIcon, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { t } from '@/i18n';
import { applyTheme, readStoredTheme, storeTheme, THEMES, type Theme } from '@/theme';
import { HeaderMenu } from './HeaderMenu.tsx';

const ICONS: Readonly<Record<Theme, LucideIcon>> = { system: SunMoonIcon, light: SunIcon, dark: MoonIcon };

/**
 * The colour theme in the site header, next to the language (D151): the system theme by default, or light or dark.
 * The closed button shows only the current theme's icon (its name is in the button's label), so the header keeps one
 * row from 640 px and two below. The page changes at once; the choice is kept for the next visit (theme.ts).
 */
export function ThemeMenu({ className }: { className?: string | undefined }) {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme());
  const Icon = ICONS[theme];
  return (
    <HeaderMenu
      className={className}
      label={t('nav.theme')}
      buttonLabel={`${t('nav.theme')}: ${t(`nav.themes.${theme}`)}`}
      buttonContent={<Icon aria-hidden="true" />}
      items={THEMES.map((option) => ({
        id: option,
        label: t(`nav.themes.${option}`),
        icon: ICONS[option],
        current: option === theme,
        onSelect: () => {
          applyTheme(option);
          storeTheme(option);
          setTheme(option);
        },
      }))}
    />
  );
}
