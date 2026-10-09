// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from 'vite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

/**
 * The site build reads no .env file (SECURITY-CHECK P18). .gitignore ignores `.env` and `.env.*`, and `git status`
 * does not list ignored files, so a forgotten apps/web/.env would change what a deploy uploads while the wrapper sees
 * a clean tree: NODE_ENV=development there makes Vite bundle development React. The config is resolved with a
 * throwaway root holding every .env file Vite would read for a production build.
 */
const CONFIG = fileURLToPath(new URL('../vite.config.ts', import.meta.url));
const ENV_FILES = ['.env', '.env.local', '.env.production', '.env.production.local'];

let root = '';
let userNodeEnv: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'stakeward-vite-env-'));
  userNodeEnv = process.env['VITE_USER_NODE_ENV'];
  vi.stubEnv('VITE_CLUSTER', 'mainnet');
});

afterEach(() => {
  vi.unstubAllEnvs();
  // Vite copies NODE_ENV from a .env file into this process; undo it if it did.
  if (userNodeEnv === undefined) delete process.env['VITE_USER_NODE_ENV'];
  else process.env['VITE_USER_NODE_ENV'] = userNodeEnv;
  rmSync(root, { recursive: true, force: true });
});

it('vite build loads no .env file, so NODE_ENV and VITE_* from one cannot reach the bundle', async () => {
  for (const name of ENV_FILES) writeFileSync(join(root, name), 'NODE_ENV=development\nVITE_FROM_DOTENV=leaked\n');
  const config = await resolveConfig({ configFile: CONFIG, root, mode: 'production', logLevel: 'silent' }, 'build');
  expect(config.env['VITE_FROM_DOTENV']).toBeUndefined();
  expect(process.env['VITE_USER_NODE_ENV']).toBe(userNodeEnv);
  expect(config.envDir).toBe(false);
  expect(config.define?.['import.meta.env.VITE_CLUSTER']).toBe('"mainnet"');
});
