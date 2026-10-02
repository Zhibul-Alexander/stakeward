import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

/** Parses the `/*` block of a Workers Static Assets `_headers` file into name -> value. */
function parseHeadersFile(text: string): Map<string, string> {
  const headers = new Map<string, string>();
  let inAllPaths = false;
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      inAllPaths = line.trim() === '/*';
      continue;
    }
    if (!inAllPaths) continue;
    const colon = line.indexOf(':');
    headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return headers;
}

describe('static _headers and API headers', () => {
  it('apps/web/public/_headers sets the same values that /api responses get', async () => {
    const fileHeaders = parseHeadersFile(env.TEST_STATIC_HEADERS_FILE);
    expect([...fileHeaders.keys()].sort()).toEqual([
      'content-security-policy',
      'referrer-policy',
      'strict-transport-security',
      'x-content-type-options',
    ]);

    const res = await exports.default.fetch('https://stakeward.test/api/health');
    for (const [name, value] of fileHeaders) {
      expect(res.headers.get(name), name).toBe(value);
    }
  });
});
