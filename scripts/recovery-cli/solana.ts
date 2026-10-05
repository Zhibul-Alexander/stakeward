// The Solana CLI as an external tool (DECISIONS.md D78): not a repository dependency, found on PATH or in $SOLANA_BIN.
// Setup and read commands run as plain argv without a shell. Card commands run as the line a user types, through
// `bash -c` (and `zsh -c` when zsh is installed), with every value in double quotes. The working directory and HOME
// are an empty folder, so a command that needed a CLI config or a default keypair would fail.
import { spawnSync } from 'node:child_process';
import {
  commandDisplayLines,
  commandLine,
  fillPlaceholders,
  RECOVERY_PLACEHOLDERS,
  type RecoveryPlaceholder,
} from '@stakeward/core';

export const CLI_TIMEOUT_MS = 120_000;

export type Shell = 'bash' | 'zsh';

export type CliResult = {
  /** Exit code 0. */
  ok: boolean;
  status: number | null;
  /** stdout, then stderr: what the user sees in the terminal. */
  output: string;
};

export type SolanaCli = {
  /** `solana …` or `solana-keygen …` as argv, no shell. */
  run(program: 'solana' | 'solana-keygen', args: readonly string[]): CliResult;
  /** A command line through `<shell> -c`. */
  shell(shell: Shell, line: string): CliResult;
  /** bash, plus zsh when it is installed. */
  shells: readonly Shell[];
  /** The empty working directory and HOME of every command. */
  home: string;
};

export function createSolanaCli({ home, bin }: { home: string; bin: string | undefined }): SolanaCli {
  const path = process.env['PATH'] ?? '/usr/bin:/bin';
  // Only PATH and HOME: no SOLANA_* variables or config reach the commands.
  const env = { PATH: bin === undefined || bin === '' ? path : `${bin}:${path}`, HOME: home };
  const spawn = (program: string, args: readonly string[]): CliResult => {
    const result = spawnSync(program, args, { cwd: home, env, encoding: 'utf8', timeout: CLI_TIMEOUT_MS });
    if (result.error !== undefined) {
      const error = result.error as NodeJS.ErrnoException;
      const reason = error.code === 'ENOENT' ? `${program} not found on PATH` : error.message;
      return { ok: false, status: null, output: reason };
    }
    return { ok: result.status === 0, status: result.status, output: `${result.stdout}${result.stderr}` };
  };
  const zsh = spawn('zsh', ['-c', 'true']).ok;
  return {
    run: (program, args) => spawn(program, args),
    shell: (shell, line) => spawn(shell, ['-c', line]),
    shells: zsh ? ['bash', 'zsh'] : ['bash'],
    home,
  };
}

// ---- Card commands: placeholders filled the way a user fills them ----

const PLACEHOLDERS: readonly string[] = Object.values(RECOVERY_PLACEHOLDERS);

function isPlaceholder(token: string): token is RecoveryPlaceholder {
  return PLACEHOLDERS.includes(token);
}

/** `"value"`: the way the card tells users to write a path or a Ledger URL. */
export function quote(value: string): string {
  if (/["$`\\]/.test(value)) throw new Error(`cannot put ${value} in double quotes as is`);
  return `"${value}"`;
}

/** The placeholders still in an argv or a line. */
export function placeholdersIn(tokens: readonly string[]): string[] {
  return PLACEHOLDERS.filter((placeholder) => tokens.some((token) => token.includes(placeholder)));
}

export type FilledCommand = {
  /** What the program must receive. */
  argv: string[];
  /** What the user types: every value in double quotes. */
  line: string;
  /** The card's display form of the same typed command, one argument per line ending in ` \`. */
  displayLines: string[];
  /** Placeholders left unfilled. */
  left: string[];
};

/**
 * Fills a card template. `overrides` replace the value after a flag (`{ '--fee-payer': '<MAIN_KEY>' }`), with a
 * placeholder or a literal value; the variants are the card's own ("the main key may pay instead") or the user
 * errors the N-checks make.
 */
export function fillCommand(
  template: readonly string[],
  values: Partial<Readonly<Record<RecoveryPlaceholder, string>>>,
  overrides: Readonly<Record<string, string>> = {},
): FilledCommand {
  const build = (wrap: (value: string) => string) => {
    const varied = template.map((token, index) => {
      const override = overrides[template[index - 1] ?? ''];
      if (override === undefined) return token;
      return isPlaceholder(override) ? override : wrap(override);
    });
    const wrapped: Partial<Record<RecoveryPlaceholder, string>> = {};
    for (const [placeholder, value] of Object.entries(values) as [RecoveryPlaceholder, string][]) {
      wrapped[placeholder] = wrap(value);
    }
    return fillPlaceholders(varied, wrapped);
  };
  const missing = Object.keys(overrides).filter((flag) => !template.includes(flag));
  if (missing.length > 0) throw new Error(`the template has no ${missing.join(', ')}`);
  const typed = build(quote);
  return {
    argv: build((value) => value),
    line: commandLine(typed),
    displayLines: commandDisplayLines(typed),
    left: placeholdersIn(typed),
  };
}

/** The argv a shell makes of a line, read back with printf: proves the quoting gives the program what it should get. */
export function shellArgv(cli: SolanaCli, shell: Shell, line: string): string[] | null {
  const result = cli.shell(shell, `printf '%s\\n' ${line}`);
  if (!result.ok) return null;
  return result.output.replace(/\n$/, '').split('\n');
}

// ---- Help pages ----

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when a `--help` page lists the flag as an option: `    -u, --url <URL>` or `        --custodian <KEYPAIR>`. */
export function helpListsFlag(help: string, flag: string): boolean {
  return new RegExp(`(^|\\s)(-\\w, )?${escapeRegExp(flag)}[ =]`, 'm').test(help);
}

/** The `--flags` of an argv. */
export function flagsOf(argv: readonly string[]): string[] {
  return argv.filter((token) => token.startsWith('--'));
}

// ---- Output parsing ----

/** `solana-cli 4.3.0 (src:44b42d45; …)` -> `4.3.0`. */
export function parseCliVersion(output: string): string | null {
  return /solana-cli (\d+\.\d+\.\d+)/.exec(output)?.[1] ?? null;
}

/** `Rent-exempt minimum: 2282880 lamports`, `1000000000 lamports`, `899980000 lamports` -> the number. */
export function parseLamports(output: string): bigint | null {
  const match = /(\d+) lamports/.exec(output);
  return match?.[1] === undefined ? null : BigInt(match[1]);
}

/** Every `Signature: <base58>` line of a command's output. */
export function parseSignatures(output: string): string[] {
  return [...output.matchAll(/^Signature: ([1-9A-HJ-NP-Za-km-z]{64,88})$/gm)].map((match) => match[1] ?? '');
}

/** Clock sysvar data: slot, epoch_start_timestamp, epoch, leader_schedule_epoch, unix_timestamp (i64 at 32). */
export function clockUnixTimestamp(base64: string): bigint {
  const data = Buffer.from(base64, 'base64');
  if (data.length < 40) throw new Error(`Clock sysvar data has ${String(data.length)} bytes`);
  return data.readBigInt64LE(32);
}

/** The line of an output that holds `fragment`, trimmed, for the report. */
export function lineWith(output: string, fragment: string): string | null {
  const line = output.split('\n').find((candidate) => candidate.includes(fragment));
  return line === undefined ? null : line.trim();
}

/** `1002282880n` -> `1.00228288`: an AMOUNT argument of the CLI, in SOL. */
export function solArgument(lamports: bigint): string {
  const whole = lamports / 1_000_000_000n;
  const fraction = (lamports % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return fraction === '' ? whole.toString() : `${whole.toString()}.${fraction}`;
}
