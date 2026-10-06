// Command lines of scripts/deploy.ts and scripts/verify-deploy.ts.
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

export type DeployEnv = 'dev' | 'prod';
export type Cluster = 'devnet' | 'mainnet';

/** The site build each wrangler environment serves (DECISIONS D30). */
export const CLUSTER_OF: Record<DeployEnv, Cluster> = { dev: 'devnet', prod: 'mainnet' };

/** Where each environment is served (DECISIONS «Развёртывание»; workers.dev until a domain is bought, D84). */
export const ORIGIN_OF: Record<DeployEnv, string> = {
  dev: 'https://stakeward-dev.zhibul-alexander.workers.dev',
  prod: 'https://stakeward-prod.zhibul-alexander.workers.dev',
};

export const DEPLOY_USAGE = [
  'Usage: pnpm deploy:dev [--allow-unpushed] [--dry-run] [--secrets-file <file>]',
  '       pnpm deploy:prod --prod-confirm [--dry-run] [--secrets-file <file>]',
  '  Deploys the committed HEAD: refuses a dirty tree and a HEAD that is not origin/<branch>, installs with the frozen',
  '  lockfile, builds the site without any secret in the environment, runs the build guards',
  '  (apps/web test/build-output.test.ts and test/test-code-guard.test.ts) on that very build, then runs',
  '  `wrangler deploy --env <dev|prod>` with only CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID from the secrets',
  '  file. Appends the version id, the commit and the sha256 of every uploaded file to docs/deploys.md.',
  '  --env              dev (devnet build) or prod (mainnet build); set by deploy:dev and deploy:prod',
  '  --prod-confirm     required for prod',
  '  --allow-unpushed   dev only: deploy a HEAD that is not on origin (recorded in docs/deploys.md)',
  '  --dry-run          everything but the upload: `wrangler deploy --dry-run` without the token, no docs written',
  '  --secrets-file     KEY=value file with CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID;',
  '                     default ~/.config/stakeward/secrets.env. The values of its other keys are never kept or passed on;',
  '                     their names only serve to refuse a shell that exports them.',
].join('\n');

export const VERIFY_USAGE = [
  'Usage: pnpm verify-deploy --env <dev|prod> [--commit <ref>] [--origin <https origin>]',
  '  Builds the site of <ref> (default HEAD) in a temporary git worktree, for the cluster of the environment, then',
  '  downloads index.html and every other file of that build from the deployed site and compares sha256.',
  '  Prints PASS or FAIL; exit code 0 only on PASS.',
  '  --env      dev (devnet build, dev origin) or prod (mainnet build, prod origin)',
  '  --commit   commit, tag or branch to build; default HEAD',
  "  --origin   the site to check instead of the environment's: https://host[:port] (http only for localhost)",
].join('\n');

/** A command line the script cannot run; printed with the usage, exit code 1. */
export class UsageError extends Error {
  override name = 'UsageError';
}

export type DeployArgs =
  | { help: true }
  | {
      help: false;
      env: DeployEnv;
      cluster: Cluster;
      prodConfirm: boolean;
      allowUnpushed: boolean;
      dryRun: boolean;
      /** Absolute path of the KEY=value file the Cloudflare token and account id are read from. */
      secretsFile: string;
    };

export type VerifyArgs =
  | { help: true }
  | { help: false; env: DeployEnv; cluster: Cluster; origin: string; commit: string };

/** pnpm may pass a `--` separator in front of the script's own arguments. */
function withoutSeparator(argv: readonly string[]): string[] {
  return argv[0] === '--' ? argv.slice(1) : [...argv];
}

function parseEnv(value: string | undefined): DeployEnv {
  if (value === undefined) throw new UsageError('--env is required: dev or prod');
  if (value !== 'dev' && value !== 'prod') throw new UsageError(`--env takes dev or prod, got "${value}"`);
  return value;
}

export function parseDeployArgs(
  argv: readonly string[],
  home: string = homedir(),
  cwd: string = process.env['INIT_CWD'] ?? process.cwd(),
): DeployArgs {
  let values;
  try {
    ({ values } = parseArgs({
      args: withoutSeparator(argv),
      allowPositionals: false,
      strict: true,
      options: {
        env: { type: 'string' },
        'prod-confirm': { type: 'boolean', default: false },
        'allow-unpushed': { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        'secrets-file': { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    }));
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  if (values.help) return { help: true };
  const env = parseEnv(values.env);
  const prodConfirm = values['prod-confirm'];
  const allowUnpushed = values['allow-unpushed'];
  if (env === 'prod' && !prodConfirm) {
    throw new UsageError('A prod deploy needs --prod-confirm: pnpm deploy:prod --prod-confirm');
  }
  if (env !== 'prod' && prodConfirm) throw new UsageError('--prod-confirm is for --env prod only');
  if (env === 'prod' && allowUnpushed) {
    throw new UsageError('--allow-unpushed is for dev only: prod deploys only a commit that is on origin');
  }
  const secretsFile = values['secrets-file'];
  return {
    help: false,
    env,
    cluster: CLUSTER_OF[env],
    prodConfirm,
    allowUnpushed,
    dryRun: values['dry-run'],
    secretsFile:
      secretsFile === undefined
        ? join(home, '.config', 'stakeward', 'secrets.env')
        : isAbsolute(secretsFile)
          ? secretsFile
          : resolve(cwd, secretsFile),
  };
}

function parseOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UsageError(`--origin takes https://host[:port], got "${value}"`);
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new UsageError(`--origin must be https (http only for localhost), got "${value}"`);
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') {
    throw new UsageError(`--origin takes an origin without a path, query or credentials, got "${value}"`);
  }
  return url.origin;
}

/** A git ref as typed: no spaces, and no leading `-` that git would read as an option. */
const REF = /^[\w][\w./^~@{}-]*$/;

export function parseVerifyArgs(argv: readonly string[]): VerifyArgs {
  let values;
  try {
    ({ values } = parseArgs({
      args: withoutSeparator(argv),
      allowPositionals: false,
      strict: true,
      options: {
        env: { type: 'string' },
        commit: { type: 'string', default: 'HEAD' },
        origin: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    }));
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  if (values.help) return { help: true };
  const env = parseEnv(values.env);
  if (!REF.test(values.commit)) throw new UsageError(`--commit takes a commit, tag or branch, got "${values.commit}"`);
  return {
    help: false,
    env,
    cluster: CLUSTER_OF[env],
    origin: values.origin === undefined ? ORIGIN_OF[env] : parseOrigin(values.origin),
    commit: values.commit,
  };
}
