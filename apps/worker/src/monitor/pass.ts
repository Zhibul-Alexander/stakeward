import type { Address } from '@solana/kit';
import {
  decodeStakeAccount,
  GENESIS_HASH,
  isLockupInForce,
  newValidatorRisks,
  reminderDue,
  STAKE_PROGRAM_ADDRESS,
  SYSVAR_CLOCK_ADDRESS,
  validatorRisks,
  VALIDATOR_RISKS,
  VOTE_PROGRAM_ADDRESS,
  type ChainClock,
  type Cluster,
  type ValidatorRisk,
} from '@stakeward/core';
import { isAddressText } from '../address.ts';
import { decodeBase64 } from '../base64.ts';
import { kitSettlement, RESCUE_KIT_EVENTS, sendKit } from '../rescue-kits.ts';
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
 *              writes, the cursor and, when the chunk calls for a rescan, the queue with its pairs in front; accounts
 *              with an alarming event (rescue-kits.ts RESCUE_KIT_EVENTS) join meta.kit_queue in the same batch.
 * 3b. kits   - the ready rescue kits of meta.kit_queue whose auto mode the event matches are sent (D118, D120), at
 *              most MONITOR_LIMITS.maxKitSends a pass.
 * 4. daily   - on the first pass after 06:00 UTC: the reminders due (REMINDER_<d> events) are written, one page per
 *              pass; a full page keeps the stage open for the next pass, which goes on after it (meta.daily_sweep).
 * 4a. validators - once a day from 06:00 UTC (D128): the vote accounts of the validators watched accounts are
 *              delegated to, 99 a pass (meta.validator_sweep), one getMultipleAccounts with the Clock; a risk a validator
 *              did not have at the last check (core validatorRisks) is a VALIDATOR_AT_RISK event for each of its accounts.
 * 4b. bot    - every pass getWebhookInfo, once a day from 06:00 UTC getMe too (meta.bot_check_day): a webhook that is
 *              not SITE_ORIGIN's, recent updates it refused with 401, or a token of another bot than
 *              TELEGRAM_BOT_USERNAME is an admin alert.
 * 5. sends   - Telegram delivery (step 5 spec section 7): one message per chat, committed before the rescans.
 * 6. rescans - getProgramAccounts by (main key, second key) pair, urgent pairs first; locked accounts split off a
 *              watched one are watched from then on. A pass that read no chunk reads the Clock alone for them. Once
 *              a day from 06:00 UTC a round of every pair starts; its pairs join the back of the queue a page at a
 *              time while the queue is short (meta.pairs_sweep). Pairs the queue's cap cuts off the back send the
 *              round back for them (withUrgent).
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

export type Stage =
  | 'config'
  | 'load'
  | 'chunks'
  | 'kits'
  | 'daily'
  | 'validators'
  | 'bot'
  | 'sends'
  | 'rescans'
  | 'admin'
  | 'finish';

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
  /** Rescue kits this pass tried to send, and how many a node took or found stale (autoSendKits). */
  kitSends: number;
  kitsSent: number;
  kitsStale: number;
  reminders: number;
  daily: boolean;
  /** Validators the daily validator check read in this pass, and the VALIDATOR_AT_RISK events it wrote. */
  validators: number;
  validatorEvents: number;
  /** The bot check of this pass (null: not run, past the soft deadline or the budget). */
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
  /** meta.bot_check_day: the UTC day of the last getMe that got an answer (and its alert out). */
  botCheckDay: string | null;
  rescanQueue: QueuedPair[];
  /** meta.daily_sweep: the daily stage of `day`, open after a full page of reminders that ended at `after`. */
  dailySweep: DailySweep | null;
  /** meta.pairs_sweep: the daily search round. */
  pairsSweep: PairsSweep | null;
  readFailures: number;
  adminAlerts: Record<string, number>;
  alertsSent: number;
  /** meta.kit_queue: stake accounts with an alarming event whose rescue kit, if ready and in a mode that takes it, is
   * still to be sent. */
  kitQueue: KitQueued[];
  /** meta.validator_sweep: the daily validator check of `day`, done or up to `after`. */
  validatorSweep: ValidatorSweep | null;
};

/** The validator check of a day: the last validator read ('' = none yet), and whether the day's check is over. */
type ValidatorSweep = { day: string; after: string; done: boolean };

/**
 * A meta.kit_queue entry: the account and its trigger, 'staker' for a STAKER_CHANGED, 'any' for another alarming
 * event. The kit's auto mode (D120, KITS_READY_FOR) decides whether the trigger sends it.
 */
type KitQueued = { a: Address; t: 'staker' | 'any' };

/**
 * The daily stage a pass works on: the UTC day it started, and the last stake account
 * whose reminder it got through ('' = none yet).
 */
type DailySweep = { day: string; after: string };

/**
 * The daily search round (SECURITY-CHECK П25): started on `day`, its pairs queued up to and including `after`
 * (['', ''] = none yet; [main key, ''] = every pair before that main key), keyset by (main key, second key);
 * `after: null` once every pair was queued. A round that does not end within a day goes on: a new one starts only
 * after it ended, so every pair is reached however many pairs sort before it. A pair the queue's cap cuts off puts
 * `after` back before it, and opens a round that ended again (withUrgent).
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
  /** The daily part of the bot check (getMe) is due: from 06:00 UTC on a day not checked yet. */
  botCheckDue: boolean;
  /** getMe answered in this pass. */
  usernameChecked: boolean;
  /** The daily stage to work on when due: the open one from meta, else a new one for today. */
  sweep: DailySweep;
  /** The rescan queue: meta.rescan_queue, then the daily pairs; urgent pairs go in front before the rescans. */
  queue: QueuedPair[];
  /** meta.rescan_queue as this pass last wrote it (or loaded it): the finish writes the queue only when it differs. */
  storedQueue: string;
  /** The daily search round as this pass leaves it; the finish writes it with the queue. */
  pairs: PairsSweep | null;
  /** meta.pairs_sweep as this pass last wrote it (or loaded it), like storedQueue. */
  storedPairs: string;
  /** (main key, second key) pairs of this pass's events that call for a rescan. */
  urgent: Pair[];
  /** meta.kit_queue with this pass's alarming events; storedKitQueue is it as last written (or loaded). */
  kitQueue: KitQueued[];
  storedKitQueue: string;
  /** The cluster clock of the last chunk read in this pass, or of a read of the Clock alone; rescans need it. */
  lastRead: { clock: ChainClock; clockMs: number } | null;
  readFailed: boolean;
  telegramConfigFailed: boolean;
  adminDue: Set<AdminKind>;
  adminCounts: AdminCounts;
  dailyDone: boolean;
  /** The validator check to work on, when due (not done for today, from 06:00 UTC): from `after` on. */
  validatorsDue: boolean;
  validatorsAfter: string;
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
    await autoSendKits(pass);
    await daily(pass);
    await checkValidators(pass);
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
    usernameChecked: false,
    sweep: open ?? { day: today, after: '' },
    queue: [...meta.rescanQueue],
    storedQueue: JSON.stringify(meta.rescanQueue),
    pairs: meta.pairsSweep,
    storedPairs: JSON.stringify(meta.pairsSweep),
    urgent: [],
    kitQueue: [...meta.kitQueue],
    storedKitQueue: JSON.stringify(meta.kitQueue),
    lastRead: null,
    readFailed: false,
    telegramConfigFailed: false,
    adminDue: new Set<AdminKind>(report.previousDied ? ['pass-died'] : []),
    adminCounts: {},
    dailyDone: false,
    validatorsDue: afterDailyHour && !(meta.validatorSweep?.day === today && meta.validatorSweep.done),
    validatorsAfter: meta.validatorSweep?.day === today ? meta.validatorSweep.after : '',
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
      COST.chunk +
      COST.sendFloor +
      (pass.dailyDue ? COST.daily : 0) +
      COST.webhookCheck +
      (pass.botCheckDue ? COST.usernameCheck : 0);
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
        if (genesis === 'mismatch') {
          pass.adminDue.add('wrong-cluster');
          pass.adminCounts.rpc = config.rpcSecrets[endpoint];
        }
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
 * when this chunk calls for a rescan, the queue with the urgent pairs in front (withUrgent) and the round it may have
 * sent back. Once the events are in, the next pass sees no change and would not ask for that rescan again: a pass
 * that fails or is killed later must leave it queued.
 */
async function commitChunk(pass: LoadedPass, out: ChunkOutcome, cursor: string | null, nowMs: number): Promise<void> {
  const db = pass.deps.db;
  const statements: D1PreparedStatement[] = [];
  if (out.events.length > 0) statements.push(chunkEventsStatement(db, out.events, nowMs));
  if (out.updates.length > 0) statements.push(chunkUpdateStatement(db, out.updates));
  const entries: Record<string, string> = {};
  if (cursor !== null) entries.cursor = cursor;
  const stored = out.rescan.length > 0 ? queueEntries(pass, withUrgent(pass), entries) : null;
  // Like the rescan queue: once the events are in, no later pass would see this change again.
  const attacked = out.events
    .filter((e) => RESCUE_KIT_EVENTS.has(e.type))
    .map((e): KitQueued => ({ a: e.stakeAccount, t: e.type === 'STAKER_CHANGED' ? 'staker' : 'any' }));
  const kitQueue = uniqueKitQueue([...pass.kitQueue, ...attacked]);
  const storedKitQueue = JSON.stringify(kitQueue);
  if (storedKitQueue !== pass.storedKitQueue) entries.kit_queue = storedKitQueue;
  if (Object.keys(entries).length > 0) statements.push(putMetaStatement(db, entries, pass.passId));
  if (statements.length === 0) return;
  const results = await pass.budget.batch(db, statements);
  if (out.events.length > 0) pass.report.events += results[0]?.meta.changes ?? 0;
  if (stored !== null) Object.assign(pass, stored);
  Object.assign(pass, { kitQueue, storedKitQueue });
}

/**
 * Stage 3b (DECISIONS.md D118, D120): sends the ready rescue kits of the accounts in meta.kit_queue whose auto mode
 * takes the trigger. By default ('staker') only a changed staker sends: it is the thief's first move (it lets them
 * deactivate and delegate, and the owner's main key can no longer), while a DEACTIVATED may be the owner's own
 * unstake. The bound chat may choose 'any' (every alarming event) or 'off' (/kits). One KITS_READY_FOR, then at
 * most MONITOR_LIMITS.maxKitSends sends (one attempt each) while the budget keeps the daily stage, the bot check and
 * the delivery possible, then one batch: the outcomes (KIT_SETTLE) and the queue. An account leaves the queue when its
 * kit was sent, turned stale, was refused (it stays ready for the owner's own tap) or is not ready; a send without an
 * answer and the accounts past the cap stay for the next pass. One log line per send, no chat ids.
 */
async function autoSendKits(pass: LoadedPass): Promise<void> {
  const { budget, report, deps, config } = pass;
  if (pass.kitQueue.length === 0) return;
  const keep =
    COST.sendLoad +
    COST.sendCommit +
    1 +
    (pass.dailyDue ? COST.daily : 0) +
    COST.webhookCheck +
    (pass.botCheckDue ? COST.usernameCheck : 0);
  if (pass.pastDeadline() || budget.left() < COST.kitLoad + COST.kitSend + COST.kitCommit + keep) return;
  report.stage = 'kits';
  const db = deps.db;
  const [result] = await budget.batch(db, [db.prepare(SQL.KITS_READY_FOR).bind(JSON.stringify(pass.kitQueue))]);
  const kits = rowsOf<{ stake_account: Address; tx: string }>(result);
  // Accounts without a ready kit, or whose kit's mode does not take the trigger, leave the queue.
  const ready = new Set<string>(kits.map((kit) => kit.stake_account));
  let queue = pass.kitQueue.filter((entry) => ready.has(entry.a));
  const settled: ReturnType<typeof kitSettlement>[] = [];
  for (const kit of kits) {
    if (report.kitSends >= MONITOR_LIMITS.maxKitSends) break;
    if (pass.pastDeadline() || budget.left() < COST.kitSend + COST.kitCommit + keep) break;
    report.kitSends += 1;
    const outcome = await sendKit(kit.tx, { endpoints: config.rpc, options: pass.upstream });
    const signature = outcome.kind === 'sent' ? outcome.signature : null;
    deps.log({ msg: 'rescue kit auto-send', stakeAccount: kit.stake_account, outcome: outcome.kind, signature });
    if (outcome.kind === 'sent' || outcome.kind === 'stale') {
      settled.push(kitSettlement(kit.stake_account, kit.tx, outcome, deps.now()));
      if (outcome.kind === 'sent') report.kitsSent += 1;
      else report.kitsStale += 1;
    }
    if (outcome.kind !== 'upstream') queue = queue.filter((entry) => entry.a !== kit.stake_account);
  }
  const statements: D1PreparedStatement[] = [];
  if (settled.length > 0) statements.push(db.prepare(SQL.KIT_SETTLE).bind(JSON.stringify(settled)));
  const storedKitQueue = JSON.stringify(queue);
  if (storedKitQueue !== pass.storedKitQueue) {
    statements.push(putMetaStatement(db, { kit_queue: storedKitQueue }, pass.passId));
  }
  if (statements.length > 0) await budget.batch(db, statements);
  pass.kitQueue = queue;
  pass.storedKitQueue = storedKitQueue;
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
  let stored: Stored | null = null;
  if (last !== undefined) {
    const entries: Record<string, string> = { daily_sweep: JSON.stringify({ day: sweep.day, after: last.stake_account }) };
    // As commitChunk: the urgent pairs of this pass stay in front, in case it dies before the rescans.
    stored = queueEntries(pass, withUrgent(pass), entries);
    statements.push(putMetaStatement(db, entries, pass.passId));
  }
  if (statements.length > 0) {
    const [inserted] = await budget.batch(db, statements);
    if (events.length > 0) report.reminders += inserted?.meta.changes ?? 0;
  }
  if (stored !== null) Object.assign(pass, stored);
  pass.dailyDone = last === undefined;
  report.daily = true;
}

/**
 * Stage 4a, once a day from 06:00 UTC (DECISIONS.md D128): will the watched stake keep earning? One page of the
 * validators that delegated, not deactivating, watched accounts point at (VALIDATOR_PAGE, with the risks found last
 * time), their vote accounts in one getMultipleAccounts with the Clock, and one batch: a VALIDATOR_AT_RISK event per
 * account of each validator with a risk it did not have last time (risks that went away are just forgotten, so a
 * relapse alerts again), every validator's risks now, and meta.validator_sweep. A full page leaves the day open from
 * its last validator; the next pass goes on. A vote account that reads as gone counts as closed only once the node
 * proved its cluster, as in the chunks. A failed read leaves the check for a later pass; it is not a failed pass
 * (the stake accounts were read).
 */
async function checkValidators(pass: LoadedPass): Promise<void> {
  const { budget, report, deps, config } = pass;
  const keep =
    COST.sendLoad + COST.sendCommit + 1 + COST.webhookCheck + (pass.botCheckDue ? COST.usernameCheck : 0);
  if (!pass.validatorsDue || pass.pastDeadline() || budget.left() < COST.validators + keep) return;
  report.stage = 'validators';
  const db = deps.db;
  const pageSize = MONITOR_LIMITS.accountsPerChunk;
  const [page] = await budget.batch(db, [db.prepare(SQL.VALIDATOR_PAGE).bind(pass.validatorsAfter, pageSize)]);
  const rows = rowsOf<{ voter: Address; risks: string | null }>(page);
  const day = utcDay(pass.t0);
  const statements: D1PreparedStatement[] = [];
  if (rows.length > 0) {
    const result = await readChunk([SYSVAR_CLOCK_ADDRESS, ...rows.map((row) => row.voter)], {
      endpoints: config.rpc,
      options: pass.upstream,
    });
    if (!result.ok) return;
    const { read, endpoint } = result;
    const gone = read.items.some((item) => item === null || item.owner !== VOTE_PROGRAM_ADDRESS);
    if (gone && (await checkGenesis(pass, endpoint)) !== 'ok') return;
    const events: { v: Address; d: string }[] = [];
    const stored: { v: Address; r: string }[] = [];
    rows.forEach((row, i) => {
      const item = read.items[i] ?? null;
      const data = item === null ? null : decodeBase64(item.dataBase64);
      // Bytes the node sent that are not base64: no verdict on this validator today.
      if (item !== null && data === null) return;
      const account = item === null || data === null ? null : { owner: item.owner, data, lamports: item.lamports };
      const risks = validatorRisks({ account, epoch: read.clock.epoch });
      if (newValidatorRisks(parseRisks(row.risks), risks).length > 0) {
        events.push({ v: row.voter, d: JSON.stringify({ voter: row.voter, risks }) });
      }
      stored.push({ v: row.voter, r: JSON.stringify(risks) });
    });
    report.validators = rows.length;
    if (events.length > 0) statements.push(db.prepare(SQL.VALIDATOR_EVENTS).bind(JSON.stringify(events), read.slot, deps.now()));
    statements.push(db.prepare(SQL.VALIDATORS_PUT).bind(JSON.stringify(stored), deps.now()));
  }
  const full = rows.length >= pageSize;
  const sweep: ValidatorSweep = { day, after: full ? (rows.at(-1)?.voter ?? '') : '', done: !full };
  statements.push(putMetaStatement(db, { validator_sweep: JSON.stringify(sweep) }, pass.passId));
  const results = await budget.batch(db, statements);
  if (statements.length === 3) report.validatorEvents = results[0]?.meta.changes ?? 0;
}

/**
 * Stage 4b, every pass (SECURITY-CHECK П17): whoever holds the bot token can point the webhook at their own server and
 * answer users with phishing links, while sendMessage keeps working for this worker. A check at a known hour only
 * would be dodged by putting our URL back around it, so getWebhookInfo runs on every pass (COST.webhookCheck); getMe
 * once a day from 06:00 UTC (COST.usernameCheck). A `bot-mismatch` admin alert (at most one an hour) when:
 * - the webhook URL is not SITE_ORIGIN + TELEGRAM_WEBHOOK_PATH (none set included);
 * - Telegram's last delivery error is a 401 within MONITOR_LIMITS.webhookErrorWindowMs: our URL set back by someone
 *   without our secret_token (a thief who borrows the webhook between passes), or a rotation that changed one side
 *   only; this worker refuses every update then;
 * - the username is not TELEGRAM_BOT_USERNAME (case aside).
 * A token Telegram refuses fails the pass like a refused sendMessage. The finish records the day of getMe once it
 * answered and, for a mismatch, the alert went out (within the hour): until then every pass asks again. Only the
 * outcome is logged.
 */
async function checkBot(pass: LoadedPass): Promise<void> {
  const { config, budget, report, deps } = pass;
  const needed = COST.webhookCheck + (pass.botCheckDue ? COST.usernameCheck : 0);
  if (pass.pastDeadline() || budget.left() < needed) return;
  report.stage = 'bot';
  const identity = await getBotIdentity({
    token: config.telegramToken,
    fetch: budget.fetch,
    timeoutMs: deps.telegramTimeoutMs,
    withUsername: pass.botCheckDue,
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
  const { lastError } = identity;
  if (
    lastError !== null &&
    lastError.date * 1000 > deps.now() - MONITOR_LIMITS.webhookErrorWindowMs &&
    /\b401\b/.test(lastError.message)
  ) {
    found.push('refused');
  }
  const username = botUsernameOf(deps.env);
  pass.usernameChecked = identity.username !== null;
  if (identity.username !== null && username !== null && identity.username.toLowerCase() !== username.toLowerCase()) {
    found.push('username');
  }
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
  pass.queue = withUrgent(pass);
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
 * The urgent pairs of this pass in front of the queue, as uniquePairs keeps them: at most MONITOR_LIMITS.rescanQueueMax.
 * Urgent pairs pile up over passes when more come in than are searched (or while searches fail), so the cap can cut
 * pairs off the back: daily pairs the round's cursor already passed, urgent pairs of earlier passes. Every such pair
 * sends the round back for it (roundBefore): the round queues it again once the queue is short, so no pair is lost
 * while a watched lock has it (DAILY_PAIRS keeps closed rows). Called again later in the pass, with more urgent pairs,
 * it cuts the same pairs and maybe more; the round goes back to the lowest pair cut (by address), never further.
 */
function withUrgent(pass: LoadedPass): QueuedPair[] {
  const all = [...pass.urgent, ...pass.queue];
  const kept = uniquePairs(all);
  if (kept.length < MONITOR_LIMITS.rescanQueueMax) return kept;
  const keptIds = new Set(kept.map(pairId));
  for (const pair of all) {
    if (!keptIds.has(pairId(pair))) pass.pairs = roundBefore(pass.pairs, pair);
  }
  return kept;
}

/**
 * The round with its cursor before `pair`: [main key, ''], every pair of that main key (DAILY_PAIRS takes the pairs
 * after the cursor), unless the cursor is there already. A round that ended opens again. No round yet: the first one,
 * from 06:00 UTC, reaches every pair anyway.
 */
function roundBefore(round: PairsSweep | null, pair: QueuedPair): PairsSweep | null {
  if (round === null) return null;
  const before: [string, string] = [pair[0], ''];
  if (round.after !== null && comparePairs(round.after, before) <= 0) return round;
  return { day: round.day, after: before };
}

/** Text order of (main key, second key), as SQLite compares the TEXT columns of DAILY_PAIRS (base58 is ASCII). */
function comparePairs(a: readonly [string, string], b: readonly [string, string]): number {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  return a[1] === b[1] ? 0 : a[1] < b[1] ? -1 : 1;
}

/** What a meta write stored, for the pass to remember (storedQueue, storedPairs). */
type Stored = { storedQueue: string; storedPairs: string };

/**
 * Adds to `entries` the queue and the round where they differ from what this pass stored last; returns what is
 * stored once the write went through. The round is written with the queue it goes with: a queue without the pairs it
 * cut must never be stored with a round that does not go back for them.
 */
function queueEntries(pass: LoadedPass, queue: readonly QueuedPair[], entries: Record<string, string>): Stored {
  const storedQueue = JSON.stringify(queue);
  if (storedQueue !== pass.storedQueue) entries.rescan_queue = storedQueue;
  const storedPairs = JSON.stringify(pass.pairs);
  if (pass.pairs !== null && storedPairs !== pass.storedPairs) entries.pairs_sweep = storedPairs;
  return { storedQueue, storedPairs };
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
  // getMe answered; another bot counts once its alert went out (the kind is not allowed again within the hour).
  const botChecked =
    pass.usernameChecked &&
    (!(pass.adminCounts.bot ?? []).includes('username') || !adminAllowed('bot-mismatch', pass.adminSent, deps.now()));
  if (botChecked) entries.bot_check_day = utcDay(pass.t0);
  const pairs = pass.pairs === null ? null : JSON.stringify(pass.pairs);
  if (pairs !== null && pairs !== pass.storedPairs) entries.pairs_sweep = pairs;
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
    kitSends: 0,
    kitsSent: 0,
    kitsStale: 0,
    reminders: 0,
    daily: false,
    validators: 0,
    validatorEvents: 0,
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
    kitQueue: parseKitQueue(values.get('kit_queue')),
    validatorSweep: parseValidatorSweep(values.get('validator_sweep')),
  };
}

/** meta.validator_sweep: {"day": "YYYY-MM-DD", "after": "" or an address, "done": boolean}; anything else is null. */
function parseValidatorSweep(text: string | undefined): ValidatorSweep | null {
  const json = parseJson(text);
  if (typeof json !== 'object' || json === null) return null;
  const { day, after, done } = json as Record<string, unknown>;
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || typeof done !== 'boolean') return null;
  if (typeof after !== 'string' || (after !== '' && !isAddressText(after))) return null;
  return { day, after, done };
}

/** validators.risks as stored: the known risks of a JSON array; anything else counts as none. */
function parseRisks(text: string | null): ValidatorRisk[] {
  const json = parseJson(text ?? undefined);
  if (!Array.isArray(json)) return [];
  return VALIDATOR_RISKS.filter((risk) => (json as unknown[]).includes(risk));
}

/**
 * meta.kit_queue: an array of {a: address, t: 'staker' | 'any'} (uniqueKitQueue); a bare address, as D118 stored
 * them, is a 'staker' entry. Anything else is dropped.
 */
function parseKitQueue(text: string | undefined): KitQueued[] {
  const json = parseJson(text);
  if (!Array.isArray(json)) return [];
  const entries: KitQueued[] = [];
  for (const value of json as unknown[]) {
    if (typeof value === 'string') {
      if (isAddressText(value)) entries.push({ a: value, t: 'staker' });
      continue;
    }
    if (typeof value !== 'object' || value === null) continue;
    const { a, t } = value as Record<string, unknown>;
    if (typeof a === 'string' && isAddressText(a) && (t === 'staker' || t === 'any')) entries.push({ a, t });
  }
  return uniqueKitQueue(entries);
}

/**
 * One entry per account, where it first appears, at most MONITOR_LIMITS.kitQueueMax (the oldest stay). 'staker' wins
 * over 'any': it sends in every mode 'any' sends in, and in 'staker' too.
 */
function uniqueKitQueue(entries: readonly KitQueued[]): KitQueued[] {
  const byAccount = new Map<Address, KitQueued>();
  for (const entry of entries) {
    const seen = byAccount.get(entry.a);
    if (seen === undefined) byAccount.set(entry.a, { ...entry });
    else if (entry.t === 'staker') seen.t = 'staker';
  }
  return [...byAccount.values()].slice(0, MONITOR_LIMITS.kitQueueMax);
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

/**
 * meta.pairs_sweep: {"day": "YYYY-MM-DD", "after": null, ['', ''] (none yet), [main key, ''] (before that main key)
 * or [main key, second key]}; anything else is null.
 */
function parsePairsSweep(text: string | undefined): PairsSweep | null {
  const json = parseJson(text);
  if (typeof json !== 'object' || json === null) return null;
  const { day, after } = json as Record<string, unknown>;
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  if (after === null) return { day, after: null };
  if (!Array.isArray(after) || after.length !== 2) return null;
  const [main, second] = after as unknown[];
  if (typeof main !== 'string' || typeof second !== 'string') return null;
  const start = main === '' && second === '';
  if (!start && !(isAddressText(main) && (second === '' || isAddressText(second)))) return null;
  return { day, after: [main, second] };
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

/** The identity of a queued search: its (main key, second key) pair. */
function pairId(pair: QueuedPair): string {
  return `${pair[0]}/${pair[1]}`;
}

/** First occurrence of each (main key, second key) pair, in order, at most MONITOR_LIMITS.rescanQueueMax. */
function uniquePairs(pairs: readonly QueuedPair[]): QueuedPair[] {
  const seen = new Set<string>();
  const unique: QueuedPair[] = [];
  for (const pair of pairs) {
    const id = pairId(pair);
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
