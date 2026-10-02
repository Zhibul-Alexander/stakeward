import type { CSSProperties } from 'react';
import { t } from '@/i18n';
import tokensCss from '@/styles/tokens.css?raw';
import { DemoGroup, DevSection } from './layout.tsx';
import {
  parseTokens,
  RADIUS_CLASS,
  SHADOW_CLASS,
  SPACING_STEPS,
  SWATCH_CLASS,
  TEXT_CLASS,
  type ColourToken,
} from './tokens.ts';

const TOKENS = parseTokens(tokensCss);

/**
 * A panel that renders with one theme's colours whatever the browser prefers: it re-declares every --color-*
 * variable (values read from tokens.css) on itself through the style prop (CSSOM, allowed by the CSP), and the token
 * classes inside resolve to them.
 */
function ThemePanel({ theme, colours }: { theme: 'light' | 'dark'; colours: ColourToken[] }) {
  const vars = Object.fromEntries(colours.map((colour) => [`--color-${colour.name}`, colour[theme]])) as CSSProperties;
  return (
    <div style={vars} data-theme-preview={theme} className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4 text-foreground">
      <h4 className="font-semibold">{t(theme === 'light' ? 'devUi.lightTheme' : 'devUi.darkTheme')}</h4>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {colours.map((colour) => (
          <li key={colour.name} className="flex items-center gap-3 rounded-md bg-surface p-2">
            <span
              aria-hidden="true"
              className={`size-8 shrink-0 rounded-md border border-border-strong ${SWATCH_CLASS[colour.name] ?? ''}`}
            />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-mono text-xs font-medium">{colour.name}</span>
              <span className="font-mono text-xs text-muted">{colour[theme]}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TokensSection() {
  return (
    <DevSection id="tokens" title={t('devUi.tokens')}>
      <DemoGroup title={t('devUi.colours')} note={t('devUi.coloursNote')}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ThemePanel theme="light" colours={TOKENS.colours} />
          <ThemePanel theme="dark" colours={TOKENS.colours} />
        </div>
      </DemoGroup>

      <DemoGroup title={t('devUi.typeScale')}>
        <ul className="flex flex-col gap-3">
          {TOKENS.textSizes.map((size) => (
            <li key={size.name} className="flex flex-col gap-1 border-b border-border pb-3 sm:flex-row sm:items-baseline sm:gap-4">
              <span className="w-28 shrink-0 font-mono text-xs text-muted">
                text-{size.name} · {size.value}
              </span>
              <span className={`min-w-0 ${TEXT_CLASS[size.name] ?? ''}`}>{t('devUi.typeSample')}</span>
            </li>
          ))}
        </ul>
      </DemoGroup>

      <DemoGroup title={t('devUi.fonts')}>
        <p className="font-sans">{t('devUi.sansSample')}</p>
        <p className="font-mono text-sm break-all">{t('devUi.monoSample')}</p>
      </DemoGroup>

      <DemoGroup title={t('devUi.spacing')} note={t('devUi.spacingNote', { unit: TOKENS.spacing })}>
        <ul className="flex flex-col gap-2">
          {SPACING_STEPS.map(([step, widthClass]) => (
            <li key={step} className="flex items-center gap-3">
              <span className="w-12 shrink-0 font-mono text-xs text-muted">{step}</span>
              <span aria-hidden="true" className={`h-3 rounded-sm bg-primary ${widthClass}`} />
            </li>
          ))}
        </ul>
      </DemoGroup>

      <DemoGroup title={t('devUi.radii')}>
        <ul className="flex flex-wrap gap-4">
          {TOKENS.radii.map((radius) => (
            <li key={radius.name} className="flex flex-col items-center gap-2">
              <span
                aria-hidden="true"
                className={`size-16 border border-border-strong bg-subtle ${RADIUS_CLASS[radius.name] ?? ''}`}
              />
              <span className="font-mono text-xs text-muted">
                {radius.name} · {radius.value}
              </span>
            </li>
          ))}
        </ul>
      </DemoGroup>

      <DemoGroup title={t('devUi.shadows')}>
        <ul className="flex flex-wrap gap-6">
          {TOKENS.shadows.map((shadow) => (
            <li key={shadow} className="flex flex-col items-center gap-2">
              <span aria-hidden="true" className={`size-16 rounded-lg bg-surface ${SHADOW_CLASS[shadow] ?? ''}`} />
              <span className="font-mono text-xs text-muted">shadow-{shadow}</span>
            </li>
          ))}
        </ul>
      </DemoGroup>
    </DevSection>
  );
}
