// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEV_COSIGN_MARKER } from '@/pages/dev/DevCosignPage';
import { DEV_UI_MARKER } from '@/pages/dev/DevUiPage';
import { DEV_SLOTS_STORAGE_KEY } from '@/pages/dev-cosign/ports';
import { REPORTS_STORAGE_KEY } from '@/pages/dev-cosign/report';

/**
 * Builds the site for both clusters, exactly as the deploy scripts do, and greps the output.
 *
 * Marker convention (extend it, do not weaken it):
 * - Code that exists only in devnet builds exports a string literal starting with DEV_ONLY_PREFIX and renders or
 *   uses it (so the minifier keeps it). It must be in the devnet build and must not be in the mainnet build.
 *   Add new devnet-only markers to DEV_MARKERS below.
 * - Test-only code (the in-memory test wallet, LiteSVM helpers) carries a literal starting with TEST_ONLY_PREFIX.
 *   It must not be in any build (CLAUDE.md section 11).
 */
const DEV_ONLY_PREFIX = 'stakeward-dev-only:';
const TEST_ONLY_PREFIX = 'stakeward-test-only:';
const DEV_MARKERS = [DEV_UI_MARKER, DEV_COSIGN_MARKER];
/**
 * Literals that only devnet-only modules use (not markers): they show that the code behind a page is gone too, not
 * just the page component. /dev/cosign's storage keys live in src/pages/dev-cosign.
 */
const DEV_ONLY_CODE = [DEV_SLOTS_STORAGE_KEY, REPORTS_STORAGE_KEY];

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const VITE_BIN = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');

type Build = { dir: string; files: Map<string, string> };

function build(cluster: 'devnet' | 'mainnet'): Build {
  const dir = mkdtempSync(join(tmpdir(), `stakeward-${cluster}-`));
  // A clean environment: NODE_ENV=test from Vitest would make Vite bundle development React.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'NODE_ENV' && !key.startsWith('VITEST') && !key.startsWith('VITE_')) env[key] = value;
  }
  env['VITE_CLUSTER'] = cluster;
  execFileSync(process.execPath, [VITE_BIN, 'build', '--outDir', dir, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: WEB_ROOT,
    env,
    stdio: 'pipe',
  });
  const files = new Map<string, string>();
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.set(relative(dir, path), readFileSync(path, 'latin1'));
    }
  };
  walk(dir);
  return { dir, files };
}

function filesContaining(output: Build, needle: string): string[] {
  return [...output.files].filter(([, content]) => content.includes(needle)).map(([name]) => name);
}

describe('production builds', () => {
  let devnet: Build;
  let mainnet: Build;

  beforeAll(() => {
    devnet = build('devnet');
    mainnet = build('mainnet');
  }, 180_000);

  afterAll(() => {
    for (const output of [devnet, mainnet]) rmSync(output.dir, { recursive: true, force: true });
  });

  it('the devnet build contains every devnet-only page (positive control)', () => {
    for (const marker of DEV_MARKERS) {
      expect(marker.startsWith(DEV_ONLY_PREFIX), marker).toBe(true);
      expect(filesContaining(devnet, marker), marker).not.toEqual([]);
    }
    for (const literal of DEV_ONLY_CODE) expect(filesContaining(devnet, literal), literal).not.toEqual([]);
  });

  it('the mainnet build has no devnet-only code: no markers, no /dev routes, no dev page chunks', () => {
    expect(filesContaining(mainnet, DEV_ONLY_PREFIX)).toEqual([]);
    expect(filesContaining(mainnet, '/dev/ui')).toEqual([]);
    expect(filesContaining(mainnet, '/dev/cosign')).toEqual([]);
    for (const literal of DEV_ONLY_CODE) expect(filesContaining(mainnet, literal), literal).toEqual([]);
    expect([...mainnet.files.keys()].filter((name) => /dev/i.test(name))).toEqual([]);
  });

  it('no build contains test-only code', () => {
    expect(filesContaining(devnet, TEST_ONLY_PREFIX)).toEqual([]);
    expect(filesContaining(mainnet, TEST_ONLY_PREFIX)).toEqual([]);
  });

  it('each build carries the security headers file and no inline scripts or styles', () => {
    for (const output of [devnet, mainnet]) {
      expect(output.files.has('_headers')).toBe(true);
      const html = output.files.get('index.html') ?? '';
      expect(html).toMatch(/<script type="module" crossorigin src="\/assets\/index-[\w-]+\.js"><\/script>/);
      expect(html).not.toMatch(/<script(?![^>]*\ssrc=)[^>]*>/);
      expect(html).not.toMatch(/<style|\sstyle=/);
    }
  });
});
