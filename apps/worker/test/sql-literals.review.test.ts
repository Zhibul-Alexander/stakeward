// Review (CLAUDE.md section 8: queries only with parameters, never built from strings): every `prepare(` in src/
// takes a literal without `${`, or a constant of store.ts `SQL`, whose values are such literals themselves. Values go
// in through bind() only, so nothing from the chain, a request or Telegram can become SQL.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { SQL } from '../src/monitor/store.ts';

type Argument = { kind: 'literal'; text: string } | { kind: 'name'; text: string } | { kind: 'other'; text: string };

/** The argument of each `prepare(` in `source`, read with a small scanner (literals may hold parentheses). */
function prepareArguments(source: string): Argument[] {
  const found: Argument[] = [];
  const call = /\bprepare\(/g;
  for (let match = call.exec(source); match !== null; match = call.exec(source)) {
    let i = match.index + match[0].length;
    while (/\s/.test(source[i] ?? '')) i += 1;
    const quote = source[i];
    if (quote === '`' || quote === "'" || quote === '"') {
      let end = i + 1;
      while (end < source.length && source[end] !== quote) end += source[end] === '\\' ? 2 : 1;
      const text = source.slice(i, end + 1);
      const rest = source.slice(end + 1).match(/^\s*,?\s*\)/);
      found.push({ kind: rest === null ? 'other' : 'literal', text });
      continue;
    }
    const name = source.slice(i).match(/^([A-Za-z_$][\w$.]*)\s*\)/);
    found.push(name === null ? { kind: 'other', text: source.slice(i, i + 60) } : { kind: 'name', text: name[1] ?? '' });
  }
  return found;
}

/** Problems of one argument; none for a literal without `${` or `SQL.<NAME>`. */
function problemsOf(argument: Argument): string[] {
  if (argument.kind === 'literal') return argument.text.includes('${') ? [`interpolated literal ${argument.text}`] : [];
  if (argument.kind === 'name' && /^SQL\.[A-Z][A-Z_]*$/.test(argument.text)) return [];
  return [`not a literal: ${argument.text}`];
}

/** The property values of `export const SQL = { ... } as const;` in store.ts, as source text. */
function sqlBlockValues(source: string): { name: string; text: string }[] {
  const start = source.indexOf('export const SQL = {');
  const end = source.indexOf('} as const;', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const block = source.slice(start + 'export const SQL = {'.length, end);
  const withoutComments = block
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  const entries: { name: string; text: string }[] = [];
  const entry = /([A-Z][A-Z_]*):\s*(`[^`]*`|'[^']*')\s*,/g;
  let consumed = '';
  for (let match = entry.exec(withoutComments); match !== null; match = entry.exec(withoutComments)) {
    entries.push({ name: match[1] ?? '', text: match[2] ?? '' });
    consumed += match[0];
  }
  // Nothing else in the block: no concatenation, no computed values.
  expect(withoutComments.replace(entry, '').trim()).toBe('');
  expect(consumed.length).toBeGreaterThan(0);
  return entries;
}

describe('review: SQL is literal', () => {
  const sources = env.TEST_WORKER_SOURCES;

  it('the scanner finds the forms that are not allowed', () => {
    const bad = [
      'db.prepare(`SELECT * FROM accounts WHERE wallet = ${wallet}`)',
      "db.prepare('SELECT ' + column)",
      'db.prepare(query)',
      'db.prepare(SQL.PAGE + where)',
      'db.prepare(sql.page)',
    ];
    for (const source of bad) {
      const args = prepareArguments(source);
      expect(args, source).toHaveLength(1);
      expect(args.flatMap(problemsOf), source).not.toEqual([]);
    }
    const good = ["db.prepare('SELECT 1')", 'db.prepare(`SELECT (1)\nFROM meta`)', 'db\n  .prepare(SQL.STOP)\n  .bind(x)'];
    for (const source of good) expect(prepareArguments(source).flatMap(problemsOf), source).toEqual([]);
  });

  it('reads the sources of src/', () => {
    const files = Object.keys(sources);
    expect(files).toContain('monitor/store.ts');
    expect(files).toContain('telegram/webhook.ts');
    expect(files).toContain('public-api.ts');
  });

  it('every prepare( in src/ takes a literal without ${ or an SQL constant', () => {
    const problems: string[] = [];
    let calls = 0;
    for (const [file, source] of Object.entries(sources)) {
      for (const argument of prepareArguments(source)) {
        calls += 1;
        for (const problem of problemsOf(argument)) problems.push(`${file}: ${problem}`);
      }
    }
    expect(problems).toEqual([]);
    expect(calls).toBeGreaterThan(20);
  });

  it('every value of store.ts SQL is a literal without ${', () => {
    const entries = sqlBlockValues(sources['monitor/store.ts'] ?? '');
    expect(entries.map((e) => e.name).sort()).toEqual(Object.keys(SQL).sort());
    for (const { name, text } of entries) expect(text.includes('${'), name).toBe(false);
    for (const value of Object.values(SQL)) expect(typeof value).toBe('string');
  });
});
