import type { Cluster } from '@stakeward/core';
import { MONITOR_LIMITS } from './config.ts';
import type { Stage } from './pass.ts';

/**
 * Alerts to the admin chat (ADMIN_CHAT_ID) about the monitor itself (step 5 spec section 7.6). At most one per pass,
 * sent from the fetch the pass budget reserves for it, as plain text without a button, and at most one per kind per
 * hour. The texts carry counts and names only: no addresses, chat ids, URLs or error messages, which may quote them.
 */

export type AdminKind = 'pass-error' | 'wrong-cluster' | 'bot-mismatch' | 'pass-died' | 'rpc-down' | 'rescan-dropped';

/** The order in which a pass picks its one admin alert. */
export const ADMIN_KINDS: readonly AdminKind[] = [
  'pass-error',
  'wrong-cluster',
  'bot-mismatch',
  'pass-died',
  'rpc-down',
  'rescan-dropped',
];

/** What the daily bot check found not to be this deployment's: the webhook URL, the bot's username. */
export type BotMismatch = 'webhook' | 'username';

export type AdminCounts = { stage?: Stage; errorName?: string; passes?: number; kb?: number; bot?: readonly BotMismatch[] };

/** The wrangler environment that deploys each cluster (wrangler.jsonc: env.dev is devnet, env.prod is mainnet). */
const WRANGLER_ENV: Record<Cluster, string> = { devnet: 'dev', mainnet: 'prod' };

const BOT_MISMATCH: Record<BotMismatch, string> = {
  webhook: "Telegram sends this bot's updates to another address than SITE_ORIGIN/api/telegram/webhook",
  username: 'the bot token belongs to another bot than TELEGRAM_BOT_USERNAME',
};

export function adminText(kind: AdminKind, cluster: Cluster | null, counts: AdminCounts): string {
  const monitor = cluster === null ? 'Stakeward monitor' : `Stakeward ${cluster} monitor`;
  switch (kind) {
    case 'pass-error':
      return (
        `${monitor}: the pass failed at ${counts.stage ?? 'an unknown stage'} (${safeErrorName(counts.errorName)}). ` +
        'Health turns red after 10 minutes. See Workers Logs.'
      );
    case 'wrong-cluster':
      return `${monitor}: RPC_URL answers for another cluster. Account closures were not recorded.`;
    case 'pass-died':
      return (
        `${monitor}: the previous pass did not finish, most likely the 10 ms CPU limit of the Workers Free plan. ` +
        'Check CPU time of cron invocations in Workers Logs.'
      );
    case 'rpc-down':
      return (
        `${monitor}: the RPC could not be read for ${String(counts.passes ?? 0)} passes in a row. ` +
        'Health turns red after 10 minutes.'
      );
    case 'rescan-dropped':
      return `${monitor}: a rescan answer over ${String(counts.kb ?? 0)} KB was skipped.`;
    case 'bot-mismatch': {
      const found = (counts.bot ?? []).map((what) => BOT_MISMATCH[what]);
      const what = found.length === 0 ? "Telegram's webhook or bot is not this deployment's" : found.join(', and ');
      // The rotation runbook (SECURITY-CHECK П17): both secrets, in the cluster's environment. A webhook set with a new
      // secret_token while the worker keeps the old TELEGRAM_WEBHOOK_SECRET answers every update 401.
      const env = cluster === null ? '<env>' : WRANGLER_ENV[cluster];
      return (
        `${monitor}: ${what}. If you did not change it, the bot token may be stolen. Revoke it with BotFather and ` +
        `put the new one with wrangler secret put TELEGRAM_BOT_TOKEN --env ${env}. Then put a new webhook secret with ` +
        `wrangler secret put TELEGRAM_WEBHOOK_SECRET --env ${env} and call setWebhook with ` +
        'SITE_ORIGIN/api/telegram/webhook and that same secret as secret_token: while the two differ, the webhook ' +
        'refuses every update.'
      );
    }
  }
}

/** True unless an alert of this kind went out less than an hour before `nowMs`. */
export function adminAllowed(kind: AdminKind, sent: Readonly<Record<string, number>>, nowMs: number): boolean {
  const last = sent[kind];
  return last === undefined || nowMs - last >= MONITOR_LIMITS.adminThrottleMs;
}

/** The alert a pass sends: the first kind of ADMIN_KINDS that is due and not sent within the hour; null for none. */
export function adminKindToSend(
  due: ReadonlySet<AdminKind>,
  sent: Readonly<Record<string, number>>,
  nowMs: number,
): AdminKind | null {
  return ADMIN_KINDS.find((kind) => due.has(kind) && adminAllowed(kind, sent, nowMs)) ?? null;
}

/** `meta.admin_alerts` ({"<kind>": ms}); anything malformed reads as no alert sent. */
export function parseAdminAlerts(text: string | undefined): Record<string, number> {
  if (text === undefined) return {};
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {};
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return {};
  const sent: Record<string, number> = {};
  for (const kind of ADMIN_KINDS) {
    const value = (json as Record<string, unknown>)[kind];
    if (typeof value === 'number' && Number.isSafeInteger(value)) sent[kind] = value;
  }
  return sent;
}

/** An error's name when it looks like one (`TypeError`, `D1_ERROR`); anything else could be a message in disguise. */
export function safeErrorName(name: string | undefined): string {
  return name !== undefined && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name) ? name : 'Error';
}
