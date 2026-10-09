// The whole Stakeward stack on this machine, for the QA suite's `local` target (.claude/skills/qa-e2e/SKILL.md):
//   1. the LiteSVM JSON-RPC (chain-server.ts) on QA_CHAIN_PORT (8899), standing in for devnet;
//   2. the site built for devnet (apps/web/dist), unless --no-build;
//   3. the real worker under `wrangler dev --local` on QA_SITE_PORT (8787): static site, /api/*, local D1 with the
//      repository's migrations, RPC_URL pointing at (1). Telegram secrets are placeholders: no message leaves.
// Everything it writes lives in apps/web/.cache/qa-local (git-ignored) and is wiped on each start.
// Stops both children on SIGINT/SIGTERM. Playwright starts it as its webServer; it also runs on its own:
//   node apps/web/qa/local/stack.ts [--no-build]
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('../../', import.meta.url));
const WORKER = fileURLToPath(new URL('../../../worker/', import.meta.url));
const STATE = fileURLToPath(new URL('../../.cache/qa-local/', import.meta.url));
const chainPort = process.env['QA_CHAIN_PORT'] ?? '8899';
const sitePort = process.env['QA_SITE_PORT'] ?? '8787';
const siteOrigin = `http://127.0.0.1:${sitePort}`;
const children: ChildProcess[] = [];

let stopping = false;
function stopAll(code = 0): never {
  stopping = true;
  // Each child leads its own process group (pnpm -> wrangler -> workerd): signal the whole group.
  for (const child of children) {
    if (child.pid === undefined) continue;
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  process.exit(code);
}
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
process.on('SIGHUP', () => stopAll(0));

function run(command: string, args: string[], cwd: string, env: Record<string, string> = {}): void {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.status !== 0) {
    console.error(`[qa-local] ${command} ${args.join(' ')} failed (exit ${String(result.status)})`);
    stopAll(1);
  }
}

function start(name: string, command: string, args: string[], cwd: string): ChildProcess {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: process.env, detached: true });
  const prefix = (chunk: Buffer) =>
    chunk
      .toString()
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => `[${name}] ${line}`)
      .join('\n');
  child.stdout.on('data', (chunk: Buffer) => {
    console.log(prefix(chunk));
  });
  child.stderr.on('data', (chunk: Buffer) => {
    console.error(prefix(chunk));
  });
  child.on('exit', (code) => {
    if (stopping) return;
    console.error(`[qa-local] ${name} exited (${String(code)}); stopping the stack`);
    stopAll(code === 0 ? 1 : (code ?? 1));
  });
  children.push(child);
  return child;
}

async function waitFor(url: string, init: RequestInit | undefined, label: string, seconds = 90): Promise<void> {
  for (let i = 0; i < seconds; i += 1) {
    try {
      const response = await fetch(url, init);
      await response.body?.cancel();
      return;
    } catch {
      // not up yet
    }
    await sleep(1000);
  }
  console.error(`[qa-local] ${label} did not come up at ${url}`);
  stopAll(1);
}

rmSync(STATE, { recursive: true, force: true });
mkdirSync(STATE, { recursive: true });

start('chain', process.execPath, [fileURLToPath(new URL('./chain-server.ts', import.meta.url)), '--port', chainPort], WEB);
await waitFor(`http://127.0.0.1:${chainPort}/`, undefined, 'the LiteSVM chain');

if (!process.argv.includes('--no-build')) run('pnpm', ['exec', 'vite', 'build'], WEB, { VITE_CLUSTER: 'devnet' });

const envFile = `${STATE}worker.env`;
writeFileSync(
  envFile,
  [
    `RPC_URL=http://127.0.0.1:${chainPort}`,
    // Placeholders: the local stack never talks to Telegram for real (calls fail and are logged, nothing is sent).
    'TELEGRAM_BOT_TOKEN=0:qa-local-placeholder',
    'TELEGRAM_WEBHOOK_SECRET=qa-local-webhook-secret',
    'ADMIN_CHAT_ID=0',
    'TELEGRAM_BOT_USERNAME=stakeward_qa_local_bot',
    `SITE_ORIGIN=${siteOrigin}`,
    '',
  ].join('\n'),
);
const persist = `${STATE}wrangler`;
// The repository's wrangler.jsonc with the per-IP rate limits raised: every request of a local run comes from one IP
// at test speed. The limits themselves are covered by the worker's tests, and the dev target runs with the real ones.
const config = JSON.parse(
  readFileSync(`${WORKER}wrangler.jsonc`, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n'),
) as { ratelimits: { simple: { limit: number } }[] };
for (const limit of config.ratelimits) limit.simple.limit = 100_000;
const configPath = `${WORKER}.wrangler.qa-local.json`;
writeFileSync(configPath, JSON.stringify(config, null, 2));
run('pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist, '--config', configPath], WORKER);
start(
  'worker',
  'pnpm',
  [
    'exec',
    'wrangler',
    'dev',
    '--local',
    '--config',
    configPath,
    '--ip',
    '127.0.0.1',
    '--port',
    sitePort,
    '--env-file',
    envFile,
    '--persist-to',
    persist,
    '--test-scheduled',
    '--show-interactive-dev-session=false',
  ],
  WORKER,
);
await waitFor(`${siteOrigin}/api/health`, undefined, 'the worker');
// One monitor pass, so /api/health has a fresh "last checked" (crons do not fire under wrangler dev).
await fetch(`${siteOrigin}/cdn-cgi/handler/scheduled?cron=*/2+*+*+*+*`).catch(() => undefined);
console.log(`[qa-local] ready: site ${siteOrigin}, chain http://127.0.0.1:${chainPort}`);
// Keep the "last checked" fresh for long runs: one pass every 2 minutes, as the cron would.
setInterval(() => {
  void fetch(`${siteOrigin}/cdn-cgi/handler/scheduled?cron=*/2+*+*+*+*`).catch(() => undefined);
}, 120_000);
