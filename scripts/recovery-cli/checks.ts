// The recovery card's Solana CLI commands against a cluster (spec step 8 §10). Setup uses plain CLI commands; every
// check then runs a card command as the line a user types; cleanup returns everything but the fees to the funder.
// Failing checks fail in the CLI's own preflight, so they land nothing and cost nothing.
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  CLI_ERROR_MESSAGES,
  LEDGER_PUBKEY_COMMAND,
  RECOVERY_CLI_VERSION,
  recoveryCommands,
  rfc3339Utc,
  type CliErrorKey,
  type RecoveryCommandId,
  type RecoveryPlaceholder,
} from '@stakeward/core';
import { formatSol } from '../gate/tx.ts';
import type { RecoveryCluster } from './args.ts';
import {
  clockUnixTimestamp,
  fillCommand,
  flagsOf,
  helpListsFlag,
  lineWith,
  parseLamports,
  parseSignatures,
  shellArgv,
  solArgument,
  type CliResult,
  type FilledCommand,
  type Shell,
  type SolanaCli,
} from './solana.ts';

const SOL = 1_000_000_000n;
/** On top of the rent reserve in each undelegated account. */
const STAKE_EXTRA = SOL / 100n;
/** K, D and K2 each; also A's and X's margin for fees. */
const WALLET_FUNDS = SOL / 100n;
/** On top of the minimum delegation and rent in the delegated account; also what the thief splits off. */
const SMALL_EXTRA = SOL / 1000n;
export const LAMPORTS_PER_SIGNATURE = 5000n;

/** The main lock: cluster clock + 2 h. The short one, which C9 waits out: + 90 s. */
const LOCK_SECONDS = 2n * 3600n;
const SHORT_LOCK_SECONDS = 90n;
/** Deactivating in the epoch of the activation makes the stake withdrawable at once (C8). */
const MIN_SLOTS_LEFT_TO_DELEGATE = 150n;
/** How long the rewards period, a cooling-down stake and the short lock are waited out. */
const WAIT_MS = 5 * 60_000;
const POLL_MS = 5_000;

const CLOCK_SYSVAR = 'SysvarC1ock11111111111111111111111111111111';
const TRANSIENT = /\b429\b|Too Many Requests|error sending request|connection refused|timed out/i;

export const STAKE_NAMES = ['withdraw', 'rescue', 'extend', 'swap', 'short', 'split', 'delegated', 'split2'] as const;
export type StakeName = (typeof STAKE_NAMES)[number];
/** The accounts setup creates with A; `split2` is the thief's split (C12). */
const SETUP_STAKES: readonly StakeName[] = ['withdraw', 'rescue', 'extend', 'swap', 'short', 'split', 'delegated'];

export const ROLE_NAMES = ['main', 'second', 'second2', 'new', 'thief', 'unfunded'] as const;
export type RoleName = (typeof ROLE_NAMES)[number];
/** How the report names each role. */
export const ROLE_LABELS: Record<RoleName, string> = {
  main: 'A (основной)',
  second: 'K (второй)',
  second2: 'K2 (новый второй)',
  new: 'D (новый кошелёк)',
  thief: 'X (вор)',
  unfunded: 'пустой плательщик (N7)',
};
const ROLE_LETTERS: Record<RoleName, string> = {
  main: 'A',
  second: 'K',
  second2: 'K2',
  new: 'D',
  thief: 'X',
  unfunded: 'пустой',
};

/** A key file and its address. */
export type KeyFile = { path: string; address: string };

export type RunKeys = Record<RoleName, KeyFile> & { stakes: Record<StakeName, KeyFile> };

export type CheckResult = {
  id: string;
  /** What ran, for the table. */
  title: string;
  /** `успех …` or the CLI message the card explains. */
  expected: string;
  passed: boolean;
  /** What happened, short. */
  outcome: string;
  signatures: string[];
  /** The output line that holds the expected message. */
  message: string | null;
  /** The CLI_ERROR_MESSAGES entry an N-check produced. */
  produced: CliErrorKey | null;
};

export type RunContext = {
  cli: SolanaCli;
  url: string;
  cluster: RecoveryCluster;
  log: (line: string) => void;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---- Plan ----

export type FundingPlan = {
  rent: bigint;
  minDelegation: bigint;
  /** Each undelegated setup account. */
  stakeLamports: bigint;
  /** The delegated account; null with --skip-delegated. */
  delegatedLamports: bigint | null;
  /** What the funder sends to each role. */
  wallets: { role: RoleName; lamports: bigint }[];
  /** Network fees of a passing run, all of them. */
  fees: bigint;
  /** Wallet funds plus the funder's own transfer fees. */
  required: bigint;
};

/** Signatures of every transaction a passing run lands. */
export function feeSignatures(skipDelegated: boolean): number {
  const setupStakes = skipDelegated ? 6 : 7;
  return (
    5 + // funder -> A, K, D, K2, X
    setupStakes * 2 + // create-stake-account: A, the stake key
    setupStakes * 2 + // stake-set-lockup-checked: A, K
    (skipDelegated ? 0 : 1 + 2 + 1 + 1 + 2) + // delegate; N9 thief (X, A), A takes back; C8 (A), (A, K)
    2 + // C2 withdraw: A, K
    (2 + 3) + // C3 thief takes the staker (X, A); rescue (D, A, K)
    (2 + 2 + 3) + // C12 thief takes the staker (X, A), splits (X, split′); rescue of split′ (D, A, K)
    (1 + 2) + // C4 extend (K); C5 extend (A, K)
    (1 + 1) + // C6 remove-lock (K); withdraw-alone (A)
    (2 + 2) + // C7 change-second-key (K, K2); withdraw (A, K2)
    1 + // C9 withdraw-alone (A)
    (2 + 2 + 2) + // cleanup: withdraw rescue and split′ (D, K), split (A, K)
    5 // cleanup: A, K, K2, D, X send what is left
  );
}

export function fundingPlan(input: { rent: bigint; minDelegation: bigint; skipDelegated: boolean }): FundingPlan {
  const { rent, minDelegation, skipDelegated } = input;
  const stakeLamports = rent + STAKE_EXTRA;
  const delegatedLamports = skipDelegated ? null : minDelegation + rent + SMALL_EXTRA;
  const wallets: FundingPlan['wallets'] = [
    { role: 'main', lamports: 6n * stakeLamports + WALLET_FUNDS + (delegatedLamports ?? 0n) },
    { role: 'second', lamports: WALLET_FUNDS },
    { role: 'new', lamports: WALLET_FUNDS },
    { role: 'second2', lamports: WALLET_FUNDS },
    { role: 'thief', lamports: WALLET_FUNDS + rent },
  ];
  const transferFees = BigInt(wallets.length) * LAMPORTS_PER_SIGNATURE;
  return {
    rent,
    minDelegation,
    stakeLamports,
    delegatedLamports,
    wallets,
    fees: BigInt(feeSignatures(skipDelegated)) * LAMPORTS_PER_SIGNATURE,
    required: wallets.reduce((sum, wallet) => sum + wallet.lamports, 0n) + transferFees,
  };
}

export function renderPlan(plan: FundingPlan, funder: KeyFile, balance: bigint): string[] {
  return [
    `Funder ${funder.address} (${funder.path}) holds ${formatSol(balance)}; the run needs ${formatSol(plan.required)}:`,
    ...plan.wallets.map((wallet) => `  ${formatSol(wallet.lamports).padStart(16)}  ${ROLE_LABELS[wallet.role]}`),
    `  rent of a stake account ${formatSol(plan.rent)}, minimum delegation ${formatSol(plan.minDelegation)}` +
      (plan.delegatedLamports === null ? ' (not used: --skip-delegated)' : ''),
    `Only the network fees, about ${formatSol(plan.fees)}, are spent; everything else comes back to the funder.`,
  ];
}

// ---- CLI access ----

function sol(ctx: RunContext, args: readonly string[]): CliResult {
  return ctx.cli.run('solana', [...args, '--url', ctx.url]);
}

/** A read at `confirmed`, retried on rate limits and dropped connections. */
async function read(ctx: RunContext, args: readonly string[]): Promise<CliResult> {
  for (let attempt = 1; ; attempt++) {
    const result = sol(ctx, [...args, '--commitment', 'confirmed']);
    if (result.ok || attempt >= 4 || !TRANSIENT.test(result.output)) return result;
    await sleep(2_000 * attempt);
  }
}

/** Runs a command that sends a transaction, again while the stake program is closed for the epoch rewards period. */
async function retryRewards(run: () => CliResult, log: (line: string) => void): Promise<CliResult> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const result = run();
    if (result.ok || !result.output.includes(CLI_ERROR_MESSAGES.rewards) || Date.now() > deadline) return result;
    log('  epoch rewards period: trying again in 10 s');
    await sleep(10_000);
  }
}

/** A setup or cleanup command failed: the CLI output says why. */
export class SetupError extends Error {
  override name = 'SetupError';
}

/** A plain command that must land; returns its signatures. */
async function send(ctx: RunContext, what: string, args: readonly string[]): Promise<string[]> {
  const result = await retryRewards(() => sol(ctx, args), ctx.log);
  if (!result.ok) throw new SetupError(`${what}: ${result.output.trim()}`);
  return parseSignatures(result.output);
}

function json(result: CliResult): unknown {
  return JSON.parse(result.output.slice(result.output.indexOf('{')));
}

export async function readLamports(ctx: RunContext, args: readonly string[]): Promise<bigint> {
  const result = await read(ctx, [...args, '--lamports']);
  const value = result.ok ? parseLamports(result.output) : null;
  if (value === null) throw new SetupError(`solana ${args.join(' ')}: ${result.output.trim()}`);
  return value;
}

export async function balance(ctx: RunContext, address: string): Promise<bigint> {
  return readLamports(ctx, ['balance', address]);
}

/** `solana stake-account --output json`: the fields the checks read. Lockup fields are absent without a lock. */
export type StakeJson = {
  stakeType: string;
  accountBalance: number;
  staker?: string;
  withdrawer?: string;
  unixTimestamp?: number;
  epoch?: number;
  custodian?: string;
  deactivationEpoch?: number;
};

export async function stakeState(ctx: RunContext, address: string): Promise<StakeJson | null> {
  const result = await read(ctx, ['stake-account', address, '--output', 'json']);
  if (!result.ok) {
    if (/AccountNotFound|not found|does not exist/i.test(result.output)) return null;
    throw new SetupError(`stake-account ${address}: ${result.output.trim()}`);
  }
  return json(result) as StakeJson;
}

/** The cluster's Clock: locks follow it, not the wall clock (the test validator's ran about 80 s behind, D76). */
export async function clusterClock(ctx: RunContext): Promise<bigint> {
  const result = await read(ctx, ['account', CLOCK_SYSVAR, '--output', 'json']);
  if (!result.ok) throw new SetupError(`Clock sysvar: ${result.output.trim()}`);
  return clockUnixTimestamp((json(result) as { account: { data: [string, string] } }).account.data[0]);
}

async function epochInfo(ctx: RunContext): Promise<{ epoch: bigint; slotsLeft: bigint }> {
  const result = await read(ctx, ['epoch-info', '--output', 'json']);
  if (!result.ok) throw new SetupError(`epoch-info: ${result.output.trim()}`);
  const info = json(result) as { epoch: number; slotIndex: number; slotsInEpoch: number };
  return { epoch: BigInt(info.epoch), slotsLeft: BigInt(info.slotsInEpoch - info.slotIndex) };
}

/** A vote account to delegate to: the largest one that is not delinquent, else the largest. */
async function voteAccount(ctx: RunContext): Promise<string> {
  const result = await read(ctx, ['validators', '--output', 'json']);
  if (!result.ok) throw new SetupError(`validators: ${result.output.trim()}`);
  const { validators } = json(result) as {
    validators: { voteAccountPubkey: string; activatedStake: number; delinquent: boolean }[];
  };
  const sorted = [...validators].sort((a, b) => b.activatedStake - a.activatedStake);
  const pick = sorted.find((validator) => !validator.delinquent) ?? sorted[0];
  if (pick === undefined) throw new SetupError('the cluster lists no validators');
  return pick.voteAccountPubkey;
}

// ---- Checks before any SOL moves: installer (I1) and help pages (H) ----

export function emptyResult(id: string, title: string, expected: string): CheckResult {
  return { id, title, expected, passed: false, outcome: '', signatures: [], message: null, produced: null };
}

export async function installerCheck(fetchImpl: typeof fetch = fetch): Promise<CheckResult> {
  const url = `https://release.anza.xyz/v${RECOVERY_CLI_VERSION}/install`;
  const result = emptyResult('I1', `Установщик из карточки: HEAD ${url}`, 'HTTP 200');
  try {
    const response = await fetchImpl(url, { method: 'HEAD', signal: AbortSignal.timeout(15_000) });
    result.passed = response.status === 200;
    result.outcome = `HTTP ${String(response.status)}`;
  } catch (error) {
    result.outcome = `запрос не прошёл: ${errorText(error)}`;
  }
  return result;
}

/** H: every `--flag` of every card template is on its `--help` page; `solana-keygen pubkey --help` works. */
export function helpCheck(
  cli: SolanaCli,
  templates: Readonly<Record<RecoveryCommandId, readonly string[]>>,
): CheckResult {
  const ids = Object.keys(templates) as RecoveryCommandId[];
  const result = emptyResult(
    'H',
    '`solana <команда> --help` для каждого шаблона карточки и `solana-keygen pubkey --help`',
    'каждый флаг шаблона описан',
  );
  const missing: string[] = [];
  let flags = 0;
  const pages = new Map<string, CliResult>();
  for (const id of ids) {
    const sub = templates[id][1] ?? '';
    const page = pages.get(sub) ?? cli.run('solana', [sub, '--help']);
    pages.set(sub, page);
    for (const flag of flagsOf(templates[id])) {
      flags++;
      if (!page.ok || !helpListsFlag(page.output, flag)) missing.push(`${sub} ${flag}`);
    }
  }
  const keygen = cli.run('solana-keygen', [LEDGER_PUBKEY_COMMAND[1] ?? 'pubkey', '--help']);
  if (!keygen.ok || !keygen.output.includes('USAGE:')) missing.push('solana-keygen pubkey --help');
  result.passed = missing.length === 0;
  result.outcome =
    missing.length === 0
      ? `шаблонов: ${String(ids.length)}, подкоманд: ${String(pages.size)}, флагов: ${String(flags)}`
      : `нет в справке: ${missing.join(', ')}`;
  return result;
}

// ---- Card commands ----

/** Read-only card commands run through every shell; a signing command is sent once, through bash. */
const READ_ONLY: ReadonlySet<RecoveryCommandId> = new Set(['find', 'show', 'epoch']);

type CardRun = {
  runs: { shell: Shell; result: CliResult }[];
  /** Shells that parsed the line into another argv than the program must get. */
  problems: string[];
};

type CardOptions = {
  values: Partial<Record<RecoveryPlaceholder, string>>;
  overrides?: Record<string, string>;
  /** Placeholders deliberately left in (N10b). */
  keep?: readonly RecoveryPlaceholder[];
};

type Verdict = Pick<CheckResult, 'passed' | 'outcome'> &
  Partial<Pick<CheckResult, 'signatures' | 'message' | 'produced'>>;

/** The last line of an output: where the CLI prints its error. */
function lastLine(output: string): string {
  return output.trim().split('\n').at(-1)?.trim() ?? '';
}

/** Every shell's run failed with the card's message, and every shell parsed the line as intended. */
function failsWith(run: CardRun, key: CliErrorKey): Verdict {
  const fragment = CLI_ERROR_MESSAGES[key];
  const wrong = run.runs.filter(({ result }) => result.ok || !result.output.includes(fragment));
  if (wrong.length > 0 || run.problems.length > 0) {
    const what = wrong.map(({ shell, result }) => `${shell}: ${result.ok ? 'успех' : lastLine(result.output)}`);
    return { passed: false, outcome: [...what, ...run.problems].join('; ') };
  }
  const message = lineWith(run.runs[0]?.result.output ?? '', fragment);
  return { passed: true, outcome: 'ошибка', message, produced: key };
}

/** Every shell's run succeeded, and every shell parsed the line as intended; carries the signatures. */
function succeeds(run: CardRun): Verdict & { signatures: string[] } {
  const wrong = run.runs.filter(({ result }) => !result.ok);
  const signatures = run.runs.flatMap(({ result }) => parseSignatures(result.output));
  if (wrong.length > 0 || run.problems.length > 0) {
    const what = wrong.map(({ shell, result }) => `${shell}: ${lastLine(result.output)}`);
    return { passed: false, outcome: [...what, ...run.problems].join('; '), signatures };
  }
  return { passed: true, outcome: 'успех', signatures };
}

/** All of several steps: the first failure's outcome, every signature. */
function all(...verdicts: Verdict[]): Verdict {
  const failed = verdicts.find((verdict) => !verdict.passed);
  return {
    passed: failed === undefined,
    outcome: failed?.outcome ?? 'успех',
    signatures: verdicts.flatMap((verdict) => verdict.signatures ?? []),
  };
}

function expectation(key: CliErrorKey): string {
  return `ошибка \`${CLI_ERROR_MESSAGES[key]}\``;
}

function closed(gone: boolean): string {
  return `аккаунт ${gone ? 'закрыт' : 'НЕ закрыт'}`;
}

// ---- The run ----

export type ChecksOutcome = {
  results: CheckResult[];
  locks: string[];
  notes: string[];
  aborted: string | null;
};

function date(unix: bigint): string {
  const text = rfc3339Utc(unix);
  if (text === null) throw new Error(`${String(unix)} is not a date`);
  return text;
}

/**
 * Setup, then every check in the order of spec §10 (N9 runs on the delegated account, after N3). A check that throws
 * is recorded as failed and the run goes on; a setup failure stops it. Cleanup is the caller's (`returnFunds`), so it
 * runs whatever happens here.
 */
export async function runChecks(
  ctx: RunContext,
  keys: RunKeys,
  plan: FundingPlan,
  funder: KeyFile,
): Promise<ChecksOutcome> {
  const { cli, log } = ctx;
  const templates = recoveryCommands({ mainKeyAddress: keys.main.address, url: ctx.url });
  const results: CheckResult[] = [];
  const notes: string[] = [];
  const locks: string[] = [];
  const S = keys.stakes;
  const { main: A, second: K, thief: X, new: D } = keys;
  const delegated = plan.delegatedLamports !== null;
  const setupStakes = SETUP_STAKES.filter((name) => delegated || name !== 'delegated');

  /** `D` for the new wallet's address, and so on; any other address as it is. */
  const who = (address: string | undefined): string => {
    const role = ROLE_NAMES.find((name) => keys[name].address === address);
    return role === undefined ? String(address) : ROLE_LETTERS[role];
  };
  /** The card's key placeholders filled with this run's key files, the stake account, and anything else. */
  const values = (stake: KeyFile, extra: Partial<Record<RecoveryPlaceholder, string>> = {}) => ({
    '<MAIN_KEY>': A.path,
    '<SECOND_KEY>': K.path,
    '<NEW_WALLET>': D.path,
    '<NEW_SECOND_KEY>': keys.second2.path,
    '<STAKE_ACCOUNT>': stake.address,
    ...extra,
  });
  /** A card command as typed: placeholders filled, each shell's parse checked, then run. */
  const card = async (id: RecoveryCommandId, options: CardOptions): Promise<CardRun> => {
    const command: FilledCommand = fillCommand(templates[id], options.values, options.overrides);
    const unexpected = command.left.filter((left) => !(options.keep ?? []).some((kept) => kept === left));
    if (unexpected.length > 0) throw new Error(`${id}: placeholders left unfilled: ${unexpected.join(', ')}`);
    const problems: string[] = [];
    if (command.left.length === 0) {
      for (const shell of cli.shells) {
        const argv = shellArgv(cli, shell, command.line);
        if (argv?.join('\n') !== command.argv.join('\n')) problems.push(`${shell} разбирает строку в другие аргументы`);
      }
    }
    log(`  $ ${command.line}`);
    const runs: CardRun['runs'] = [];
    for (const shell of READ_ONLY.has(id) ? cli.shells : (['bash'] as const)) {
      runs.push({ shell, result: await retryRewards(() => cli.shell(shell, command.line), log) });
    }
    return { runs, problems };
  };
  const check = async (id: string, title: string, expected: string, body: () => Verdict | Promise<Verdict>) => {
    const result = emptyResult(id, title, expected);
    try {
      Object.assign(result, await body());
    } catch (error) {
      result.passed = false;
      result.outcome = `сбой проверки: ${errorText(error)}`;
    }
    results.push(result);
    log(`${id.padEnd(5)}${(result.passed ? 'ok' : 'FAILED').padEnd(8)}${result.title}`);
    if (!result.passed) log(`     ${result.outcome}`);
  };
  /** The thief, who holds A, makes X the staker: a plain command, not a card one. */
  const thiefTakesStaker = (stake: KeyFile) =>
    send(ctx, 'thief takes the staker', [
      'stake-authorize-checked', stake.address,
      '--stake-authority', A.path, '--new-stake-authority', X.path, '--fee-payer', X.path,
    ]);

  // ---- Setup ----
  let T: bigint;
  let T2: bigint;
  let T3: bigint;
  let shortT: bigint;
  try {
    log('setup: funding the run keys');
    for (const wallet of plan.wallets) {
      await send(ctx, `fund ${wallet.role}`, [
        'transfer', keys[wallet.role].address, solArgument(wallet.lamports),
        '--from', funder.path, '--fee-payer', funder.path, '--allow-unfunded-recipient',
      ]);
    }
    log('setup: stake accounts with staker = withdrawer = A');
    for (const name of setupStakes) {
      const lamports = name === 'delegated' ? (plan.delegatedLamports ?? 0n) : plan.stakeLamports;
      await send(ctx, `create ${name}`, [
        'create-stake-account', S[name].path, solArgument(lamports),
        '--stake-authority', A.address, '--withdraw-authority', A.address,
        '--from', A.path, '--fee-payer', A.path,
      ]);
    }
    const clock = await clusterClock(ctx);
    T = clock + LOCK_SECONDS;
    T2 = clock + 2n * LOCK_SECONDS;
    T3 = clock + 3n * LOCK_SECONDS;
    shortT = clock + SHORT_LOCK_SECONDS;
    locks.push(`T = ${date(T)}`, `T2 = ${date(T2)}`, `T3 = ${date(T3)}`, `короткий (short) = ${date(shortT)}`);
    log(`setup: locks the way Stakeward sets them (stake-set-lockup-checked, new custodian K), T = ${date(T)}`);
    for (const name of setupStakes) {
      await send(ctx, `lock ${name}`, [
        'stake-set-lockup-checked', S[name].address,
        '--lockup-date', date(name === 'short' ? shortT : T),
        '--new-custodian', K.path, '--custodian', A.path, '--fee-payer', A.path,
      ]);
    }
    if (delegated) {
      const vote = await voteAccount(ctx);
      const deadline = Date.now() + WAIT_MS;
      for (let info = await epochInfo(ctx); info.slotsLeft < MIN_SLOTS_LEFT_TO_DELEGATE; info = await epochInfo(ctx)) {
        if (Date.now() > deadline) throw new SetupError('the epoch did not change within 5 min');
        log(`setup: ${String(info.slotsLeft)} slots left in epoch ${String(info.epoch)}; waiting for the next one`);
        await sleep(POLL_MS);
      }
      log(`setup: delegating to ${vote}`);
      await send(ctx, 'delegate', [
        'delegate-stake', S.delegated.address, vote, '--stake-authority', A.path, '--fee-payer', A.path,
      ]);
    }
  } catch (error) {
    return { results, locks, notes, aborted: `подготовка не прошла: ${errorText(error)}` };
  }

  // ---- C0: find ----
  await check(
    'C0',
    'find: `solana stakes --withdraw-authority <адрес A>`',
    `все ${String(setupStakes.length)} аккаунтов подготовки`,
    async () => {
      const run = await card('find', { values: {} });
      const verdict = succeeds(run);
      const missing = run.runs.flatMap(({ shell, result }) =>
        setupStakes.filter((name) => !result.output.includes(S[name].address)).map((name) => `${shell}: нет ${name}`),
      );
      if (!verdict.passed || missing.length > 0) return { passed: false, outcome: [verdict.outcome, ...missing].join('; ') };
      return { passed: true, outcome: `найдены все ${String(setupStakes.length)}` };
    },
  );

  // ---- N1, C2: withdraw ----
  await check('N1', 'withdraw-alone на запертом `withdraw` (подпись только A)', expectation('lockup'), async () =>
    failsWith(await card('withdraw-alone', { values: values(S.withdraw) }), 'lockup'),
  );
  await check(
    'C2',
    'withdraw на `withdraw` подписями A и K; получатель `<MAIN_KEY>` — файл ключа A',
    'успех: аккаунт закрыт, баланс A вырос',
    async () => {
      const before = await balance(ctx, A.address);
      const verdict = succeeds(await card('withdraw', { values: values(S.withdraw) }));
      if (!verdict.passed) return verdict;
      const gained = (await balance(ctx, A.address)) - before;
      const gone = (await stakeState(ctx, S.withdraw.address)) === null;
      return { ...verdict, passed: gone && gained > 0n, outcome: `${closed(gone)}, баланс A +${formatSol(gained)}` };
    },
  );

  // ---- N2, C3: the thief, then the rescue ----
  await check(
    'N2',
    'Вор (обычная команда): `stake-authorize-checked rescue --withdraw-authority A ' +
      '--new-withdraw-authority X --fee-payer X`',
    expectation('custodian'),
    async () => {
      const args = [
        'stake-authorize-checked', S.rescue.address,
        '--withdraw-authority', A.path, '--new-withdraw-authority', X.path, '--fee-payer', X.path,
      ];
      const result = await retryRewards(() => sol(ctx, args), log);
      const fragment = CLI_ERROR_MESSAGES.custodian;
      if (result.ok || !result.output.includes(fragment)) {
        return { passed: false, outcome: result.ok ? 'успех' : lastLine(result.output) };
      }
      return { passed: true, outcome: 'ошибка', message: lineWith(result.output, fragment), produced: 'custodian' };
    },
  );
  await check(
    'C3',
    'Вор (обычная команда) забирает staker у `rescue`; затем rescue: подписи A, D, K, платит D',
    'успех: staker = withdrawer = D, замок прежний, баланс A не изменился',
    async () => {
      const thief = await thiefTakesStaker(S.rescue);
      const taken = await stakeState(ctx, S.rescue.address);
      if (taken?.staker !== X.address) return { passed: false, outcome: `staker после вора: ${who(taken?.staker)}` };
      const before = await balance(ctx, A.address);
      const verdict = succeeds(await card('rescue', { values: values(S.rescue) }));
      if (!verdict.passed) return verdict;
      const state = await stakeState(ctx, S.rescue.address);
      const aChange = (await balance(ctx, A.address)) - before;
      const roles = state?.staker === D.address && state.withdrawer === D.address;
      const lock = state?.custodian === K.address && BigInt(state.unixTimestamp ?? 0) === T;
      return {
        passed: roles && lock && aChange === 0n,
        outcome:
          `staker ${who(state?.staker)}, withdrawer ${who(state?.withdrawer)}, ` +
          `замок ${lock ? 'прежний (K, T)' : 'ИЗМЕНИЛСЯ'}, ` +
          `баланс A ${aChange === 0n ? 'не изменился' : `изменился на ${formatSol(aChange)}`}`,
        signatures: [...thief, ...verdict.signatures],
      };
    },
  );

  // ---- C12: the thief splits `split`; find and rescue still cover the new account ----
  await check(
    'C12',
    'Вор (обычные команды, подпись X): забирает staker у `split`, `split-stake split split′`; ' +
      'затем find и rescue `split′`',
    'успех: find видит split′; staker = withdrawer = D',
    async () => {
      const thief = await thiefTakesStaker(S.split);
      const amount = plan.rent + SMALL_EXTRA;
      const splitArgs = [
        'split-stake', S.split.address, S.split2.path, solArgument(amount),
        '--stake-authority', X.path, '--fee-payer', X.path,
      ];
      const thiefBefore = await balance(ctx, X.address);
      let split = await retryRewards(() => sol(ctx, splitArgs), log);
      let how = 'split-stake прошёл без дополнительных флагов';
      // CLI 4.3.0 refuses a split below the minimum delegation, delegated or not, unless the rent reserve is given.
      if (!split.ok && split.output.includes('minimum stake delegation')) {
        const reserve = solArgument(plan.rent);
        how =
          `split-stake без флагов: «${lastLine(split.output)}»; ` +
          `с \`--rent-exempt-reserve-sol ${reserve}\` CLI эту проверку пропускает`;
        split = await retryRewards(() => sol(ctx, [...splitArgs, '--rent-exempt-reserve-sol', reserve]), log);
      }
      if (!split.ok) return { passed: false, outcome: `split-stake: ${lastLine(split.output)}` };
      const split2 = await stakeState(ctx, S.split2.address);
      const thiefSpent = thiefBefore - (await balance(ctx, X.address));
      notes.push(
        `C12: ${how}. На split′ ${split2 === null ? 'аккаунта нет' : formatSol(BigInt(split2.accountBalance))}: ` +
          `${formatSol(amount)} из split и залог ${formatSol(plan.rent)}, который CLI сам перевёл с плательщика X ` +
          `в той же транзакции (X потратил ${formatSol(thiefSpent)}). Split копирует замок: хранитель ` +
          `${who(split2?.custodian)}.`,
      );
      const find = await card('find', { values: {} });
      const listed = succeeds(find).passed && find.runs.every(({ result }) => result.output.includes(S.split2.address));
      const rescue = succeeds(await card('rescue', { values: values(S.split2) }));
      const state = await stakeState(ctx, S.split2.address);
      const rescued = rescue.passed && state?.staker === D.address && state.withdrawer === D.address;
      const roles = `staker ${who(state?.staker)}, withdrawer ${who(state?.withdrawer)}`;
      return {
        passed: listed && rescued,
        outcome: `find ${listed ? 'видит' : 'НЕ видит'} split′; ${rescue.passed ? roles : rescue.outcome}`,
        signatures: [...thief, ...parseSignatures(split.output), ...rescue.signatures],
      };
    },
  );

  // ---- N5, N4: the wrong key ----
  await check('N5', 'rescue на `extend` с `--custodian` = файл ключа X', expectation('lockup'), async () =>
    failsWith(await card('rescue', { values: values(S.extend), overrides: { '--custodian': X.path } }), 'lockup'),
  );
  await check('N4', 'extend на `extend` с `--custodian <MAIN_KEY>`', expectation('authority'), async () =>
    failsWith(
      await card('extend', {
        values: values(S.extend, { '<NEW_END_DATE>': date(T2) }),
        overrides: { '--custodian': '<MAIN_KEY>' },
      }),
      'authority',
    ),
  );

  // ---- C4, C5: extend ----
  const lockedUntil = async (stake: KeyFile) => BigInt((await stakeState(ctx, stake.address))?.unixTimestamp ?? 0);
  await check('C4', 'extend на `extend` до T2, платит K', 'успех: дата замка = T2', async () => {
    const verdict = succeeds(await card('extend', { values: values(S.extend, { '<NEW_END_DATE>': date(T2) }) }));
    if (!verdict.passed) return verdict;
    const at = await lockedUntil(S.extend);
    return { ...verdict, passed: at === T2, outcome: `дата замка ${date(at)}` };
  });
  await check(
    'C5',
    'extend на `extend` до T3, платит A (`--fee-payer <MAIN_KEY>`)',
    'успех: дата замка = T3, комиссию заплатил A',
    async () => {
      const [aBefore, kBefore] = [await balance(ctx, A.address), await balance(ctx, K.address)];
      const verdict = succeeds(
        await card('extend', {
          values: values(S.extend, { '<NEW_END_DATE>': date(T3) }),
          overrides: { '--fee-payer': '<MAIN_KEY>' },
        }),
      );
      if (!verdict.passed) return verdict;
      const at = await lockedUntil(S.extend);
      const [aChange, kChange] = [(await balance(ctx, A.address)) - aBefore, (await balance(ctx, K.address)) - kBefore];
      return {
        ...verdict,
        passed: at === T3 && aChange < 0n && kChange === 0n,
        outcome: `дата замка ${date(at)}; A ${formatSol(aChange)}, K ${formatSol(kChange)}`,
      };
    },
  );

  // ---- N7, N8, N10a, N10b: user errors ----
  const extendTo = (endDate: string) => values(S.extend, { '<NEW_END_DATE>': endDate });
  await check('N7', 'extend с новым пустым `--fee-payer`', expectation('fee'), async () =>
    failsWith(
      await card('extend', { values: extendTo(date(T3)), overrides: { '--fee-payer': keys.unfunded.path } }),
      'fee',
    ),
  );
  await check('N8', 'extend с `<NEW_END_DATE>` = `2027-01-01` (без времени)', expectation('date'), async () =>
    failsWith(await card('extend', { values: extendTo('2027-01-01') }), 'date'),
  );
  await check('N10a', 'extend с `--custodian` = путь к несуществующему файлу', expectation('file'), async () =>
    failsWith(
      await card('extend', {
        values: extendTo(date(T3)),
        overrides: { '--custodian': join(dirname(cli.home), 'missing.json') },
      }),
      'file',
    ),
  );
  await check(
    'N10b',
    'extend, `<SECOND_KEY>` не заменён, через bash в пустой папке',
    `${expectation('file')} от оболочки, файлов не появилось`,
    async () => {
      const { '<SECOND_KEY>': _left, ...filled } = extendTo(date(T3));
      const run = await card('extend', { values: filled, keep: ['<SECOND_KEY>'] });
      const verdict = failsWith(run, 'file');
      if (!verdict.passed) return verdict;
      // bash reads `<SECOND_KEY` as "stdin from the file SECOND_KEY" and stops before running anything.
      const fromShell = run.runs.every(({ shell, result }) => result.output.startsWith(`${shell}:`));
      const stray = readdirSync(cli.home);
      return {
        ...verdict,
        passed: fromShell && stray.length === 0,
        outcome:
          `${fromShell ? 'сообщение оболочки' : 'сообщение НЕ от оболочки'}; ` +
          (stray.length === 0 ? 'папка пуста' : `появились файлы: ${stray.join(', ')}`),
      };
    },
  );

  // ---- C6: remove the lock, then withdraw with the main key alone ----
  await check(
    'C6',
    'remove-lock на `extend` (K), show, затем withdraw-alone (A)',
    'успех: в show нет строк Lockup; аккаунт закрыт',
    async () => {
      const removed = succeeds(await card('remove-lock', { values: values(S.extend) }));
      if (!removed.passed) return removed;
      const shown = await card('show', { values: values(S.extend) });
      const lockLines = shown.runs.some(({ result }) => result.output.includes('Lockup'));
      const withdrawn = succeeds(await card('withdraw-alone', { values: values(S.extend) }));
      const gone = (await stakeState(ctx, S.extend.address)) === null;
      const verdict = all(removed, succeeds(shown), withdrawn);
      return {
        ...verdict,
        passed: verdict.passed && !lockLines && gone,
        outcome: verdict.passed
          ? `show ${lockLines ? 'ЕЩЁ показывает Lockup' : 'без строк Lockup'}; ${closed(gone)}`
          : verdict.outcome,
      };
    },
  );

  // ---- C7: a new second key, which pays for the change itself ----
  await check(
    'C7',
    'change-second-key на `swap` → K2 (платит K2), затем withdraw с `<SECOND_KEY>` = K2',
    'успех: хранитель K2, дата прежняя; аккаунт закрыт',
    async () => {
      const changed = succeeds(await card('change-second-key', { values: values(S.swap) }));
      if (!changed.passed) return changed;
      const state = await stakeState(ctx, S.swap.address);
      const swapped = state?.custodian === keys.second2.address && BigInt(state.unixTimestamp ?? 0) === T;
      const withdrawn = succeeds(
        await card('withdraw', { values: values(S.swap, { '<SECOND_KEY>': keys.second2.path }) }),
      );
      const gone = (await stakeState(ctx, S.swap.address)) === null;
      const verdict = all(changed, withdrawn);
      const lock = swapped
        ? 'хранитель K2, дата прежняя'
        : `хранитель ${who(state?.custodian)}, ${String(state?.unixTimestamp)}`;
      return {
        ...verdict,
        passed: verdict.passed && swapped && gone,
        outcome: verdict.passed ? `${lock}; ${closed(gone)}` : verdict.outcome,
      };
    },
  );

  // ---- N3, N9, C8: delegated stake ----
  if (delegated) {
    await check('N3', 'withdraw (A и K) на делегированном `delegated`', expectation('funds'), async () =>
      failsWith(await card('withdraw', { values: values(S.delegated) }), 'funds'),
    );
    // Deactivate on an undelegated account fails with `invalid account data for instruction` before any signer
    // check (first localnet run), so N9 needs the delegated account; A then takes the staker back for C8.
    await check(
      'N9',
      'deactivate (подпись A) на `delegated` после того, как вор (обычная команда) забрал у него staker',
      expectation('signature'),
      async () => {
        await thiefTakesStaker(S.delegated);
        const verdict = failsWith(await card('deactivate', { values: values(S.delegated) }), 'signature');
        await send(ctx, 'A takes the staker back', [
          'stake-authorize-checked', S.delegated.address,
          '--stake-authority', A.path, '--new-stake-authority', A.path, '--fee-payer', A.path,
        ]);
        const back = (await stakeState(ctx, S.delegated.address))?.staker === A.address;
        return {
          ...verdict,
          passed: verdict.passed && back,
          outcome: `${verdict.outcome}; затем A (withdrawer) ${back ? 'вернул' : 'НЕ вернул'} себе staker`,
        };
      },
    );
    await check('C8', 'deactivate `delegated`, затем withdraw (A и K)', 'успех: аккаунт закрыт', async () => {
      const deactivated = succeeds(await card('deactivate', { values: values(S.delegated) }));
      if (!deactivated.passed) return deactivated;
      const deadline = Date.now() + WAIT_MS;
      let withdrawn = succeeds(await card('withdraw', { values: values(S.delegated) }));
      let waited = 0;
      while (!withdrawn.passed && withdrawn.outcome.includes(CLI_ERROR_MESSAGES.funds) && Date.now() < deadline) {
        log('  stake still cooling down: trying again in 15 s');
        await sleep(15_000);
        waited += 15;
        withdrawn = succeeds(await card('withdraw', { values: values(S.delegated) }));
      }
      const gone = (await stakeState(ctx, S.delegated.address)) === null;
      const verdict = all(deactivated, withdrawn);
      const wait = waited > 0 ? `ждали ${String(waited)} с` : 'вывод сразу после снятия (та же эпоха)';
      if (!verdict.passed) return verdict;
      return { ...verdict, passed: gone, outcome: `${closed(gone)}; ${wait}` };
    });
  } else {
    notes.push('`--skip-delegated`: N3, N9 и C8 не выполнялись.');
  }

  // ---- C9: a lock that ended by itself ----
  await check(
    'C9',
    'Дождаться по часам кластера конца короткого замка `short`, затем withdraw-alone (A)',
    'успех: аккаунт закрыт',
    async () => {
      const deadline = Date.now() + WAIT_MS;
      for (let clock = await clusterClock(ctx); clock <= shortT; clock = await clusterClock(ctx)) {
        if (Date.now() > deadline) return { passed: false, outcome: `часы кластера не дошли до ${date(shortT)}` };
        log(`  cluster clock ${date(clock)}, waiting for ${date(shortT)}`);
        await sleep(POLL_MS);
      }
      const verdict = succeeds(await card('withdraw-alone', { values: values(S.short) }));
      if (!verdict.passed) return verdict;
      const gone = (await stakeState(ctx, S.short.address)) === null;
      return { ...verdict, passed: gone, outcome: closed(gone) };
    },
  );

  // ---- C10, C11, S1, N6: read-only commands ----
  await check(
    'C10',
    'show на спасённом `rescue`',
    '`Withdraw Authority: D`, `Lockup Custodian: K`, `Lockup Timestamp: T`',
    async () => {
      const run = await card('show', { values: values(S.rescue) });
      const verdict = succeeds(run);
      if (!verdict.passed) return verdict;
      const wanted = [
        `Withdraw Authority: ${D.address}`,
        `Lockup Custodian: ${K.address}`,
        `Lockup Timestamp: ${date(T)}`,
      ];
      const missing = run.runs.flatMap(({ shell, result }) =>
        wanted.filter((line) => !result.output.includes(line)).map((line) => `${shell}: нет «${line}»`),
      );
      if (missing.length > 0) return { passed: false, outcome: missing.join('; ') };
      return { passed: true, outcome: 'все три строки на месте' };
    },
  );
  await check('C11', 'epoch', '`Epoch Completed Time`', async () => {
    const run = await card('epoch', { values: {} });
    const verdict = succeeds(run);
    if (!verdict.passed) return verdict;
    const everywhere = run.runs.every(({ result }) => result.output.includes('Epoch Completed Time'));
    const line = lineWith(run.runs[0]?.result.output ?? '', 'Epoch Completed Time');
    return { passed: everywhere, outcome: everywhere ? 'строка на месте' : 'строки нет', message: line };
  });
  await check(
    'S1',
    'Вид карточки с ` \\` в конце строк (по аргументу на строку): show и epoch',
    'тот же вывод, что у команды в одну строку',
    () => {
      const problems: string[] = [];
      for (const [id, filled] of [
        ['show', values(S.rescue)],
        ['epoch', {}],
      ] as const) {
        const command = fillCommand(templates[id], filled);
        log(`  $ ${command.displayLines.join('\n    ')}`);
        // epoch-info moves on between the two runs: compare its line labels; show must match exactly.
        const shape = (output: string) =>
          id === 'epoch' ? output.split('\n').map((line) => line.split(':')[0]).join('\n') : output;
        for (const shell of cli.shells) {
          const oneLine = cli.shell(shell, command.line);
          const display = cli.shell(shell, command.displayLines.join('\n'));
          if (!oneLine.ok || !display.ok || shape(oneLine.output) !== shape(display.output)) {
            problems.push(`${shell} ${id}: ${display.ok ? 'другой вывод' : lastLine(display.output)}`);
          }
        }
      }
      return {
        passed: problems.length === 0,
        outcome: problems.length === 0 ? `${cli.shells.join(', ')}: совпадает` : problems.join('; '),
      };
    },
  );
  await check(
    'N6',
    '`solana-keygen pubkey "usb://ledger?key=0"` без Ledger',
    `${expectation('device')} или адрес`,
    () => {
      const line = LEDGER_PUBKEY_COMMAND.join(' ');
      const runs = cli.shells.map((shell) => ({ shell, result: cli.shell(shell, line) }));
      const fragment = CLI_ERROR_MESSAGES.device;
      const address = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/m;
      const expected = (result: CliResult) =>
        result.ok ? address.test(result.output) : result.output.includes(fragment);
      const wrong = runs.filter(({ result }) => !expected(result));
      if (wrong.length > 0) {
        const what = wrong.map(({ shell, result }) => `${shell}: ${lastLine(result.output)}`);
        return { passed: false, outcome: what.join('; ') };
      }
      const sample = runs[0]?.result;
      return sample?.ok === true
        ? { passed: true, outcome: 'адрес Ledger', message: lastLine(sample.output) }
        : { passed: true, outcome: 'ошибка', message: lineWith(sample?.output ?? '', fragment), produced: 'device' };
    },
  );

  const produced = new Set(
    results.flatMap((result) => (result.passed && result.produced !== null ? [result.produced] : [])),
  );
  const notProduced = (Object.keys(CLI_ERROR_MESSAGES) as CliErrorKey[]).filter((key) => !produced.has(key));
  const list = (keys: Iterable<CliErrorKey>) => [...keys].map((key) => `\`${key}\``).join(', ');
  notes.push(
    `Сообщения \`CLI_ERROR_MESSAGES\`, которые вызвали проверки N: ${list(produced)}` +
      (notProduced.length === 0 ? '.' : `; не вызваны: ${list(notProduced)}.`),
  );
  return { results, locks, notes, aborted: null };
}

// ---- Cleanup ----

/**
 * Returns what the run keys hold to the funder: each stake account that still exists is withdrawn by the key that
 * controls it (with the custodian while its lock is in force; a delegated one is deactivated first by its staker),
 * then every wallet sends what it has left. Used at the end of a run and on the keys of an earlier run.
 */
export async function returnFunds(
  ctx: RunContext,
  funder: KeyFile,
  wallets: readonly KeyFile[],
  stakes: readonly { name: string; key: KeyFile }[],
): Promise<{ notes: string[]; leftovers: string[] }> {
  const notes: string[] = [];
  const leftovers: string[] = [];
  const byAddress = new Map(wallets.map((wallet) => [wallet.address, wallet]));
  const clock = await clusterClock(ctx);
  const { epoch } = await epochInfo(ctx);
  for (const { name, key } of stakes) {
    const state = await stakeState(ctx, key.address);
    if (state === null) continue;
    const held = `${name} ${key.address}: ${formatSol(BigInt(state.accountBalance))}`;
    const locked = BigInt(state.unixTimestamp ?? 0) > clock || BigInt(state.epoch ?? 0) > epoch;
    const withdrawer = byAddress.get(state.withdrawer ?? '');
    const custodian = locked ? byAddress.get(state.custodian ?? '') : undefined;
    const active = state.stakeType === 'Stake' && state.deactivationEpoch === undefined;
    const staker = active ? byAddress.get(state.staker ?? '') : undefined;
    if (withdrawer === undefined || (locked && custodian === undefined) || (active && staker === undefined)) {
      leftovers.push(`${held} (no key of this run can withdraw it)`);
      continue;
    }
    try {
      if (staker !== undefined) {
        await send(ctx, `deactivate ${name}`, [
          'deactivate-stake', key.address, '--stake-authority', staker.path, '--fee-payer', staker.path,
        ]);
      }
      await send(ctx, `withdraw ${name}`, [
        'withdraw-stake', key.address, funder.address, 'ALL',
        '--withdraw-authority', withdrawer.path,
        ...(custodian === undefined ? [] : ['--custodian', custodian.path]),
        '--fee-payer', withdrawer.path,
      ]);
      notes.push(`${name} ${formatSol(BigInt(state.accountBalance))}`);
    } catch (error) {
      leftovers.push(`${held} (${errorText(error).split('\n')[0] ?? ''})`);
    }
  }
  let returned = 0n;
  for (const wallet of wallets) {
    const lamports = await balance(ctx, wallet.address);
    if (lamports === 0n) continue;
    if (lamports <= LAMPORTS_PER_SIGNATURE) {
      leftovers.push(`wallet ${wallet.address}: ${formatSol(lamports)}, less than a fee`);
      continue;
    }
    try {
      await send(ctx, 'return a wallet', [
        'transfer', funder.address, 'ALL',
        '--from', wallet.path, '--fee-payer', wallet.path, '--allow-unfunded-recipient',
      ]);
      returned += lamports;
    } catch (error) {
      leftovers.push(`wallet ${wallet.address}: ${formatSol(lamports)} (${errorText(error).split('\n')[0] ?? ''})`);
    }
  }
  if (returned > 0n) notes.push(`кошельки ${formatSol(returned)}`);
  return { notes, leftovers };
}
