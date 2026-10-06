import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/**
 * The deploy wrapper (scripts/deploy.ts) runs build-output.test.ts and test-code-guard.test.ts on the very folder it
 * uploads (SECURITY-CHECK P18): it passes the folder and the cluster it was built for in these two variables. Without
 * them the tests build the site themselves, as in CI. The names are repeated in scripts/deploy/env.ts.
 */
export const PREBUILT_DIST_VAR = 'STAKEWARD_PREBUILT_DIST';
export const PREBUILT_CLUSTER_VAR = 'STAKEWARD_PREBUILT_CLUSTER';

export type Prebuilt = { dir: string; cluster: 'devnet' | 'mainnet' };

/** The prebuilt site to check, or null. A half-set or wrong value throws: the guard must not quietly check another build. */
export function prebuiltDist(env: Readonly<Record<string, string | undefined>> = process.env): Prebuilt | null {
  const dir = env[PREBUILT_DIST_VAR] ?? '';
  const cluster = env[PREBUILT_CLUSTER_VAR] ?? '';
  if (dir === '' && cluster === '') return null;
  if (dir === '') throw new Error(`${PREBUILT_CLUSTER_VAR} is set without ${PREBUILT_DIST_VAR}`);
  if (cluster === '') throw new Error(`${PREBUILT_DIST_VAR} is set without ${PREBUILT_CLUSTER_VAR}`);
  if (cluster !== 'devnet' && cluster !== 'mainnet') {
    throw new Error(`${PREBUILT_CLUSTER_VAR} must be devnet or mainnet, got "${cluster}"`);
  }
  if (!isAbsolute(dir)) throw new Error(`${PREBUILT_DIST_VAR} must be an absolute path, got "${dir}"`);
  if (!existsSync(join(dir, 'index.html'))) throw new Error(`${PREBUILT_DIST_VAR} has no index.html: ${dir}`);
  return { dir, cluster };
}
