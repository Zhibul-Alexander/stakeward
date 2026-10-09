import type { Cluster } from './constants.ts';

/**
 * Solana CLI commands of the recovery card (CLAUDE.md section 9): what a user runs without Stakeward. The site prints
 * them, the README lists them, and scripts/recovery-cli runs every one of them against a cluster. Each command is an
 * argv; key paths are placeholders the reader replaces, because the card never asks for or holds a key (section 2).
 */

/** Words the reader replaces with a keypair path or a Ledger URL (or, for `<NEW_END_DATE>`, an RFC 3339 date). */
export const RECOVERY_PLACEHOLDERS = {
  stakeAccount: '<STAKE_ACCOUNT>',
  mainKey: '<MAIN_KEY>',
  secondKey: '<SECOND_KEY>',
  newWallet: '<NEW_WALLET>',
  newSecondKey: '<NEW_SECOND_KEY>',
  newEndDate: '<NEW_END_DATE>',
  /** README only: the address the `find` command searches for. */
  mainKeyAddress: '<MAIN_KEY_ADDRESS>',
} as const;
export type RecoveryPlaceholder = (typeof RECOVERY_PLACEHOLDERS)[keyof typeof RECOVERY_PLACEHOLDERS];

const PLACEHOLDER_SET: ReadonlySet<string> = new Set(Object.values(RECOVERY_PLACEHOLDERS));

function isPlaceholder(token: string): token is RecoveryPlaceholder {
  return PLACEHOLDER_SET.has(token);
}

/** Solana CLI release the card's commands were run with (docs/recovery-cli.md). */
export const RECOVERY_CLI_VERSION = '4.3.0';

/** --lockup-date that removes a lock: SetLockup { unixTimestamp: 0 }. */
export const REMOVE_LOCK_DATE = '1970-01-01T00:00:00Z';

/** Display and shell form: double quotes work in bash, zsh, PowerShell and cmd. */
export const LEDGER_PUBKEY_COMMAND: readonly string[] = ['solana-keygen', 'pubkey', '"usb://ledger?key=0"'];

/** The pinned installer (Linux, macOS). */
export const INSTALL_CLI_COMMAND: readonly string[] = [
  'sh',
  '-c',
  `"$(curl -sSfL https://release.anza.xyz/v${RECOVERY_CLI_VERSION}/install)"`,
];

export type RecoveryCommandId =
  | 'find'
  | 'show'
  | 'epoch'
  | 'rescue'
  | 'deactivate'
  | 'withdraw'
  | 'withdraw-alone'
  | 'extend'
  | 'remove-lock'
  | 'change-second-key';

/** The `--url` moniker of a cluster. */
export function cliUrl(cluster: Cluster): 'mainnet-beta' | 'devnet' {
  return cluster === 'mainnet' ? 'mainnet-beta' : 'devnet';
}

/**
 * argv of each card command. `mainKeyAddress` only fills `find`, which is read-only; every key that signs is a
 * placeholder. Fee payers (CLAUDE.md section 5): the rescue is paid by the new wallet, extend and remove-lock by the
 * second key, and change-second-key by the new second key, so a key that may be stolen never pays.
 */
export function recoveryCommands(input: {
  mainKeyAddress: string;
  url: string;
}): Readonly<Record<RecoveryCommandId, readonly string[]>> {
  const { stakeAccount, mainKey, secondKey, newWallet, newSecondKey, newEndDate } = RECOVERY_PLACEHOLDERS;
  const url = ['--url', input.url];
  return {
    find: ['solana', 'stakes', '--withdraw-authority', input.mainKeyAddress, ...url],
    show: ['solana', 'stake-account', stakeAccount, ...url],
    epoch: ['solana', 'epoch-info', ...url],
    // One transaction: AuthorizeChecked(Staker), then AuthorizeChecked(Withdrawer). The checked form makes the new
    // wallet sign; plain stake-authorize needs a default signer (DECISIONS.md D76).
    rescue: [
      'solana',
      'stake-authorize-checked',
      stakeAccount,
      '--stake-authority',
      mainKey,
      '--withdraw-authority',
      mainKey,
      '--new-stake-authority',
      newWallet,
      '--new-withdraw-authority',
      newWallet,
      '--custodian',
      secondKey,
      '--fee-payer',
      newWallet,
      ...url,
    ],
    deactivate: [
      'solana',
      'deactivate-stake',
      stakeAccount,
      '--stake-authority',
      mainKey,
      '--fee-payer',
      mainKey,
      ...url,
    ],
    withdraw: [
      'solana',
      'withdraw-stake',
      stakeAccount,
      mainKey,
      'ALL',
      '--withdraw-authority',
      mainKey,
      '--custodian',
      secondKey,
      '--fee-payer',
      mainKey,
      ...url,
    ],
    'withdraw-alone': [
      'solana',
      'withdraw-stake',
      stakeAccount,
      mainKey,
      'ALL',
      '--withdraw-authority',
      mainKey,
      '--fee-payer',
      mainKey,
      ...url,
    ],
    extend: [
      'solana',
      'stake-set-lockup',
      stakeAccount,
      '--lockup-date',
      newEndDate,
      '--custodian',
      secondKey,
      '--fee-payer',
      secondKey,
      ...url,
    ],
    'remove-lock': [
      'solana',
      'stake-set-lockup',
      stakeAccount,
      '--lockup-date',
      REMOVE_LOCK_DATE,
      '--custodian',
      secondKey,
      '--fee-payer',
      secondKey,
      ...url,
    ],
    // The old second key is the one suspected stolen here, so the new one pays.
    'change-second-key': [
      'solana',
      'stake-set-lockup-checked',
      stakeAccount,
      '--new-custodian',
      newSecondKey,
      '--custodian',
      secondKey,
      '--fee-payer',
      newSecondKey,
      ...url,
    ],
  };
}

/** argv.join(' '): what the copy button copies and what the script runs through bash. */
export function commandLine(argv: readonly string[]): string {
  return argv.join(' ');
}

/**
 * The display form of a `solana` command: line 1 is `solana <sub>`, then one line per positional and per
 * `--flag value` pair, indented two spaces; every line but the last ends with ` \` (bash and zsh line continuation).
 * Any other argv is one line.
 */
export function commandDisplayLines(argv: readonly string[]): string[] {
  const [program, sub, ...rest] = argv;
  if (program !== 'solana' || sub === undefined) return [commandLine(argv)];
  const groups: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i] ?? '';
    const next = rest[i + 1];
    if (token.startsWith('--') && next !== undefined && !next.startsWith('--')) {
      groups.push(`${token} ${next}`);
      i++;
    } else {
      groups.push(token);
    }
  }
  const lines = [`${program} ${sub}`, ...groups.map((group) => `  ${group}`)];
  return lines.map((line, index) => (index < lines.length - 1 ? `${line} \\` : line));
}

/**
 * Replaces every argv entry that is exactly a placeholder with its value from `values`. Other entries, and
 * placeholders without a value, are left as they are; the script asserts none is left before it runs a command.
 */
export function fillPlaceholders(
  argv: readonly string[],
  values: Partial<Readonly<Record<RecoveryPlaceholder, string>>>,
): string[] {
  return argv.map((token) => (isPlaceholder(token) ? (values[token] ?? token) : token));
}

/** CLI output fragments the card explains. Every one but `rewards` is produced by an N-check of scripts/recovery-cli. */
export const CLI_ERROR_MESSAGES = {
  lockup: 'lockup has not yet expired',
  custodian: 'custodian address not present',
  authority: 'Invalid authority provided',
  signature: 'missing required signature for instruction',
  funds: 'insufficient funds for instruction',
  fee: 'insufficient funds for fee',
  rewards: 'stake action is not permitted while the epoch rewards period is active',
  date: 'premature end of input',
  file: 'No such file or directory',
  device: 'no device found',
} as const;
export type CliErrorKey = keyof typeof CLI_ERROR_MESSAGES;
