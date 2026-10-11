import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
