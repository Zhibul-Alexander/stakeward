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
import { sendTelegramMessage, type TelegramOutcome } from '../telegram/api.ts';
import { callUpstream, DEFAULT_UPSTREAM_OPTIONS, type UpstreamOptions } from '../upstream.ts';
import {
  adminAllowed,
  adminKindToSend,
  adminText,
  parseAdminAlerts,
  safeErrorName,
  type AdminCounts,
  type AdminKind,
} from './admin.ts';
import { COST, PassBudget } from './budget.ts';
import { classifyChunk, type ChunkOutcome, type Pair, type StoredEvent } from './classify.ts';
import { adminChannelOf, clusterOf, MONITOR_LIMITS, MONITOR_PLANS, monitorConfig, type MonitorConfig } from './config.ts';
import {
  linkOf,
  pendingEventOf,
  planDeliveries,
  recipientsOf,
  settleDeliveries,
  type SendResult,
} from './deliver.ts';
import { GENESIS_REQUEST, massNull, parseGenesisHash, readChunk } from './read.ts';
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
 * 3. chunks  - per chunk of 99 rows: one getMultipleAccounts with the Clock sysvar first, the genesis check when most
 *              accounts read as gone, classifyChunk, and one batch with the events, the row writes and the cursor.
 * 4. daily   - on the first pass after 06:00 UTC: every (main key, second key) pair joins the rescan queue, and the
 *              reminders due (REMINDER_<d> events) are written.
 * 5. sends   - Telegram delivery (step 5 spec section 7): one message per chat, committed before the rescans.
 * 6. rescans - getProgramAccounts by (main key, second key) pair, urgent pairs first; locked accounts split off a
 *              watched one are watched from then on.
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

export type Stage = 'config' | 'load' | 'chunks' | 'daily' | 'sends' | 'rescans' | 'admin' | 'finish';

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

/** The meta values a pass reads (step 5 spec section 2.3), parsed; anything malformed reads as its default. */
type LoadedMeta = {
  lease: Lease | null;
  cursor: string;
  dailyDay: string | null;
  rescanQueue: Pair[];
  readFailures: number;
  adminAlerts: Record<string, number>;
  alertsSent: number;
};

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
  /** The rescan queue: meta.rescan_queue, then the daily pairs; urgent pairs go in front before the rescans. */
  queue: Pair[];
  /** (main key, second key) pairs of this pass's events that call for a rescan. */
  urgent: Pair[];
  /** The cluster clock of the last chunk read in this pass; rescans need it. */
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

  // The same object, grown: the exception path keeps seeing what the phases change.
  return Object.assign(ctx, {
    config,
    budget,
    meta,
    page: rows,
    upstream: { timeoutMs: deps.upstream.timeoutMs, retryDelayMs: deps.upstream.retryDelayMs, fetch: budget.fetch },
    pastDeadline: () => deps.now() - t0 > MONITOR_LIMITS.softDeadlineMs,
    dailyDue: new Date(t0).getUTCHours() >= MONITOR_LIMITS.dailyHourUtc && meta.dailyDay !== utcDay(t0),
    queue: [...meta.rescanQueue],
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
  let genesisChecked = false;

  if (rows.length === 0) {
    pass.resetCursor = cursor !== '';
    return;
  }
  for (let start = 0; start < rows.length; start += perChunk) {
    const needed = COST.chunk + COST.sendFloor + (pass.dailyDue ? COST.daily : 0);
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
    const { read } = result;
    if (!genesisChecked && massNull(read.items)) {
      // Most accounts read as gone: a wrong RPC_URL looks exactly like this. Prove the cluster before closing rows.
      const genesis = await checkGenesis(pass);
      if (genesis !== 'ok') {
        report.chunksFailed += 1;
        pass.readFailed = true;
        if (genesis === 'mismatch') pass.adminDue.add('wrong-cluster');
        return;
      }
      genesisChecked = true;
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
    await commitChunk(pass, out, cursorAfter === cursor ? null : cursorAfter, deps.now());
    cursor = cursorAfter;
    pass.urgent.push(...out.rescan);
    pass.lastRead = { clock: read.clock, clockMs: read.clockMs };
    if (out.processed < chunk.length) {
      report.deferred = true;
      return;
    }
  }
}

/** getGenesisHash against the configured cluster: 'failed' when it cannot be read. */
async function checkGenesis(pass: LoadedPass): Promise<'ok' | 'mismatch' | 'failed'> {
  const result = await callUpstream(pass.config.rpc, GENESIS_REQUEST, 'read', pass.upstream);
  const hash = result.ok ? parseGenesisHash(result.body) : null;
  if (hash === null) return 'failed';
  return hash === GENESIS_HASH[pass.config.cluster] ? 'ok' : 'mismatch';
}

/** One batch: the events (gated on the row versions), then the row writes (compare-and-set), then the cursor. */
async function commitChunk(pass: LoadedPass, out: ChunkOutcome, cursor: string | null, nowMs: number): Promise<void> {
  const db = pass.deps.db;
  const statements: D1PreparedStatement[] = [];
  if (out.events.length > 0) statements.push(chunkEventsStatement(db, out.events, nowMs));
  if (out.updates.length > 0) statements.push(chunkUpdateStatement(db, out.updates));
  if (cursor !== null) statements.push(putMetaStatement(db, { cursor }, pass.passId));
  if (statements.length === 0) return;
  const results = await pass.budget.batch(db, statements);
  if (out.events.length > 0) pass.report.events += results[0]?.meta.changes ?? 0;
}

/**
 * Stage 4, once a day on the first pass after 06:00 UTC (worker clock): every (main key, second key) pair of a lock
 * not ended joins the back of the rescan queue, and each lock ending within 30 days gets the reminder now due
 * (core reminderDue), as a REMINDER_<d> event gated on the row version, with last_reminder_days in the same batch.
 * The day is recorded by the finish: a pass that dies here repeats it, and the recorded threshold keeps the
 * reminders from repeating.
 */
async function daily(pass: LoadedPass): Promise<void> {
  const { deps, budget, report, t0 } = pass;
  if (!pass.dailyDue || budget.left() < COST.daily) return;
  report.stage = 'daily';
  const db = deps.db;
  const nowSec = Math.floor(t0 / 1000);
  const [pairsResult, remindersResult] = await budget.batch(db, [
    db.prepare(SQL.DAILY_PAIRS).bind(nowSec),
    db.prepare(SQL.DAILY_REMINDER_ROWS).bind(nowSec),
  ]);
  const pairs = rowsOf<{ withdrawer: Address; custodian: Address }>(pairsResult).map(
    (p): Pair => [p.withdrawer, p.custodian],
  );
  pass.queue = uniquePairs([...pass.queue, ...pairs]);

  type ReminderRow = { stake_account: Address; lock_until: string; last_reminder_days: number | null; slot: number; checked_at: number };
  const events: StoredEvent[] = [];
  const days: { stakeAccount: Address; days: number; prevSlot: number; prevCheckedAt: number }[] = [];
  for (const row of rowsOf<ReminderRow>(remindersResult)) {
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
  if (events.length > 0) {
    const [inserted] = await budget.batch(db, [
      chunkEventsStatement(db, events, deps.now()),
      reminderDaysStatement(db, days),
    ]);
    report.reminders += inserted?.meta.changes ?? 0;
  }
  pass.dailyDone = true;
  report.daily = true;
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
 * Split copies both keys and the lock, so the pair finds every account split off a watched one (D52). Runs only after
 * a chunk read in this pass (the cluster clock judges the locks). A failed call keeps its pair at the head and stops
 * the search; an answer over the plan's size limit drops its pair (admin alert). Unknown accounts (closed rows too)
 * are decoded within the decode cap and watched when the pair matches and the lock is in force: a first sighting,
 * no events, a live row never touched, a closed one revived (INSERT_WATCHED). A pair whose accounts did not all fit
 * the decode cap goes to the back of the queue: the next search skips the ones now known.
 */
async function rescans(pass: LoadedPass): Promise<void> {
  const { config, budget, report, deps } = pass;
  pass.queue = uniquePairs([...pass.urgent, ...pass.queue]);
  pass.urgent = [];
  const lastRead = pass.lastRead;
  if (lastRead === null) return;
  report.stage = 'rescans';

  const found: { pair: Pair; slot: number; items: ProgramAccountItem[] }[] = [];
  // Each call keeps room for itself (3 attempts) and the two statements after the loop.
  while (
    pass.queue.length > 0 &&
    report.rescans < config.plan.maxRescans &&
    !pass.pastDeadline() &&
    budget.left() >= COST.rescanCall + COST.rescanPost
  ) {
    const pair = pass.queue[0];
    if (pair === undefined) break;
    report.rescans += 1;
    const result = await callUpstream(
      config.rpc,
      JSON.stringify(pairAccountsRequest(pair[0], pair[1])),
      'read',
      pass.upstream,
    );
    if (!result.ok) break;
    if (result.body.length > config.plan.rescanMaxBodyChars) {
      pass.queue.shift();
      report.rescansDropped += 1;
      pass.adminDue.add('rescan-dropped');
      pass.adminCounts.kb = Math.round(config.plan.rescanMaxBodyChars / 1000);
      continue;
    }
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
    const [mainKey, secondKey] = pair;
    for (const item of items) {
      if (seen.has(item.pubkey)) continue;
      if (decodeLeft <= 0) {
        pass.queue = uniquePairs([...pass.queue, pair]);
        break;
      }
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
  if (queue !== JSON.stringify(meta.rescanQueue)) entries.rescan_queue = queue;
  const readFailures = pass.readFailed ? meta.readFailures + 1 : 0;
  if (readFailures !== meta.readFailures) entries.read_failures = String(readFailures);
  if (pass.adminChanged) entries.admin_alerts = JSON.stringify(pass.adminSent);
  if (pass.dailyDone) entries.daily_day = utcDay(pass.t0);
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
    rescanQueue: parseQueue(values.get('rescan_queue')),
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

/** meta.rescan_queue: pairs of addresses, deduplicated, at most 1000; anything else is dropped. */
function parseQueue(text: string | undefined): Pair[] {
  const json = parseJson(text);
  if (!Array.isArray(json)) return [];
  const pairs: Pair[] = [];
  for (const entry of json as unknown[]) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [mainKey, secondKey] = entry as unknown[];
    if (typeof mainKey === 'string' && typeof secondKey === 'string' && isAddressText(mainKey) && isAddressText(secondKey)) {
      pairs.push([mainKey, secondKey]);
    }
  }
  return uniquePairs(pairs);
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

/** First occurrence of each pair, in order, at most MONITOR_LIMITS.rescanQueueMax. */
function uniquePairs(pairs: readonly Pair[]): Pair[] {
  const seen = new Set<string>();
  const unique: Pair[] = [];
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
