import { describe, expect, it } from 'vitest';
import en from './en.json';
import es from './es.json';
import ka from './ka.json';

/**
 * The translations (DECISIONS.md D140). en.json is the source; es.json and ka.json must say the same things with the
 * same parts: every key, every `{placeholder}`, every line break (FAQ paragraphs), every number, command and flag,
 * and the names of products and devices. They keep the rules en.json keeps (i18n.test.ts): the program's words only in
 * the FAQ and on the recovery card, never "2FA", and one name for each key role.
 */

function leaves(node: unknown, prefix = ''): [string, string][] {
  if (typeof node === 'string') return [[prefix, node]];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leaves(value, prefix === '' ? key : `${prefix}.${key}`),
  );
}

const SOURCE = new Map(leaves(en));

/** Sorted, so two lists compare as multisets. */
const sorted = (items: readonly string[]) => [...items].sort();
const placeholders = (text: string) => sorted(text.match(/\{\w+\}/g) ?? []);
const lineBreaks = (text: string) => (text.match(/\n/g) ?? []).length;
const numbers = (text: string) => sorted(text.replace(/\{\w+\}/g, '').match(/\d+/g) ?? []);
/** `solana withdraw-stake` and `--custodian`: what a reader types, so it must stay exactly as written. */
const commands = (text: string) =>
  sorted([...(text.match(/solana [a-z]+(?:-[a-z]+)+/g) ?? []), ...(text.match(/(?<![\w-])--[a-z][a-z-]*/g) ?? [])]);
/** Names a translation keeps as they are: products, devices, units, and labels a Ledger shows in English. */
const NAMES = ['Stakeward', 'SOL', 'Solana', 'Phantom', 'Solflare', 'Backpack', 'Ledger', 'Telegram', 'Squads', 'UTC', 'GitHub', 'MIT', 'New authority'];
const hasName = (text: string, name: string) => new RegExp(`(?<![A-Za-z])${name}(?![A-Za-z])`).test(text);

const TRANSLATIONS = [
  {
    locale: 'es',
    messages: es,
    roles: { main: 'Clave principal', second: 'Segunda clave', new: 'Billetera nueva' },
    // The same role in other words would make a reader wonder whether it is a third key (D81, G2).
    synonyms: /segunda billetera|billetera principal|billetera secundaria|clave de respaldo|clave de recuperaci[oó]n|clave secundaria|cofirmante|guardi[aá]n|monedero|cartera/i,
    roleStems: { main: /clave principal/i, second: /segunda clave/i, new: /billetera nueva/i },
  },
  {
    locale: 'ka',
    messages: ka,
    roles: { main: 'მთავარი გასაღები', second: 'მეორე გასაღები', new: 'ახალი საფულე' },
    synonyms: /მეორე საფულ|მთავარ\S* საფულ|სარეზერვო გასაღებ|აღდგენის გასაღებ|მეურვე/,
    // Georgian declines the adjective too: მთავარი გასაღები, მთავარ გასაღებს.
    roleStems: { main: /მთავარ\S* გასაღებ/, second: /მეორე გასაღებ/, new: /ახალ\S* საფულ/ },
  },
] as const;

describe.each(TRANSLATIONS)('$locale.json', ({ messages, roles, synonyms, roleStems }) => {
  const entries = leaves(messages);
  const translated = new Map(entries);

  it('has exactly the keys of en.json, each a string that is not empty', () => {
    expect(sorted(entries.map(([key]) => key))).toEqual(sorted([...SOURCE.keys()]));
    expect(entries.filter(([, text]) => typeof text !== 'string' || text.trim() === '').map(([key]) => key)).toEqual([]);
  });

  it('keeps every placeholder, line break, number, command and flag of the English text', () => {
    const differ = (part: (text: string) => unknown) =>
      [...SOURCE].filter(([key, text]) => JSON.stringify(part(text)) !== JSON.stringify(part(translated.get(key) ?? ''))).map(([key]) => key);
    expect(differ(placeholders), 'placeholders').toEqual([]);
    expect(differ(lineBreaks), 'line breaks').toEqual([]);
    expect(differ(numbers), 'numbers').toEqual([]);
    expect(differ(commands), 'commands').toEqual([]);
  });

  it('keeps the names of products, devices and units', () => {
    const missing = [...SOURCE].flatMap(([key, text]) =>
      NAMES.filter((name) => hasName(text, name) && !hasName(translated.get(key) ?? '', name)).map((name) => `${key}: ${name}`),
    );
    expect(missing).toEqual([]);
  });

  it('names the three key roles as en.json does, and never by another name', () => {
    expect(messages.common.roles).toEqual(roles);
    const english = { main: /main key/i, second: /second key/i, new: /new wallet/i } as const;
    const unnamed = [...SOURCE].flatMap(([key, text]) =>
      (['main', 'second', 'new'] as const)
        .filter((role) => english[role].test(text) && !roleStems[role].test(translated.get(key) ?? ''))
        .map((role) => `${key}: ${role}`),
    );
    expect(unnamed).toEqual([]);
    expect(entries.filter(([, text]) => synonyms.test(text)).map(([key]) => key)).toEqual([]);
  });

  it('uses the program words custodian/withdrawer/staker only in faq.* and recovery.*, and never says 2FA', () => {
    const offending = entries
      .filter(([key]) => !key.startsWith('faq.') && !key.startsWith('recovery.'))
      .filter(([, text]) => /custodian|withdrawer|staker/i.test(text))
      .map(([key]) => key);
    expect(offending).toEqual([]);
    expect(entries.filter(([, text]) => /2fa|two-factor|dos factores|doble factor|ორფაქტორ/i.test(text)).map(([key]) => key)).toEqual([]);
  });

  it('points the command line hints for locks Stakeward cannot handle to the option that makes them work', () => {
    expect(messages.withdraw.unsupportedLock).toContain('solana withdraw-stake --help');
    expect(messages.rescue.stake.unsupported).toContain('solana stake-authorize --help');
  });
});
