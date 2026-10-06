// scripts/deploy/ci.ts without the network: which repository origin is, what the check runs of a commit say, and how
// a GitHub answer or a failed request becomes a refusal.
import { describe, expect, it } from 'vitest';
import {
  checkRunsUrl,
  ciProblem,
  githubRepo,
  parseCheckRuns,
  readCiProblem,
  REQUIRED_CI_JOB,
  type CheckRun,
} from './ci.ts';

const SHA = '745e54dcea2097cdaf05ab58502b27c35aaeb484';
const REPO = { owner: 'Zhibul-Alexander', repo: 'stakeward' };

describe('githubRepo', () => {
  it('reads owner and name from the usual GitHub remote forms', () => {
    for (const url of [
      'git@github.com:Zhibul-Alexander/stakeward.git',
      'git@github.com:Zhibul-Alexander/stakeward',
      'https://github.com/Zhibul-Alexander/stakeward.git',
      'https://github.com/Zhibul-Alexander/stakeward',
      'https://someone:ghp_secret@github.com/Zhibul-Alexander/stakeward.git',
      'ssh://git@github.com/Zhibul-Alexander/stakeward.git',
      'ssh://git@github.com:22/Zhibul-Alexander/stakeward',
    ]) {
      expect(githubRepo(url), url).toEqual(REPO);
    }
  });

  it('anything else is not a GitHub repository', () => {
    for (const url of [
      'https://gitlab.com/Zhibul-Alexander/stakeward.git',
      'git@github.com.evil.example:Zhibul-Alexander/stakeward.git',
      'https://github.com/Zhibul-Alexander',
      'https://github.com/Zhibul-Alexander/stakeward/extra',
      '/home/dev/stakeward.git',
      '',
    ]) {
      expect(githubRepo(url), url).toBeNull();
    }
  });
});

describe('checkRunsUrl', () => {
  it('asks GitHub for the latest check runs of the commit', () => {
    expect(checkRunsUrl(REPO, SHA)).toBe(
      `https://api.github.com/repos/Zhibul-Alexander/stakeward/commits/${SHA}/check-runs?filter=latest&per_page=100`,
    );
  });
});

const run = (name: string, status: string, conclusion: string | null, app = 'github-actions'): CheckRun => ({
  name,
  status,
  conclusion,
  app,
});

describe('ciProblem', () => {
  it('the job a prod deploy waits for is the check job of ci.yml', () => {
    expect(REQUIRED_CI_JOB).toBe('check');
  });

  it('passes when the check job succeeded, whatever e2e did', () => {
    expect(ciProblem([run('e2e', 'completed', 'failure'), run('check', 'completed', 'success')], SHA)).toBeNull();
  });

  it('refuses a commit CI has not started on', () => {
    expect(ciProblem([], SHA)).toContain('has not started');
    expect(ciProblem([run('e2e', 'completed', 'success')], SHA)).toContain('has not started');
    // A job of another app with the same name does not count.
    expect(ciProblem([run('check', 'completed', 'success', 'some-other-app')], SHA)).toContain('has not started');
  });

  it('refuses while the check job is queued or running', () => {
    expect(ciProblem([run('check', 'queued', null)], SHA)).toContain('still running');
    expect(ciProblem([run('check', 'in_progress', null)], SHA)).toContain('still running');
  });

  it('refuses a check job that did not succeed, naming how it ended', () => {
    for (const conclusion of ['failure', 'cancelled', 'timed_out', 'neutral', 'action_required']) {
      const problem = ciProblem([run('check', 'completed', conclusion)], SHA);
      expect(problem, conclusion).toContain('did not pass');
      expect(problem, conclusion).toContain(conclusion);
    }
  });

  it('every check job of the commit must have passed (push and pull_request runs)', () => {
    expect(ciProblem([run('check', 'completed', 'success'), run('check', 'completed', 'failure')], SHA)).toContain(
      'did not pass',
    );
  });

  it('a check job the daily scheduled run skipped neither passes nor blocks the push run', () => {
    // ci.yml skips check on schedule; that run lands on the HEAD of the default branch next to the push run.
    expect(ciProblem([run('check', 'completed', 'success'), run('check', 'completed', 'skipped')], SHA)).toBeNull();
    expect(ciProblem([run('check', 'completed', 'failure'), run('check', 'completed', 'skipped')], SHA)).toContain(
      'did not pass',
    );
    expect(ciProblem([run('check', 'in_progress', null), run('check', 'completed', 'skipped')], SHA)).toContain(
      'still running',
    );
  });

  it('refuses a commit whose every check job was skipped: nothing checked it', () => {
    const problem = ciProblem([run('check', 'completed', 'skipped'), run('audit', 'completed', 'success')], SHA);
    expect(problem).toContain('skipped the "check" job');
    expect(problem).toContain(SHA.slice(0, 12));
  });

  it('names the commit', () => {
    expect(ciProblem([], SHA)).toContain(SHA.slice(0, 12));
  });
});

describe('parseCheckRuns', () => {
  it('keeps name, status, conclusion and app of each run', () => {
    expect(
      parseCheckRuns({
        total_count: 2,
        check_runs: [
          { id: 1, name: 'e2e', status: 'completed', conclusion: 'failure', app: { slug: 'github-actions' } },
          { id: 2, name: 'check', status: 'in_progress', conclusion: null, app: { slug: 'github-actions' } },
        ],
      }),
    ).toEqual([run('e2e', 'completed', 'failure'), run('check', 'in_progress', null)]);
  });

  it('throws on an answer of another shape', () => {
    expect(() => parseCheckRuns({ message: 'Not Found' })).toThrow();
    expect(() => parseCheckRuns({ check_runs: [{ name: 'check' }] })).toThrow();
    expect(() => parseCheckRuns(null)).toThrow();
  });
});

type Call = { url: string; init: RequestInit | undefined };

function fakeFetch(respond: () => Response | Promise<Response>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: input instanceof Request ? input.url : String(input), init });
    return Promise.resolve(respond());
  };
  return { fetch: impl, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('readCiProblem', () => {
  it('reads the check runs without any token and passes a green check job', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({ total_count: 1, check_runs: [{ name: 'check', status: 'completed', conclusion: 'success', app: { slug: 'github-actions' } }] }),
    );
    expect(await readCiProblem(REPO, SHA, fetch)).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(checkRunsUrl(REPO, SHA));
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('accept')).toBe('application/vnd.github+json');
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('more check runs than one page holds is a problem: a red check could hide on the next page', async () => {
    // Every daily scheduled run on an unchanged default-branch HEAD adds a check suite of three runs.
    const { fetch } = fakeFetch(() =>
      json({ total_count: 101, check_runs: [{ name: 'check', status: 'completed', conclusion: 'success', app: { slug: 'github-actions' } }] }),
    );
    const problem = await readCiProblem(REPO, SHA, fetch);
    expect(problem).toContain('101 check runs');
    expect(problem).toContain(SHA.slice(0, 12));
  });

  it('a red check job is a problem', async () => {
    const { fetch } = fakeFetch(() =>
      json({ total_count: 1, check_runs: [{ name: 'check', status: 'completed', conclusion: 'failure', app: { slug: 'github-actions' } }] }),
    );
    expect(await readCiProblem(REPO, SHA, fetch)).toContain('did not pass');
  });

  it('an HTTP error is a problem with the status and GitHub message (a commit GitHub does not have: 422)', async () => {
    const { fetch } = fakeFetch(() => json({ message: `No commit found for SHA: ${SHA}` }, 422));
    const problem = await readCiProblem(REPO, SHA, fetch);
    expect(problem).toContain('HTTP 422');
    expect(problem).toContain('No commit found');
  });

  it('a failed request or an unreadable answer is a problem, never a pass', async () => {
    const failing = (() => Promise.reject(new Error('getaddrinfo ENOTFOUND api.github.com'))) as typeof fetch;
    expect(await readCiProblem(REPO, SHA, failing)).toContain('ENOTFOUND');
    const { fetch } = fakeFetch(() => new Response('<html>', { status: 200 }));
    expect(await readCiProblem(REPO, SHA, fetch)).toContain('could not read');
  });
});
