// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * CLAUDE.md section 9: every user-facing string lives in src/i18n/en.json. This guard parses every .tsx under src/
 * (tests excluded) and fails on text that reaches the screen or assistive technology without t():
 * - JSX text with a word in it (`<p>Hello</p>`);
 * - a string literal or template as a JSX child (`{'Hello'}`, {`Step ${n}`});
 * - a literal in an attribute that people read or hear (aria-label, title, placeholder, alt, ...);
 * - any other attribute literal that reads like a sentence (two words), e.g. message="Something failed".
 * Code identifiers shown on the devnet-only /dev/ui page (button sizes, token class names) are listed explicitly.
 */

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/** Attributes whose value is read or announced. */
const SPOKEN_ATTRIBUTES = new Set([
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'aria-placeholder',
  'title',
  'placeholder',
  'alt',
  'label',
]);

/** /dev/ui shows design-system identifiers as they are written in code; they are not prose. */
const ALLOWED: readonly { file: string; text: string }[] = [
  { file: 'pages/dev-ui/PrimitivesSection.tsx', text: 'sm' },
  { file: 'pages/dev-ui/PrimitivesSection.tsx', text: 'md' },
  { file: 'pages/dev-ui/PrimitivesSection.tsx', text: 'lg' },
  { file: 'pages/dev-ui/TokensSection.tsx', text: 'text-' },
  { file: 'pages/dev-ui/TokensSection.tsx', text: 'shadow-' },
];

const WORD = /[A-Za-z]{2,}/;
const SENTENCE = /[A-Za-z]{2,}\s+[A-Za-z]{2,}/;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [path] : [];
  });
}

type Finding = { file: string; line: number; kind: string; text: string };

function scan(path: string): Finding[] {
  return scanSource(relative(SRC, path), readFileSync(path, 'utf8'));
}

function scanSource(file: string, text: string): Finding[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findings: Finding[] = [];
  const add = (node: ts.Node, kind: string, text: string) => {
    if (ALLOWED.some((allowed) => allowed.file === file && allowed.text === text)) return;
    findings.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, kind, text });
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const text = node.getText().trim();
      if (WORD.test(text)) add(node, 'jsx text', text);
    } else if (ts.isJsxExpression(node) && node.expression !== undefined && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      const expression = node.expression;
      if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
        if (WORD.test(expression.text)) add(node, 'jsx child literal', expression.text);
      } else if (ts.isTemplateExpression(expression)) {
        const literalParts = [expression.head.text, ...expression.templateSpans.map((span) => span.literal.text)].join(' ');
        if (WORD.test(literalParts)) add(node, 'jsx child template', expression.getText());
      }
    } else if (ts.isJsxAttribute(node) && node.initializer !== undefined) {
      const name = node.name.getText();
      let value: ts.Expression | ts.JsxAttributeValue = node.initializer;
      if (ts.isJsxExpression(value) && value.expression !== undefined) value = value.expression;
      if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
        const spoken = SPOKEN_ATTRIBUTES.has(name) && WORD.test(value.text);
        const prose = name !== 'className' && !name.startsWith('data-') && SENTENCE.test(value.text);
        if (spoken || prose) add(node, `attribute ${name}`, value.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

describe('i18n: no user-facing literals in TSX (CLAUDE.md section 9)', () => {
  it('every visible or announced string comes from t()', () => {
    const findings = tsxFiles(SRC).flatMap(scan);
    expect(findings.map((f) => `${f.file}:${String(f.line)} ${f.kind}: ${f.text}`)).toEqual([]);
  });

  it('catches a literal (positive control)', () => {
    const findings = scanSource(
      'probe.tsx',
      'export const A = () => <p aria-label="Close dialog" message="Something failed" className="text-sm font-medium">Hello there {"again"} {`Step ${1}`}</p>;',
    );
    expect(findings.map((f) => f.kind).sort()).toEqual(['attribute aria-label', 'attribute message', 'jsx child literal', 'jsx child template', 'jsx text']);
  });
});
