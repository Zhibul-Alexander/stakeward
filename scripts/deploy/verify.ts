// Does the deployed site serve exactly the build of a commit (SECURITY-CHECK P18)? The pure half of
// scripts/verify-deploy.ts: which path serves each build file, what the served index.html loads, the comparison and
// the report.
import type { Cluster } from './args.ts';
import type { FileHash } from './manifest.ts';

/** Files Cloudflare reads as configuration of the static assets; they are not served. */
const CONFIG_FILES = new Set(['_headers', '_redirects', '.assetsignore']);

/** The path the site serves a build file at, or null for a config file. index.html is served at `/`. */
export function servedPath(file: string): string | null {
  if (CONFIG_FILES.has(file)) return null;
  return file === 'index.html' ? '/' : `/${file}`;
}

/** Every `/assets/…` path a `src` or `href` attribute of the page names, once, in order. */
export function assetReferences(html: string): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(/\s(?:src|href)\s*=\s*(["'])(\/assets\/[^"'?#]+)\1/g)) {
    const path = match[2];
    if (path !== undefined && !found.includes(path)) found.push(path);
  }
  return found;
}

/** One served file: the HTTP status and the sha256 of the body, or why the request failed. */
export type Served = { status: number; sha256: string } | { error: string };

export type FileRow = {
  path: string;
  expected: string;
  got: string | null;
  verdict: string;
};

export type Comparison = { ok: boolean; rows: FileRow[]; problems: string[] };

const NOT_SERVED = 'not served (Cloudflare config)';

export function compareServed(
  local: readonly FileHash[],
  served: ReadonlyMap<string, Served>,
  references: readonly string[],
): Comparison {
  const rows: FileRow[] = local.map((file) => {
    const path = servedPath(file.path);
    const base = { path: file.path, expected: file.sha256 };
    if (path === null) return { ...base, got: null, verdict: NOT_SERVED };
    const response = served.get(path);
    if (response === undefined) return { ...base, got: null, verdict: 'NOT FETCHED' };
    if ('error' in response) return { ...base, got: null, verdict: `ERROR ${response.error}` };
    if (response.status !== 200) return { ...base, got: response.sha256, verdict: `HTTP ${String(response.status)}` };
    return { ...base, got: response.sha256, verdict: response.sha256 === file.sha256 ? 'ok' : 'MISMATCH' };
  });
  const builtPaths = new Set(local.map((file) => `/${file.path}`));
  const problems = references
    .filter((reference) => !builtPaths.has(reference))
    .map((reference) => `the served index.html loads ${reference}, which the local build does not have`);
  const ok = problems.length === 0 && rows.every((row) => row.verdict === 'ok' || row.verdict === NOT_SERVED);
  return { ok, rows, problems };
}

function count(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/** The console report; its last line is PASS or FAIL. */
export function renderVerifyReport(
  result: Comparison,
  context: { origin: string; commit: string; cluster: Cluster },
): string {
  const short = (sha: string | null) => (sha === null ? '-' : sha.slice(0, 16));
  const width = Math.max(...result.rows.map((row) => row.verdict.length), 2);
  const lines = [
    `Comparing ${context.origin} with the ${context.cluster} build of ${context.commit}`,
    '',
    ...result.rows.map(
      (row) => `${row.verdict.padEnd(width)}  ${row.path}  local ${short(row.expected)}  served ${short(row.got)}`,
    ),
    ...result.problems.map((problem) => `PROBLEM  ${problem}`),
    '',
  ];
  const compared = result.rows.filter((row) => row.verdict !== NOT_SERVED);
  if (result.ok) {
    lines.push(
      `PASS: ${context.origin} serves the ${context.cluster} build of ${context.commit} (${count(compared.length, 'file', 'files')} compared)`,
    );
  } else {
    const differing = compared.filter((row) => row.verdict !== 'ok').length;
    const parts = [
      ...(differing > 0 ? [count(differing, 'file differs', 'files differ')] : []),
      ...(result.problems.length > 0 ? [count(result.problems.length, 'other problem', 'other problems')] : []),
    ];
    lines.push(
      `FAIL: ${context.origin} does not serve the ${context.cluster} build of ${context.commit} (${parts.join(', ')})`,
    );
  }
  return lines.join('\n');
}
