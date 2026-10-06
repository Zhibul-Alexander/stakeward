// scripts/verify-deploy.ts without git, pnpm or the network: arguments, which files are fetched from where, the
// references of the served index.html, the comparison and the report.
import { describe, expect, it } from 'vitest';
import { ORIGIN_OF, parseVerifyArgs, UsageError, VERIFY_USAGE } from './args.ts';
import type { FileHash } from './manifest.ts';
import { assetReferences, compareServed, renderVerifyReport, servedPath, type Served } from './verify.ts';

describe('parseVerifyArgs', () => {
  it('the environment gives the cluster and the origin; the commit defaults to HEAD', () => {
    expect(parseVerifyArgs(['--env', 'dev'])).toEqual({
      help: false,
      env: 'dev',
      cluster: 'devnet',
      origin: ORIGIN_OF.dev,
      commit: 'HEAD',
    });
    expect(parseVerifyArgs(['--', '--env', 'prod', '--commit', 'dd9cd96'])).toEqual({
      help: false,
      env: 'prod',
      cluster: 'mainnet',
      origin: ORIGIN_OF.prod,
      commit: 'dd9cd96',
    });
  });

  it('--origin takes an https origin (http only for localhost), without a path', () => {
    expect(parseVerifyArgs(['--env', 'prod', '--origin', 'https://stakeward.app/'])).toMatchObject({
      origin: 'https://stakeward.app',
    });
    expect(parseVerifyArgs(['--env', 'dev', '--origin', 'http://localhost:8787'])).toMatchObject({
      origin: 'http://localhost:8787',
    });
    expect(() => parseVerifyArgs(['--env', 'dev', '--origin', 'http://example.com'])).toThrow(UsageError);
    expect(() => parseVerifyArgs(['--env', 'dev', '--origin', 'https://example.com/app'])).toThrow(UsageError);
    expect(() => parseVerifyArgs(['--env', 'dev', '--origin', 'not a url'])).toThrow(UsageError);
  });

  it('refuses a missing environment and a commit that git could read as an option', () => {
    expect(() => parseVerifyArgs([])).toThrow('--env');
    expect(() => parseVerifyArgs(['--env', 'dev', '--commit=--output=x'])).toThrow(UsageError);
    expect(() => parseVerifyArgs(['--env', 'dev', '--commit', 'a b'])).toThrow(UsageError);
    expect(parseVerifyArgs(['--help'])).toEqual({ help: true });
    expect(VERIFY_USAGE).toContain('--commit');
  });
});

describe('servedPath', () => {
  it('maps a build file to the path the site serves it at; Cloudflare config files are not served', () => {
    expect(servedPath('index.html')).toBe('/');
    expect(servedPath('assets/index-AB.js')).toBe('/assets/index-AB.js');
    expect(servedPath('favicon.svg')).toBe('/favicon.svg');
    expect(servedPath('_headers')).toBeNull();
    expect(servedPath('_redirects')).toBeNull();
  });
});

const HTML = [
  '<!doctype html><html><head>',
  '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />',
  '<script type="module" crossorigin src="/assets/index-AB_c.js"></script>',
  '<link rel="modulepreload" crossorigin href="/assets/vendor-CD.js">',
  "<link rel='stylesheet' crossorigin href='/assets/index-EF.css'>",
  '<script type="module" src="/assets/index-AB_c.js"></script>',
  '</head><body><a href="https://example.com/assets/x.js">x</a></body></html>',
].join('\n');

describe('assetReferences', () => {
  it('lists every /assets/ file the page loads, once, in order', () => {
    expect(assetReferences(HTML)).toEqual(['/assets/index-AB_c.js', '/assets/vendor-CD.js', '/assets/index-EF.css']);
  });
});

const LOCAL: FileHash[] = [
  { path: '_headers', bytes: 10, sha256: 'h'.repeat(64) },
  { path: 'assets/index-AB_c.js', bytes: 100, sha256: 'a'.repeat(64) },
  { path: 'assets/index-EF.css', bytes: 50, sha256: 'c'.repeat(64) },
  { path: 'favicon.svg', bytes: 5, sha256: 'f'.repeat(64) },
  { path: 'index.html', bytes: 400, sha256: 'i'.repeat(64) },
];

/** The `/*` block of the build's _headers, names as written there. */
const STATIC_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'",
  'X-Content-Type-Options': 'nosniff',
};
/** What the site sends with each file: fetch gives header names in lower case; Cloudflare adds its own. */
const SERVED_HEADERS = {
  'content-security-policy': "default-src 'self'; script-src 'self'",
  'x-content-type-options': 'nosniff',
  server: 'cloudflare',
};

function servedAll(overrides: Record<string, Served> = {}): Map<string, Served> {
  const served = new Map<string, Served>();
  for (const file of LOCAL) {
    const path = servedPath(file.path);
    if (path !== null) served.set(path, { status: 200, sha256: file.sha256, headers: SERVED_HEADERS });
  }
  for (const [path, value] of Object.entries(overrides)) served.set(path, value);
  return served;
}

describe('compareServed', () => {
  it('passes when every served file has the local hash and the headers of _headers, and the page loads nothing else', () => {
    const result = compareServed(LOCAL, servedAll(), ['/assets/index-AB_c.js', '/assets/index-EF.css'], STATIC_HEADERS);
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.headers).toEqual({ names: 2, responses: 4 });
    expect(result.rows.map((row) => [row.path, row.verdict])).toEqual([
      ['_headers', 'ok'],
      ['assets/index-AB_c.js', 'ok'],
      ['assets/index-EF.css', 'ok'],
      ['favicon.svg', 'ok'],
      ['index.html', 'ok'],
    ]);
  });

  it('fails on another hash: a changed file, or the SPA fallback serving index.html for a missing asset', () => {
    const result = compareServed(
      LOCAL,
      servedAll({ '/assets/index-EF.css': { status: 200, sha256: 'i'.repeat(64), headers: SERVED_HEADERS } }),
      ['/assets/index-AB_c.js', '/assets/index-EF.css'],
      STATIC_HEADERS,
    );
    expect(result.ok).toBe(false);
    expect(result.rows.find((row) => row.path === 'assets/index-EF.css')?.verdict).toBe('MISMATCH');
  });

  it('fails on an HTTP error or a failed request', () => {
    const http = compareServed(
      LOCAL,
      servedAll({ '/favicon.svg': { status: 404, sha256: 'x'.repeat(64), headers: SERVED_HEADERS } }),
      [],
      STATIC_HEADERS,
    );
    expect(http.ok).toBe(false);
    expect(http.rows.find((row) => row.path === 'favicon.svg')?.verdict).toBe('HTTP 404');
    const failed = compareServed(LOCAL, servedAll({ '/': { error: 'timeout' } }), [], STATIC_HEADERS);
    expect(failed.ok).toBe(false);
    expect(failed.rows.find((row) => row.path === 'index.html')?.verdict).toBe('ERROR timeout');
  });

  it('fails when the served page loads an asset the local build does not have', () => {
    const result = compareServed(LOCAL, servedAll(), ['/assets/index-AB_c.js', '/assets/evil.js'], STATIC_HEADERS);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      'the served index.html loads /assets/evil.js, which the local build does not have',
    ]);
  });

  it('fails when a response lacks a header of _headers or serves another value (a weaker CSP)', () => {
    const { 'content-security-policy': _csp, ...withoutCsp } = SERVED_HEADERS;
    const weaker = { ...SERVED_HEADERS, 'content-security-policy': "default-src *; script-src 'self' 'unsafe-inline'" };
    const result = compareServed(
      LOCAL,
      servedAll({
        '/': { status: 200, sha256: 'i'.repeat(64), headers: weaker },
        '/assets/index-EF.css': { status: 200, sha256: 'c'.repeat(64), headers: withoutCsp },
      }),
      [],
      STATIC_HEADERS,
    );
    expect(result.ok).toBe(false);
    expect(result.rows.find((row) => row.path === '_headers')?.verdict).toBe('HEADERS DIFFER');
    expect(result.rows.filter((row) => row.path !== '_headers').every((row) => row.verdict === 'ok')).toBe(true);
    expect(result.problems).toEqual([
      'Content-Security-Policy is missing on /assets/index-EF.css',
      `Content-Security-Policy differs on /: served "default-src *; script-src 'self' 'unsafe-inline'", _headers says "default-src 'self'; script-src 'self'"`,
    ]);
  });

  it('names the first response and how many more when a header differs on several', () => {
    const { 'x-content-type-options': _nosniff, ...without } = SERVED_HEADERS;
    const served = new Map<string, Served>(
      [...servedAll()].map(([path, value]) => [path, 'error' in value ? value : { ...value, headers: without }]),
    );
    const result = compareServed(LOCAL, served, [], STATIC_HEADERS);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual(['X-Content-Type-Options is missing on /assets/index-AB_c.js and 3 more responses']);
  });

  it('compares header names without case and values exactly, after trimming', () => {
    const result = compareServed(LOCAL, servedAll(), [], {
      'content-SECURITY-policy': "  default-src 'self'; script-src 'self' ",
      'X-Content-Type-Options': 'nosniff',
    });
    expect(result.ok).toBe(true);
    const off = compareServed(LOCAL, servedAll(), [], { ...STATIC_HEADERS, 'X-Content-Type-Options': 'NOSNIFF' });
    expect(off.ok).toBe(false);
  });

  it('fails when the build has no _headers, or one that sets nothing: the security headers would go unchecked', () => {
    const none = compareServed(
      LOCAL.filter((file) => file.path !== '_headers'),
      servedAll(),
      [],
      null,
    );
    expect(none.ok).toBe(false);
    expect(none.problems).toEqual(['the local build has no _headers: the security headers were not checked']);
    const empty = compareServed(LOCAL, servedAll(), [], {});
    expect(empty.ok).toBe(false);
    expect(empty.problems).toEqual(['the _headers of the local build sets no header for /*']);
  });

  it('fails when no file came back, so no response carried the headers', () => {
    const served = new Map<string, Served>([...servedAll()].map(([path]) => [path, { error: 'timeout' }]));
    const result = compareServed(LOCAL, served, [], STATIC_HEADERS);
    expect(result.ok).toBe(false);
    expect(result.rows.find((row) => row.path === '_headers')?.verdict).toBe('NOT CHECKED');
  });
});

describe('renderVerifyReport', () => {
  const context = { origin: ORIGIN_OF.dev, commit: 'c'.repeat(40), cluster: 'devnet' as const };

  it('ends with PASS, the number of files compared and the headers checked', () => {
    const report = renderVerifyReport(
      compareServed(LOCAL, servedAll(), ['/assets/index-AB_c.js'], STATIC_HEADERS),
      context,
    );
    expect(report).toContain('assets/index-AB_c.js');
    expect(report.trimEnd().split('\n').at(-1)).toBe(
      `PASS: ${ORIGIN_OF.dev} serves the devnet build of ${context.commit} (5 files compared; _headers: 2 headers on 4 responses)`,
    );
  });

  it('ends with FAIL and what differs', () => {
    const report = renderVerifyReport(
      compareServed(
        LOCAL,
        servedAll({ '/': { status: 200, sha256: 'z'.repeat(64), headers: SERVED_HEADERS } }),
        ['/assets/evil.js'],
        STATIC_HEADERS,
      ),
      context,
    );
    expect(report).toContain('MISMATCH');
    expect(report).toContain('/assets/evil.js');
    expect(report.trimEnd().split('\n').at(-1)).toBe(
      `FAIL: ${ORIGIN_OF.dev} does not serve the devnet build of ${context.commit} (1 file differs, 1 other problem)`,
    );
  });
});
