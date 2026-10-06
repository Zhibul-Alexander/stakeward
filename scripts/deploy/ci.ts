// A prod deploy ships only a commit whose CI passed (SECURITY-CHECK P18). The wrapper itself runs only the build
// guards; the `check` job of .github/workflows/ci.yml runs the rest: audit, wrangler types, typecheck, lint, every core,
// worker, web and scripts test, both site builds and the prod config dry run. The `e2e` job is not required: it is
// flaky at 360 px (TESTPLAN), and a red e2e must not block a fix from reaching prod.
// GitHub's check runs are public for a public repository: read without a token, so no credential is involved.

/** The CI job (a GitHub Actions check run of this name) a prod deploy waits for. */
export const REQUIRED_CI_JOB = 'check';
const ACTIONS_APP = 'github-actions';
const FETCH_TIMEOUT_MS = 15_000;

export type GitHubRepo = { owner: string; repo: string };

export type CheckRun = { name: string; status: string; conclusion: string | null; app: string | null };

const NAME = /^[A-Za-z0-9_.-]+$/;

/** owner and name of a github.com remote (https, scp-like or ssh URL), or null for anything else. */
export function githubRepo(remoteUrl: string): GitHubRepo | null {
  const match =
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(remoteUrl) ??
    /^(?:https:\/\/(?:[^@/]+@)?|ssh:\/\/git@)github\.com(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(remoteUrl);
  const owner = match?.[1];
  const repo = match?.[2];
  if (owner === undefined || repo === undefined || !NAME.test(owner) || !NAME.test(repo)) return null;
  return { owner, repo };
}

/** The latest check run of each job for the commit (one page is plenty: ci.yml has three jobs). */
export function checkRunsUrl(repo: GitHubRepo, sha: string): string {
  return `https://api.github.com/repos/${repo.owner}/${repo.repo}/commits/${sha}/check-runs?filter=latest&per_page=100`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The runs of a `GET …/commits/{sha}/check-runs` answer; throws on any other shape. */
export function parseCheckRuns(body: unknown): CheckRun[] {
  const runs = isRecord(body) ? body['check_runs'] : undefined;
  if (!Array.isArray(runs)) throw new Error('the answer has no check_runs list');
  return runs.map((run: unknown) => {
    if (!isRecord(run)) throw new Error('a check run is not an object');
    const { name, status, conclusion, app } = run;
    if (typeof name !== 'string' || typeof status !== 'string') throw new Error('a check run has no name or status');
    if (conclusion !== null && typeof conclusion !== 'string') throw new Error('a check run has an odd conclusion');
    const slug = isRecord(app) && typeof app['slug'] === 'string' ? app['slug'] : null;
    return { name, status, conclusion, app: slug };
  });
}

/** Why CI does not let `sha` go to prod, or null when every `check` run of GitHub Actions for it succeeded. */
export function ciProblem(runs: readonly CheckRun[], sha: string): string | null {
  const short = sha.slice(0, 12);
  const jobs = runs.filter((run) => run.name === REQUIRED_CI_JOB && run.app === ACTIONS_APP);
  if (jobs.length === 0) {
    return `CI has not started the "${REQUIRED_CI_JOB}" job for ${short}: wait for the CI run of this commit, then deploy again`;
  }
  const running = jobs.find((run) => run.status !== 'completed');
  if (running !== undefined) {
    return `CI is still running "${REQUIRED_CI_JOB}" for ${short} (${running.status}): wait for it to pass, then deploy again`;
  }
  const failed = jobs.find((run) => run.conclusion !== 'success');
  if (failed !== undefined) {
    return `CI "${REQUIRED_CI_JOB}" did not pass for ${short} (${failed.conclusion ?? 'no conclusion'}): fix it on a new commit, push it and deploy once CI passes`;
  }
  return null;
}

/** Asks GitHub about the CI of `sha`; any failure to get an answer is a problem too, never a pass. */
export async function readCiProblem(
  repo: GitHubRepo,
  sha: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const short = sha.slice(0, 12);
  let response: Response;
  try {
    response = await fetchImpl(checkRunsUrl(repo, sha), {
      method: 'GET',
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'stakeward-deploy',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    return `could not ask GitHub about the CI of ${short}: ${error instanceof Error ? error.message : String(error)}`;
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message = isRecord(body) && typeof body['message'] === 'string' ? `: ${body['message'].slice(0, 200)}` : '';
    return `GitHub answered HTTP ${String(response.status)} about the CI of ${short}${message}`;
  }
  try {
    return ciProblem(parseCheckRuns(body), sha);
  } catch (error) {
    return `could not read GitHub's answer about the CI of ${short}: ${error instanceof Error ? error.message : String(error)}`;
  }
}
