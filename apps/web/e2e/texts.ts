import { readFileSync } from 'node:fs';
import type { MessageKey, MessageParams } from '../src/i18n/index.ts';

/**
 * The site's strings for Playwright (step 8 spec 12.3): headings and link names come from src/i18n/en.json, the file
 * the built site renders, so a copy edit does not break the browser tests. The file is read from disk, not imported;
 * the key type still comes from src/i18n, so a renamed key fails `pnpm typecheck`. A key with no string throws, and
 * `{name}` placeholders are filled the way `t()` fills them.
 */
const MESSAGES: unknown = JSON.parse(readFileSync(new URL('../src/i18n/en.json', import.meta.url), 'utf8'));

const PLACEHOLDER = /\{(\w+)\}/g;

export function text(key: MessageKey, params?: MessageParams): string {
  let node: unknown = MESSAGES;
  for (const part of key.split('.')) {
    node = typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined;
  }
  if (typeof node !== 'string') throw new Error(`en.json has no string at ${key}`);
  if (params === undefined) return node;
  return node.replace(PLACEHOLDER, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
