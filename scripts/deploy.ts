// Deploy wrapper (SECURITY-CHECK P18 and P19). Usage: scripts/deploy/args.ts, or `pnpm deploy:dev --help`.
// Plain Node 24 (DECISIONS D8). In order: refuse secrets exported in this shell, a dirty tree, a HEAD that is not
// origin/<branch>; frozen install; site build for the cluster; the build guards on that very folder; `wrangler deploy`
// with only the Cloudflare token and account id from the secrets file; the record in docs/deploys.md.
// Exit code 0: deployed (or the dry run passed); 1: refused, or a step failed.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEPLOY_USAGE, parseDeployArgs, UsageError } from './deploy/args.ts';
import {
  baseEnv,
  buildEnv,
  DEPLOY_SECRET_NAMES,
  deployEnv,
  leakedNames,
  readDeploySecrets,
  SecretsFileError,
  secretsFileKeyNames,
} from './deploy/env.ts';
import { dirtyFiles, headProblem } from './deploy/git.ts';
import {
  appendDeploySection,
  DEPLOYS_DOC,
  hashTree,
  manifestChanges,
  parseWranglerOutput,
  renderDeploySection,
  type FileHash,
} from './deploy/manifest.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WORKER = join(ROOT, 'apps', 'worker');
const DIST = join(ROOT, 'apps', 'web', 'dist');
/** The build guards (DECISIONS D31), run on DIST through apps/web/test/support/prebuilt.ts. */
const GUARD_TESTS = ['test/build-output.test.ts', 'test/test-code-guard.test.ts'];

/** The deploy will not go ahead; the message says why and what to do. */
class Refusal extends Error {
  override name = 'Refusal';
}

function step(text: string): void {
  console.log(`\n== ${text}`);
}

/** git with this process's environment (git is not third-party npm code; SSH needs the agent socket). */
function git(args: readonly string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Runs a command with the given environment and the terminal attached; throws when it fails. */
function run(command: string, args: readonly string[], options: { cwd: string; env: Record<string, string> }): void {
  const result = spawnSync(command, args, { cwd: options.cwd, env: options.env, stdio: 'inherit' });
  if (result.error !== undefined) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${[command, ...args].join(' ')} failed (exit ${String(result.status ?? result.signal)})`);
  }
}

function ensureCleanTree(when: string): void {
  const dirty = dirtyFiles(git(['status', '--porcelain=v1', '--untracked-files=all']));
  if (dirty.length > 0) {
    throw new Refusal(`The working tree is not clean ${when}:\n  ${dirty.join('\n  ')}\nCommit or stash first.`);
  }
}

/** origin's commit for the branch, or null when origin has no such branch (network errors throw). */
function remoteHead(branch: string): string | null {
  const result = spawnSync('git', ['ls-remote', '--exit-code', 'origin', `refs/heads/${branch}`], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (result.status === 2) return null;
  if (result.status !== 0) throw new Error(`git ls-remote origin failed: ${result.stderr.trim()}`);
  const sha = result.stdout.split('\t')[0]?.trim() ?? '';
  if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new Error('git ls-remote origin gave no commit');
  return sha;
}

function ensureSameFiles(expected: readonly FileHash[], when: string): void {
  const changes = manifestChanges(expected, hashTree(DIST));
  if (changes.length > 0) {
    throw new Error(`apps/web/dist changed ${when}:\n  ${changes.join('\n  ')}`);
  }
}

function wranglerBin(): { path: string; version: string } {
  const require = createRequire(join(WORKER, 'package.json'));
  const manifestPath = require.resolve('wrangler/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version: string; bin: { wrangler: string } };
  return { path: join(dirname(manifestPath), manifest.bin.wrangler), version: manifest.version };
}

function main(argv: readonly string[]): number {
  const args = parseDeployArgs(argv);
  if (args.help) {
    console.log(DEPLOY_USAGE);
    return 0;
  }
  console.log(
    `Deploying to ${args.env} (${args.cluster} build)${args.dryRun ? ', dry run: nothing is uploaded' : ''}.`,
  );

  // Secrets: read from the file by this process only; refuse a shell that already exports them (old procedure).
  const secretsText = existsSync(args.secretsFile) ? readFileSync(args.secretsFile, 'utf8') : null;
  if (secretsText === null && !args.dryRun) throw new Refusal(`No secrets file at ${args.secretsFile} (--secrets-file).`);
  const fileNames = secretsText === null ? [] : secretsFileKeyNames(secretsText);
  const exported = leakedNames(process.env, [...new Set([...DEPLOY_SECRET_NAMES, ...fileNames])]);
  if (exported.length > 0) {
    throw new Refusal(
      `These secrets are exported in this shell: ${exported.join(', ')}. The wrapper reads what wrangler needs from ` +
        'the secrets file itself and gives nothing else to the build. Open a new shell without ' +
        '`set -a; . ~/.config/stakeward/secrets.env` and run the deploy again.',
    );
  }

  step('git: clean tree, HEAD is origin/<branch>');
  ensureCleanTree('before the deploy');
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = git(['rev-parse', 'HEAD']);
  const remote = branch === 'HEAD' ? null : remoteHead(branch);
  const problem = headProblem({ branch, head, remoteHead: remote, allowUnpushed: args.allowUnpushed });
  if (problem !== null) throw new Refusal(problem);
  const pushed = remote === head;
  console.log(`${branch} @ ${head}${pushed ? ', same as origin' : ', NOT on origin (--allow-unpushed)'}`);

  const env = buildEnv(process.env, args.cluster);
  console.log(`Environment of install, build and guards: ${Object.keys(env).sort().join(', ')}`);

  step('pnpm install --frozen-lockfile');
  run('pnpm', ['install', '--frozen-lockfile'], { cwd: ROOT, env });

  step(`site build for ${args.cluster}`);
  run('pnpm', ['--filter', '@stakeward/web', 'run', `build:${args.cluster}`], { cwd: ROOT, env });
  ensureCleanTree('after the install and the build');
  const files = hashTree(DIST);
  console.log(`apps/web/dist: ${String(files.length)} files`);

  step('build guards on apps/web/dist');
  run('pnpm', ['--filter', '@stakeward/web', 'exec', 'vitest', 'run', ...GUARD_TESTS], {
    cwd: ROOT,
    env: buildEnv(process.env, args.cluster, { prebuiltDist: DIST }),
  });
  ensureSameFiles(files, 'during the build guards');

  const wrangler = wranglerBin();
  if (args.dryRun) {
    step(`wrangler deploy --dry-run --env ${args.env}`);
    const outDir = mkdtempSync(join(tmpdir(), 'stakeward-deploy-dry-'));
    try {
      run(process.execPath, [wrangler.path, 'deploy', '--dry-run', '--outdir', outDir, '--env', args.env], {
        cwd: WORKER,
        env: baseEnv(process.env),
      });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
    ensureSameFiles(files, 'during the dry run');
    console.log(`\nDry run passed: ${branch} @ ${head} would deploy ${String(files.length)} site files to ${args.env}.`);
    return 0;
  }

  step(`wrangler deploy --env ${args.env}`);
  if (secretsText === null) throw new Refusal(`No secrets file at ${args.secretsFile}.`);
  const outDir = mkdtempSync(join(tmpdir(), 'stakeward-deploy-'));
  const outputFile = join(outDir, 'wrangler-output.ndjson');
  let deployed: { versionId: string; targets: string[] };
  try {
    run(process.execPath, [wrangler.path, 'deploy', '--env', args.env], {
      cwd: WORKER,
      env: deployEnv(process.env, readDeploySecrets(secretsText), outputFile),
    });
    deployed = parseWranglerOutput(readFileSync(outputFile, 'utf8'));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
  ensureSameFiles(files, 'during the upload: the deployed files may not be the checked ones');

  const pnpmVersion = execFileSync('pnpm', ['--version'], { cwd: ROOT, env: baseEnv(process.env), encoding: 'utf8' });
  const section = renderDeploySection({
    env: args.env,
    cluster: args.cluster,
    branch,
    commit: head,
    pushed,
    versionId: deployed.versionId,
    targets: deployed.targets,
    deployedAt: new Date(),
    tools: { node: process.version, pnpm: pnpmVersion.trim(), wrangler: wrangler.version },
    files,
  });
  const docPath = fileURLToPath(DEPLOYS_DOC);
  writeFileSync(docPath, appendDeploySection(existsSync(docPath) ? readFileSync(docPath, 'utf8') : null, section));

  console.log(`\nDeployed ${branch} @ ${head} to ${args.env}: version ${deployed.versionId}.`);
  console.log('Recorded in docs/deploys.md: commit it (the next deploy refuses a dirty tree).');
  console.log(`Check the live site against the commit: pnpm verify-deploy --env ${args.env} --commit ${head}`);
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`${error.message}\n\n${DEPLOY_USAGE}`);
  } else if (error instanceof Refusal || error instanceof SecretsFileError) {
    console.error(`\nRefused: ${error.message}`);
  } else {
    console.error(`\nDeploy failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exitCode = 1;
}
