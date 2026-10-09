// Mechanism gate (CLAUDE.md step 1). Usage:
//   pnpm gate:litesvm   local chain with the mainnet stake program v5.1.0, all 14 checks
//   pnpm gate:devnet    checks 1-13, paid by .keys/devnet-funder.json (generated on first run)
//   pnpm gate:mainnet   checks 2, 3, 4, 5, 6, 13 with the one-time key .keys/mainnet-gate.json
// RPC_URL overrides the public endpoint. Each run rewrites its own section of docs/gate.md.
// Devnet and mainnet runs print the address to fund and the exact amount, and stop (exit code 0) while the balance
// is short. Exit code 1: a check did not match or the run failed.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { generateKeyPairSigner, type KeyPairSigner } from '@solana/kit';
import { STAKE_PROGRAM_SHA256 } from '@stakeward/core/test/support';
import { gateBudget, readRents, type Role } from './gate/budget.ts';
import type { GateCluster } from './gate/chain.ts';
import { archiveKey, createKey, keyDisplayPath, keyPath, loadKey, loadOrCreateKey } from './gate/keys.ts';
import { consoleReport, GATE_DOC, hasResults, renderPending, renderResults, upsertSection } from './gate/report.ts';
import { createRpcChain, GENESIS_HASH, PUBLIC_RPC_URL } from './gate/rpc.ts';
import { runGate, type GateKeys, type GateReport } from './gate/run.ts';
import { createSender } from './gate/sender.ts';
import { sweep } from './gate/sweep.ts';
import { formatLamports, formatSol } from './gate/tx.ts';

/** The checks that mix the delegation of S1 (1b, 7a, 8a, 9) must run inside one epoch; start only with this much left. */
const MIN_EPOCH_MINUTES_LEFT = 20;
/** Average slot time used to estimate the end of the epoch. */
const SLOT_SECONDS = 0.4;

const log = (line: string) => {
  console.log(line);
};

function readDoc(): string | null {
  return existsSync(GATE_DOC) ? readFileSync(GATE_DOC, 'utf8') : null;
}

function writeSection(cluster: GateCluster, body: string): void {
  writeFileSync(GATE_DOC, upsertSection(readDoc(), cluster, body));
  log(`docs/gate.md: ${cluster} section updated`);
}

function finish(report: GateReport): void {
  writeSection(report.cluster, renderResults(report));
  log('');
  log(consoleReport(report));
  if (report.sweep !== null) for (const note of report.sweep.notes) log(`sweep: ${note}`);
  const allMatched = report.aborted === null && report.results.every((result) => result.matched);
  process.exitCode = allMatched ? 0 : 1;
}

async function runLiteSvm(): Promise<void> {
  // Loaded only here: the devnet and mainnet modes do not need the native LiteSVM module.
  const { createLiteSvmChain } = await import('./gate/litesvm.ts');
  const chain = await createLiteSvmChain();
  const [funder, A, B, X, D] = await Promise.all([1, 2, 3, 4, 5].map(() => generateKeyPairSigner()));
  if (funder === undefined || A === undefined || B === undefined || X === undefined || D === undefined) {
    throw new Error('key generation failed');
  }
  const budget = gateBudget('litesvm', await readRents(chain));
  chain.fund(funder.address, budget.required);
  log(`LiteSVM, funder starts with exactly ${formatSol(budget.required)}`);
  finish(await runGate(chain, { cluster: 'litesvm', keys: { funder, A, B, X, D }, log }));
}

/** Role keys kept in .keys/ for one run, so a crashed run's funds can be recovered. */
const ROLE_FILES: Record<'devnet' | 'mainnet', Partial<Record<Role, string>>> = {
  devnet: { A: 'gate-devnet-a', B: 'gate-devnet-b', X: 'gate-devnet-x', D: 'gate-devnet-d' },
  mainnet: { B: 'mainnet-gate-b', X: 'mainnet-gate-x' },
};
const FUNDER_FILE = { devnet: 'devnet-funder', mainnet: 'mainnet-gate' } as const;

async function runRpc(cluster: 'devnet' | 'mainnet'): Promise<void> {
  const envUrl = process.env['RPC_URL'];
  const url = envUrl === undefined || envUrl === '' ? PUBLIC_RPC_URL[cluster] : envUrl;
  const chain = createRpcChain(url, { log });
  if ((await chain.genesisHash()) !== GENESIS_HASH[cluster]) {
    throw new Error(`RPC_URL does not point to ${cluster} (genesis hash differs)`);
  }
  const { signer: funder, created } = await loadOrCreateKey(FUNDER_FILE[cluster]);
  const role = cluster === 'devnet' ? 'funder' : 'one-time key';
  log(`${cluster} ${role}: ${funder.address} (${keyDisplayPath(FUNDER_FILE[cluster])}${created ? ', new' : ''})`);
  const program = await chain.programElf();
  log(`stake program ELF sha256 ${program.sha256} (release fixture ${STAKE_PROGRAM_SHA256})`);

  // Keys of an earlier run: return what they still hold before replacing them.
  const files = Object.values(ROLE_FILES[cluster]);
  const previous = (await Promise.all(files.map((file) => loadKey(file)))).filter((key) => key !== null);
  if (previous.length > 0 && (await chain.balance(funder.address)) === 0n) {
    log('keys of an earlier run found, but the payer has no SOL for the fees of returning their funds; skipped');
  } else if (previous.length > 0) {
    log(`recovering funds held by the keys of an earlier run (${String(previous.length)} key files)`);
    // On mainnet the one-time key is A: its stake accounts are the gate's too.
    const owners = cluster === 'mainnet' ? [funder, ...previous] : previous;
    const result = await sweep(createSender(chain, new Map(), log), funder, owners);
    for (const note of result.notes) log(`recovery: ${note}`);
    if (!result.clean) {
      const suffix = Date.now().toString(36);
      for (const file of files) if (existsSync(keyPath(file))) log(`kept ${archiveKey(file, suffix)}`);
    }
  }

  const budget = gateBudget(cluster, await readRents(chain));
  const balance = await chain.balance(funder.address);
  if (balance < budget.required) {
    log(
      `Fund ${funder.address} on ${cluster}: it holds ${formatSol(balance)}, ` +
        `the run needs ${formatSol(budget.required)} (${formatLamports(budget.required)} lamports).`,
    );
    for (const item of budget.items) log(`  ${formatLamports(item.lamports).padStart(15)}  ${item.label}`);
    log(`Only the network fees (${formatSol(budget.fees)}) are spent; the rest comes back. Not run.`);
    if (!hasResults(readDoc(), cluster)) {
      writeSection(
        cluster,
        renderPending({
          cluster,
          address: funder.address,
          keyFile: keyDisplayPath(FUNDER_FILE[cluster]),
          balance,
          budget,
          program,
          programMatchesRelease: program.sha256 === STAKE_PROGRAM_SHA256,
        }),
      );
    }
    return; // not an error: the run waits for funds
  }

  if (cluster === 'devnet') {
    const epoch = await chain.epochInfo();
    const minutesLeft = (Number(epoch.slotsInEpoch - epoch.slotIndex) * SLOT_SECONDS) / 60;
    if (minutesLeft < MIN_EPOCH_MINUTES_LEFT) {
      log(`Epoch ${String(epoch.epoch)} ends in about ${minutesLeft.toFixed(0)} min; run again after it changes. Not run.`);
      return;
    }
  }

  const roleKey = async (role: Role): Promise<KeyPairSigner> => {
    const file = ROLE_FILES[cluster][role];
    return file === undefined ? generateKeyPairSigner() : createKey(file, { replace: true });
  };
  const keys: GateKeys = {
    funder,
    A: cluster === 'mainnet' ? funder : await roleKey('A'),
    B: await roleKey('B'),
    X: await roleKey('X'),
    // Not used on mainnet; an in-memory key that never holds anything.
    D: await roleKey('D'),
  };
  finish(await runGate(chain, { cluster, keys, log }));
}

async function main(): Promise<void> {
  const cluster = process.argv.slice(2).find((arg) => arg !== '--');
  if (cluster === 'litesvm') return runLiteSvm();
  if (cluster === 'devnet' || cluster === 'mainnet') return runRpc(cluster);
  throw new Error('Usage: node gate.ts litesvm|devnet|mainnet');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
