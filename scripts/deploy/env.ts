// What each child process of a deploy may see (SECURITY-CHECK P19). The install, the build and the build guards run
// third-party code (pnpm lifecycle scripts, vite, rollup, tailwind and their dependencies): they get a short allowlist
// of the parent environment and no secret. Only `wrangler deploy` gets the Cloudflare token and account id, read from
// the secrets file here; nothing else of that file ever enters the run.
import type { Cluster } from './args.ts';

/** Also in apps/web/test/support/prebuilt.ts: the build guards check this folder instead of building their own. */
export const PREBUILT_DIST_VAR = 'STAKEWARD_PREBUILT_DIST';
export const PREBUILT_CLUSTER_VAR = 'STAKEWARD_PREBUILT_CLUSTER';

/** The only secrets a deploy needs, and only wrangler gets them. */
export const DEPLOY_SECRET_NAMES = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'] as const;
export type DeploySecrets = Record<(typeof DEPLOY_SECRET_NAMES)[number], string>;

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Passed through from the parent: where programs and the home folder are, locale and terminal, temp folder, Node
 * options and extra CA certificates, and where pnpm and corepack (which runs pnpm here) keep their files. NODE_ENV is
 * left out on purpose: `test` would make Vite bundle development React.
 */
const PASS_NAMES = new Set([
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'TERM',
  'TMPDIR',
  'NODE_OPTIONS',
  'NODE_EXTRA_CA_CERTS',
  'PNPM_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_STATE_HOME',
]);
const PASS_PREFIXES = ['COREPACK_'];
/** Never passed, whatever the allowlist says (COREPACK_NPM_TOKEN, COREPACK_NPM_PASSWORD, …). */
const SECRET_LIKE = /TOKEN|SECRET|PASSW|AUTH|KEY|CREDENTIAL|PRIVATE|COOKIE|SESSION/i;

/** The allowlisted part of the parent environment. */
export function baseEnv(parent: Env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(parent)) {
    if (value === undefined || SECRET_LIKE.test(name)) continue;
    if (PASS_NAMES.has(name) || PASS_PREFIXES.some((prefix) => name.startsWith(prefix))) env[name] = value;
  }
  return env;
}

/** For pnpm install, the site build and the build guards: the base environment and the cluster to build. */
export function buildEnv(parent: Env, cluster: Cluster, options: { prebuiltDist?: string } = {}): Record<string, string> {
  const env: Record<string, string> = { ...baseEnv(parent), VITE_CLUSTER: cluster };
  if (options.prebuiltDist !== undefined) {
    env[PREBUILT_DIST_VAR] = options.prebuiltDist;
    env[PREBUILT_CLUSTER_VAR] = cluster;
  }
  return env;
}

/** For `wrangler deploy`: the base environment, the two Cloudflare values and the file wrangler reports into. */
export function deployEnv(parent: Env, secrets: DeploySecrets, outputFile: string): Record<string, string> {
  return {
    ...baseEnv(parent),
    CLOUDFLARE_API_TOKEN: secrets.CLOUDFLARE_API_TOKEN,
    CLOUDFLARE_ACCOUNT_ID: secrets.CLOUDFLARE_ACCOUNT_ID,
    WRANGLER_OUTPUT_FILE_PATH: outputFile,
  };
}

/** Which of `names` the parent environment has (an exported secrets file); names only. */
export function leakedNames(parent: Env, names: readonly string[]): string[] {
  return names.filter((name) => parent[name] !== undefined);
}

/** A secrets file the script cannot use. The message names keys and line numbers, never values or line text. */
export class SecretsFileError extends Error {
  override name = 'SecretsFileError';
}

type Entry = { line: number; name: string; value: string };

const ASSIGNMENT = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/** NAME=value lines (optional `export `, optional matching quotes), skipping blanks and `#` comments. */
function* entries(text: string): Generator<Entry> {
  const lines = text.split(/\r?\n/);
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = ASSIGNMENT.exec(line);
    const name = match?.[1];
    let value = match?.[2];
    if (name === undefined || value === undefined) {
      throw new SecretsFileError(`secrets file line ${String(index + 1)} is not NAME=value`);
    }
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      if (value.length < 2 || !value.endsWith(quote)) {
        throw new SecretsFileError(`secrets file line ${String(index + 1)} (${name}) has an unclosed quote`);
      }
      value = value.slice(1, -1);
    }
    yield { line: index + 1, name, value };
  }
}

/** The key names in the file, in order. Values are read past and dropped. */
export function secretsFileKeyNames(text: string): string[] {
  return [...entries(text)].map((entry) => entry.name);
}

/** Exactly `keys` from the file; every other line's value is dropped as soon as it is read. */
export function parseSecretsFile<K extends string>(text: string, keys: readonly K[]): Record<K, string> {
  const wanted = new Set<string>(keys);
  const found = new Map<string, string>();
  for (const entry of entries(text)) {
    if (!wanted.has(entry.name)) continue;
    if (found.has(entry.name)) {
      throw new SecretsFileError(`secrets file sets ${entry.name} twice (again on line ${String(entry.line)})`);
    }
    if (entry.value === '') throw new SecretsFileError(`secrets file has an empty ${entry.name}`);
    found.set(entry.name, entry.value);
  }
  const result = {} as Record<K, string>;
  for (const key of keys) {
    const value = found.get(key);
    if (value === undefined) throw new SecretsFileError(`secrets file has no ${key}`);
    result[key] = value;
  }
  return result;
}

export function readDeploySecrets(text: string): DeploySecrets {
  return parseSecretsFile(text, DEPLOY_SECRET_NAMES);
}
