// scripts/deploy.ts without git, pnpm, wrangler or the network: arguments, the sanitised environments, the secrets
// file, the git checks, the file manifest and the docs/deploys.md section. The run itself is docs/deploys.md.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CLUSTER_OF, DEPLOY_USAGE, ORIGIN_OF, parseDeployArgs, UsageError } from './args.ts';
import {
  baseEnv,
  buildEnv,
  deployEnv,
  leakedNames,
  parseSecretsFile,
  PREBUILT_CLUSTER_VAR,
  PREBUILT_DIST_VAR,
  readDeploySecrets,
  SecretsFileError,
  secretsFileKeyNames,
} from './env.ts';
import { dirtyFiles, headProblem } from './git.ts';
import {
  appendDeploySection,
  DEPLOYS_INTRO,
  hashTree,
  manifestChanges,
  parseWranglerOutput,
  renderDeploySection,
  type DeployRecord,
} from './manifest.ts';

const HOME = '/home/someone';

describe('parseDeployArgs', () => {
  it('dev: devnet build, secrets from ~/.config/stakeward/secrets.env', () => {
    expect(parseDeployArgs(['--env', 'dev'], HOME, '/repo')).toEqual({
      help: false,
      env: 'dev',
      cluster: 'devnet',
      prodConfirm: false,
      allowUnpushed: false,
      dryRun: false,
      secretsFile: '/home/someone/.config/stakeward/secrets.env',
    });
    expect(CLUSTER_OF).toEqual({ dev: 'devnet', prod: 'mainnet' });
  });

  it('drops the -- that pnpm may put in front of the arguments', () => {
    expect(parseDeployArgs(['--', '--env', 'dev', '--dry-run'], HOME, '/repo')).toMatchObject({ env: 'dev', dryRun: true });
  });

  it('prod needs --prod-confirm, and the flag means nothing anywhere else', () => {
    expect(() => parseDeployArgs(['--env', 'prod'], HOME, '/repo')).toThrow(UsageError);
    expect(() => parseDeployArgs(['--env', 'prod'], HOME, '/repo')).toThrow('--prod-confirm');
    expect(() => parseDeployArgs(['--env', 'prod', '--dry-run'], HOME, '/repo')).toThrow('--prod-confirm');
    expect(parseDeployArgs(['--env', 'prod', '--prod-confirm'], HOME, '/repo')).toMatchObject({
      env: 'prod',
      cluster: 'mainnet',
      prodConfirm: true,
    });
    expect(() => parseDeployArgs(['--env', 'dev', '--prod-confirm'], HOME, '/repo')).toThrow(UsageError);
  });

  it('--allow-unpushed is for dev only', () => {
    expect(parseDeployArgs(['--env', 'dev', '--allow-unpushed'], HOME, '/repo')).toMatchObject({ allowUnpushed: true });
    expect(() => parseDeployArgs(['--env', 'prod', '--prod-confirm', '--allow-unpushed'], HOME, '/repo')).toThrow(
      UsageError,
    );
  });

  it('refuses a missing or unknown environment, unknown options and positionals', () => {
    expect(() => parseDeployArgs([], HOME, '/repo')).toThrow('--env');
    expect(() => parseDeployArgs(['--env', 'staging'], HOME, '/repo')).toThrow('dev or prod');
    expect(() => parseDeployArgs(['--env', 'dev', '--force'], HOME, '/repo')).toThrow(UsageError);
    expect(() => parseDeployArgs(['--env', 'dev', 'now'], HOME, '/repo')).toThrow(UsageError);
  });

  it('resolves a relative --secrets-file against the folder pnpm was started in', () => {
    expect(parseDeployArgs(['--env', 'dev', '--secrets-file', 'cf.env'], HOME, '/work')).toMatchObject({
      secretsFile: '/work/cf.env',
    });
    expect(parseDeployArgs(['--env', 'dev', '--secrets-file', '/etc/cf.env'], HOME, '/work')).toMatchObject({
      secretsFile: '/etc/cf.env',
    });
  });

  it('--help', () => {
    expect(parseDeployArgs(['--help'], HOME, '/repo')).toEqual({ help: true });
    expect(DEPLOY_USAGE).toContain('--prod-confirm');
    expect(ORIGIN_OF.dev).toMatch(/^https:\/\/stakeward-dev\./);
  });
});

const TOKEN = 'cf-token-SHOULD-NOT-LEAK-1234567890';
const ACCOUNT = 'acc0unt1d0000000000000000000000';
const HELIUS = 'helius-key-SHOULD-NOT-LEAK';
const BOT = '123456:bot-token-SHOULD-NOT-LEAK';
const SECRETS_FILE = [
  '# Stakeward owner keys',
  '',
  `CLOUDFLARE_API_TOKEN=${TOKEN}`,
  `export CLOUDFLARE_ACCOUNT_ID="${ACCOUNT}"`,
  `HELIUS_API_KEY='${HELIUS}'`,
  `TELEGRAM_BOT_TOKEN_DEV=${BOT}`,
  `CLOUDFLARE_API_TOKEN_OLD=old-${TOKEN}`,
  '',
].join('\r\n');
const ALL_VALUES = [TOKEN, ACCOUNT, HELIUS, BOT];

function errorOf(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error('threw a non-Error', { cause: error });
  }
  throw new Error('did not throw');
}

describe('secrets file', () => {
  it('returns only the two keys wrangler needs, never the rest of the file', () => {
    const secrets = readDeploySecrets(SECRETS_FILE);
    expect(secrets).toEqual({ CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT });
    expect(Object.keys(secrets).sort()).toEqual(['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']);
    expect(JSON.stringify(secrets)).not.toContain(HELIUS);
    expect(JSON.stringify(secrets)).not.toContain(BOT);
  });

  it('matches names exactly: a longer name with the same start is another key', () => {
    expect(parseSecretsFile(SECRETS_FILE, ['CLOUDFLARE_API_TOKEN'])).toEqual({ CLOUDFLARE_API_TOKEN: TOKEN });
  });

  it('lists the names in the file, without values', () => {
    const names = secretsFileKeyNames(SECRETS_FILE);
    expect(names).toEqual([
      'CLOUDFLARE_API_TOKEN',
      'CLOUDFLARE_ACCOUNT_ID',
      'HELIUS_API_KEY',
      'TELEGRAM_BOT_TOKEN_DEV',
      'CLOUDFLARE_API_TOKEN_OLD',
    ]);
    for (const value of ALL_VALUES) expect(names.join('\n')).not.toContain(value);
  });

  it('a missing, empty or repeated key fails with its name and no value', () => {
    const missing = errorOf(() => parseSecretsFile(SECRETS_FILE, ['CLOUDFLARE_API_TOKEN', 'NOT_THERE']));
    expect(missing).toBeInstanceOf(SecretsFileError);
    expect(missing.message).toContain('NOT_THERE');
    const empty = errorOf(() => readDeploySecrets(`CLOUDFLARE_API_TOKEN=\nCLOUDFLARE_ACCOUNT_ID=${ACCOUNT}\n`));
    expect(empty.message).toContain('CLOUDFLARE_API_TOKEN');
    const twice = errorOf(() => readDeploySecrets(`${SECRETS_FILE}\nCLOUDFLARE_API_TOKEN=${TOKEN}-2\n`));
    expect(twice.message).toContain('CLOUDFLARE_API_TOKEN');
    for (const error of [missing, empty, twice]) {
      for (const value of ALL_VALUES) expect(error.message).not.toContain(value);
    }
  });

  it('a line that is not NAME=value fails with its number, never its text (it may be a pasted token)', () => {
    const error = errorOf(() => readDeploySecrets(`CLOUDFLARE_API_TOKEN=${TOKEN}\n${BOT}\n`));
    expect(error).toBeInstanceOf(SecretsFileError);
    expect(error.message).toContain('line 2');
    for (const value of ALL_VALUES) expect(error.message).not.toContain(value);
    const unclosed = errorOf(() => readDeploySecrets(`CLOUDFLARE_API_TOKEN="${TOKEN}\n`));
    expect(unclosed.message).toContain('line 1');
    expect(unclosed.message).not.toContain(TOKEN);
  });
});

const PARENT: Record<string, string> = {
  PATH: '/usr/bin:/home/someone/.nvm/versions/node/v24.21.0/bin',
  HOME,
  LANG: 'C.UTF-8',
  TERM: 'xterm-256color',
  TMPDIR: '/tmp/x',
  PNPM_HOME: '/home/someone/.local/share/pnpm',
  COREPACK_ENABLE_AUTO_PIN: '0',
  XDG_CONFIG_HOME: '/home/someone/.config',
  NODE_OPTIONS: '--max-old-space-size=4096',
  // Everything below must not reach a build or wrangler.
  CLOUDFLARE_API_TOKEN: TOKEN,
  CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
  HELIUS_API_KEY: HELIUS,
  TELEGRAM_BOT_TOKEN_DEV: BOT,
  NODE_AUTH_TOKEN: 'npm-token',
  COREPACK_NPM_TOKEN: 'npm-token-2',
  COREPACK_NPM_PASSWORD: 'pw',
  npm_config__authToken: 'npm-token-3',
  GITHUB_TOKEN: 'gh-token',
  AWS_SECRET_ACCESS_KEY: 'aws',
  CLAUDE_CODE_MESSAGING_TOKEN: 'claude',
  SSH_AUTH_SOCK: '/tmp/ssh.sock',
  NODE_ENV: 'test',
  VITE_CLUSTER: 'mainnet',
  VITE_EXTRA: 'x',
  USER: 'someone',
  FOO: 'bar',
};

describe('sanitised environments', () => {
  it('the build gets PATH, HOME, locale, node and pnpm settings, the cluster, and nothing else', () => {
    expect(buildEnv(PARENT, 'devnet')).toEqual({
      PATH: PARENT['PATH'],
      HOME,
      LANG: 'C.UTF-8',
      TERM: 'xterm-256color',
      TMPDIR: '/tmp/x',
      PNPM_HOME: PARENT['PNPM_HOME'],
      COREPACK_ENABLE_AUTO_PIN: '0',
      XDG_CONFIG_HOME: PARENT['XDG_CONFIG_HOME'],
      NODE_OPTIONS: '--max-old-space-size=4096',
      VITE_CLUSTER: 'devnet',
    });
  });

  it('the build guards also get the folder to check', () => {
    const env = buildEnv(PARENT, 'mainnet', { prebuiltDist: '/repo/apps/web/dist' });
    expect(env[PREBUILT_DIST_VAR]).toBe('/repo/apps/web/dist');
    expect(env[PREBUILT_CLUSTER_VAR]).toBe('mainnet');
    expect(env['VITE_CLUSTER']).toBe('mainnet');
    expect(PREBUILT_DIST_VAR).toBe('STAKEWARD_PREBUILT_DIST');
    expect(PREBUILT_CLUSTER_VAR).toBe('STAKEWARD_PREBUILT_CLUSTER');
  });

  it('no secret-looking name passes, even under an allowed prefix', () => {
    const env = baseEnv({ ...PARENT, COREPACK_INTEGRITY_KEYS: '{}', PNPM_HOME_TOKEN: 'x' });
    for (const name of Object.keys(env)) expect(name).not.toMatch(/TOKEN|SECRET|PASSW|AUTH|KEY|CREDENTIAL/i);
    for (const value of [TOKEN, ACCOUNT, HELIUS, BOT]) expect(Object.values(env)).not.toContain(value);
  });

  it('wrangler gets the base environment plus the Cloudflare token, the account id and its output file', () => {
    const env = deployEnv(
      PARENT,
      { CLOUDFLARE_API_TOKEN: 'from-file-token', CLOUDFLARE_ACCOUNT_ID: 'from-file-account' },
      '/tmp/out/wrangler.ndjson',
    );
    expect(env).toEqual({
      ...baseEnv(PARENT),
      CLOUDFLARE_API_TOKEN: 'from-file-token',
      CLOUDFLARE_ACCOUNT_ID: 'from-file-account',
      WRANGLER_OUTPUT_FILE_PATH: '/tmp/out/wrangler.ndjson',
    });
    expect(Object.values(env)).not.toContain(HELIUS);
    expect(env['VITE_CLUSTER']).toBeUndefined();
  });

  it('names the secrets-file keys already exported in this shell', () => {
    expect(leakedNames(PARENT, secretsFileKeyNames(SECRETS_FILE))).toEqual([
      'CLOUDFLARE_API_TOKEN',
      'CLOUDFLARE_ACCOUNT_ID',
      'HELIUS_API_KEY',
      'TELEGRAM_BOT_TOKEN_DEV',
    ]);
    expect(leakedNames({ PATH: '/usr/bin', CLOUDFLARE_API_TOKEN: '' }, ['CLOUDFLARE_API_TOKEN'])).toEqual([
      'CLOUDFLARE_API_TOKEN',
    ]);
    expect(leakedNames({ PATH: '/usr/bin' }, secretsFileKeyNames(SECRETS_FILE))).toEqual([]);
  });
});

describe('git checks', () => {
  it('lists every changed and untracked path of git status --porcelain', () => {
    expect(dirtyFiles('')).toEqual([]);
    expect(dirtyFiles(' M package.json\n?? apps/web/public/new.svg\nR  a.ts -> b.ts\n')).toEqual([
      'package.json',
      'apps/web/public/new.svg',
      'a.ts -> b.ts',
    ]);
  });

  const head = 'a'.repeat(40);
  it('HEAD must be the commit on origin/<branch>', () => {
    expect(headProblem({ branch: 'main', head, remoteHead: head, allowUnpushed: false })).toBeNull();
    expect(headProblem({ branch: 'main', head, remoteHead: 'b'.repeat(40), allowUnpushed: false })).toContain(
      'origin/main',
    );
    expect(headProblem({ branch: 'build/ops', head, remoteHead: null, allowUnpushed: false })).toContain(
      'origin/build/ops',
    );
  });

  it('--allow-unpushed lifts the origin check, never the detached-HEAD one', () => {
    expect(headProblem({ branch: 'build/ops', head, remoteHead: null, allowUnpushed: true })).toBeNull();
    expect(headProblem({ branch: 'main', head, remoteHead: 'b'.repeat(40), allowUnpushed: true })).toBeNull();
    expect(headProblem({ branch: 'HEAD', head, remoteHead: null, allowUnpushed: true })).toContain('detached');
  });
});

describe('manifest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stakeward-manifest-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html>');
  writeFileSync(join(dir, 'assets', 'index-abc.js'), 'console.log(1)');
  writeFileSync(join(dir, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n');

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const sha = (text: string) => createHash('sha256').update(text).digest('hex');

  it('hashes every file, with posix paths in sorted order', () => {
    expect(hashTree(dir)).toEqual([
      { path: '_headers', bytes: 37, sha256: sha('/*\n  X-Content-Type-Options: nosniff\n') },
      { path: 'assets/index-abc.js', bytes: 14, sha256: sha('console.log(1)') },
      { path: 'index.html', bytes: 15, sha256: sha('<!doctype html>') },
    ]);
  });

  it('names what changed between two manifests', () => {
    const before = hashTree(dir);
    expect(manifestChanges(before, before)).toEqual([]);
    const after = [
      ...before.filter((file) => file.path !== '_headers'),
      { path: 'assets/extra.js', bytes: 1, sha256: sha('x') },
    ].map((file) => (file.path === 'index.html' ? { ...file, sha256: sha('changed') } : file));
    expect(manifestChanges(before, after)).toEqual([
      'removed: _headers',
      'added: assets/extra.js',
      'changed: index.html',
    ]);
  });

  const record: DeployRecord = {
    env: 'dev',
    cluster: 'devnet',
    branch: 'build/ops',
    commit: 'c'.repeat(40),
    pushed: false,
    versionId: '0b6f3a3e-1111-2222-3333-444455556666',
    targets: ['stakeward-dev.someone.workers.dev', 'schedule: */2 * * * *'],
    deployedAt: new Date('2026-10-06T10:20:30.000Z'),
    tools: { node: 'v24.21.0', pnpm: '12.8.1', wrangler: '4.146.0' },
    files: [
      { path: 'assets/index-abc.js', bytes: 14, sha256: sha('console.log(1)') },
      { path: 'index.html', bytes: 15, sha256: sha('<!doctype html>') },
    ],
  };

  it('renders one section per deploy: environment, commit, version id, every file hash, how to verify', () => {
    const section = renderDeploySection(record);
    expect(section).toMatch(/^## dev · 2026-10-06 10:20:30 UTC\n/);
    expect(section).toContain(record.commit);
    expect(section).toContain(record.versionId);
    expect(section).toContain('build/ops');
    expect(section).toContain('--allow-unpushed');
    expect(section).toContain('wrangler 4.146.0');
    for (const file of record.files) expect(section).toContain(`| \`${file.path}\` | ${String(file.bytes)} | \`${file.sha256}\` |`);
    expect(section).toContain(`pnpm verify-deploy --env dev --commit ${record.commit}`);
    expect(renderDeploySection({ ...record, pushed: true })).not.toContain('--allow-unpushed');
  });

  it('appends: a new file gets the intro, an existing one keeps everything it had', () => {
    const first = appendDeploySection(null, 'SECTION 1');
    expect(first.startsWith(DEPLOYS_INTRO)).toBe(true);
    expect(first.endsWith('SECTION 1\n')).toBe(true);
    const second = appendDeploySection(first, 'SECTION 2');
    expect(second.startsWith(first.trimEnd())).toBe(true);
    expect(second.endsWith('\n\nSECTION 2\n')).toBe(true);
  });

  it('reads the version id and targets from wrangler output (WRANGLER_OUTPUT_FILE_PATH)', () => {
    const lines = [
      JSON.stringify({ type: 'wrangler-session', version: 1, wrangler_version: '4.146.0' }),
      JSON.stringify({ type: 'deploy', version: 1, version_id: 'v-1', targets: ['a.workers.dev'] }),
      '',
    ].join('\n');
    expect(parseWranglerOutput(lines)).toEqual({ versionId: 'v-1', targets: ['a.workers.dev'] });
    expect(() => parseWranglerOutput(lines.split('\n')[0] ?? '')).toThrow('deploy');
    expect(() => parseWranglerOutput(JSON.stringify({ type: 'deploy', targets: [] }))).toThrow('version_id');
  });
});
