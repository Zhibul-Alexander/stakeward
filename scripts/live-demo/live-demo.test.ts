import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commandFor, NETWORKS, parseBalances, parseNetwork, parseStatus, STEPS } from './ui.ts';

const SW = new URL('sw.sh', import.meta.url).pathname;
const ROLE = new URL('role.sh', import.meta.url).pathname;
const source = readFileSync(SW, 'utf8');

function sw(...args: string[]) {
  // No Solana CLI on PATH: help must still work, everything else must say how to install it.
  return spawnSync('bash', [SW, ...args], {
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', NO_COLOR: '1', SW_DIR: '/nonexistent/live-demo' },
  });
}

// sw.sh against stand-ins for solana, solana-keygen and curl: every solana call is logged, nothing reaches a network.
function stubbed(env: Record<string, string>, ...args: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'sw-test-'));
  const bin = join(root, 'bin');
  const dir = join(root, 'demo');
  mkdirSync(bin);
  mkdirSync(dir);
  for (const role of ['main', 'second', 'new', 'thief']) writeFileSync(join(dir, `${role}.json`), '');
  writeFileSync(join(dir, 'current-stake'), 'Stake1111111111111111111111111111111111111');
  if ('STUB_STAKE' in env) writeFileSync(join(dir, 'stake-1.json'), '');
  const log = join(root, 'solana.log');
  const tools: Record<string, string> = {
    // A demo key's address is its file name plus filler: main.json -> main111…
    'solana-keygen': `[ "$1" = pubkey ] && { b=$(basename "$2" .json); printf '%s1111111111111111111111111111111111\n' "$b" | cut -c1-40; }; [ "$1" = new ] && touch "$5"; exit 0`,
    solana: `echo "$*" >> "${log}"
case "$1" in
  stake-account) echo "{\\"unixTimestamp\\":9999999999,\\"withdrawer\\":\\"\${STUB_WITHDRAWER:-main111}\\",\\"staker\\":\\"main111\\",\\"custodian\\":\\"second111\\"}" ;;
  withdraw-stake) echo 'Error: lockup has not yet expired'; exit 1 ;;
  balance) echo "\${STUB_LAMPORTS:-0} lamports" ;;
esac
exit 0`,
    curl: `echo '{"jsonrpc":"2.0","result":"ok","id":1}'`,
  };
  for (const [name, body] of Object.entries(tools)) {
    writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const result = spawnSync('bash', [SW, ...args], {
    encoding: 'utf8',
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: root, NO_COLOR: '1', SW_NETLOG: '0', SW_DIR: dir, SW_URL: 'mainnet-beta', ...env },
  });
  let calls: string[] = [];
  try {
    calls = readFileSync(log, 'utf8').trim().split('\n');
  } catch {
    // no solana call at all
  }
  return { ...result, calls };
}

describe('live demo scripts', () => {
  it('parse in bash', () => {
    for (const file of [SW, ROLE]) expect(spawnSync('bash', ['-n', file]).status).toBe(0);
  });

  it('prints help without the Solana CLI', () => {
    const result = sw('help');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('sw thief withdraw');
  });

  it('dispatches every command the help lists', () => {
    const help = sw('help').stdout;
    const commands = new Set([...help.matchAll(/^ {2}sw ([a-z-]+)/gm)].map((match) => match[1] ?? ''));
    expect(commands.size).toBeGreaterThan(10);
    for (const command of commands) expect(source).toMatch(new RegExp(`^ {4}(.*\\| )?${command}( \\|.*)?\\)`, 'm'));
  });

  it('asks for the Solana CLI instead of failing obscurely', () => {
    const result = sw('balances');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Solana CLI not found');
  });

  it('keeps the demo keys in the gitignored .keys folder', () => {
    expect(source).toContain('SW_DIR="${SW_DIR:-$REPO_DIR/.keys/live-demo}"');
    const gitignore = readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8');
    expect(gitignore.split('\n')).toContain('.keys/');
  });

  it('runs only commands sw.sh knows from the menu', () => {
    const steps = /^MENU_STEPS='([^']*)'/m.exec(source)?.[1]?.split('\n') ?? [];
    expect(steps.length).toBeGreaterThan(10);
    for (const step of steps) {
      const command = step.split('|')[3]?.split(' ')[0] ?? '';
      expect(source).toMatch(new RegExp(`^ {4}(.*\\| )?${command}( \\|.*)?\\)`, 'm'));
    }
  });

  it('never prints the RPC API key', () => {
    const result = spawnSync('bash', ['-c', `eval "$(sed -n '/^mask_key()/p' ${SW})"; echo 'https://x.io/?api-key=SECRET&a=1' | mask_key`], {
      encoding: 'utf8',
    });
    expect(result.stdout.trim()).toBe('https://x.io/?api-key=…&a=1');
  });

  it('tells the cluster from a moniker or an RPC URL', () => {
    const cluster = (url: string) =>
      spawnSync('bash', ['-c', `eval "$(sed -n '/^cluster()/,/^}/p' ${SW})"; SW_URL='${url}'; cluster`], { encoding: 'utf8' }).stdout.trim();
    expect(cluster('mainnet-beta')).toBe('mainnet');
    expect(cluster('https://mainnet.helius-rpc.com/?api-key=x')).toBe('mainnet');
    expect(cluster('devnet')).toBe('devnet');
    expect(cluster('https://devnet.helius-rpc.com/?api-key=x')).toBe('devnet');
    expect(cluster('localhost')).toBe('localnet');
  });

  it('converts SOL and lamports exactly', () => {
    const convert = (call: string) =>
      spawnSync('bash', ['-c', `eval "$(grep -E '^(lamports|sol)[(][)]' ${SW})"; ${call}`], { encoding: 'utf8' }).stdout.trim();
    expect(convert('lamports 0.22')).toBe('220000000');
    expect(convert('lamports 0.000000001')).toBe('1');
    expect(convert('sol 219995000')).toBe('0.219995');
    expect(convert('sol 1000000000')).toBe('1');
  });

  it('puts the priority fee on transactions that should land, not on those that should fail', () => {
    const lock = stubbed({ SW_CU_PRICE: '5' }, 'lock', '10m');
    expect(lock.calls.find((c) => c.startsWith('stake-set-lockup-checked'))).toContain('--with-compute-unit-price 5');
    // With a price the CLI simulates first and drops a failing transaction: the thief's attempt would leave no trace.
    const thief = stubbed({ SW_CU_PRICE: '5' }, 'thief', 'withdraw');
    const attempt = thief.calls.find((c) => c.startsWith('withdraw-stake'));
    expect(attempt).toContain('--skip-preflight');
    expect(attempt).not.toContain('--with-compute-unit-price');
    expect(thief.stdout).toContain('REJECTED by Solana');
  });

  it('does not ask a mainnet faucet for SOL', () => {
    const result = stubbed({}, 'fund');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Mainnet has no faucet');
    expect(result.calls.some((c) => c.startsWith('airdrop'))).toBe(false);
  });

  it('sweeps the funder back to the address in SW_RETURN_TO, and to nothing else', () => {
    const funder = { SW_FUNDER_KEY: '/dev/null/missing' };
    expect(stubbed(funder, 'sweep').stderr).toContain('Set SW_FUNDER_KEY');
    const root = mkdtempSync(join(tmpdir(), 'sw-funder-'));
    const key = join(root, 'funder.json');
    writeFileSync(key, '');
    expect(stubbed({ SW_FUNDER_KEY: key, SW_RETURN_TO: 'not an address' }, 'sweep').stderr).toContain('not a Solana address');
    const me = 'Me11111111111111111111111111111111111111111';
    const result = stubbed({ SW_FUNDER_KEY: key, SW_RETURN_TO: me }, 'sweep');
    expect(result.status).toBe(0);
    expect(result.calls.filter((c) => c.startsWith('transfer'))).toEqual([
      expect.stringMatching(new RegExp(`^transfer ${me} ALL --from ${key} --fee-payer ${key} --allow-unfunded-recipient`)),
    ]);
  });

  it('sweeps the wallets into a funder that holds nothing yet', () => {
    // On the local network "sw fund" airdrops, so the funder may still be empty when the wallets send it their SOL.
    const root = mkdtempSync(join(tmpdir(), 'sw-funder-'));
    const key = join(root, 'funder.json');
    writeFileSync(key, '');
    const result = stubbed({ SW_FUNDER_KEY: key, STUB_LAMPORTS: '5000' }, 'sweep');
    const toFunder = result.calls.filter((c) => c.startsWith('transfer funder'));
    expect(toFunder).toHaveLength(4);
    for (const call of toFunder) expect(call).toContain('--allow-unfunded-recipient');
  });

  it('empties the wallets into the funder before the funder pays for withdrawing the stake accounts', () => {
    const root = mkdtempSync(join(tmpdir(), 'sw-funder-'));
    const key = join(root, 'funder.json');
    writeFileSync(key, '');
    const main = `main${'1'.repeat(34)}`;
    const env = { SW_FUNDER_KEY: key, STUB_LAMPORTS: '5000', STUB_STAKE: '1', STUB_WITHDRAWER: main };
    const { calls } = stubbed(env, 'sweep');
    const withdraw = calls.findIndex((c) => c.startsWith('withdraw-stake'));
    const toFunder = calls.flatMap((c, i) => (c.startsWith('transfer funder') ? [i] : []));
    expect(withdraw).toBeGreaterThan(-1);
    expect(toFunder).toHaveLength(4);
    expect(withdraw).toBeGreaterThan(Math.max(...toFunder));
  });

  it('runs only listed steps from the page', () => {
    expect(commandFor('lock', '10m')).toEqual(['lock', '10m']);
    expect(commandFor('lock', '1d; rm -rf ~')).toBeNull();
    expect(commandFor('nope')).toBeNull();
    for (const step of STEPS) {
      const command = commandFor(step.id)?.[0] ?? '';
      expect(source).toMatch(new RegExp(`^ {4}(.*\\| )?${command}( \\|.*)?\\)`, 'm'));
    }
  });

  it('reads balances and the stake status for the page', () => {
    const balances = parseBalances('Wallet balances on devnet\n  MAIN KEY    6cvh…mzae          1.649955 SOL\n  STAKE       4qZZ…qbVB          0.1 SOL\n');
    expect(balances).toEqual([
      { name: 'MAIN KEY', address: '6cvh…mzae', sol: '1.649955' },
      { name: 'STAKE', address: '4qZZ…qbVB', sol: '0.1' },
    ]);
    const status = parseStatus(
      '\nStake account 4qZZvnpc\n  In plain words: 🔒 PROTECTED until 09 Apr 2027 13:49 UTC, second key: SECOND KEY\n  owner (withdraw): NEW WALLET;  manager (stake): NEW WALLET\n',
    );
    expect(status).toEqual({ plain: '🔒 PROTECTED until 09 Apr 2027 13:49 UTC, second key: SECOND KEY', owner: 'NEW WALLET', address: '4qZZvnpc' });
    expect(parseStatus('No stake account yet. Run: sw stake 0.1')).toBeNull();
  });

  it('switches only between the networks sw net knows', () => {
    expect(parseNetwork('network=local\nlabel=local network\nrpc_label=devnet.helius-rpc.com\n')).toEqual({
      name: 'local',
      label: 'local network',
      rpcLabel: 'devnet.helius-rpc.com',
    });
    expect(source).toContain(`    ${NETWORKS.join(' | ')}) printf`);
  });
});
