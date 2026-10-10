import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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
});
