import type { Cluster } from '@stakeward/core';
import type { UpstreamEndpoints } from '../upstream.ts';

/**
 * Settings of the monitor pass (CLAUDE.md section 8, DECISIONS.md D47, D48). The preset follows the Cloudflare Workers
 * plan (wrangler.jsonc `MONITOR_PLAN`); the limits below hold on every plan.
 */

export type MonitorPlan = {
  name: 'free' | 'paid';
  /** Combined cap: fetch attempts + D1 statements per pass (platform limit 50 on Free). */
  subrequestCap: number;
  /** getMultipleAccounts calls per pass (Clock + 99 accounts each); §8: at most 5. */
  maxChunks: number;
  /** kit decodes per pass (monitor chunks + rescans together). */
  decodeCap: number;
  maxRescans: number;
  /** A rescan answer longer than this (characters) is skipped. */
  rescanMaxBodyChars: number;
};

export const MONITOR_PLANS = {
  free: { name: 'free', subrequestCap: 48, maxChunks: 1, decodeCap: 20, maxRescans: 3, rescanMaxBodyChars: 100_000 },
  paid: { name: 'paid', subrequestCap: 400, maxChunks: 5, decodeCap: 500, maxRescans: 10, rescanMaxBodyChars: 2_000_000 },
} as const satisfies Record<string, MonitorPlan>;

export const MONITOR_LIMITS = {
  accountsPerChunk: 99, // + the Clock sysvar = 100 keys per getMultipleAccounts
  maxSends: 25, // §8
  sendFloor: 10, // sends kept possible while reading chunks
  pendingLimit: 100,
  maxAlertsPerMessage: 5,
  maxMessageChars: 3_500, // Telegram allows 4096
  deliveryExpiryMs: 7 * 86_400_000,
  softDeadlineMs: 60_000, // no new network step starts after this
  leaseTtlMs: 110_000, // > max pass (~90 s), < cron interval (120 s)
  dailyHourUtc: 6,
  rescanQueueMax: 1_000,
  reminderRowsLimit: 1_000,
  adminThrottleMs: 3_600_000,
  rpcDownPasses: 3,
  telegramTimeoutMs: 8_000,
} as const;

export type MonitorConfig = {
  cluster: Cluster;
  plan: MonitorPlan;
  /** Null unless exactly an `https:` origin (no path, no trailing slash). */
  siteOrigin: string | null;
  /** Null when empty. */
  telegramToken: string | null;
  /** Null unless a Telegram chat id (an optionally negative integer). */
  adminChatId: string | null;
  rpc: UpstreamEndpoints;
};

/** A deploy bug (wrong CLUSTER or MONITOR_PLAN): the pass fails with this name and the admin is alerted. */
export class MonitorConfigError extends Error {
  override name = 'MonitorConfigError';
}

/** The pass settings from the environment. Throws MonitorConfigError on an unknown CLUSTER or MONITOR_PLAN. */
export function monitorConfig(env: Env): MonitorConfig {
  // Widened to string: the generated types give vars literal types ("free"), which never compare with 'paid'.
  const cluster: string = env.CLUSTER;
  const planName: string = env.MONITOR_PLAN;
  if (!isCluster(cluster)) throw new MonitorConfigError('unknown CLUSTER');
  if (planName !== 'free' && planName !== 'paid') throw new MonitorConfigError('unknown MONITOR_PLAN');
  const token = textOf(env.TELEGRAM_BOT_TOKEN);
  const adminChatId = textOf(env.ADMIN_CHAT_ID);
  return {
    cluster,
    plan: MONITOR_PLANS[planName],
    siteOrigin: siteOriginOf(env),
    telegramToken: token === '' ? null : token,
    adminChatId: /^-?\d{1,20}$/.test(adminChatId) ? adminChatId : null,
    rpc: { primary: env.RPC_URL, fallback: env.RPC_FALLBACK_URL },
  };
}

/** SITE_ORIGIN when it is exactly an `https:` origin (`https://host[:port]`, no path, no trailing slash); else null. */
export function siteOriginOf(env: Env): string | null {
  const value = textOf(env.SITE_ORIGIN);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return url.protocol === 'https:' && url.origin === value ? value : null;
}

/** TELEGRAM_BOT_USERNAME when it is a Telegram username without `@` (5 to 32 of A-Z, a-z, 0-9, _); else null. */
export function botUsernameOf(env: Env): string | null {
  const value = textOf(env.TELEGRAM_BOT_USERNAME);
  return /^[A-Za-z0-9_]{5,32}$/.test(value) ? value : null;
}

function isCluster(value: string): value is Cluster {
  return value === 'devnet' || value === 'mainnet';
}

/**
 * The value of a required secret, '' when it is missing: the types say string, but a local `wrangler dev` without
 * the value in .dev.vars only warns and leaves it out.
 */
function textOf(value: string | undefined): string {
  return typeof value === 'string' ? value : '';
}
