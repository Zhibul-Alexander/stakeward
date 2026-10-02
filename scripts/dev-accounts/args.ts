// Command line of scripts/dev-accounts.ts.
import { parseArgs } from 'node:util';
import { isAddress, type Address } from '@solana/kit';
import { LAMPORTS_PER_SOL } from '../gate/tx.ts';
import { ACCOUNT_KINDS, type AccountKind } from './accounts.ts';

export const USAGE = [
  'Usage: pnpm dev-accounts <address> [--delegated-sol 1] [--undelegated-sol 0.1] [--only delegated|undelegated] [--dry-run]',
  '  Creates on devnet, paid by .keys/devnet-funder.json, one delegated and one undelegated stake account whose',
  '  staker and withdrawer are <address>, without a lockup.',
  '  --delegated-sol    stake of the delegated account, at least 1 SOL (minimum delegation); default 1',
  '  --undelegated-sol  SOL in the undelegated account on top of its rent reserve; default 0.1',
  '  --only             create just one of the two',
  '  --dry-run          read the chain and print the plan; send nothing',
  '  RPC_URL            overrides https://api.devnet.solana.com (must be a devnet endpoint)',
].join('\n');

export const DEFAULT_DELEGATED_LAMPORTS = LAMPORTS_PER_SOL;
export const DEFAULT_UNDELEGATED_LAMPORTS = LAMPORTS_PER_SOL / 10n;

export type DevAccountsArgs =
  | { help: true }
  | {
      help: false;
      target: Address;
      kinds: AccountKind[];
      delegatedLamports: bigint;
      undelegatedLamports: bigint;
      dryRun: boolean;
    };

/** A command line the script cannot run; printed with the usage, exit code 1. */
export class UsageError extends Error {
  override name = 'UsageError';
}

/** `1` -> 1 000 000 000 lamports, `0.25` -> 250 000 000; at most 9 decimals, no sign, no exponent. */
export function parseSol(text: string, flag: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,9}))?$/.exec(text);
  if (match === null) throw new UsageError(`${flag} takes an amount of SOL such as 1 or 0.25, got "${text}"`);
  const [, whole = '0', fraction = ''] = match;
  return BigInt(whole) * LAMPORTS_PER_SOL + BigInt(fraction.padEnd(9, '0'));
}

export function parseDevAccountsArgs(argv: readonly string[]): DevAccountsArgs {
  // pnpm may pass a `--` separator in front of the script's own arguments.
  const args = argv[0] === '--' ? argv.slice(1) : [...argv];
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        'delegated-sol': { type: 'string' },
        'undelegated-sol': { type: 'string' },
        only: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  if (values.help) return { help: true };
  if (positionals.length !== 1) throw new UsageError('Pass exactly one address');
  const [target = ''] = positionals;
  if (!isAddress(target)) throw new UsageError(`"${target}" is not a Solana address`);

  let kinds: AccountKind[] = [...ACCOUNT_KINDS];
  if (values.only !== undefined) {
    const only = ACCOUNT_KINDS.find((kind) => kind === values.only);
    if (only === undefined) throw new UsageError(`--only takes delegated or undelegated, got "${values.only}"`);
    kinds = [only];
  }
  const delegatedSol = values['delegated-sol'];
  const undelegatedSol = values['undelegated-sol'];
  return {
    help: false,
    target,
    kinds,
    delegatedLamports:
      delegatedSol === undefined ? DEFAULT_DELEGATED_LAMPORTS : parseSol(delegatedSol, '--delegated-sol'),
    undelegatedLamports:
      undelegatedSol === undefined ? DEFAULT_UNDELEGATED_LAMPORTS : parseSol(undelegatedSol, '--undelegated-sol'),
    dryRun: values['dry-run'],
  };
}
