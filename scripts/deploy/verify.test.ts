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

function servedAll(overrides: Record<string, Served> = {}): Map<string, Served> {
  const served = new Map<string, Served>();
  for (const file of LOCAL) {
    const path = servedPath(file.path);
    if (path !== null) served.set(path, { status: 200, sha256: file.sha256 });
  }
  for (const [path, value] of Object.entries(overrides)) served.set(path, value);
  return served;
}

describe('compareServed', () => {
  it('passes when every served file has the local hash and the page loads nothing else', () => {
    const result = compareServed(LOCAL, servedAll(), ['/assets/index-AB_c.js', '/assets/index-EF.css']);
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.rows.map((row) => [row.path, row.verdict])).toEqual([
      ['_headers', 'not served (Cloudflare config)'],
      ['assets/index-AB_c.js', 'ok'],
      ['assets/index-EF.css', 'ok'],
      ['favicon.svg', 'ok'],
      ['index.html', 'ok'],
    ]);
  });

  it('fails on another hash: a changed file, or the SPA fallback serving index.html for a missing asset', () => {
    const result = compareServed(
      LOCAL,
      servedAll({ '/assets/index-EF.css': { status: 200, sha256: 'i'.repeat(64) } }),
      ['/assets/index-AB_c.js', '/assets/index-EF.css'],
    );
    expect(result.ok).toBe(false);
    expect(result.rows.find((row) => row.path === 'assets/index-EF.css')?.verdict).toBe('MISMATCH');
  });

  it('fails on an HTTP error or a failed request', () => {
    const http = compareServed(LOCAL, servedAll({ '/favicon.svg': { status: 404, sha256: 'x'.repeat(64) } }), []);
    expect(http.ok).toBe(false);
    expect(http.rows.find((row) => row.path === 'favicon.svg')?.verdict).toBe('HTTP 404');
    const failed = compareServed(LOCAL, servedAll({ '/': { error: 'timeout' } }), []);
    expect(failed.ok).toBe(false);
    expect(failed.rows.find((row) => row.path === 'index.html')?.verdict).toBe('ERROR timeout');
  });

  it('fails when the served page loads an asset the local build does not have', () => {
    const result = compareServed(LOCAL, servedAll(), ['/assets/index-AB_c.js', '/assets/evil.js']);
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      'the served index.html loads /assets/evil.js, which the local build does not have',
    ]);
  });
});

describe('renderVerifyReport', () => {
  const context = { origin: ORIGIN_OF.dev, commit: 'c'.repeat(40), cluster: 'devnet' as const };

  it('ends with PASS and the number of files compared', () => {
    const report = renderVerifyReport(compareServed(LOCAL, servedAll(), ['/assets/index-AB_c.js']), context);
    expect(report).toContain('assets/index-AB_c.js');
    expect(report.trimEnd().split('\n').at(-1)).toBe(
      `PASS: ${ORIGIN_OF.dev} serves the devnet build of ${context.commit} (4 files compared)`,
    );
  });

  it('ends with FAIL and what differs', () => {
    const report = renderVerifyReport(
      compareServed(LOCAL, servedAll({ '/': { status: 200, sha256: 'z'.repeat(64) } }), ['/assets/evil.js']),
      context,
    );
    expect(report).toContain('MISMATCH');
    expect(report).toContain('/assets/evil.js');
    expect(report.trimEnd().split('\n').at(-1)).toBe(
      `FAIL: ${ORIGIN_OF.dev} does not serve the devnet build of ${context.commit} (1 file differs, 1 other problem)`,
    );
  });
});
