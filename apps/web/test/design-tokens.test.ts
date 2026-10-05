// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseTokens } from '@/pages/dev-ui/tokens';

/**
 * CLAUDE.md section 9: colours, sizes and other raw design values live only in src/styles/tokens.css. Components and
 * pages use token utilities (bg-surface, text-muted, rounded-md, p-4). This test scans every .ts, .tsx and .css file
 * under src/ except tokens.css, and checks the WCAG contrast of the token pairs in both themes.
 */

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const TOKENS_FILE = join(SRC, 'styles', 'tokens.css');

type Finding = { rule: string; match: string };

const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|mauve|olive|mist|taupe';
const COLOR_UTILITY =
  'bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|outline|fill|stroke|from|via|to|decoration|divide|placeholder|caret|accent|shadow|inset-shadow|inset-ring|drop-shadow|text-shadow';

const RULES: { rule: string; pattern: RegExp; files: 'all' | 'code' | 'css' }[] = [
  // #fff, #ffffff, #ffffff80 where a colour would stand (not '/#cannot-do' or '#main').
  { rule: 'hex colour', pattern: /(?<=['"`\s(:,[])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi, files: 'all' },
  { rule: 'colour function', pattern: /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(/gi, files: 'all' },
  // Tailwind's own palette (bg-red-500, text-neutral-700, border-white): reset in tokens.css, never used.
  {
    rule: 'palette class',
    pattern: new RegExp(`(?<![\\w-])(?:${COLOR_UTILITY})-(?:(?:${PALETTE})-\\d{2,3}|white|black)(?![\\w-])`, 'g'),
    files: 'code',
  },
  // style={{ color: ... }} and friends: colours go through classes.
  {
    rule: 'inline style colour',
    pattern:
      /style=\{\{[^}]*\b(?:color|background|backgroundColor|borderColor|outlineColor|fill|stroke|boxShadow|textShadow)\s*:/g,
    files: 'code',
  },
  // Raw lengths in CSS outside tokens.css (0 is fine).
  { rule: 'raw CSS length', pattern: /(?<![\w.-])(?:\d*\.\d+|[1-9]\d*)(?:px|rem|em)\b/g, files: 'css' },
];

/** Tailwind utility with an arbitrary value: w-[12px], bg-[#fff], text-[0.8rem], size-(--x), grid-cols-[1fr_auto]. */
const ARBITRARY_VALUE = /^-?[a-z][a-z0-9-]*-(?:\[[^\]]*\]|\([^)]*\))(?:\/\S+)?$/;
/** Arbitrary property: [color:red], [--card-spacing:4px]. */
const ARBITRARY_PROPERTY = /^\[(?:--)?[a-z][\w-]*:[^\]]+\]$/;
/** Arbitrary breakpoint variants are raw sizes too: min-[400px]:, max-[600px]:. */
const ARBITRARY_BREAKPOINT = /^(?:min|max)-\[/;

/** Splits `md:hover:[&_svg]:size-4` into variants and the utility, ignoring colons inside brackets. */
function splitVariants(token: string): { variants: string[]; utility: string } {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of token) {
    if (char === '[' || char === '(') depth += 1;
    if (char === ']' || char === ')') depth -= 1;
    if (char === ':' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  return { variants: parts, utility: current };
}

function arbitraryValues(code: string): Finding[] {
  const findings: Finding[] = [];
  for (const literal of code.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)) {
    const text = literal[1] ?? literal[2] ?? literal[3] ?? '';
    for (const raw of text.split(/\s+/)) {
      const token = raw.replace(/^!|!$/g, '');
      if (token === '') continue;
      const { variants, utility } = splitVariants(token);
      if (ARBITRARY_VALUE.test(utility) || ARBITRARY_PROPERTY.test(utility)) {
        findings.push({ rule: 'arbitrary value', match: token });
      } else if (variants.some((variant) => ARBITRARY_BREAKPOINT.test(variant))) {
        findings.push({ rule: 'arbitrary breakpoint', match: token });
      }
    }
  }
  return findings;
}

/** Everything the guard rejects in one file's text. `kind` picks the rules: code (.ts/.tsx) or css. */
function findRawDesignValues(text: string, kind: 'code' | 'css'): Finding[] {
  const findings: Finding[] = [];
  for (const { rule, pattern, files } of RULES) {
    if (files !== 'all' && files !== kind) continue;
    for (const match of text.matchAll(pattern)) findings.push({ rule, match: match[0] });
  }
  if (kind === 'code') findings.push(...arbitraryValues(text));
  return findings;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return ['.ts', '.tsx', '.css'].includes(extname(entry.name)) ? [path] : [];
  });
}

describe('raw design values outside tokens.css', () => {
  it('the guard catches each kind of raw value (positive control)', () => {
    const bad = [
      `const a = 'bg-[#fff]';`,
      `const b = "text-[0.8rem] rounded-[min(var(--radius-md),10px)]";`,
      `const c = 'w-[12px] p-[3px] grid-cols-[1fr_auto] size-(--card) [--card-spacing:4px] min-[400px]:flex';`,
      `const d = 'bg-red-500 text-neutral-700 border-white hover:bg-black/50 ring-offset-slate-100';`,
      `const e = '#ffffff'; const f = "rgb(0 0 0)"; const g = 'oklch(0.5 0.1 200)';`,
      `<div style={{ color: 'red' }} />`,
      `<div style={{ backgroundColor: x }} />`,
    ].join('\n');
    const rules = findRawDesignValues(bad, 'code').map((f) => f.rule);
    expect(new Set(rules)).toEqual(
      new Set(['hex colour', 'colour function', 'palette class', 'inline style colour', 'arbitrary value', 'arbitrary breakpoint']),
    );
    expect(findRawDesignValues(bad, 'code').filter((f) => f.rule === 'arbitrary value')).toHaveLength(8);
    expect(findRawDesignValues(bad, 'code').filter((f) => f.rule === 'palette class')).toHaveLength(5);

    const css = `a { color: #fff; margin: 12px; padding: 0.5rem; border: 0; inset: 0px; }`;
    expect(findRawDesignValues(css, 'css').map((f) => f.match)).toEqual(['#fff', '12px', '0.5rem']);
  });

  it('the guard leaves token classes, variants with selectors and ordinary strings alone (negative control)', () => {
    const good = [
      `const a = 'bg-surface text-muted rounded-md p-4 shadow-sm border-border-strong text-neutral bg-neutral-soft';`,
      `const b = "data-[state=open]:animate-fade-in [&_svg:not([class*='size-'])]:size-4 has-[>svg]:grid-cols-icon *:[svg]:size-4";`,
      `const c = 'hover:bg-primary-hover md:text-sm -translate-x-1/2 after:-inset-2 size-2.5';`,
      `const d = '/#cannot-do'; const e = '#main'; const f = 'https://explorer.solana.com/tx/abc?cluster=devnet';`,
      `throw new Error('Set VITE_CLUSTER=devnet (pnpm build:devnet / build:mainnet).');`,
      'const g = `translateX(-${String(100 - percent)}%)`;',
      `<div style={{ transform: x }} />`,
    ].join('\n');
    expect(findRawDesignValues(good, 'code')).toEqual([]);
    expect(findRawDesignValues(`a { outline: var(--focus-ring-width) solid var(--color-ring); min-height: 100dvh; }`, 'css')).toEqual(
      [],
    );
  });

  it('src/ has none (tokens.css is the only exception)', () => {
    const files = sourceFiles(SRC).filter((file) => file !== TOKENS_FILE);
    expect(files.length).toBeGreaterThan(10);
    const report = files.flatMap((file) =>
      findRawDesignValues(readFileSync(file, 'utf8'), file.endsWith('.css') ? 'css' : 'code').map(
        (f) => `${relative(SRC, file)}: ${f.rule}: ${f.match}`,
      ),
    );
    expect(report).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------

type Theme = Map<string, string>;

/**
 * The dark theme's media query. `screen` keeps it off paper: a printed recovery card is dark text on white whatever
 * the reader's system theme (DECISIONS.md D77).
 */
const DARK_QUERY = '@media screen and (prefers-color-scheme: dark)';

const COLOUR_DECLARATION = /--color-([\w-]+):\s*(#[0-9a-f]{6});/gi;

/** `--color-<name>: #rrggbb` from the light block (@theme) and the dark block (DARK_QUERY); `rest` is what follows. */
function readThemes(css: string): { light: Theme; dark: Theme; rest: string } {
  const darkStart = css.indexOf(DARK_QUERY);
  const darkEnd = css.indexOf('@media', darkStart + 1);
  if (darkStart < 0 || darkEnd < 0) throw new Error('tokens.css: dark theme block not found');
  const read = (part: string): Theme =>
    new Map([...part.matchAll(COLOUR_DECLARATION)].map((m) => [m[1] ?? '', (m[2] ?? '').toLowerCase()]));
  return { light: read(css.slice(0, darkStart)), dark: read(css.slice(darkStart, darkEnd)), rest: css.slice(darkEnd) };
}

function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ['background', 'surface', 'surface-raised'];
const TONES = ['success', 'warning', 'neutral', 'info', 'danger'];

/** Text pairs need 4.5:1 (WCAG 1.4.3 AA). */
const TEXT_PAIRS: [string, string][] = [
  ...SURFACES.flatMap((bg): [string, string][] => [
    ['foreground', bg],
    ['muted', bg],
    ['primary', bg],
    ...TONES.map((tone): [string, string] => [tone, bg]),
  ]),
  ['foreground', 'subtle'],
  ['muted', 'subtle'],
  ['foreground', 'subtle-hover'],
  ['on-primary', 'primary'],
  ['on-primary', 'primary-hover'],
  ['primary-hover', 'surface'],
  ['on-inverse', 'inverse'],
  ['on-danger', 'danger-solid'],
  ['on-danger', 'danger-solid-hover'],
  ...TONES.flatMap((tone): [string, string][] => [
    [tone, `${tone}-soft`],
    ['foreground', `${tone}-soft`],
  ]),
  // QR modules on their ground (the same in both themes): scanners need strong contrast.
  ['qr-dark', 'qr-light'],
];

/** Control outlines, focus indicator and the checked fill need 3:1 against what surrounds them (WCAG 1.4.11). */
const UI_PAIRS: [string, string][] = SURFACES.flatMap((bg): [string, string][] => [
  ['border-strong', bg],
  ['ring', bg],
  ['primary', bg],
]);

describe('tokens.css colours', () => {
  const css = readFileSync(TOKENS_FILE, 'utf8');
  const themes = readThemes(css);

  it('the dark theme defines every colour of the light theme', () => {
    expect(themes.light.size).toBeGreaterThan(20);
    expect([...themes.dark.keys()].sort()).toEqual([...themes.light.keys()].sort());
  });

  for (const [name, theme] of Object.entries({ light: themes.light, dark: themes.dark })) {
    it(`${name} theme: text 4.5:1, controls and focus 3:1`, () => {
      const failures: string[] = [];
      const check = (pairs: [string, string][], minimum: number) => {
        for (const [fg, bg] of pairs) {
          const a = theme.get(fg);
          const b = theme.get(bg);
          if (a === undefined || b === undefined) {
            failures.push(`missing --color-${a === undefined ? fg : bg}`);
            continue;
          }
          const ratio = contrastRatio(a, b);
          if (ratio < minimum) failures.push(`${fg} on ${bg}: ${ratio.toFixed(2)} < ${String(minimum)}`);
        }
      };
      check(TEXT_PAIRS, 4.5);
      check(UI_PAIRS, 3);
      expect(failures).toEqual([]);
    });
  }

  it('print is always light: the dark theme applies to screens only, and no other block overrides a colour', () => {
    expect(css).toContain(DARK_QUERY);
    // Exactly one dark block, and the only colour overrides are the light theme and that block.
    expect([...css.matchAll(/@media[^{]*prefers-color-scheme[^{]*/g)].map((m) => m[0].trim())).toEqual([DARK_QUERY]);
    expect([...themes.rest.matchAll(/--color-[\w-]+\s*:/g)].map((m) => m[0])).toEqual([]);
    const all = [...css.matchAll(/--color-[\w-]+\s*:\s*#/g)].length;
    expect(all).toBe(themes.light.size + themes.dark.size);
    // Paper: browser-drawn parts (form controls, scrollbars) are light too.
    expect(css.replace(/\s+/g, ' ')).toContain('@media print { :root { color-scheme: light; } }');
  });

  it('the /dev/ui token tables read both themes from tokens.css', () => {
    const { colours } = parseTokens(css);
    expect(colours.map((colour) => colour.name).sort()).toEqual([...themes.light.keys()].sort());
    expect(colours.filter((colour) => colour.dark !== themes.dark.get(colour.name)).map((colour) => colour.name)).toEqual([]);
  });

  it('the QR pair does not change with the theme: phone cameras need dark modules on a light ground', () => {
    for (const name of ['qr-dark', 'qr-light']) {
      expect(themes.dark.get(name), name).toBeDefined();
      expect(themes.dark.get(name), name).toBe(themes.light.get(name));
    }
    expect(relativeLuminance(themes.light.get('qr-dark') ?? '')).toBeLessThan(relativeLuminance(themes.light.get('qr-light') ?? ''));
  });

  it('contrast maths matches known WCAG values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });
});
