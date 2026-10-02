import { readFileSync } from 'node:fs';

/** apps/web/public/_headers: security headers that Workers Static Assets adds to every page (CLAUDE.md section 11). */
export const STATIC_HEADERS_FILE = new URL('./public/_headers', import.meta.url);

/**
 * The `/*` block of a Workers Static Assets `_headers` file as name -> value (names as written). `vite preview`
 * serves the same headers, so Playwright runs under the production CSP without a second copy of the strings.
 */
export function parseHeadersFile(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  let inAllPaths = false;
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      inAllPaths = line.trim() === '/*';
      continue;
    }
    if (!inAllPaths) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) throw new Error(`Malformed _headers line: ${line}`);
    headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return headers;
}

export function readStaticHeaders(): Record<string, string> {
  return parseHeadersFile(readFileSync(STATIC_HEADERS_FILE, 'utf8'));
}
