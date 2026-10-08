import type { CSSProperties, ReactNode } from 'react';
import tokensCss from '@/styles/tokens.css?raw';
import { parseTokens } from './tokens.ts';

const COLOURS = parseTokens(tokensCss).colours;

/**
 * Components in the dark theme whatever the browser prefers: the panel re-declares every --color-* variable with its
 * dark value (read from tokens.css) through the style prop (CSSOM, allowed by the CSP), and the token classes inside
 * resolve to them. `data-dark-preview`, not the token tables' `data-theme-preview`: e2e/dev-ui.spec.ts counts swatches
 * by the latter.
 */
export function DarkPreview({ children }: { children: ReactNode }) {
  const vars = Object.fromEntries(COLOURS.map((colour) => [`--color-${colour.name}`, colour.dark])) as CSSProperties;
  return (
    <div style={vars} data-dark-preview="" className="flex flex-col gap-4 rounded-lg border border-border bg-background p-4 text-foreground">
      {children}
    </div>
  );
}
