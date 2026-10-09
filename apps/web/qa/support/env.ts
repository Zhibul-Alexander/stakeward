// QA suite settings from the environment (.claude/skills/qa-e2e/SKILL.md, "Settings").
import { fileURLToPath } from 'node:url';

export type QaTarget = 'local' | 'dev';

const DEV_SITE = 'https://stakeward-dev.stakeward.workers.dev';
const PROD_HOST = 'stakeward-prod.stakeward.workers.dev';

function readTarget(): QaTarget {
  const raw = process.env['QA_TARGET'] ?? 'local';
  if (raw !== 'local' && raw !== 'dev') throw new Error(`QA_TARGET must be local or dev, got ${raw}. Prod is never a QA target.`);
  return raw;
}

const target = readTarget();
const chainPort = process.env['QA_CHAIN_PORT'] ?? '8899';
const sitePort = process.env['QA_SITE_PORT'] ?? '8787';
const baseUrl = (process.env['QA_BASE_URL'] ?? (target === 'local' ? `http://127.0.0.1:${sitePort}` : DEV_SITE)).replace(/\/$/, '');

// The suite signs with throwaway devnet keys and expects devnet behaviour; it must never point at prod (mainnet).
if (new URL(baseUrl).hostname === PROD_HOST) {
  throw new Error(`QA_BASE_URL ${baseUrl} looks like production. The QA suite runs on local or dev only.`);
}

export const QA = {
  target,
  baseUrl,
  /** JSON-RPC the suite itself reads and sends through (setup and on-chain checks). */
  rpcUrl: (process.env['QA_RPC_URL'] ?? (target === 'local' ? `http://127.0.0.1:${chainPort}` : 'https://api.devnet.solana.com')).replace(/\/$/, ''),
  chainPort,
  sitePort,
  /** dev: the key that pays for test keys and stake accounts (solana-keygen JSON). */
  funderKeyPath: process.env['QA_FUNDER_KEY'] ?? fileURLToPath(new URL('../../../../.keys/devnet-funder.json', import.meta.url)),
  /** dev: also run scenarios that need a delegated account (1 SOL minimum delegation each, locked for days). */
  delegatedOnDev: process.env['QA_DELEGATED'] === '1',
  /** dev: pause before each scenario, so the per-IP rate limits of the previous one have reset. */
  cooldownMs: Number(process.env['QA_COOLDOWN_MS'] ?? '20000'),
  /** Path of a Chromium to run instead of Playwright's own build. */
  chromium: process.env['QA_CHROMIUM'] === undefined || process.env['QA_CHROMIUM'] === '' ? undefined : process.env['QA_CHROMIUM'],
} as const;
