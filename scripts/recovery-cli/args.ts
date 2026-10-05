// Command line of scripts/recovery-cli.ts.
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { GENESIS_HASH } from '../gate/rpc.ts';

export const USAGE = [
  'Usage: pnpm recovery-cli [--url devnet|localhost|<rpc url>] [--funder <keypair file>] [--skip-delegated] [--dry-run]',
  '  Runs every Solana CLI command of the recovery card against a cluster with throwaway keys, and writes the',
  "  cluster's section of docs/recovery-cli.md. Everything but the network fees goes back to the funder.",
  '  --url             devnet (https://api.devnet.solana.com, default), localhost (http://127.0.0.1:8899) or a URL;',
  '                    mainnet is refused',
  '  --funder          solana-keygen key file that pays; default .keys/devnet-funder.json',
  '  --skip-delegated  no delegated account: skips N3, N9 and C8 and needs about 1 SOL less',
  '  --dry-run         read the cluster and print the funding plan; send nothing',
  '  SOLANA_BIN        folder of the solana binaries when they are not on PATH',
].join('\n');

export const URL_MONIKERS = {
  devnet: 'https://api.devnet.solana.com',
  localhost: 'http://127.0.0.1:8899',
} as const;

export const DEFAULT_FUNDER_FILE = 'devnet-funder';
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export type RecoveryCliArgs =
  | { help: true }
  | {
      help: false;
      /** The RPC URL every command gets as `--url`. */
      url: string;
      /** Absolute path of the funder's key file. */
      funder: string;
      /** True when --funder was not given: the gate's devnet funder, created when missing. */
      defaultFunder: boolean;
      skipDelegated: boolean;
      dryRun: boolean;
    };

/** A command line the script cannot run; printed with the usage, exit code 1. */
export class UsageError extends Error {
  override name = 'UsageError';
}

/** The script will not run here (mainnet, no CLI, a funder file that does not exist); exit code 1. */
export class RecoveryCliRefusal extends Error {
  override name = 'RecoveryCliRefusal';
}

export function resolveUrl(value: string): string {
  if (value === 'devnet' || value === 'localhost') return URL_MONIKERS[value];
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UsageError(`--url takes devnet, localhost or an http(s) URL, got "${value}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UsageError(`--url takes devnet, localhost or an http(s) URL, got "${value}"`);
  }
  return value;
}

/** Relative paths are relative to where `pnpm` was started (INIT_CWD), not to scripts/. */
export function resolveFunder(value: string, cwd: string): string {
  return isAbsolute(value) ? value : resolve(cwd, value);
}

export function parseRecoveryCliArgs(
  argv: readonly string[],
  cwd: string = process.env['INIT_CWD'] ?? process.cwd(),
): RecoveryCliArgs {
  // pnpm may pass a `--` separator in front of the script's own arguments.
  const args = argv[0] === '--' ? argv.slice(1) : [...argv];
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        url: { type: 'string', default: 'devnet' },
        funder: { type: 'string' },
        'skip-delegated': { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const { values } = parsed;
  if (values.help) return { help: true };
  return {
    help: false,
    url: resolveUrl(values.url),
    funder:
      values.funder === undefined
        ? resolveFunder(`.keys/${DEFAULT_FUNDER_FILE}.json`, REPO_ROOT)
        : resolveFunder(values.funder, cwd),
    defaultFunder: values.funder === undefined,
    skipDelegated: values['skip-delegated'],
    dryRun: values['dry-run'],
  };
}

export type RecoveryCluster = 'localnet' | 'devnet';

/** The cluster by its genesis hash. Mainnet is refused: the run moves SOL and its keys are throwaway files. */
export function clusterOfGenesis(hash: string): RecoveryCluster {
  if (hash === GENESIS_HASH.mainnet) {
    throw new RecoveryCliRefusal(
      'This RPC URL points to mainnet (genesis hash). The script runs on devnet or localnet only.',
    );
  }
  return hash === GENESIS_HASH.devnet ? 'devnet' : 'localnet';
}
