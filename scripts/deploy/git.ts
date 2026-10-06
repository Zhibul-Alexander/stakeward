// The commit a deploy may ship (SECURITY-CHECK P18): a clean tree, so the build is exactly the commit, and a HEAD that
// is origin/<branch>, so the commit is public and CI ran on it.

/** The paths `git status --porcelain=v1 --untracked-files=all` lists (changed, staged, untracked, renamed). */
export function dirtyFiles(porcelain: string): string[] {
  return porcelain
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => line.slice(3));
}

export type HeadState = {
  /** `git rev-parse --abbrev-ref HEAD`: the branch, or `HEAD` when detached. */
  branch: string;
  head: string;
  /** origin/<branch> after `git fetch origin <branch>`, or null when origin has no such branch. */
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
