import type { Address } from '@solana/kit';
import {
  decodeStakeAccount,
  GENESIS_HASH,
  isLockupInForce,
  reminderDue,
  STAKE_PROGRAM_ADDRESS,
  SYSVAR_CLOCK_ADDRESS,
  type ChainClock,
  type Cluster,
} from '@stakeward/core';
import { isAddressText } from '../address.ts';
import { decodeBase64 } from '../base64.ts';
import { pairAccountsRequest, parseProgramAccountItems, type ProgramAccountItem } from '../stake-accounts.ts';
import { getBotIdentity, sendTelegramMessage, type TelegramOutcome } from '../telegram/api.ts';
import { TELEGRAM_WEBHOOK_PATH } from '../telegram/webhook.ts';
import { callUpstream, DEFAULT_UPSTREAM_OPTIONS, type EndpointName, type UpstreamOptions } from '../upstream.ts';
import {
  adminAllowed,
  adminKindToSend,
  adminText,
  parseAdminAlerts,
  safeErrorName,
  type AdminCounts,
  type AdminKind,
  type BotMismatch,
} from './admin.ts';
import { COST, PassBudget } from './budget.ts';
import { classifyChunk, type ChunkOutcome, type Pair, type StoredEvent } from './classify.ts';
import {
  adminChannelOf,
  botUsernameOf,
  clusterOf,
  MONITOR_LIMITS,
  MONITOR_PLANS,
  monitorConfig,
  type MonitorConfig,
} from './config.ts';
import {
  linkOf,
  pendingEventOf,
  planDeliveries,
  recipientsOf,
  settleDeliveries,
  type SendResult,
} from './deliver.ts';
import { anyGone, GENESIS_REQUEST, parseGenesisHash, readChunk } from './read.ts';
import {
  chunkEventsStatement,
  chunkUpdateStatement,
  INSERT_WATCHED_ROWS,
  insertWatchedStatements,
  leaseAcquireStatement,
  putMetaStatement,
  reminderDaysStatement,
  SQL,
  watchRowOf,
  type AccountRow,
  type Lease,
  type LinkRow,
  type PendingRow,
  type WatchRow,
} from './store.ts';

/**
 * The monitor pass (CLAUDE.md section 8; step 5 spec section 4.2; DECISIONS.md D47, D48): one run of the cron trigger.
 * Phases, each committed as it ends, so that a pass killed late (usually by the CPU limit) keeps what it found:
 *
 * 1. config  - the environment (a bad CLUSTER or MONITOR_PLAN fails the pass).
 * 2. load    - one batch: every meta value, the lease, one page of watched rows from the cursor on. A pass that does
 *              not get the lease writes nothing and returns 'skipped-lease'.
 * 3. chunks  - per chunk of 99 rows: one getMultipleAccounts with the Clock sysvar first, the genesis check of the node
 *              that answered when any account reads as gone, classifyChunk, and one batch with the events, the row
 *              writes, the cursor and, when the chunk calls for a rescan, the queue with its pairs in front.
 * 4. daily   - on the first pass after 06:00 UTC: the reminders due (REMINDER_<d> events) are written, one page per
 *              pass; a full page keeps the stage open for the next pass, which goes on after it (meta.daily_sweep).
 * 4b. bot    - once a day from 06:00 UTC: getWebhookInfo and getMe; a webhook that is not SITE_ORIGIN's or a token of
 *              another bot than TELEGRAM_BOT_USERNAME is an admin alert (meta.bot_check_day).
 * 5. sends   - Telegram delivery (step 5 spec section 7): one message per chat, committed before the rescans.
 * 6. rescans - getProgramAccounts by (main key, second key) pair, urgent pairs first; locked accounts split off a
 *              watched one are watched from then on. A pass that read no chunk reads the Clock alone for them. Once
 *              a day from 06:00 UTC a round of every pair starts; its pairs join the back of the queue a page at a
 *              time while the queue is short (meta.pairs_sweep).
 * 7. admin   - at most one admin alert.
 * 8. finish  - one statement: the lease released, the queue, the counters and, only when the pass succeeded, the
 *              marker `last_pass_at` that /api/health reads. It is always the pass's last statement.
 *
 * Every D1 call goes through the pass budget (budget.ts), every outbound call through its counting fetch. All meta
 * writes are fenced by the pass id: a pass that lost its lease to a later one changes nothing there. Row and event
 * writes are compare-and-set on the row version, so two passes never both apply a change (store.ts).
 *
 * On an exception the pass logs the stage and the error name (never the message), alerts the admin once an hour,
 * releases its lease and rethrows: the invocation is recorded as failed and the marker stays old.
 */

export type MonitorDeps = {
  /** Read through monitorConfig() inside the pass. */
  env: Env;
  db: D1Database;
  /** Every outbound call: RPC and Telegram. */
  fetch: typeof fetch;
  /** Worker clock, unix ms. */
  now: () => number;
  newPassId: () => string;
  /** Production: 8000 / 250. */
  upstream: { timeoutMs: number; retryDelayMs: number };
  /** Production: 8000. */
  telegramTimeoutMs: number;
  /** Production: one JSON line on the console. Counters, stages and error names only. */
  log: (line: Record<string, unknown>) => void;
  /**
   * Admin alerts this isolate sent (kind -> ms): the hourly throttle when D1, and with it meta.admin_alerts, cannot
   * be read. Module scope in production.
   */
  adminMemory: Map<string, number>;
};

export type Stage = 'config' | 'load' | 'chunks' | 'daily' | 'bot' | 'sends' | 'rescans' | 'admin' | 'finish';

export type PassOutcome = 'ok' | 'skipped-lease' | 'read-failed' | 'telegram-config' | 'error';

export type PassReport = {
  outcome: PassOutcome;
  stage: Stage;
  previousDied: boolean;
  plan: 'free' | 'paid';
  rows: number;
  chunks: number;
  chunksFailed: number;
  stale: number;
  fastPath: number;
  lamportsOnly: number;
  decoded: number;
  deferred: boolean;
  closed: number;
  events: number;
  reminders: number;
  daily: boolean;
  /** The daily bot check of this pass (null: not due or not run). */
  botCheck: 'ok' | 'mismatch' | 'config' | 'retry' | null;
  /** Pairs of the daily round this pass added to the rescan queue. */
  pairsQueued: number;
  rescans: number;
  rescansDropped: number;
  autoWatched: number;
  rescanQueue: number;
  pending: number;
  messages: number;
  alertsDelivered: number;
  rejected: number;
  blockedChats: number;
  retrySends: number;
  expiredUndelivered: number;
  superseded: number;
  fetches: number;
  statements: number;
  wallMs: number;
};

/**
 * Logged when Telegram refuses the bot token (401/404, or none is set) or SITE_ORIGIN is not an origin. No admin alert
 * for it: the bot itself is broken. The marker stays old, so health turns red.
 */
const TELEGRAM_CONFIG_ERROR = { level: 'error', msg: 'telegram rejected the bot token or the site origin is invalid' };

/** Admin alerts sent by this isolate, shared by its passes (see MonitorDeps.adminMemory). */
const ISOLATE_ADMIN_ALERTS = new Map<string, number>();

export function monitorDepsFromEnv(env: Env): MonitorDeps {
  return {
    env,
    db: env.DB,
    // Looked up at call time, like callUpstream's default.
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    newPassId: () => crypto.randomUUID(),
    upstream: { timeoutMs: DEFAULT_UPSTREAM_OPTIONS.timeoutMs, retryDelayMs: DEFAULT_UPSTREAM_OPTIONS.retryDelayMs },
    telegramTimeoutMs: MONITOR_LIMITS.telegramTimeoutMs,
    log: (line) => {
      if (line.level === 'error') console.error(JSON.stringify(line));
      else console.log(JSON.stringify(line));
    },
    adminMemory: ISOLATE_ADMIN_ALERTS,
  };
}

/**
 * A queued search: a (main key, second key) pair and, when an earlier search of it stopped at the decode cap, the
 * last account (in address order) that search got through. The next search goes on after it: the accounts it
 * rejected (a lock not in force) are never stored, so starting over would decode the same ones again and again.
 */
type QueuedPair = readonly [withdrawer: Address, custodian: Address, after?: Address];

/** The meta values a pass reads (step 5 spec section 2.3), parsed; anything malformed reads as its default. */
type LoadedMeta = {
  lease: Lease | null;
  cursor: string;
  dailyDay: string | null;
  /** meta.bot_check_day: the UTC day of the last bot check that got an answer (and its alert out). */
  botCheckDay: string | null;
  rescanQueue: QueuedPair[];
  /** meta.daily_sweep: the daily stage of `day`, open after a full page of reminders that ended at `after`. */
  dailySweep: DailySweep | null;
  /** meta.pairs_sweep: the daily search round. */
  pairsSweep: PairsSweep | null;
  readFailures: number;
  adminAlerts: Record<string, number>;
  alertsSent: number;
};

/**
 * The daily stage a pass works on: the UTC day it started, and the last stake account
 * whose reminder it got through ('' = none yet).
 */
type DailySweep = { day: string; after: string };

/**
 * The daily search round (SECURITY-CHECK П25): started on `day`, its pairs queued up to and including `after`
 * (['', ''] = none yet), keyset by (main key, second key); `after: null` once every pair was queued. A round that
 * does not end within a day goes on: a new one starts only after it ended, so every pair is reached however many
 * pairs sort before it.
 */
type PairsSweep = { day: string; after: readonly [string, string] | null };

/** Where a pass is. Phases change it as they go; the exception path reads it. */
type PassContext = {
  deps: MonitorDeps;
  passId: string;
  t0: number;
  report: PassReport;
  cluster: Cluster | null;
  /** Null until the config stage passed. */
  config: MonitorConfig | null;
  /** Null until the config stage passed. */
  budget: PassBudget | null;
  leaseHeld: boolean;
  meta: LoadedMeta | null;
  /** Admin alerts sent: meta.admin_alerts merged with the isolate memory. */
  adminSent: Record<string, number>;
  adminChanged: boolean;
  /** This pass already tried its one admin alert. */
  adminTried: boolean;
};

/** A pass after its load stage: settings, budget, lease and meta in hand. */
type LoadedPass = PassContext & {
  config: MonitorConfig;
  budget: PassBudget;
  meta: LoadedMeta;
  /** The rows of this pass: one page from the cursor on (PAGE). */
  page: AccountRow[];
  upstream: UpstreamOptions;
  pastDeadline: () => boolean;
  dailyDue: boolean;
  /** The daily bot check is due: from 06:00 UTC on a day not checked yet. */
  botCheckDue: boolean;
  /** The daily stage to work on when due: the open one from meta, else a new one for today. */
  sweep: DailySweep;
  /** The rescan queue: meta.rescan_queue, then the daily pairs; urgent pairs go in front before the rescans. */
  queue: QueuedPair[];
  /** meta.rescan_queue as this pass last wrote it (or loaded it): the finish writes the queue only when it differs. */
  storedQueue: string;
  /** The daily search round as this pass leaves it; the finish writes it with the queue. */
  pairs: PairsSweep | null;
  /** (main key, second key) pairs of this pass's events that call for a rescan. */
  urgent: Pair[];
  /** The cluster clock of the last chunk read in this pass, or of a read of the Clock alone; rescans need it. */
  lastRead: { clock: ChainClock; clockMs: number } | null;
  readFailed: boolean;
  telegramConfigFailed: boolean;
  adminDue: Set<AdminKind>;
  adminCounts: AdminCounts;
  dailyDone: boolean;
  /** An empty page after the cursor: the cycle is over, the finish moves the cursor back to the start. */
  resetCursor: boolean;
};

export async function runMonitorPass(deps: MonitorDeps): Promise<PassReport> {
  const t0 = deps.now();
  const ctx: PassContext = {
    deps,
    passId: deps.newPassId(),
    t0,
    report: emptyReport(),
    cluster: clusterOf(deps.env),
    config: null,
    budget: null,
    leaseHeld: false,
    meta: null,
    adminSent: Object.fromEntries(deps.adminMemory),
    adminChanged: false,
    adminTried: false,
  };
  try {
    ctx.config = monitorConfig(deps.env);
    ctx.report.plan = ctx.config.plan.name;
    ctx.budget = new PassBudget(ctx.config.plan.subrequestCap, deps.fetch);

    const pass = await load(ctx, ctx.config, ctx.budget);
    if (pass === null) {
      ctx.report.outcome = 'skipped-lease';
      logReport(ctx);
      return ctx.report;
    }
    await readChunks(pass);
    await daily(pass);
    await checkBot(pass);
    await deliver(pass);
    await rescans(pass);
    await admin(pass);
    await finish(pass);
    logReport(ctx);
    return ctx.report;
  } catch (error) {
    await failPass(ctx, error);
    throw error;
  }
}

/** Stage 2: the meta values, the lease and one page of rows in one batch. Null when another pass holds the lease. */
async function load(ctx: PassContext, config: MonitorConfig, budget: PassBudget): Promise<LoadedPass | null> {
  const { deps, report, t0, passId } = ctx;
  report.stage = 'load';
  const db = deps.db;
  const lease: Lease = { pass: passId, until: t0 + MONITOR_LIMITS.leaseTtlMs };
  const [metaResult, leaseResult, pageResult] = await budget.batch(db, [
    db.prepare(SQL.LOAD_META),
    leaseAcquireStatement(db, lease, t0),
    db.prepare(SQL.PAGE).bind(config.plan.maxChunks * MONITOR_LIMITS.accountsPerChunk),
  ]);
  if (rowsOf(leaseResult).length === 0) return null;
  ctx.leaseHeld = true;

  const meta = parseMeta(rowsOf<{ key: string; value: string }>(metaResult));
  ctx.meta = meta;
  for (const [kind, ms] of Object.entries(meta.adminAlerts)) {
    ctx.adminSent[kind] = Math.max(ctx.adminSent[kind] ?? 0, ms);
  }
  report.previousDied = meta.lease !== null && meta.lease.until > 0 && meta.lease.until <= t0;
  const rows = rowsOf<AccountRow>(pageResult);
  report.rows = rows.length;

  // An open daily stage goes on whatever the hour (a crowd of due reminders may keep it open past midnight); a new one
  // starts on the first pass after 06:00 UTC of a day not done yet.
  const today = utcDay(t0);
  const open = openSweep(meta, today);
  const afterDailyHour = new Date(t0).getUTCHours() >= MONITOR_LIMITS.dailyHourUtc;
  const dailyDue = open !== null || (afterDailyHour && meta.dailyDay !== today);

  // The same object, grown: the exception path keeps seeing what the phases change.
  return Object.assign(ctx, {
    config,
    budget,
    meta,
    page: rows,
    upstream: { timeoutMs: deps.upstream.timeoutMs, retryDelayMs: deps.upstream.retryDelayMs, fetch: budget.fetch },
    pastDeadline: () => deps.now() - t0 > MONITOR_LIMITS.softDeadlineMs,
    dailyDue,
    botCheckDue: afterDailyHour && meta.botCheckDay !== today,
    sweep: open ?? { day: today, after: '' },
    queue: [...meta.rescanQueue],
    storedQueue: JSON.stringify(meta.rescanQueue),
    pairs: meta.pairsSweep,
    urgent: [],
    lastRead: null,
    readFailed: false,
    telegramConfigFailed: false,
    adminDue: new Set<AdminKind>(report.previousDied ? ['pass-died'] : []),
    adminCounts: {},
    dailyDone: false,
    resetCursor: false,
  });
}

/**
 * Stage 3: the page in chunks of 99 rows (plan.maxChunks at most). A chunk starts only before the soft deadline and
 * while the budget still holds a chunk, the sends floor and the daily work. A failed read stops the chunks and fails
 * the pass; the decode cap stops them with the cursor right before the first row not handled.
 */
async function readChunks(pass: LoadedPass): Promise<void> {
  const { config, budget, report, deps } = pass;
  report.stage = 'chunks';
  const rows = pass.page;
  const perChunk = MONITOR_LIMITS.accountsPerChunk;
  const shortPage = rows.length < config.plan.maxChunks * perChunk;
  let cursor = pass.meta.cursor;
  // Endpoints whose genesis hash this pass checked.
  const verified = new Set<EndpointName>();

  if (rows.length === 0) {
    pass.resetCursor = cursor !== '';
    return;
  }
  for (let start = 0; start < rows.length; start += perChunk) {
    const needed =
      COST.chunk + COST.sendFloor + (pass.dailyDue ? COST.daily : 0) + (pass.botCheckDue ? COST.botCheck : 0);
    if (pass.pastDeadline() || budget.left() < needed) {
      report.deferred = true;
      return;
    }
    const chunk = rows.slice(start, start + perChunk);
    const result = await readChunk([SYSVAR_CLOCK_ADDRESS, ...chunk.map((row) => row.stake_account)], {
      endpoints: config.rpc,
      options: pass.upstream,
    });
    if (!result.ok) {
      report.chunksFailed += 1;
      pass.readFailed = true;
      return;
    }
    const { read, endpoint } = result;
    if (!verified.has(endpoint) && anyGone(read.items)) {
      // An account reads as gone: a node on another cluster looks exactly like this. Prove the cluster of the node
      // that answered before closing rows (another node answering the check would prove nothing about this one).
      const genesis = await checkGenesis(pass, endpoint);
      if (genesis !== 'ok') {
        report.chunksFailed += 1;
        pass.readFailed = true;
        if (genesis === 'mismatch') pass.adminDue.add('wrong-cluster');
        return;
      }
      verified.add(endpoint);
    }
    report.chunks += 1;

    const out = classifyChunk(chunk, read, config.plan.decodeCap - report.decoded);
    addCounts(report, out);
    const lastOfPage = start + chunk.length === rows.length;
    const cursorAfter =
      out.processed < chunk.length
        ? (chunk[out.processed - 1]?.stake_account ?? cursor)
        : shortPage && lastOfPage
          ? ''
          : (chunk.at(-1)?.stake_account ?? cursor);
    pass.urgent.push(...out.rescan);
    await commitChunk(pass, out, cursorAfter === cursor ? null : cursorAfter, deps.now());
    cursor = cursorAfter;
    pass.lastRead = { clock: read.clock, clockMs: read.clockMs };
    if (out.processed < chunk.length) {
      report.deferred = true;
      return;
    }
  }
}

/** getGenesisHash of `endpoint` against the configured cluster: 'failed' when it cannot be read there. */
async function checkGenesis(pass: LoadedPass, endpoint: EndpointName): Promise<'ok' | 'mismatch' | 'failed'> {
  const result = await callUpstream(pass.config.rpc, GENESIS_REQUEST, 'read', pass.upstream, endpoint);
  const hash = result.ok ? parseGenesisHash(result.body) : null;
  if (hash === null) return 'failed';
  return hash === GENESIS_HASH[pass.config.cluster] ? 'ok' : 'mismatch';
}

/**
 * One batch: the events (gated on the row versions), then the row writes (compare-and-set), then meta: the cursor and,
 * when this chunk calls for a rescan, the queue with the urgent pairs in front. Once the events are in, the next pass
 * sees no change and would not ask for that rescan again: a pass that fails or is killed later must leave it queued.
 */
async function commitChunk(pass: LoadedPass, out: ChunkOutcome, cursor: string | null, nowMs: number): Promise<void> {
  const db = pass.deps.db;
  const statements: D1PreparedStatement[] = [];
  if (out.events.length > 0) statements.push(chunkEventsStatement(db, out.events, nowMs));
  if (out.updates.length > 0) statements.push(chunkUpdateStatement(db, out.updates));
  const entries: Record<string, string> = {};
  if (cursor !== null) entries.cursor = cursor;
  const queue = out.rescan.length > 0 ? JSON.stringify(uniquePairs([...pass.urgent, ...pass.queue])) : null;
  if (queue !== null && queue !== pass.storedQueue) entries.rescan_queue = queue;
  if (Object.keys(entries).length > 0) statements.push(putMetaStatement(db, entries, pass.passId));
  if (statements.length === 0) return;
  const results = await pass.budget.batch(db, statements);
  if (out.events.length > 0) pass.report.events += results[0]?.meta.changes ?? 0;
  if (queue !== null) pass.storedQueue = queue;
}

/**
 * Stage 4, once a day from the first pass after 06:00 UTC (worker clock): each lock ending within 30 days gets the
 * reminder now due (core reminderDue), as a REMINDER_<d> event gated on the row version, with last_reminder_days in
 * the same batch. The day's search of every (main key, second key) pair is a round of its own (queueDailyPairs).
 *
 * Reminders go one page per pass (DAILY_REMINDER_ROWS: only rows with a reminder due, by address). A page that comes
 * back full may have more after it: its batch also records the open stage (meta.daily_sweep: its day and the last row)
 * and the queue, and the next pass goes on after that row. The day is recorded by the finish of the pass whose page
 * was not full: a pass that dies before repeats its page, and the recorded thresholds keep the reminders from
 * repeating.
 */
async function daily(pass: LoadedPass): Promise<void> {
  const { deps, budget, report, t0, config, sweep } = pass;
  if (!pass.dailyDue || budget.left() < COST.daily) return;
  report.stage = 'daily';
  const db = deps.db;
  const nowSec = Math.floor(t0 / 1000);
  const pageRows = config.plan.reminderPageRows;
  const results = await budget.batch(db, [db.prepare(SQL.DAILY_REMINDER_ROWS).bind(nowSec, sweep.after, pageRows)]);

  type ReminderRow = { stake_account: Address; lock_until: string; last_reminder_days: number | null; slot: number; checked_at: number };
  const rows = rowsOf<ReminderRow>(results.at(-1));
  const events: StoredEvent[] = [];
  const days: { stakeAccount: Address; days: number; prevSlot: number; prevCheckedAt: number }[] = [];
  for (const row of rows) {
    const due = reminderDue(BigInt(row.lock_until), BigInt(nowSec), row.last_reminder_days);
    if (due === null) continue;
    const version = { prevSlot: row.slot, prevCheckedAt: row.checked_at };
    events.push({
      stakeAccount: row.stake_account,
      type: `REMINDER_${String(due)}` as StoredEvent['type'],
      detailsJson: JSON.stringify({ days: due, lockUntil: row.lock_until }),
      slot: row.slot,
      ...version,
    });
    days.push({ stakeAccount: row.stake_account, days: due, ...version });
  }

  const statements: D1PreparedStatement[] = [];
  if (events.length > 0) statements.push(chunkEventsStatement(db, events, deps.now()), reminderDaysStatement(db, days));
  const last = rows.length >= pageRows ? rows.at(-1) : undefined;
  let queue: string | null = null;
  if (last !== undefined) {
    const entries: Record<string, string> = { daily_sweep: JSON.stringify({ day: sweep.day, after: last.stake_account }) };
    // As commitChunk: the urgent pairs of this pass stay in front, in case it dies before the rescans.
    queue = JSON.stringify(uniquePairs([...pass.urgent, ...pass.queue]));
    if (queue !== pass.storedQueue) entries.rescan_queue = queue;
    statements.push(putMetaStatement(db, entries, pass.passId));
  }
  if (statements.length > 0) {
    const [inserted] = await budget.batch(db, statements);
    if (events.length > 0) report.reminders += inserted?.meta.changes ?? 0;
  }
  if (queue !== null) pass.storedQueue = queue;
  pass.dailyDone = last === undefined;
  report.daily = true;
}

/**
 * Stage 4b, once a day from 06:00 UTC (SECURITY-CHECK П17): whoever holds the bot token can point the webhook at their
 * own server and answer users with phishing links, while sendMessage keeps working for this worker. getWebhookInfo
 * and getMe (COST.botCheck): a webhook URL other than SITE_ORIGIN + TELEGRAM_WEBHOOK_PATH (none set included), or a
 * username other than TELEGRAM_BOT_USERNAME (case aside), is a `bot-mismatch` admin alert. A token Telegram refuses
 * fails the pass like a refused sendMessage. The finish records the day once Telegram answered and, for a mismatch,
 * the alert went out (within the hour): until then every pass checks again. Only the outcome is logged.
 */
async function checkBot(pass: LoadedPass): Promise<void> {
  const { config, budget, report, deps } = pass;
  if (!pass.botCheckDue || pass.pastDeadline() || budget.left() < COST.botCheck) return;
  report.stage = 'bot';
  const identity = await getBotIdentity({
    token: config.telegramToken,
    fetch: budget.fetch,
    timeoutMs: deps.telegramTimeoutMs,
  });
  if (identity.outcome !== 'ok') {
    report.botCheck = identity.outcome;
    if (identity.outcome === 'config') {
      pass.telegramConfigFailed = true;
      deps.log(TELEGRAM_CONFIG_ERROR);
    }
    return;
  }
  const found: BotMismatch[] = [];
  if (config.siteOrigin !== null && identity.webhookUrl !== `${config.siteOrigin}${TELEGRAM_WEBHOOK_PATH}`) {
    found.push('webhook');
  }
  const username = botUsernameOf(deps.env);
  if (username !== null && identity.username.toLowerCase() !== username.toLowerCase()) found.push('username');
  report.botCheck = found.length === 0 ? 'ok' : 'mismatch';
  if (found.length > 0) {
    pass.adminDue.add('bot-mismatch');
    pass.adminCounts.bot = found;
  }
}

/**
 * Stage 5: Telegram delivery (step 5 spec section 7, deliver.ts). Loads the oldest pending events (PENDING) and the
 * links of their recipients (LINKS_FOR), two statements; sends one message per chat, one after another, at most
 * MONITOR_LIMITS.maxSends and only while the budget keeps the commit (and an urgent rescan) possible and the soft
 * deadline has not passed. Stops on a token Telegram refuses (401/404, the pass fails), on 429 and on two failures in
 * a row (Telegram looks down); a single failure skips that chat. Then one batch: progress, unlinked chats, closed
 * events, alerts_sent. It is committed BEFORE the rescans: a pass killed later does not send these messages again.
 */
async function deliver(pass: LoadedPass): Promise<void> {
  const { config, budget, report, deps, meta } = pass;
  report.stage = 'sends';
  if (budget.left() < COST.sendLoad + COST.sendCommit + 1) return;
  const db = deps.db;
  const [pendingResult] = await budget.batch(db, [db.prepare(SQL.PENDING).bind(MONITOR_LIMITS.pendingLimit)]);
  const pending = rowsOf<PendingRow>(pendingResult).map(pendingEventOf);
  report.pending = pending.length;
  if (pending.length === 0) return;
  const wallets = [...new Set(pending.flatMap(recipientsOf))];
  const [linksResult] = await budget.batch(db, [db.prepare(SQL.LINKS_FOR).bind(JSON.stringify(wallets))]);
  const links = rowsOf<LinkRow>(linksResult).map(linkOf);

  const rescanReserve = pass.urgent.length > 0 && pass.lastRead !== null ? COST.urgentRescan : 0;
  const plan = planDeliveries(pending, links, {
    maxMessages: Math.min(MONITOR_LIMITS.maxSends, budget.left() - COST.sendCommit - rescanReserve),
    nowMs: deps.now(),
    siteOrigin: config.siteOrigin,
    cluster: config.cluster,
    fullWindow: pending.length >= MONITOR_LIMITS.pendingLimit,
  });
  report.expiredUndelivered = plan.expired;
  report.superseded = plan.superseded;
  if (config.siteOrigin === null && plan.chats > 0) {
    // No alert can carry its button: a broken deployment, like a refused token (the marker stays old).
    pass.telegramConfigFailed = true;
    deps.log(TELEGRAM_CONFIG_ERROR);
  }

  const results: SendResult[] = plan.messages.map(() => 'not-attempted');
  let retriesInRow = 0;
  for (const [index, message] of plan.messages.entries()) {
    if (pass.pastDeadline() || budget.left() < 1 + COST.sendCommit) break;
    const outcome = await sendTelegramMessage({
      token: config.telegramToken,
      chatId: message.chatId,
      text: message.text,
      button: message.button,
      fetch: budget.fetch,
      timeoutMs: deps.telegramTimeoutMs,
    });
    results[index] = outcome;
    if (outcome === 'config') {
      pass.telegramConfigFailed = true;
      deps.log(TELEGRAM_CONFIG_ERROR);
      break;
    }
    if (outcome === 'rate-limited') break;
    retriesInRow = outcome === 'retry' ? retriesInRow + 1 : 0;
    if (retriesInRow === 2) break;
  }

  const settled = settleDeliveries(pending, links, plan.messages, results, plan.doneWithoutSend);
  report.messages = results.filter((result) => result === 'sent').length;
  report.rejected = results.filter((result) => result === 'rejected').length;
  report.retrySends = results.filter((result) => result === 'retry').length;
  report.blockedChats = settled.unlinkChats.length;
  report.alertsDelivered = settled.alertsDelivered;

  const statements: D1PreparedStatement[] = [];
  if (settled.progress.length > 0) {
    statements.push(db.prepare(SQL.LINK_PROGRESS).bind(JSON.stringify(settled.progress)));
  }
  if (settled.unlinkChats.length > 0) {
    statements.push(db.prepare(SQL.UNLINK_CHATS).bind(JSON.stringify(settled.unlinkChats)));
  }
  if (settled.doneIds.length > 0) {
    statements.push(db.prepare(SQL.MARK_NOTIFIED).bind(JSON.stringify(settled.doneIds), deps.now()));
  }
  if (settled.alertsDelivered > 0) {
    const alertsSent = String(meta.alertsSent + settled.alertsDelivered);
    statements.push(putMetaStatement(db, { alerts_sent: alertsSent }, pass.passId));
  }
  if (statements.length > 0) await budget.batch(db, statements);
}

/**
 * Stage 6: search the stake accounts of (main key, second key) pairs: this pass's urgent pairs first, then the queue.
 * Split copies both keys and the lock, so the pair finds every account split off a watched one (D52). The cluster
 * clock judges the locks: the one of this pass's last chunk read, else of a read of the Clock alone (readClockAlone).
 * A failed call keeps its pair at the head and stops the search; an answer over the plan's size limit is not read
 * on and drops its pair (admin alert). The answers parsed in a pass stay within plan.rescanParseChars (CPU): once the
 * next answer might not fit, the rest of the queue waits. Unknown accounts (closed rows too) are decoded within the
 * decode cap and watched when the pair matches and the lock is in force: a first sighting, no events, a live row
 * never touched, a closed one revived (INSERT_WATCHED). The answer is taken in address order; a pair whose accounts
 * did not all fit the decode cap goes to the back of the queue with the last account this search got through, and
 * its next search goes on after it (QueuedPair). An urgent search of the pair starts over.
 */
async function rescans(pass: LoadedPass): Promise<void> {
  const { config, budget, report, deps } = pass;
  report.stage = 'rescans';
  pass.queue = uniquePairs([...pass.urgent, ...pass.queue]);
  pass.urgent = [];
  await queueDailyPairs(pass);
  if (pass.queue.length === 0) return;
  const lastRead = pass.lastRead ?? (await readClockAlone(pass));
  if (lastRead === null) return;

  const found: { pair: QueuedPair; slot: number; items: ProgramAccountItem[] }[] = [];
  const options = { ...pass.upstream, maxBodyBytes: config.plan.rescanMaxBodyChars };
  let parsedChars = 0;
  // Each call keeps room for itself (3 attempts) and the two statements after the loop.
  while (
    pass.queue.length > 0 &&
    report.rescans < config.plan.maxRescans &&
    parsedChars + config.plan.rescanMaxBodyChars <= config.plan.rescanParseChars &&
    !pass.pastDeadline() &&
    budget.left() >= COST.rescanCall + COST.rescanPost
  ) {
    const pair = pass.queue[0];
    if (pair === undefined) break;
    report.rescans += 1;
    const result = await callUpstream(config.rpc, JSON.stringify(pairAccountsRequest(pair[0], pair[1])), 'read', options);
    if (!result.ok && result.reason === 'too-large') {
      pass.queue.shift();
      report.rescansDropped += 1;
      pass.adminDue.add('rescan-dropped');
      pass.adminCounts.kb = Math.round(config.plan.rescanMaxBodyChars / 1000);
      continue;
    }
    if (!result.ok) break;
    parsedChars += result.body.length;
    const parsed = parseProgramAccountItems(result.body);
    if (parsed === null) break;
    pass.queue.shift();
    found.push({ pair, slot: parsed.slot, items: parsed.items });
  }

  const pubkeys = [...new Set(found.flatMap((f) => f.items.map((item) => item.pubkey)))];
  if (pubkeys.length === 0) return;
  const db = deps.db;
  const [known] = await budget.batch(db, [db.prepare(SQL.KNOWN_LIVE).bind(JSON.stringify(pubkeys))]);
  const seen = new Set(rowsOf<{ stake_account: string }>(known).map((row) => row.stake_account));

  // One INSERT_WATCHED statement: at most 100 rows, so at most 100 decodes.
  let decodeLeft = Math.min(config.plan.decodeCap - report.decoded, INSERT_WATCHED_ROWS);
  const rows: WatchRow[] = [];
  for (const { pair, slot, items } of found) {
    const [mainKey, secondKey, after] = pair;
    const ordered = items
      .filter((item) => after === undefined || item.pubkey > after)
      .sort((a, b) => (a.pubkey < b.pubkey ? -1 : a.pubkey > b.pubkey ? 1 : 0));
    // The last account of `ordered` this search got through.
    let reached = after;
    for (const item of ordered) {
      if (!seen.has(item.pubkey) && decodeLeft <= 0) {
        const next: QueuedPair = reached === undefined ? [mainKey, secondKey] : [mainKey, secondKey, reached];
        pass.queue = uniquePairs([...pass.queue, next]);
        break;
      }
      reached = item.pubkey;
      if (seen.has(item.pubkey)) continue;
      seen.add(item.pubkey);
      const data = decodeBase64(item.dataBase64);
      if (data === null) continue;
      decodeLeft -= 1;
      report.decoded += 1;
      const decoded = decodeStakeAccount({ address: item.pubkey, data, lamports: item.lamports, owner: STAKE_PROGRAM_ADDRESS });
      if (!decoded.ok) continue;
      const { account } = decoded;
      if (
        account.withdrawer !== mainKey ||
        account.lockup.custodian !== secondKey ||
        !isLockupInForce(account.lockup, lastRead.clock)
      ) {
        continue;
      }
      rows.push(watchRowOf(account, BigInt(slot), lastRead.clockMs, item.dataBase64, lastRead.clock.unixTimestamp));
    }
  }
  if (rows.length === 0) return;
  const [inserted] = await budget.batch(db, insertWatchedStatements(db, rows, lastRead.clockMs));
  report.autoWatched += inserted?.meta.changes ?? 0;
}

/**
 * The daily search round (PairsSweep): from 06:00 UTC (worker clock) a day whose round has not started starts one,
 * unless the last round is still open; then, while the queue holds fewer pairs than a page, the next page of pairs
 * after the round's cursor joins the back of the queue (DAILY_PAIRS, one statement). The round and the queue are
 * written together by the finish: a pass that dies before reads the same page again.
 */
async function queueDailyPairs(pass: LoadedPass): Promise<void> {
  const { config, budget, report, deps, t0 } = pass;
  const today = utcDay(t0);
  const open = pass.pairs !== null && pass.pairs.after !== null;
  if (!open && pass.pairs?.day !== today && new Date(t0).getUTCHours() >= MONITOR_LIMITS.dailyHourUtc) {
    pass.pairs = { day: today, after: ['', ''] };
  }
  const round = pass.pairs;
  const pageRows = config.plan.pairsPageRows;
  if (round === null || round.after === null || pass.queue.length >= pageRows) return;
  if (pass.pastDeadline() || budget.left() < 1) return;
  const db = deps.db;
  const [result] = await budget.batch(db, [
    db.prepare(SQL.DAILY_PAIRS).bind(Math.floor(t0 / 1000), round.after[0], round.after[1], pageRows),
  ]);
  const pairs = rowsOf<{ withdrawer: Address; custodian: Address }>(result).map((p): Pair => [p.withdrawer, p.custodian]);
  const last = pairs.length >= pageRows ? pairs.at(-1) : undefined;
  pass.queue = uniquePairs([...pass.queue, ...pairs]);
  pass.pairs = { day: round.day, after: last === undefined ? null : [last[0], last[1]] };
  report.pairsQueued += pairs.length;
}

/**
 * The cluster clock for rescans in a pass that read no chunk: every watched row is closed (the page is empty), and
 * a queued search is the only way such a row comes back (DAILY_PAIRS keeps closed rows for that). Not after a chunk
 * that failed, past the soft deadline, or without the budget for the read and one search; a failed read leaves the
 * queue as it is and does not fail the pass.
 */
async function readClockAlone(pass: LoadedPass): Promise<LoadedPass['lastRead']> {
  const { config, budget } = pass;
  if (pass.readFailed || pass.pastDeadline()) return null;
  if (budget.left() < COST.clockRead + COST.rescanCall + COST.rescanPost) return null;
  const result = await readChunk([SYSVAR_CLOCK_ADDRESS], { endpoints: config.rpc, options: pass.upstream });
  if (!result.ok) return null;
  pass.lastRead = { clock: result.read.clock, clockMs: result.read.clockMs };
  return pass.lastRead;
}

/** Stage 7: the one admin alert of the pass, the first due kind (ADMIN_KINDS order) not sent within the hour. */
async function admin(pass: LoadedPass): Promise<void> {
  const { meta, report } = pass;
  report.stage = 'admin';
  if (pass.readFailed && meta.readFailures + 1 >= MONITOR_LIMITS.rpcDownPasses) {
    pass.adminDue.add('rpc-down');
    pass.adminCounts.passes = meta.readFailures + 1;
  }
  const kind = adminKindToSend(pass.adminDue, pass.adminSent, pass.deps.now());
  if (kind === null) return;
  const outcome = await sendAdmin(pass, pass.budget, kind, adminText(kind, pass.config.cluster, pass.adminCounts));
  // A token Telegram refuses is a broken deployment: the marker stays old and health turns red.
  if (outcome === 'config') pass.telegramConfigFailed = true;
}

/**
 * Stage 8: one fenced statement, the last of the pass. The marker is written only when the pass succeeded: every
 * chunk it started was read, Telegram took the bot token and, when there were alerts to send, SITE_ORIGIN was valid.
 * Deferring work (decode cap, budget, deadline), Telegram 5xx and 429, and failed rescans (their pairs stay queued)
 * do not make a pass fail.
 */
async function finish(pass: LoadedPass): Promise<void> {
  const { meta, report, budget, deps } = pass;
  report.stage = 'finish';
  const entries: Record<string, string> = { pass_lease: JSON.stringify({ pass: pass.passId, until: 0 }) };
  const queue = JSON.stringify(pass.queue);
  if (queue !== pass.storedQueue) entries.rescan_queue = queue;
  const readFailures = pass.readFailed ? meta.readFailures + 1 : 0;
  if (readFailures !== meta.readFailures) entries.read_failures = String(readFailures);
  if (pass.adminChanged) entries.admin_alerts = JSON.stringify(pass.adminSent);
  if (pass.dailyDone) entries.daily_day = pass.sweep.day;
  const botChecked =
    report.botCheck === 'ok' ||
    report.botCheck === 'config' ||
    (report.botCheck === 'mismatch' && !adminAllowed('bot-mismatch', pass.adminSent, deps.now()));
  if (botChecked) entries.bot_check_day = utcDay(pass.t0);
  const pairs = pass.pairs === null ? null : JSON.stringify(pass.pairs);
  if (pairs !== null && pairs !== JSON.stringify(meta.pairsSweep)) entries.pairs_sweep = pairs;
  if (pass.resetCursor) entries.cursor = '';
  const success = !pass.readFailed && !pass.telegramConfigFailed;
  if (success) entries.last_pass_at = String(pass.t0);
  report.rescanQueue = pass.queue.length;
  budget.release('finish');
  await budget.batch(deps.db, [putMetaStatement(deps.db, entries, pass.passId)]);
  report.outcome = pass.readFailed ? 'read-failed' : pass.telegramConfigFailed ? 'telegram-config' : 'ok';
}

/**
 * The exception path: log the stage and the error name, alert the admin (hourly throttle, from the reserved fetch,
 * unless this pass already sent its one alert) and release the lease with the reserved statement. Each step may fail
 * in turn (D1 down): it is skipped. The caller rethrows.
 */
async function failPass(ctx: PassContext, error: unknown): Promise<void> {
  const { deps, report } = ctx;
  const errorName = error instanceof Error ? safeErrorName(error.name) : 'unknown';
  report.outcome = 'error';
  finalCounts(ctx);
  deps.log({ level: 'error', msg: 'monitor pass failed', cluster: ctx.cluster, ...report, error: errorName });

  const budget = ctx.budget ?? new PassBudget(MONITOR_PLANS.free.subrequestCap, deps.fetch);
  try {
    if (!ctx.adminTried && adminAllowed('pass-error', ctx.adminSent, deps.now())) {
      const text = adminText('pass-error', ctx.cluster, { stage: report.stage, errorName });
      await sendAdmin(ctx, budget, 'pass-error', text);
    }
  } catch {
    // Nothing more to report with.
  }
  if (!ctx.leaseHeld) return;
  try {
    const entries: Record<string, string> = { pass_lease: JSON.stringify({ pass: ctx.passId, until: 0 }) };
    if (ctx.adminChanged) entries.admin_alerts = JSON.stringify(ctx.adminSent);
    budget.release('finish');
    await budget.batch(deps.db, [putMetaStatement(deps.db, entries, ctx.passId)]);
  } catch {
    // The lease runs out by itself after 110 s; the next pass then reports this one as died.
  }
}

/** Sends one admin alert from the reserved fetch; records it (meta and isolate memory) once Telegram took it. */
async function sendAdmin(
  ctx: PassContext,
  budget: PassBudget,
  kind: AdminKind,
  text: string,
): Promise<TelegramOutcome | null> {
  const { deps } = ctx;
  const channel = adminChannelOf(deps.env);
  if (channel.chatId === null) {
    deps.log({ level: 'error', msg: 'admin alert not sent: ADMIN_CHAT_ID is not a chat id', kind });
    return null;
  }
  ctx.adminTried = true;
  budget.release('admin');
  const outcome = await sendTelegramMessage({
    token: channel.token,
    chatId: channel.chatId,
    text,
    fetch: budget.fetch,
    timeoutMs: deps.telegramTimeoutMs,
  });
  deps.log({ msg: 'admin alert', kind, outcome });
  if (outcome === 'config') {
    deps.log(TELEGRAM_CONFIG_ERROR);
  }
  if (outcome === 'sent') {
    const now = deps.now();
    ctx.adminSent[kind] = now;
    deps.adminMemory.set(kind, now);
    ctx.adminChanged = true;
  }
  return outcome;
}

function logReport(ctx: PassContext): void {
  finalCounts(ctx);
  ctx.deps.log({ msg: 'monitor pass', cluster: ctx.cluster, ...ctx.report });
}

function finalCounts(ctx: PassContext): void {
  const { report, budget, deps } = ctx;
  report.fetches = budget?.used.fetches ?? 0;
  report.statements = budget?.used.statements ?? 0;
  report.wallMs = deps.now() - ctx.t0;
}

function addCounts(report: PassReport, out: ChunkOutcome): void {
  report.stale += out.counts.stale;
  report.fastPath += out.counts.fastPath;
  report.lamportsOnly += out.counts.lamportsOnly;
  report.decoded += out.counts.decoded;
  report.closed += out.counts.closed;
}

function emptyReport(): PassReport {
  return {
    outcome: 'ok',
    stage: 'config',
    previousDied: false,
    plan: 'free',
    rows: 0,
    chunks: 0,
    chunksFailed: 0,
    stale: 0,
    fastPath: 0,
    lamportsOnly: 0,
    decoded: 0,
    deferred: false,
    closed: 0,
    events: 0,
    reminders: 0,
    daily: false,
    botCheck: null,
    pairsQueued: 0,
    rescans: 0,
    rescansDropped: 0,
    autoWatched: 0,
    rescanQueue: 0,
    pending: 0,
    messages: 0,
    alertsDelivered: 0,
    rejected: 0,
    blockedChats: 0,
    retrySends: 0,
    expiredUndelivered: 0,
    superseded: 0,
    fetches: 0,
    statements: 0,
    wallMs: 0,
  };
}

function parseMeta(rows: readonly { key: string; value: string }[]): LoadedMeta {
  const values = new Map(rows.map((row) => [row.key, row.value]));
  return {
    lease: parseLease(values.get('pass_lease')),
    cursor: values.get('cursor') ?? '',
    dailyDay: values.get('daily_day') ?? null,
    botCheckDay: values.get('bot_check_day') ?? null,
    rescanQueue: parseQueue(values.get('rescan_queue')),
    dailySweep: parseSweep(values.get('daily_sweep')),
    pairsSweep: parsePairsSweep(values.get('pairs_sweep')),
    readFailures: parseCount(values.get('read_failures')),
    adminAlerts: parseAdminAlerts(values.get('admin_alerts')),
    alertsSent: parseCount(values.get('alerts_sent')),
  };
}

function parseLease(text: string | undefined): Lease | null {
  const json = parseJson(text);
  if (typeof json !== 'object' || json === null) return null;
  const { pass, until } = json as Record<string, unknown>;
  return typeof pass === 'string' && typeof until === 'number' && Number.isSafeInteger(until) ? { pass, until } : null;
}

/**
 * meta.rescan_queue: [main key, second key] or [main key, second key, after] of addresses (QueuedPair), deduplicated,
 * at most 1000; anything else is dropped.
 */
function parseQueue(text: string | undefined): QueuedPair[] {
  const json = parseJson(text);
  if (!Array.isArray(json)) return [];
  const pairs: QueuedPair[] = [];
  for (const entry of json as unknown[]) {
    if (!Array.isArray(entry) || entry.length < 2 || entry.length > 3) continue;
    const addresses = entry as unknown[];
    if (!addresses.every((value) => typeof value === 'string' && isAddressText(value))) continue;
    const [mainKey, secondKey, after] = addresses;
    if (mainKey === undefined || secondKey === undefined) continue;
    pairs.push(after === undefined ? [mainKey, secondKey] : [mainKey, secondKey, after]);
  }
  return uniquePairs(pairs);
}

/** meta.daily_sweep: {"day": "YYYY-MM-DD", "after": "" or an address}; anything else is null. */
function parseSweep(text: string | undefined): DailySweep | null {
  const json = parseJson(text);
  if (typeof json !== 'object' || json === null) return null;
  const { day, after } = json as Record<string, unknown>;
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  if (typeof after !== 'string' || (after !== '' && !isAddressText(after))) return null;
  return { day, after };
}

/** meta.pairs_sweep: {"day": "YYYY-MM-DD", "after": null or [main key, second key]}, '' for none yet; else null. */
function parsePairsSweep(text: string | undefined): PairsSweep | null {
  const json = parseJson(text);
  if (typeof json !== 'object' || json === null) return null;
  const { day, after } = json as Record<string, unknown>;
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  if (after === null) return { day, after: null };
  if (!Array.isArray(after) || after.length !== 2) return null;
  const [main, second] = after as unknown[];
  const start = main === '' && second === '';
  if (!start && !(typeof main === 'string' && isAddressText(main) && typeof second === 'string' && isAddressText(second))) {
    return null;
  }
  return { day, after: [String(main), String(second)] };
}

/**
 * The daily stage still open: meta.daily_sweep of a day after the last one done (meta.daily_day) and not after today.
 * A sweep of a day already done is what its last full page left behind.
 */
function openSweep(meta: LoadedMeta, today: string): DailySweep | null {
  const sweep = meta.dailySweep;
  if (sweep === null || sweep.day > today) return null;
  return meta.dailyDay === null || sweep.day > meta.dailyDay ? sweep : null;
}

function parseCount(text: string | undefined): number {
  const value = text === undefined ? NaN : Number(text);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function parseJson(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** First occurrence of each (main key, second key) pair, in order, at most MONITOR_LIMITS.rescanQueueMax. */
function uniquePairs(pairs: readonly QueuedPair[]): QueuedPair[] {
  const seen = new Set<string>();
  const unique: QueuedPair[] = [];
  for (const pair of pairs) {
    const id = `${pair[0]}/${pair[1]}`;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(pair);
    if (unique.length === MONITOR_LIMITS.rescanQueueMax) break;
  }
  return unique;
}

function rowsOf<T = Record<string, unknown>>(result: D1Result | undefined): T[] {
  return (result?.results ?? []) as T[];
}

/** YYYY-MM-DD of `ms` in UTC. */
function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
