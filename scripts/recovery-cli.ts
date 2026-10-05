// The recovery card's Solana CLI commands, run for real (spec step 8 §10, DECISIONS D78). Usage: see
// recovery-cli/args.ts or
//   pnpm recovery-cli --help
// Needs the Solana CLI on PATH (or SOLANA_BIN); it is an external tool, not a dependency, and CI never runs this.
// Throwaway keys go in .keys/recovery-<cluster>/; everything but the network fees goes back to the funder, and the
// run rewrites its cluster's section of docs/recovery-cli.md. Mainnet is refused by its genesis hash.
// Exit code 0: every check passed, or --dry-run, or the funder is short (the plan is printed); 1: refused, a check
// failed, something was left behind or the run broke.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTALL_CLI_COMMAND, RECOVERY_CLI_VERSION, recoveryCommands, RECOVERY_PLACEHOLDERS } from '@stakeward/core';
import { createKey, KEYS_DIR, keyPath, loadKey, loadOrCreateKey } from './gate/keys.ts';
import { formatSol } from './gate/tx.ts';
import {
  clusterOfGenesis,
  DEFAULT_FUNDER_FILE,
  parseRecoveryCliArgs,
  RecoveryCliRefusal,
  USAGE,
  UsageError,
} from './recovery-cli/args.ts';
import {
  balance,
  fundingPlan,
  helpCheck,
  installerCheck,
  readLamports,
  renderPlan,
  returnFunds,
  ROLE_LABELS,
  ROLE_NAMES,
  runChecks,
  STAKE_NAMES,
  type ChecksOutcome,
  type KeyFile,
  type RoleName,
  type RunContext,
  type RunKeys,
  type StakeName,
} from './recovery-cli/checks.ts';
import { consoleReport, RECOVERY_CLI_DOC, renderSection, upsertSection } from './recovery-cli/report.ts';
import { createSolanaCli, parseCliVersion, type SolanaCli } from './recovery-cli/solana.ts';

const log = (line: string) => {
  console.log(line);
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `.keys/<name>.json` as a key file the CLI reads, or null when it does not exist. */
async function loadKeyFile(name: string): Promise<KeyFile | null> {
  const signer = await loadKey(name);
  return signer === null ? null : { path: fileURLToPath(keyPath(name)), address: signer.address };
}

async function newKeyFile(name: string): Promise<KeyFile> {
  const signer = await createKey(name, { replace: false });
  return { path: fileURLToPath(keyPath(name)), address: signer.address };
}

/** Wallets first, so the stake accounts' authorities are known; then the stake accounts. */
async function loadRunKeys(runName: string) {
  const wallets: KeyFile[] = [];
  for (const role of ROLE_NAMES) {
    const key = await loadKeyFile(`${runName}/${role}`);
    if (key !== null) wallets.push(key);
  }
  const stakes: { name: string; key: KeyFile }[] = [];
  for (const name of STAKE_NAMES) {
    const key = await loadKeyFile(`${runName}/stake-${name}`);
    if (key !== null) stakes.push({ name, key });
  }
  return { wallets, stakes };
}

/** An earlier run's folder: return what its keys hold, then keep it under a new name (it is never deleted). */
async function retireEarlierRun(ctx: RunContext, funder: KeyFile, runName: string, runDir: string): Promise<void> {
  log(`.keys/${runName}/ holds the keys of an earlier run: returning what they hold to the funder`);
  const { wallets, stakes } = await loadRunKeys(runName);
  const result = await returnFunds(ctx, funder, wallets, stakes);
  if (result.notes.length > 0) log(`  returned: ${result.notes.join(', ')}`);
  for (const leftover of result.leftovers) log(`  left behind: ${leftover}`);
  const target = `${runDir.replace(/\/$/, '')}.old-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  renameSync(runDir, target);
  log(`  kept as .keys/${target.split('/').at(-1) ?? ''}`);
}

function shellVersions(cli: SolanaCli): string[] {
  return cli.shells.map((shell) => cli.shell(shell, `${shell} --version`).output.split('\n')[0]?.trim() ?? shell);
}

async function main(): Promise<void> {
  const args = parseRecoveryCliArgs(process.argv.slice(2));
  if (args.help) {
    log(USAGE);
    return;
  }
  const bin = process.env['SOLANA_BIN'];
  // Commands before the run folder exists get their own empty HOME too.
  const probeHome = mkdtempSync(join(tmpdir(), 'recovery-cli-'));
  try {
    await run(args, createSolanaCli({ home: probeHome, bin }), bin);
  } finally {
    rmSync(probeHome, { recursive: true, force: true });
  }
}

async function run(
  args: Extract<ReturnType<typeof parseRecoveryCliArgs>, { help: false }>,
  probe: SolanaCli,
  bin: string | undefined,
): Promise<void> {
  // 1. The CLI and the pinned installer.
  const version = probe.run('solana', ['--version']);
  if (!version.ok) {
    throw new RecoveryCliRefusal(
      `Solana CLI not found (${version.output.trim()}). Install it with\n  ${INSTALL_CLI_COMMAND.join(' ')}\n` +
        'or set SOLANA_BIN to the folder that holds the solana binary.',
    );
  }
  const cliVersion = version.output.trim();
  log(cliVersion);
  if (parseCliVersion(cliVersion) !== RECOVERY_CLI_VERSION) {
    log(`warning: the card's commands were checked with Solana CLI ${RECOVERY_CLI_VERSION}`);
  }
  const installer = await installerCheck();
  log(`I1   ${installer.passed ? 'ok' : 'FAILED'}  ${installer.title}: ${installer.outcome}`);

  // 2. Which cluster.
  const genesis = probe.run('solana', ['genesis-hash', '--url', args.url]);
  if (!genesis.ok) throw new RecoveryCliRefusal(`solana genesis-hash --url ${args.url}: ${genesis.output.trim()}`);
  const cluster = clusterOfGenesis(genesis.output.trim());
  log(`cluster: ${cluster} (${args.url})`);

  // 3. Help pages.
  const templates = recoveryCommands({ mainKeyAddress: RECOVERY_PLACEHOLDERS.mainKeyAddress, url: args.url });
  const help = helpCheck(probe, templates);
  log(`H    ${help.passed ? 'ok' : 'FAILED'}  ${help.outcome}`);

  // 4. Funding plan.
  if (!existsSync(args.funder)) {
    if (!args.defaultFunder) throw new RecoveryCliRefusal(`--funder ${args.funder}: no such file`);
    await loadOrCreateKey(DEFAULT_FUNDER_FILE);
    log(`created .keys/${DEFAULT_FUNDER_FILE}.json`);
  }
  const pubkey = probe.run('solana-keygen', ['pubkey', args.funder]);
  if (!pubkey.ok) throw new RecoveryCliRefusal(`--funder ${args.funder}: ${pubkey.output.trim()}`);
  const funder: KeyFile = { path: args.funder, address: pubkey.output.trim() };
  const probeCtx: RunContext = { cli: probe, url: args.url, cluster, log };
  const plan = fundingPlan({
    rent: await readLamports(probeCtx, ['rent', '200']),
    minDelegation: await readLamports(probeCtx, ['stake-minimum-delegation']),
    skipDelegated: args.skipDelegated,
  });
  let funderBalance = await balance(probeCtx, funder.address);
  for (const line of renderPlan(plan, funder, funderBalance)) log(line);
  if (args.dryRun) {
    log('Dry run: nothing sent.');
    return;
  }

  // 5. Keys: retire an earlier run's folder, then make this run's.
  const runName = `recovery-${cluster}`;
  const runDir = fileURLToPath(new URL(`${runName}/`, KEYS_DIR));
  if (existsSync(runDir)) {
    await retireEarlierRun(probeCtx, funder, runName, runDir);
    funderBalance = await balance(probeCtx, funder.address);
  }
  if (funderBalance < plan.required) {
    log(`Fund ${funder.address}: it holds ${formatSol(funderBalance)}, the run needs ${formatSol(plan.required)}.`);
    log('Not run.');
    return; // not an error: the run waits for funds
  }
  const cliHome = join(runDir, 'cli-home');
  mkdirSync(cliHome, { recursive: true, mode: 0o700 });
  const roles = {} as Record<RoleName, KeyFile>;
  for (const role of ROLE_NAMES) roles[role] = await newKeyFile(`${runName}/${role}`);
  const stakes = {} as Record<StakeName, KeyFile>;
  for (const name of STAKE_NAMES) stakes[name] = await newKeyFile(`${runName}/stake-${name}`);
  const keys: RunKeys = { ...roles, stakes };
  log(`keys: .keys/${runName}/ (${ROLE_NAMES.map((role) => `${role} ${roles[role].address}`).join(', ')})`);

  // 6-8. Setup, checks, cleanup.
  const cli = createSolanaCli({ home: cliHome, bin });
  const ctx: RunContext = { cli, url: args.url, cluster, log };
  const startedAt = new Date();
  let outcome: ChecksOutcome = { results: [], locks: [], notes: [], aborted: null };
  try {
    outcome = await runChecks(ctx, keys, plan, funder);
  } catch (error) {
    outcome.aborted = `сбой прогона: ${message(error)}`;
  }
  log('cleanup: returning everything to the funder');
  const cleanup = await returnFunds(
    ctx,
    funder,
    ROLE_NAMES.map((role) => roles[role]),
    STAKE_NAMES.map((name) => ({ name, key: stakes[name] })),
  ).catch((error: unknown) => ({ notes: [], leftovers: [`cleanup failed: ${message(error)}`] }));
  if (cleanup.notes.length > 0) log(`  returned: ${cleanup.notes.join(', ')}`);
  const funderEnd = await balance(ctx, funder.address).catch(() => null);
  const spent = funderEnd === null ? null : funderBalance - funderEnd;

  // 9. Report.
  const results = [installer, help, ...outcome.results];
  const report = {
    cluster,
    url: args.url,
    startedAt,
    cliVersion,
    shells: shellVersions(cli),
    funder: funder.address,
    keys: (['main', 'second', 'second2', 'new', 'thief'] as const).map((role) => ({
      role: ROLE_LABELS[role],
      address: roles[role].address,
    })),
    locks: outcome.locks,
    results,
    spent,
    notes: [
      ...outcome.notes,
      ...(cleanup.notes.length === 0 ? [] : [`Возврат спонсору: ${cleanup.notes.join(', ')}.`]),
      ...(cleanup.leftovers.length === 0
        ? ['На ключах прогона ничего не осталось.']
        : cleanup.leftovers.map((leftover) => `**Не возвращено:** ${leftover}`)),
    ],
    aborted: outcome.aborted,
  };
  const doc = existsSync(RECOVERY_CLI_DOC) ? readFileSync(RECOVERY_CLI_DOC, 'utf8') : null;
  writeFileSync(RECOVERY_CLI_DOC, upsertSection(doc, cluster, renderSection(report)));
  log(`docs/recovery-cli.md: ${cluster} section updated`);
  log('');
  log(consoleReport(report));
  if (spent !== null) log(`funder spent ${formatSol(spent)} (expected about ${formatSol(plan.fees)})`);
  for (const leftover of cleanup.leftovers) log(`left behind: ${leftover}`);
  const allPassed = outcome.aborted === null && results.every((result) => result.passed);
  process.exitCode = allPassed && cleanup.leftovers.length === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  if (error instanceof UsageError) console.error(`${error.message}\n\n${USAGE}`);
  else if (error instanceof RecoveryCliRefusal) console.error(error.message);
  else console.error(error);
  process.exitCode = 1;
});
