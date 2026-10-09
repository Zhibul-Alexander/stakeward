import { getAddressDecoder, type Address, type Blockhash, type Nonce } from '@solana/kit';
import {
  buildTransaction,
  decodeStakeAccount,
  encodeStakeAccountData,
  inspectAndVerifyTransaction,
  isLockupInForce,
  STAKE_PROGRAM_ADDRESS,
  stakeAccountsToJson,
  stakeDataFingerprint,
  SYSVAR_PROGRAM_ADDRESS,
  U64_MAX,
  type Lifetime,
  type StakeAccountData,
  type TransactionAction,
} from '@stakeward/core';
import { decodeBase64, encodeBase64 } from './base64.ts';
import { classifyChunk } from './monitor/classify.ts';
import { linkOf, pendingEventOf, planDeliveries, settleDeliveries } from './monitor/deliver.ts';
import { parseMultipleAccounts } from './monitor/read.ts';
import { watchRowOf, type AccountRow, type PendingRow } from './monitor/store.ts';
import { jsonRpcRequest, METHOD_PARAMS, type AllowedMethod } from './rpc-params.ts';
import { parseProgramAccountItems, parseProgramAccounts, stakeAccountsQuery } from './stake-accounts.ts';
import { judgeAccounts, watchBody } from './watch.ts';

/**
 * Warm-up at isolate start (DECISIONS.md D41, D63: the Workers Free plan allows 10 ms of CPU per invocation).
 * Measured on Cloudflare (dev, 05.10.2026): what a module does while it loads is not counted in the CPU time of the
 * isolate's first invocation, but the first runs of the decoders inside a handler are (lazy compilation, the
 * interpreter, empty inline caches). So the entry module runs the pure parts of the monitor pass, /api/rpc,
 * /api/stake-accounts and /api/watch here, on synthetic accounts, and the handlers start compiled. CPU of the first
 * call in a fresh isolate, ms, without -> with this warm-up: the pure part of a pass with 20 changed accounts 9-25 ->
 * 2-6, inspector 5-17 -> 2-4, a whole sendTransaction 9-34 -> 3-12. The isolate starts 50 ms later (23 -> 73 ms):
 * latency of its first request only, far below the 1 s startup limit. Five rounds bought nothing and took 171 ms.
 *
 * Pure: no I/O, timers, randomness or clock, and no state of its own; it calls the functions the handlers call, with
 * values made up here, and drops the results. Unsigned transactions keep the inspector away from Web Crypto: missing
 * signatures are not verified. The report counts what each path did, so a test sees when a code change stops the
 * synthetic data from reaching a path (test/warm-up.test.ts).
 */

/** Rounds of the synchronous paths. The inspector runs once per synthetic transaction. */
export const WARM_UP_ROUNDS = 2;
/** Accounts per synthetic read: more than the Free plan's decode cap per pass, so every decode path is warm. */
export const WARM_UP_ACCOUNTS = 20;

/** What one call of `warmUp` did, per path: every round must do the same, or the synthetic data missed something. */
export type WarmUpReport = {
  rounds: number;
  /** Monitor chunk: accounts decoded, events found, rescan pairs (classifyChunk). */
  decoded: number;
  events: number;
  rescanPairs: number;
  /** Delivery: messages planned and events settled (planDeliveries, settleDeliveries). */
  messages: number;
  settled: number;
  /** Monitor rescan: rows to watch from a getProgramAccounts answer (parseProgramAccountItems + decode). */
  rescanRows: number;
  /** GET /api/stake-accounts: accounts in the answer (parseProgramAccounts). */
  lookedUp: number;
  /** POST /api/watch: accounts accepted (judgeAccounts). */
  judged: number;
  /** Request schemas that accepted their value (zod). */
  schemas: number;
  /** Settles when the inspector is done: transactions it accepted, every signature missing (as built). */
  inspected: Promise<number>;
};

/** Runs every synchronous path WARM_UP_ROUNDS times, then starts the inspector. Throws only on a bug. */
export function warmUp(): WarmUpReport {
  const data = syntheticData();
  const report: WarmUpReport = {
    rounds: WARM_UP_ROUNDS,
    decoded: 0,
    events: 0,
    rescanPairs: 0,
    messages: 0,
    settled: 0,
    rescanRows: 0,
    lookedUp: 0,
    judged: 0,
    schemas: 0,
    inspected: Promise.resolve(0),
  };
  for (let round = 0; round < WARM_UP_ROUNDS; round++) {
    monitorRound(data, report);
    apiRound(data, report);
  }
  report.inspected = inspectAll(data.transactions);
  return report;
}

/**
 * Runs `run` (warmUp) at module load and never throws: a failed warm-up only means a colder first invocation, so it is
 * logged (the error name, never the message) and the worker loads anyway. Settles once the inspector is done.
 */
export function startWarmUp(
  run: () => Pick<WarmUpReport, 'inspected'> = warmUp,
  log: (line: Record<string, unknown>) => void = (line) => {
    console.warn(JSON.stringify(line));
  },
): Promise<void> {
  const failed = (stage: string) => (error: unknown) => {
    log({ msg: 'warm-up failed', stage, error: error instanceof Error ? error.name : 'unknown' });
  };
  try {
    return run().inspected.then(() => undefined, failed('inspector'));
  } catch (error) {
    failed('paths')(error);
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The synthetic accounts: one (main key, second key) pair, WARM_UP_ACCOUNTS delegated stake accounts locked for 180
// days, read again after a Deactivate (one event each).

const DAY = 86_400n;
/** 2026-10-05T12:00:00Z, the cluster clock of every synthetic read. */
const CLOCK_SECONDS = 1_791_201_600n;
const CLOCK_MS = Number(CLOCK_SECONDS) * 1000;
const READ_SLOT = 5_300;
const ROW_SLOT = 5_000;
const EPOCH = 950n;
const LAMPORTS = 10_000_000_000n;

type SyntheticData = {
  main: Address;
  second: Address;
  lockUntil: bigint;
  accounts: Address[];
  rows: AccountRow[];
  /** getMultipleAccounts answer for [Clock, ...accounts] after the Deactivate. */
  multipleAccounts: string;
  /** getProgramAccounts answer (withContext) with the same accounts. */
  programAccounts: string;
  rpcRequests: { method: AllowedMethod; params: unknown[] }[];
  transactions: Uint8Array[];
};

function syntheticData(): SyntheticData {
  const keys = getAddressDecoder();
  const key = (n: number): Address => keys.decode(new Uint8Array(32).fill(n));
  const main = key(1);
  const second = key(2);
  const voter = key(3);
  const newWallet = key(4);
  const stakeAccount = key(10);
  const accounts = Array.from({ length: WARM_UP_ACCOUNTS }, (_, i) => key(10 + i));
  const lockUntil = CLOCK_SECONDS + 180n * DAY;

  const stored: StakeAccountData = {
    rentExemptReserve: 2_282_880n,
    staker: main,
    withdrawer: main,
    lockup: { unixTimestamp: lockUntil, epoch: 0n, custodian: second },
    delegation: { voter, stake: LAMPORTS - 2_282_880n, activationEpoch: 800n, deactivationEpoch: U64_MAX },
  };
  const deactivated: StakeAccountData = {
    ...stored,
    delegation: { voter, stake: LAMPORTS - 2_282_880n, activationEpoch: 800n, deactivationEpoch: EPOCH + 1n },
  };
  const storedBase64 = encodeBase64(encodeStakeAccountData(stored));
  const deactivatedBase64 = encodeBase64(encodeStakeAccountData(deactivated));

  const rows: AccountRow[] = accounts.map((account) => ({
    stake_account: account,
    withdrawer: main,
    staker: main,
    custodian: second,
    lock_until: lockUntil.toString(),
    lamports: LAMPORTS.toString(),
    state: 'delegated',
    voter,
    activation_epoch: '800',
    deactivation_epoch: U64_MAX.toString(),
    slot: ROW_SLOT,
    checked_at: CLOCK_MS - 120_000,
    last_reminder_days: null,
    fingerprint: stakeDataFingerprint(storedBase64),
  }));

  const clock = new Uint8Array(40);
  const view = new DataView(clock.buffer);
  view.setBigUint64(0, BigInt(READ_SLOT), true);
  view.setBigInt64(8, CLOCK_SECONDS - DAY, true);
  view.setBigUint64(16, EPOCH, true);
  view.setBigUint64(24, EPOCH + 1n, true);
  view.setBigInt64(32, CLOCK_SECONDS, true);
  const item = (dataBase64: string, owner: Address, lamports: bigint) => ({
    data: [dataBase64, 'base64'],
    executable: false,
    lamports: Number(lamports),
    owner,
    rentEpoch: 0,
    space: 200,
  });
  const context = { apiVersion: '3.0.6', slot: READ_SLOT };
  const multipleAccounts = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: {
      context,
      value: [
        { ...item(encodeBase64(clock), SYSVAR_PROGRAM_ADDRESS, 1_169_280n), space: 40 },
        ...accounts.map(() => item(deactivatedBase64, STAKE_PROGRAM_ADDRESS, LAMPORTS)),
      ],
    },
  });
  const programAccounts = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    result: {
      context,
      value: accounts.map((pubkey) => ({ pubkey, account: item(deactivatedBase64, STAKE_PROGRAM_ADDRESS, LAMPORTS) })),
    },
  });

  // Unsigned, as core builds them for the wallets: a protect and a withdraw on a blockhash, a rescue on a nonce.
  const build = (action: TransactionAction, feePayer: Address, lifetime: Lifetime) =>
    buildTransaction(action, { feePayer, lifetime }).bytes;
  const hash = key(5) as string;
  const blockhash: Lifetime = { kind: 'blockhash', blockhash: hash as Blockhash, lastValidBlockHeight: 1_000n };
  const nonce: Lifetime = { kind: 'nonce', nonceAccount: key(6), nonceAuthority: newWallet, nonceValue: hash as Nonce };
  const roles = { stakeAccount, mainKey: main, secondKey: second };
  const rescue = build({ kind: 'rescue', ...roles, newWallet }, newWallet, nonce);
  const transactions = [
    build({ kind: 'protect', ...roles, lockUntil }, main, blockhash),
    build({ kind: 'withdraw', ...roles, recipient: main, lamports: LAMPORTS }, main, blockhash),
    rescue,
  ];

  const transaction = encodeBase64(rescue);
  const simulateConfig = { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true };
  const rpcRequests: SyntheticData['rpcRequests'] = [
    { method: 'sendTransaction', params: [transaction, { encoding: 'base64' }] },
    { method: 'simulateTransaction', params: [transaction, simulateConfig] },
    { method: 'getLatestBlockhash', params: [{ commitment: 'confirmed' }] },
    { method: 'getEpochInfo', params: [{ commitment: 'confirmed' }] },
    { method: 'getAccountInfo', params: [stakeAccount, { encoding: 'base64', commitment: 'confirmed' }] },
    { method: 'getMultipleAccounts', params: [accounts, { encoding: 'base64', commitment: 'confirmed' }] },
    { method: 'getBalance', params: [main, { commitment: 'confirmed' }] },
    { method: 'getMinimumBalanceForRentExemption', params: [200] },
  ];

  return { main, second, lockUntil, accounts, rows, multipleAccounts, programAccounts, rpcRequests, transactions };
}

// ---------------------------------------------------------------------------------------------------------------

/** The pure work of a monitor pass with WARM_UP_ACCOUNTS changed accounts (pass.ts stages 3, 5 and 6). */
function monitorRound(data: SyntheticData, report: WarmUpReport): void {
  const read = parseMultipleAccounts(data.multipleAccounts, data.accounts.length + 1);
  if (read === null) throw new Error('warm-up: the getMultipleAccounts answer did not parse');
  const out = classifyChunk(data.rows, read, WARM_UP_ACCOUNTS);
  report.decoded += out.counts.decoded;
  report.events += out.events.length;
  report.rescanPairs += out.rescan.length;
  JSON.stringify(out.updates);

  // The events as the delivery stage reads them back (PENDING), and a reminder; a chat for each key.
  const pendingRow = (id: number, stakeAccount: Address, type: string, detailsJson: string): PendingRow => ({
    id,
    stake_account: stakeAccount,
    type,
    details_json: detailsJson,
    detected_at: read.clockMs,
    withdrawer: data.main,
    custodian: data.second,
    lock_until: data.lockUntil.toString(),
  });
  const reminder = JSON.stringify({ days: 30, lockUntil: data.lockUntil.toString() });
  const pending = [
    ...out.events.map((e, i) => pendingRow(i + 1, e.stakeAccount, e.type, e.detailsJson)),
    pendingRow(out.events.length + 1, data.main, 'REMINDER_30', reminder),
  ].map(pendingEventOf);
  const links = [
    linkOf({ wallet: data.main, chat_id: '1', last_event_id: 0 }),
    linkOf({ wallet: data.second, chat_id: '2', last_event_id: 0 }),
  ];
  const plan = planDeliveries(pending, links, {
    maxMessages: 25,
    nowMs: read.clockMs,
    siteOrigin: 'https://warm-up.invalid',
    cluster: 'mainnet',
    fullWindow: false,
  });
  const sent = plan.messages.map(() => 'sent' as const);
  const settled = settleDeliveries(pending, links, plan.messages, sent, plan.doneWithoutSend);
  report.messages += plan.messages.length;
  report.settled += settled.doneIds.length;

  const parsed = parseProgramAccountItems(data.programAccounts);
  if (parsed === null) throw new Error('warm-up: the getProgramAccounts answer did not parse');
  for (const item of parsed.items) {
    const bytes = decodeBase64(item.dataBase64);
    if (bytes === null) continue;
    const raw = { address: item.pubkey, data: bytes, lamports: item.lamports, owner: STAKE_PROGRAM_ADDRESS };
    const decoded = decodeStakeAccount(raw);
    if (!decoded.ok || !isLockupInForce(decoded.account.lockup, read.clock)) continue;
    watchRowOf(decoded.account, BigInt(parsed.slot), read.clockMs, item.dataBase64, read.clock.unixTimestamp);
    report.rescanRows += 1;
  }
}

/** The pure work of GET /api/stake-accounts, POST /api/watch and the checks of POST /api/rpc. */
function apiRound(data: SyntheticData, report: WarmUpReport): void {
  const ok = (accepted: boolean) => {
    if (accepted) report.schemas += 1;
  };
  ok(stakeAccountsQuery.safeParse({ withdrawer: data.main }).success);
  const found = parseProgramAccounts(data.programAccounts, 'withdrawer', data.main);
  if (found !== null) JSON.stringify(stakeAccountsToJson(found));
  report.lookedUp += found?.accounts.length ?? 0;

  ok(watchBody.safeParse({ accounts: data.accounts }).success);
  const read = parseMultipleAccounts(data.multipleAccounts, data.accounts.length + 1);
  if (read !== null) report.judged += judgeAccounts(data.accounts, read).filter((j) => j.row !== null).length;

  for (const [id, { method, params }] of data.rpcRequests.entries()) {
    ok(jsonRpcRequest.safeParse({ jsonrpc: '2.0', id, method, params }).success);
    ok(METHOD_PARAMS[method].safeParse(params).success);
  }
}

/** The sendTransaction checks of rpc.ts over each of `transactions`, one after another. */
async function inspectAll(transactions: readonly Uint8Array[]): Promise<number> {
  let accepted = 0;
  for (const transaction of transactions) {
    const bytes = decodeBase64(encodeBase64(transaction));
    if (bytes === null) continue;
    const checked = await inspectAndVerifyTransaction(bytes);
    if (checked.ok && !checked.signatures.ok && checked.signatures.error.code === 'missing-signatures') accepted += 1;
  }
  return accepted;
}
