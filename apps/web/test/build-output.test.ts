// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBase58Decoder } from '@solana/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEV_COSIGN_MARKER } from '@/pages/dev/DevCosignPage';
import { DEV_UI_MARKER } from '@/pages/dev/DevUiPage';
import { SAMPLE_SIGNATURE } from '@/pages/dev-ui/samples';
import { DEVNET_CHALLENGE, MAINNET_CHALLENGE } from '@/pages/challenge/wallet';
import { DEV_SLOTS_STORAGE_KEY } from '@/pages/dev-cosign/ports';
import { REPORTS_STORAGE_KEY } from '@/pages/dev-cosign/report';
import { OG_IMAGE_PATH, robotsTxt, SITE_ORIGINS, sitemapXml } from '../seo.ts';
import { prebuiltDist } from './support/prebuilt.ts';

/**
 * Builds the site for both clusters, exactly as the deploy scripts do, and greps the output. When the deploy wrapper
 * (scripts/deploy.ts) passes the folder it is about to upload (support/prebuilt.ts), that folder stands in for the
 * build of its cluster and every check below runs on it; the other cluster is still built here.
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
 * just the page component. /dev/cosign's storage keys live in src/pages/dev-cosign. The devnet challenge wallet
 * (D133) is devnet content too: /challenge is in both builds, each with its own cluster's wallet (D154).
 */
const DEV_ONLY_CODE = [DEV_SLOTS_STORAGE_KEY, REPORTS_STORAGE_KEY, DEVNET_CHALLENGE.mainKey, DEVNET_CHALLENGE.stakeAccount, DEVNET_CHALLENGE.secondKey];
/** The mainnet challenge wallet (D154): in the mainnet build, which shows it on /challenge, and in no devnet build. */
const MAINNET_ONLY_CODE = [MAINNET_CHALLENGE.mainKey, MAINNET_CHALLENGE.stakeAccount, MAINNET_CHALLENGE.secondKey];
/**
 * A 64-byte secret as wallets import it: 87 or 88 base58 characters in a row. The challenge's main keys come from GET
 * /api/challenge and the second keys exist only in .keys/ (D133, D154), so no build has one. A 64-byte signature
 * matches too: the one /dev/ui shows (devnet build only) is the single exception.
 */
const BASE58_SECRET = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{87,88}(?![1-9A-HJ-NP-Za-km-z])/;

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const VITE_BIN = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');

type Build = { dir: string; files: Map<string, string>; owned: boolean };

const PREBUILT = prebuiltDist();

function readBuild(dir: string, owned: boolean): Build {
  const files = new Map<string, string>();
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.set(relative(dir, path), readFileSync(path, 'latin1'));
    }
  };
  walk(dir);
  return { dir, files, owned };
}

function build(cluster: 'devnet' | 'mainnet'): Build {
  if (PREBUILT?.cluster === cluster) return readBuild(PREBUILT.dir, false);
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
  return readBuild(dir, true);
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
    // A prebuilt folder is the deploy's, not ours to delete.
    for (const output of [devnet, mainnet]) if (output.owned) rmSync(output.dir, { recursive: true, force: true });
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

  it("each build shows its own cluster's challenge wallet and no other (D154)", () => {
    for (const literal of MAINNET_ONLY_CODE) {
      expect(filesContaining(mainnet, literal), literal).not.toEqual([]);
      expect(filesContaining(devnet, literal), literal).toEqual([]);
    }
  });

  it('no build contains a key: nothing shaped like a 64-byte base58 secret', () => {
    // Positive control: a keypair file's 64 bytes, as /api/challenge serves them.
    expect(BASE58_SECRET.test(`"${getBase58Decoder().decode(Uint8Array.from({ length: 64 }, (_, i) => i + 1))}"`)).toBe(true);
    for (const output of [devnet, mainnet]) {
      const found = [...output.files].flatMap(([name, content]) =>
        [...content.matchAll(new RegExp(BASE58_SECRET, 'g'))].map((match) => match[0]).filter((text) => text !== SAMPLE_SIGNATURE).map((text) => `${name}: ${text}`),
      );
      expect(found).toEqual([]);
    }
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

  it('mainnet is open to search with a sitemap; devnet is kept out of it (seo.ts, D155)', () => {
    expect(mainnet.files.get('robots.txt')).toBe(robotsTxt('mainnet'));
    expect(mainnet.files.get('sitemap.xml')).toBe(sitemapXml(SITE_ORIGINS.mainnet));
    expect(mainnet.files.get('index.html')).not.toContain('noindex');
    expect(devnet.files.get('robots.txt')).toBe(robotsTxt('devnet'));
    expect(devnet.files.has('sitemap.xml')).toBe(false);
    expect(devnet.files.get('index.html')).toContain('<meta name="robots" content="noindex">');
    for (const [output, origin] of [
      [mainnet, SITE_ORIGINS.mainnet],
      [devnet, SITE_ORIGINS.devnet],
    ] as const) {
      expect(output.files.has(OG_IMAGE_PATH.slice(1))).toBe(true);
      expect(output.files.get('index.html')).toContain(`<meta property="og:image" content="${origin}${OG_IMAGE_PATH}">`);
    }
  });
});
