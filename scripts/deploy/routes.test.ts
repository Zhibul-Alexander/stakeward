// Every prod deploy goes through scripts/deploy.ts (SECURITY-CHECK P18 and P19). No package script uploads a Worker
// version anywhere but dev on its own, and the deploy commands README.md shows are ones the wrapper accepts, from a
// shell that did not export the secrets file.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDeployArgs } from './args.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

type Script = { file: string; name: string; command: string };

/** package.json of the root and of every workspace package (pnpm-workspace.yaml: packages/*, apps/*, scripts). */
function packageFiles(): string[] {
  const groups = ['apps', 'packages'].flatMap((group) =>
    readdirSync(join(ROOT, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${group}/${entry.name}`),
  );
  return ['.', 'scripts', ...groups]
    .map((dir) => join(dir, 'package.json'))
    .filter((file) => existsSync(join(ROOT, file)));
}

function packageScripts(): Script[] {
  return packageFiles().flatMap((file) => {
    const manifest = JSON.parse(readFileSync(join(ROOT, file), 'utf8')) as { scripts?: Record<string, string> };
    return Object.entries(manifest.scripts ?? {}).map(([name, command]) => ({ file, name, command }));
  });
}

/** One shell command of a script line: `a && b; c | d` is four. */
function commands(line: string): string[] {
  return line.split(/&&|\|\||;|\|/).map((part) => part.trim());
}

/** Uploads a Worker version (wrangler deploy without --dry-run, wrangler versions upload or deploy) not to dev. */
function uploadsBeyondDev(command: string): boolean {
  const deploy = /\bwrangler\s+deploy\b/.test(command) && !/--dry-run\b/.test(command);
  const versions = /\bwrangler\s+versions\s+(?:upload|deploy)\b/.test(command);
  return (deploy || versions) && !/--env[=\s]+dev\b/.test(command);
}

describe('deploy routes', () => {
  it('the root deploy:dev and deploy:prod are the wrapper', () => {
    const root = new Map(packageScripts().filter((script) => script.file === 'package.json').map((s) => [s.name, s]));
    expect(root.get('deploy:dev')?.command).toBe('node scripts/deploy.ts --env dev');
    expect(root.get('deploy:prod')?.command).toBe('node scripts/deploy.ts --env prod');
  });

  it('no package script uploads to prod (or anywhere but dev) without the wrapper', () => {
    const scripts = packageScripts();
    expect(scripts.length).toBeGreaterThan(10);
    const offenders = scripts
      .filter((script) => commands(script.command).some(uploadsBeyondDev))
      .map((script) => `${script.file} "${script.name}": ${script.command}`);
    expect(offenders).toEqual([]);
  });

  const README = readFileSync(join(ROOT, 'README.md'), 'utf8');

  it('every deploy command in README.md is one the wrapper accepts', () => {
    const found = [...README.matchAll(/pnpm (deploy:(?:dev|prod))(?![:\w-])([^`\n]*)/g)].map((match) => ({
      script: match[1] ?? '',
      args: (match[2] ?? '').trim().split(/\s+/).filter((arg) => arg !== ''),
    }));
    expect(found.map((command) => command.script)).toEqual(expect.arrayContaining(['deploy:dev', 'deploy:prod']));
    for (const { script, args } of found) {
      const env = script === 'deploy:prod' ? 'prod' : 'dev';
      expect(() => parseDeployArgs(['--env', env, ...args], '/home/someone', '/repo'), `pnpm ${script} ${args.join(' ')}`)
        .not.toThrow();
    }
  });

  it('README.md never sources the secrets file into the shell (the wrapper refuses such a shell)', () => {
    expect(README).not.toMatch(/(?:^|[\s;`(])(?:\.|source)\s+\S*secrets\.env/m);
  });
});
