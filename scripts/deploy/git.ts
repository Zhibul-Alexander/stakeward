// The commit a deploy may ship (SECURITY-CHECK P18): a clean tree (no changed, staged or untracked file), and a HEAD
// that is origin/<branch>, so the commit is public.
import { execFileSync } from 'node:child_process';

/**
 * The paths of `git status --porcelain=v1 -z` output: `XY path` entries ended by NUL, and for a rename or a copy
 * `XY new` followed by the old path as its own entry. Shown as `old -> new`.
 */
export function dirtyFiles(porcelainZ: string): string[] {
  const entries = porcelainZ.split('\0');
  const paths: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? '';
    if (entry === '') continue;
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    if (/[RC]/.test(status)) {
      index += 1;
      paths.push(`${entries[index] ?? ''} -> ${path}`);
    } else {
      paths.push(path);
    }
  }
  return paths;
}

/**
 * Every changed, staged, untracked or renamed path of the working tree at `cwd`. The output is read raw: the first
 * entry may start with a space (` M path`), which a trim would eat together with the first letter of the path; `-z`
 * also keeps paths with spaces unquoted.
 */
export function dirtyFilesIn(cwd: string): string[] {
  const output = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return dirtyFiles(output);
}

export type HeadState = {
  /** `git rev-parse --abbrev-ref HEAD`: the branch, or `HEAD` when detached. */
  branch: string;
  head: string;
  /** origin's commit for the branch (`git ls-remote origin`), or null when origin has no such branch. */
  remoteHead: string | null;
  allowUnpushed: boolean;
};

/** Why this HEAD may not be deployed, or null. */
export function headProblem(state: HeadState): string | null {
  if (state.branch === 'HEAD') return 'HEAD is detached: check out the branch to deploy';
  if (state.allowUnpushed) return null;
  if (state.remoteHead === null) {
    return `origin/${state.branch} does not exist: push the branch and let CI pass first`;
  }
  if (state.remoteHead !== state.head) {
    return `HEAD ${state.head.slice(0, 12)} is not origin/${state.branch} (${state.remoteHead.slice(0, 12)}): push or pull first, then let CI pass`;
  }
  return null;
}

