/**
 * Reads the design tokens out of tokens.css (the only place raw values live) for the /dev/ui token tables, so the
 * page always shows the real values of both themes. The classes below must be written out in full: Tailwind only
 * generates utilities it finds in the source. e2e/dev-ui.spec.ts fails when tokens.css gains a colour that has no
 * class here (its swatch would stay transparent).
 */

import type { MessageKey } from '@/i18n';

export type ColourToken = { name: string; light: string; dark: string };
export type SizeToken = { name: string; value: string };

export type Tokens = {
  colours: ColourToken[];
  textSizes: SizeToken[];
  radii: SizeToken[];
  shadows: string[];
  spacing: string;
  /** Grid column templates (`--grid-template-columns-<name>`, the class `grid-cols-<name>`). */
  gridColumns: SizeToken[];
};

function block(css: string, start: number, end: number): string {
  return css.slice(start, end < 0 ? undefined : end);
}

/** `--<prefix><name>: <value>;` pairs of one block, in source order. */
function declarations(text: string, prefix: string): [string, string][] {
  const pattern = new RegExp(`--${prefix}([\\w-]+):\\s*([^;]+);`, 'g');
  return [...text.matchAll(pattern)].map((m) => [m[1] ?? '', (m[2] ?? '').trim()]);
}

/**
 * Token tables from the text of tokens.css. Empty when the text has no theme blocks: Vitest does not load CSS
 * (`?raw` of a .css file is '' there), and the page must still render in component tests. e2e/dev-ui.spec.ts checks
 * on the built site that every table is filled and every swatch has a colour.
 */
export function parseTokens(css: string): Tokens {
  const themeStart = css.indexOf('@theme');
  const darkStart = css.indexOf('@media screen and (prefers-color-scheme: dark)');
  const darkEnd = css.indexOf('@media', darkStart + 1);
  if (themeStart < 0 || darkStart < 0) return { colours: [], textSizes: [], radii: [], shadows: [], spacing: '', gridColumns: [] };
  const light = block(css, themeStart, darkStart);
  const dark = new Map(declarations(block(css, darkStart, darkEnd), 'color-'));
  const isValue = ([, value]: [string, string]) => value !== 'initial';
  return {
    colours: declarations(light, 'color-')
      .filter(isValue)
      .map(([name, value]) => ({ name, light: value, dark: dark.get(name) ?? value })),
    textSizes: declarations(light, 'text-')
      .filter(isValue)
      .filter(([name]) => !name.includes('--'))
      .map(([name, value]) => ({ name, value })),
    radii: declarations(light, 'radius-')
      .filter(isValue)
      .map(([name, value]) => ({ name, value })),
    shadows: declarations(light, 'shadow-')
      .filter(isValue)
      .map(([name]) => name),
    spacing: declarations(light, '').find(([name]) => name === 'spacing')?.[1] ?? '',
    gridColumns: declarations(light, 'grid-template-columns-')
      .filter(isValue)
      .map(([name, value]) => ({ name, value })),
  };
}

/** Background class per colour token (written out for Tailwind). */
export const SWATCH_CLASS: Record<string, string> = {
  background: 'bg-background',
  surface: 'bg-surface',
  'surface-raised': 'bg-surface-raised',
  subtle: 'bg-subtle',
  'subtle-hover': 'bg-subtle-hover',
  foreground: 'bg-foreground',
  muted: 'bg-muted',
  border: 'bg-border',
  'border-strong': 'bg-border-strong',
  ring: 'bg-ring',
  primary: 'bg-primary',
  'primary-hover': 'bg-primary-hover',
  'on-primary': 'bg-on-primary',
  'primary-soft': 'bg-primary-soft',
  inverse: 'bg-inverse',
  'on-inverse': 'bg-on-inverse',
  success: 'bg-success',
  'success-soft': 'bg-success-soft',
  'success-border': 'bg-success-border',
  warning: 'bg-warning',
  'warning-soft': 'bg-warning-soft',
  'warning-border': 'bg-warning-border',
  neutral: 'bg-neutral',
  'neutral-soft': 'bg-neutral-soft',
  'neutral-border': 'bg-neutral-border',
  info: 'bg-info',
  'info-soft': 'bg-info-soft',
  'info-border': 'bg-info-border',
  danger: 'bg-danger',
  'danger-soft': 'bg-danger-soft',
  'danger-border': 'bg-danger-border',
  'danger-solid': 'bg-danger-solid',
  'danger-solid-hover': 'bg-danger-solid-hover',
  'on-danger': 'bg-on-danger',
  'qr-dark': 'bg-qr-dark',
  'qr-light': 'bg-qr-light',
};

export const TEXT_CLASS: Record<string, string> = {
  xs: 'text-xs',
  sm: 'text-sm',
  base: 'text-base',
  lg: 'text-lg',
  '2xl': 'text-2xl',
  '3xl': 'text-3xl',
};

/** The role of each size (the table in tokens.css, DECISIONS.md D109). */
export const TEXT_ROLE: Record<string, MessageKey> = {
  xs: 'devUi.typeRoles.xs',
  sm: 'devUi.typeRoles.sm',
  base: 'devUi.typeRoles.base',
  lg: 'devUi.typeRoles.lg',
  '2xl': 'devUi.typeRoles.2xl',
  '3xl': 'devUi.typeRoles.3xl',
};

export const RADIUS_CLASS: Record<string, string> = {
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
};

export const SHADOW_CLASS: Record<string, string> = {
  sm: 'shadow-sm',
  md: 'shadow-md',
  lg: 'shadow-lg',
};

/** Class per grid column template; /dev/ui draws each with it, one cell per column. */
export const GRID_COLUMNS_CLASS: Record<string, string> = {
  'account-row': 'grid-cols-account-row',
  'account-row-actions': 'grid-cols-account-row-actions',
};

/** Spacing steps shown on the page (multiples of the spacing unit) and their width classes. */
export const SPACING_STEPS: readonly [number, string][] = [
  [1, 'w-1'],
  [2, 'w-2'],
  [3, 'w-3'],
  [4, 'w-4'],
  [6, 'w-6'],
  [8, 'w-8'],
  [12, 'w-12'],
  [16, 'w-16'],
  [24, 'w-24'],
];
