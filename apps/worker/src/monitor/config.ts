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
  /** A rescan answer longer than this (characters) is skipped, not read on. */
  rescanMaxBodyChars: number;
  /**
   * Rescan answers parsed per pass, in characters: a search starts only while what the pass parsed plus the largest
   * answer allowed fits. The parse is the costly part (the exact-lamports reviver: about 2 ms per 100 000 characters,
   * test/monitor-cpu.test.ts); on Free 120 000 still allows three small answers, or one large one.
   */
  rescanParseChars: number;
  /**
   * Rows of locks whose reminder is due, per daily page (one page per pass). More due rows than this keep the daily
   * stage open: the next pass goes on after the last row of the page (DECISIONS.md D58).
   */
  reminderPageRows: number;
  /**
   * (main key, second key) pairs of the daily search round per page (DAILY_PAIRS). A page joins the back of the rescan
   * queue only while the queue holds fewer pairs than this, so the round's own pairs never fill it (SECURITY-CHECK
   * П25); a round that does not end within a day goes on the next. Urgent pairs pile up in front over passes and may
   * still push the queue past rescanQueueMax: the pairs cut off the back send the round back for them (pass.ts
   * withUrgent), so every pair is reached in its turn.
   */
  pairsPageRows: number;
};

export const MONITOR_PLANS = {
  free: {
    name: 'free',
    subrequestCap: 48,
    maxChunks: 1,
    // A pass with 20 decodes measured 10-15 ms CPU on Cloudflare even in a warm isolate (DECISIONS.md D63); 8 keeps a
    // pass with real changes near the 10 ms limit. Rewards take the fast path and need no decode, so changes that do
    // are rare and the rest wait one pass.
    decodeCap: 8,
    maxRescans: 3,
    rescanMaxBodyChars: 100_000,
    rescanParseChars: 120_000,
    // CPU: a page is read, checked and written in one pass. 250 keeps it a small part of the 10 ms; a crowd of 1000 due
    // reminders takes four passes, eight minutes.
    reminderPageRows: 250,
    // About 33 passes of 3 searches: one DAILY_PAIRS statement an hour while a round lasts.
    pairsPageRows: 100,
  },
  paid: {
    name: 'paid',
    subrequestCap: 400,
    maxChunks: 5,
    decodeCap: 500,
    maxRescans: 10,
    rescanMaxBodyChars: 2_000_000,
    rescanParseChars: 20_000_000,
    reminderPageRows: 1_000,
    // Two pages and the urgent pairs of one pass (at most 5 x 99 rows) stay below rescanQueueMax; urgent pairs of
    // several passes may not, and the round goes back for what the cap cuts (pass.ts withUrgent).
    pairsPageRows: 250,
  },
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
  adminThrottleMs: 3_600_000,
  /** A 401 Telegram got from the webhook this recently is a bot-mismatch (pass.ts checkBot). */
  webhookErrorWindowMs: 600_000,
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
  const admin = adminChannelOf(env);
  return {
    cluster,
    plan: MONITOR_PLANS[planName],
    siteOrigin: siteOriginOf(env),
    telegramToken: admin.token,
    adminChatId: admin.chatId,
    rpc: { primary: env.RPC_URL, fallback: env.RPC_FALLBACK_URL },
  };
}

/**
 * The bot token (null when empty) and the admin chat id (null unless an optionally negative integer). Read apart from
 * monitorConfig so that a pass whose CLUSTER or MONITOR_PLAN is broken can still alert the admin.
 */
export function adminChannelOf(env: Env): { token: string | null; chatId: string | null } {
  const token = textOf(env.TELEGRAM_BOT_TOKEN);
  const chatId = textOf(env.ADMIN_CHAT_ID);
  return { token: token === '' ? null : token, chatId: /^-?\d{1,20}$/.test(chatId) ? chatId : null };
}

/** CLUSTER when it is a known cluster, else null. */
export function clusterOf(env: Env): Cluster | null {
  const cluster: string = env.CLUSTER;
  return isCluster(cluster) ? cluster : null;
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

/** TELEGRAM_WEBHOOK_SECRET, null when empty (the webhook then answers 503). */
export function webhookSecretOf(env: Env): string | null {
  const value = textOf(env.TELEGRAM_WEBHOOK_SECRET);
  return value === '' ? null : value;
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
