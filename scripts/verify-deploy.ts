// Does the deployed site serve exactly the build of a commit (SECURITY-CHECK P18)? Usage: scripts/deploy/args.ts, or
// `pnpm verify-deploy --help`. Plain Node 24 (DECISIONS D8).
// Builds the commit in a temporary git worktree (frozen install, no secrets in the environment, the environment's
// cluster), downloads index.html and every other file of that build from the site, and compares sha256. Also checks
// that every /assets/ file the served index.html loads is part of the local build, and that every response carries the
// headers of the build's _headers (the CSP and the rest of CLAUDE.md section 11) with the same values.
// Exit code 0: PASS; 1: FAIL, or the check could not run.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHeadersFile } from '../apps/web/static-headers.ts';
import { parseVerifyArgs, UsageError, VERIFY_USAGE } from './deploy/args.ts';
import { buildEnv } from './deploy/env.ts';
import { hashTree, type FileHash } from './deploy/manifest.ts';
import { assetReferences, compareServed, renderVerifyReport, servedPath, type Served } from './deploy/verify.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FETCH_TIMEOUT_MS = 15_000;

function git(args: readonly string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function run(command: string, args: readonly string[], options: { cwd: string; env: Record<string, string> }): void {
  const result = spawnSync(command, args, { cwd: options.cwd, env: options.env, stdio: 'inherit' });
  if (result.error !== undefined) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${[command, ...args].join(' ')} failed (exit ${String(result.status ?? result.signal)})`);
  }
}

type LocalBuild = { files: FileHash[]; staticHeaders: Record<string, string> | null };

/**
 * The site build of `commit` for `cluster`, made in a throwaway worktree that is removed afterwards: every file's hash
 * and the `/*` block of its _headers.
 */
function buildCommit(commit: string, cluster: 'devnet' | 'mainnet'): LocalBuild {
  const parent = mkdtempSync(join(tmpdir(), 'stakeward-verify-'));
  const worktree = join(parent, 'repo');
  try {
    console.log(`== building ${commit} for ${cluster} in a temporary worktree`);
    git(['worktree', 'add', '--detach', worktree, commit]);
    const env = buildEnv(process.env, cluster);
    run('pnpm', ['install', '--frozen-lockfile'], { cwd: worktree, env });
    run('pnpm', ['--filter', '@stakeward/web', 'run', `build:${cluster}`], { cwd: worktree, env });
    const dist = join(worktree, 'apps', 'web', 'dist');
    const headersFile = join(dist, '_headers');
    return {
      files: hashTree(dist),
      staticHeaders: existsSync(headersFile) ? parseHeadersFile(readFileSync(headersFile, 'utf8')) : null,
    };
  } finally {
    try {
      git(['worktree', 'remove', '--force', worktree]);
    } catch {
      // Not registered (the add failed) or already gone; the folder goes below either way.
    }
    rmSync(parent, { recursive: true, force: true });
    git(['worktree', 'prune']);
  }
}

/** The status, the sha256 of the body and the headers; redirects are not followed (a redirect is a failure here). */
async function fetchServed(url: string): Promise<{ served: Served; body: Buffer | null }> {
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      headers: { 'cache-control': 'no-cache', 'user-agent': 'stakeward-verify-deploy' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const body = Buffer.from(await response.arrayBuffer());
    return {
      served: {
        status: response.status,
        sha256: createHash('sha256').update(body).digest('hex'),
        // fetch gives the names in lower case.
        headers: Object.fromEntries(response.headers),
      },
      body: response.status === 200 ? body : null,
    };
  } catch (error) {
    return { served: { error: error instanceof Error ? error.message : String(error) }, body: null };
  }
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseVerifyArgs(argv);
  if (args.help) {
    console.log(VERIFY_USAGE);
    return 0;
  }
  const commit = git(['rev-parse', '--verify', '--end-of-options', `${args.commit}^{commit}`]);
  const { files: local, staticHeaders } = buildCommit(commit, args.cluster);

  console.log(`\n== downloading ${String(local.length)} files from ${args.origin}`);
  const served = new Map<string, Served>();
  let indexHtml = '';
  for (const file of local) {
    const path = servedPath(file.path);
    if (path === null) continue;
    const { served: result, body } = await fetchServed(`${args.origin}${path}`);
    served.set(path, result);
    if (path === '/' && body !== null) indexHtml = body.toString('utf8');
  }
  const result = compareServed(local, served, assetReferences(indexHtml), staticHeaders);
  console.log(`\n${renderVerifyReport(result, { origin: args.origin, commit, cluster: args.cluster })}`);
  return result.ok ? 0 : 1;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) console.error(`${error.message}\n\n${VERIFY_USAGE}`);
  else console.error(`\nFAIL: the check could not run: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
