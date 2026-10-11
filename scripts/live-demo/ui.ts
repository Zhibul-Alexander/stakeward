// Stakeward live demo as a page: the scenario as buttons, what happened, and the network output in its own pane.
// Usage: sw ui (or node scripts/live-demo/ui.ts [port]). Listens on 127.0.0.1 only and runs only the sw.sh commands
// listed in STEPS, so a page from another site cannot make it run anything else.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Role = 'owner' | 'thief' | 'second' | 'new' | 'setup';

export interface Step {
  id: string;
  group: string;
  role: Role;
  label: string;
  args: readonly string[];
  // What the audience should see; shown on the button.
  expect: string;
}

export const LOCK_DURATIONS = ['10m', '1h', '6mo', '12mo'] as const;

export const STEPS: readonly Step[] = [
  { id: 'balances', group: 'Prepare', role: 'setup', label: 'Balances', args: ['balances'], expect: 'SOL on every demo wallet' },
  { id: 'fund', group: 'Prepare', role: 'setup', label: 'Top up wallets', args: ['fund', '0.25', '1.25'], expect: 'MAIN 1.25 SOL, others 0.25' },

  { id: 'before-stake', group: 'Without a lock', role: 'owner', label: 'Stake 0.1 SOL', args: ['stake', '0.1'], expect: 'new stake account, no lock' },
  { id: 'before-thief', group: 'Without a lock', role: 'thief', label: 'Steal everything', args: ['thief', 'withdraw'], expect: 'accepted: the thief takes it all' },

  { id: 'stake', group: 'With Stakeward', role: 'owner', label: 'Stake 1 SOL', args: ['stake', '1'], expect: 'new stake account' },
  { id: 'lock', group: 'With Stakeward', role: 'owner', label: 'Lock with the second key', args: ['lock', '{duration}'], expect: 'main + second key sign' },
  { id: 'thief-wallet', group: 'With Stakeward', role: 'thief', label: 'Empty the main wallet', args: ['thief', 'wallet'], expect: 'accepted: the free SOL is gone' },
  { id: 'thief-withdraw', group: 'With Stakeward', role: 'thief', label: 'Steal the stake', args: ['thief', 'withdraw'], expect: 'rejected: locked' },
  { id: 'thief-take', group: 'With Stakeward', role: 'thief', label: 'Become the owner', args: ['thief', 'take'], expect: 'rejected: needs the second key' },
  { id: 'thief-unlock', group: 'With Stakeward', role: 'thief', label: 'Remove the lock', args: ['thief', 'unlock'], expect: 'rejected: only the second key' },
  { id: 'thief-staker', group: 'With Stakeward', role: 'thief', label: 'Take over staking', args: ['thief', 'staker'], expect: 'accepted, but the SOL stays put' },
  { id: 'rescue', group: 'With Stakeward', role: 'new', label: 'Rescue to the new wallet', args: ['rescue'], expect: 'new wallet + main + second key' },
  { id: 'after-thief', group: 'With Stakeward', role: 'thief', label: 'Steal the stake again', args: ['thief', 'withdraw'], expect: 'rejected: main key no longer owns it' },

  { id: 'unlock', group: 'After the demo', role: 'second', label: 'Remove the lock', args: ['unlock'], expect: 'second key alone, before the SOL leaves' },
  { id: 'withdraw-new', group: 'After the demo', role: 'new', label: 'New wallet withdraws', args: ['withdraw-new'], expect: 'closes the stake account' },
  { id: 'sweep', group: 'After the demo', role: 'setup', label: 'Return SOL to the funder', args: ['sweep'], expect: 'leftovers back to the funder' },
];

export const NETWORKS = ['devnet', 'rpc', 'local'] as const;

export interface Network {
  name: string;
  label: string;
  rpcLabel: string;
}

// `sw net` -> the network the demo is on now.
export function parseNetwork(text: string): Network {
  const field = (key: string) => new RegExp(`^${key}=(.*)$`, 'm').exec(text)?.[1]?.trim() ?? '';
  return { name: field('network'), label: field('label'), rpcLabel: field('rpc_label') };
}

// The sw.sh arguments of a button press; null when the step or the duration is not on the list.
export function commandFor(id: string, duration = '6mo'): string[] | null {
  const step = STEPS.find((s) => s.id === id);
  if (!step || !(LOCK_DURATIONS as readonly string[]).includes(duration)) return null;
  return step.args.map((a) => (a === '{duration}' ? duration : a));
}

export interface Wallet {
  name: string;
  address: string;
  sol: string;
}

// `sw balances` lines -> wallets (the stake account comes as name STAKE).
export function parseBalances(text: string): Wallet[] {
  const wallets: Wallet[] = [];
  for (const m of text.matchAll(/^ {2}(MAIN KEY|SECOND KEY|NEW WALLET|THIEF|STAKE)\s+(\S+)\s+([\d.]+) SOL/gm)) {
    wallets.push({ name: m[1] ?? '', address: m[2] ?? '', sol: m[3] ?? '' });
  }
  return wallets;
}

// `sw status` -> the plain-words line and the owner, or null when there is no live stake account.
export function parseStatus(text: string): { plain: string; owner: string; address: string } | null {
  const plain = /In plain words: (.+)$/m.exec(text)?.[1];
  if (!plain) return null;
  return {
    plain: plain.trim(),
    owner: /owner \(withdraw\): ([^;]+);/.exec(text)?.[1]?.trim() ?? '',
    address: /^Stake account (\S+)/m.exec(text)?.[1] ?? '',
  };
}

const SW = fileURLToPath(new URL('sw.sh', import.meta.url));
const PAGE = fileURLToPath(new URL('ui.html', import.meta.url));
// The site's fonts, when the web app's dependencies are installed; the page falls back to system fonts.
const FONTS: Record<string, string> = {
  'geist.woff2': '@fontsource-variable/geist/files/geist-latin-wght-normal.woff2',
  'geist-mono.woff2': '@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2',
};
const WEB_MODULES = fileURLToPath(new URL('../../apps/web/node_modules/', import.meta.url));

function sw(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawn('bash', [SW, ...args], { env: { ...process.env, NO_COLOR: '1', ...env } });
}

function capture(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const child = sw(args);
    let text = '';
    child.stdout.on('data', (d: Buffer) => (text += d.toString()));
    child.stderr.on('data', (d: Buffer) => (text += d.toString()));
    child.on('close', () => {
      resolve(text);
    });
  });
}

// Streams one step as JSON lines: {t:'out'} is what sw.sh prints, {t:'net'} the network output it logs.
function runStep(args: string[], res: ServerResponse) {
  const dir = mkdtempSync(join(tmpdir(), 'sw-ui-'));
  const log = join(dir, 'network.log');
  let sent = 0;
  const send = (t: string, s: string) => res.write(JSON.stringify({ t, s }) + '\n');
  const flushLog = () => {
    if (!existsSync(log) || statSync(log).size <= sent) return;
    const bytes = readFileSync(log).subarray(sent);
    sent += bytes.length;
    send('net', bytes.toString());
  };
  const timer = setInterval(flushLog, 250);
  const child = sw(args, { SW_LOG_FILE: log });
  child.stdout.on('data', (d: Buffer) => send('out', d.toString()));
  child.stderr.on('data', (d: Buffer) => send('out', d.toString()));
  child.on('close', (code) => {
    clearInterval(timer);
    flushLog();
    rmSync(dir, { recursive: true, force: true });
    send('end', String(code));
    res.end();
  });
}

function serve(port: string) {
  const host = `127.0.0.1:${port}`;
  const origin = `http://${host}`;
  const server = createServer((req, res) => {
    // A foreign page can still send requests to localhost; it cannot fake Host or Origin.
    if (req.headers.host !== host) {
      res.writeHead(403).end();
      return;
    }
    const url = req.url ?? '';
    if (req.method === 'GET' && url === '/') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
      });
      res.end(readFileSync(PAGE, 'utf8').replace('/*STEPS*/[]', JSON.stringify(STEPS)));
      return;
    }
    const font = /^\/fonts\/([a-z-]+\.woff2)$/.exec(url)?.[1];
    if (req.method === 'GET' && font && FONTS[font]) {
      const file = join(WEB_MODULES, FONTS[font]);
      if (!existsSync(file)) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'max-age=86400' });
      res.end(readFileSync(file));
      return;
    }
    if (req.method === 'GET' && url === '/state') {
      // `sw net` first: on the local network it starts the validator before the other two ask it anything.
      void capture(['net'])
        .then((net) => Promise.all([Promise.resolve(net), capture(['balances']), capture(['status'])]))
        .then(([net, balances, status]) => {
          res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          res.end(JSON.stringify({ network: parseNetwork(net), wallets: parseBalances(balances), stake: parseStatus(status) }));
        });
      return;
    }
    const net = /^\/net\/([a-z]+)$/.exec(url)?.[1];
    if (req.method === 'POST' && net && req.headers.origin === origin) {
      if (!(NETWORKS as readonly string[]).includes(net)) {
        res.writeHead(400).end('unknown network');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
      runStep(['net', net], res);
      return;
    }
    const run = /^\/run\/([a-z-]+)(?:\?duration=([0-9a-z]+))?$/.exec(url);
    if (req.method === 'POST' && run && req.headers.origin === origin) {
      const args = commandFor(run[1] ?? '', run[2]);
      if (!args) {
        res.writeHead(400).end('unknown step');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
      runStep(args, res);
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(Number(port), '127.0.0.1', () => {
    console.log(`Stakeward live demo: ${origin}`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) serve(process.argv[2] ?? '4848');
