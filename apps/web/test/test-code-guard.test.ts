// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LITESVM_CHAIN_MARKER } from '@stakeward/core/test/litesvm-chain';
import { TEST_WALLET_PORT_MARKER } from '@stakeward/core/test/test-wallet-port';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { COUNTING_CHAIN_MARKER } from './support/counting-chain.ts';
import { FAKE_API_MARKER } from './support/fake-api.ts';
import { FAKE_STANDARD_WALLET_MARKER } from './support/fake-standard-wallet.ts';

/**
 * CLAUDE.md section 11: the test wallet never reaches a production bundle, and no code path handles private keys.
 * The mainnet build (what deploy:prod ships) is scanned for the markers the test doubles carry and for what only key
 * handling or forbidden wallet features would bring in. Positive controls bundle each test double on its own and find
 * its marker, so a marker cannot silently fall out of minified code and make the scan meaningless.
 */
const TEST_ONLY_PREFIX = 'stakeward-test-only:';
const TEST_MARKERS = [
  TEST_WALLET_PORT_MARKER,
  LITESVM_CHAIN_MARKER,
  FAKE_STANDARD_WALLET_MARKER,
  FAKE_API_MARKER,
  COUNTING_CHAIN_MARKER,
];
/** Never in the shipped site: test code, LiteSVM, key generation, private-key import, forbidden wallet features. */
const FORBIDDEN_IN_PRODUCTION: readonly (string | RegExp)[] = [
  TEST_ONLY_PREFIX,
  ...TEST_MARKERS,
  /litesvm/i,
  'generateKey',
  'pkcs8',
  'solana:signMessage',
  'solana:signAndSendTransaction',
  'solana:signAndSendAllTransactions',
  'solana:signIn',
];

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const VITE_BIN = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');

/** The parent environment minus Vitest's (NODE_ENV=test would make Vite bundle development builds). */
function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'NODE_ENV' && !key.startsWith('VITEST') && !key.startsWith('VITE_')) env[key] = value;
  }
  return { ...env, ...extra };
}

function readTree(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.set(path.slice(dir.length + 1), readFileSync(path, 'latin1'));
    }
  };
  walk(dir);
  return files;
}

function found(files: Map<string, string>, needle: string | RegExp): string[] {
  return [...files]
    .filter(([, content]) => (typeof needle === 'string' ? content.includes(needle) : needle.test(content)))
    .map(([name]) => name);
}

/** A scratch folder inside apps/web (git-ignored .cache/), so bundled entries resolve the workspace packages. */
function scratch(prefix: string): string {
  const parent = join(WEB_ROOT, '.cache');
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, prefix));
}

/** Minified production bundle of one entry module (browser library build, or a Node build for `ssr`). */
function bundle(source: string, options: { ssr?: boolean } = {}): string {
  const dir = scratch('guard-');
  try {
    writeFileSync(join(dir, 'entry.ts'), source);
    const build = options.ssr
      ? `{ ssr: 'entry.ts', outDir: 'out', minify: true, rollupOptions: { output: { entryFileNames: 'entry.js' } } }`
      : `{ outDir: 'out', minify: true, lib: { entry: 'entry.ts', formats: ['es'], fileName: 'entry' } }`;
    const ssr = options.ssr ? `ssr: { external: ['litesvm', '@solana/kit-plugin-litesvm'], noExternal: [/^@stakeward\\//] },` : '';
    writeFileSync(join(dir, 'vite.config.mjs'), `export default { logLevel: 'error', ${ssr} build: ${build} };`);
    execFileSync(process.execPath, [VITE_BIN, 'build', '--config', 'vite.config.mjs'], { cwd: dir, env: cleanEnv(), stdio: 'pipe' });
    return [...readTree(join(dir, 'out')).values()].join('\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('test code never ships', () => {
  let mainnet: Map<string, string>;
  let outDir: string;

  beforeAll(() => {
    outDir = scratch('mainnet-');
    execFileSync(process.execPath, [VITE_BIN, 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], {
      cwd: WEB_ROOT,
      env: cleanEnv({ VITE_CLUSTER: 'mainnet' }),
      stdio: 'pipe',
    });
    mainnet = readTree(outDir);
  }, 180_000);

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('every test double carries a test-only marker', () => {
    for (const marker of TEST_MARKERS) expect(marker.startsWith(TEST_ONLY_PREFIX), marker).toBe(true);
  });

  it('the mainnet build has no test code, no LiteSVM, no key handling, no forbidden wallet features', () => {
    expect(mainnet.size).toBeGreaterThan(0);
    for (const needle of FORBIDDEN_IN_PRODUCTION) expect(found(mainnet, needle), String(needle)).toEqual([]);
  });

  it('positive control: a bundle of the test wallet keeps its marker (and shows its key generation)', () => {
    const code = bundle(`export { createTestWalletPort } from '@stakeward/core/test/test-wallet-port';\n`);
    expect(code).toContain(TEST_WALLET_PORT_MARKER);
    expect(code).toContain('generateKey');
  }, 120_000);

  it('positive control: a bundle of the fake Wallet Standard wallet keeps its marker and forbidden features', () => {
    const code = bundle(`export { FakeStandardWallet } from '../../test/support/fake-standard-wallet.ts';\n`);
    expect(code).toContain(FAKE_STANDARD_WALLET_MARKER);
    expect(code).toContain('solana:signMessage');
  }, 120_000);

  it('positive control: a bundle of the fake API keeps its marker', () => {
    const code = bundle(`export { createFakeApi } from '../../test/support/fake-api.ts';\n`);
    expect(code).toContain(FAKE_API_MARKER);
  }, 120_000);

  it('positive control: a bundle of the counting chain keeps its marker', () => {
    const code = bundle(`export { CountingChain } from '../../test/support/counting-chain.ts';\n`);
    expect(code).toContain(COUNTING_CHAIN_MARKER);
  }, 120_000);

  it('positive control: a (Node) bundle of LiteSvmChain keeps its marker and its LiteSVM import', () => {
    const code = bundle(`export { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';\n`, { ssr: true });
    expect(code).toContain(LITESVM_CHAIN_MARKER);
    expect(code).toMatch(/litesvm/i);
  }, 120_000);
});
