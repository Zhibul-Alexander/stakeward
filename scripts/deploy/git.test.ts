// The git status read of scripts/deploy/git.ts on a throwaway repository: what the dirty-tree refusal names.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dirtyFilesIn } from './git.ts';

let repo = '';

function git(...args: string[]): void {
  execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd: repo, stdio: 'ignore' },
  );
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'stakeward-git-status-'));
  git('init', '--quiet');
  writeFileSync(join(repo, 'package.json'), '{}\n');
  writeFileSync(join(repo, 'a.ts'), 'export const a = 1;\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'init');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('dirtyFilesIn', () => {
  it('a clean tree has nothing to name', () => {
    expect(dirtyFilesIn(repo)).toEqual([]);
  });

  it('names an unstaged change in full when it is the first entry (" M path" starts with a space)', () => {
    writeFileSync(join(repo, 'package.json'), '{"changed":true}\n');
    expect(dirtyFilesIn(repo)).toEqual(['package.json']);
  });

  it('names changed, renamed and untracked paths whole, spaces included', () => {
    writeFileSync(join(repo, 'package.json'), '{"changed":true}\n');
    git('mv', 'a.ts', 'b.ts');
    mkdirSync(join(repo, 'apps'));
    writeFileSync(join(repo, 'apps', 'new file.svg'), '<svg/>');
    expect(dirtyFilesIn(repo).sort()).toEqual(['a.ts -> b.ts', 'apps/new file.svg', 'package.json']);
  });
});
