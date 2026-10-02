import en from './en.json';

/**
 * UI strings (CLAUDE.md section 9: every string lives in en.json; Russian comes later). `t('status.protected')`
 * returns the text; `{name}` placeholders are filled from `params`. Keys are checked at compile time against
 * en.json, so a typo or a removed key fails `pnpm typecheck`.
 */
export type Messages = typeof en;

type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** Every dotted key of en.json that holds a string, e.g. `'common.roles.main'`. */
export type MessageKey = Leaves<Messages>;

export type MessageParams = Readonly<Record<string, string | number>>;

const PLACEHOLDER = /\{(\w+)\}/g;

export function t(key: MessageKey, params?: MessageParams): string {
  const text = lookup(en, key);
  if (params === undefined) return text;
  return text.replace(PLACEHOLDER, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

function lookup(messages: Messages, key: string): string {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    node = typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined;
  }
  // Unreachable for a typed key; returning the key keeps a bad cast visible on screen instead of crashing.
  return typeof node === 'string' ? node : key;
}
