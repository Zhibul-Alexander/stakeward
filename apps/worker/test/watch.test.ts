// POST /api/watch (step 4 spec section 5.1 with the step 5 write contract): the worker reads every account with the
// Clock sysvar in one getMultipleAccounts, judges it by the cluster clock (core watchVerdict) and writes through
// insertWatchedStatements, one row per statement. Nothing is written for a rejected account or on any upstream problem.
import type { Address } from '@solana/kit';
import {
  MAX_WATCH_ACCOUNTS,
  STAKE_PROGRAM_ADDRESS,
  stakeDataFingerprint,
  SYSTEM_PROGRAM_ADDRESS,
  SYSVAR_CLOCK_ADDRESS,
  SYSVAR_PROGRAM_ADDRESS,
  U64_MAX,
  WATCH_MAX_LOCK_SECONDS,
  watchResponseFromJson,
  ZERO_ADDRESS,
  type WatchRejectReason,
} from '@stakeward/core';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeBase64 } from '../src/base64.ts';
import type { AccountRow } from '../src/monitor/store.ts';
import { MAX_WATCH_BODY_BYTES } from '../src/watch.ts';
import {
  fakeUpstream,
  multipleAccountsAnswer,
  testApp,
  type AccountJson,
  type Outcome,
  type UpstreamCall,
} from './fakes.ts';
import { clockData, key, stakeAccountData, type StakeAccountSpec } from './transactions.ts';

const DAY = 86_400n;
const MAIN = key(1);
const SECOND = key(2);
const THIEF = key(3);
const STAKE = key(10);

/** The worker's clock when the file loads. The cluster clock is set 30 days later, so the two are told apart. */
const WORKER_NOW_S = BigInt(Math.floor(Date.now() / 1000));
const SLOT = 5000;
const EPOCH = 950n;
const CLOCK_UNIX = WORKER_NOW_S + 30n * DAY;
const CLOCK_MS = Number(CLOCK_UNIX) * 1000;
const LOCK_UNTIL = CLOCK_UNIX + 100n * DAY;
/** 2^53 + 1: a JavaScript number cannot hold it. */
const BIG_LAMPORTS = 9_007_199_254_740_993n;

function clockAccount(slot: number, epoch: bigint, unixTimestamp: bigint): NonNullable<AccountJson> {
  return { data: clockData(BigInt(slot), epoch, unixTimestamp), lamports: 1_169_280n, owner: SYSVAR_PROGRAM_ADDRESS };
}

const CLOCK = clockAccount(SLOT, EPOCH, CLOCK_UNIX);

/** A delegated stake account of MAIN locked by SECOND until LOCK_UNTIL, with `spec` on top. */
function stake(spec: Partial<StakeAccountSpec> = {}, lamports = BIG_LAMPORTS, owner: string = STAKE_PROGRAM_ADDRESS) {
  const data = stakeAccountData({
    state: 'delegated',
    staker: MAIN,
    withdrawer: MAIN,
    custodian: SECOND,
    unixTimestamp: LOCK_UNTIL,
    ...spec,
  });
  return { data, lamports, owner } satisfies AccountJson;
}

/** A fake chain: answers getMultipleAccounts for whatever keys are asked, the Clock included. Mutable between calls. */
type Chain = { slot: number; clock: AccountJson; accounts: Map<Address, AccountJson> };

function chainOf(accounts: Record<Address, AccountJson>): Chain {
  return { slot: SLOT, clock: CLOCK, accounts: new Map(Object.entries(accounts) as [Address, AccountJson][]) };
}

function chainUpstream(chain: Chain) {
  return fakeUpstream((call) => {
    const [keys] = call.json.params as [Address[]];
    const items = keys.map((k) => (k === SYSVAR_CLOCK_ADDRESS ? chain.clock : (chain.accounts.get(k) ?? null)));
    return multipleAccountsAnswer(call.json.id, chain.slot, items);
  });
}

function noUpstream() {
  return fakeUpstream(() => {
    throw new Error('unexpected upstream call');
  });
}

type Row = AccountRow & { created_at: number };

async function rows(): Promise<Row[]> {
  const { results } = await env.DB.prepare(
    `SELECT stake_account, withdrawer, staker, custodian, CAST(lock_until AS TEXT) AS lock_until, lamports, state, voter,
            activation_epoch, deactivation_epoch, slot, checked_at, last_reminder_days, fingerprint, created_at
     FROM accounts ORDER BY stake_account`,
  ).all<Row>();
  return results;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/watch: accepts a locked account', () => {
  it('answers watched and stores the read: cluster clock, context slot, exact lamports, fingerprint', async () => {
    const account = stake();
    const upstream = chainUpstream(chainOf({ [STAKE]: account }));
    const res = await testApp(upstream).watch({ accounts: [STAKE] });

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Content-Type')).toMatch(/^application\/json/);
    const json = await res.json();
    expect(json).toEqual({ slot: String(SLOT), results: [{ account: STAKE, status: 'watched' }] });
    expect(watchResponseFromJson(json, [STAKE]).results).toEqual([{ account: STAKE, status: 'watched', reason: null }]);

    expect(await rows()).toEqual([
      {
        stake_account: STAKE,
        withdrawer: MAIN,
        staker: MAIN,
        custodian: SECOND,
        lock_until: LOCK_UNTIL.toString(),
        lamports: '9007199254740993',
        state: 'delegated',
        voter: key(42),
        activation_epoch: '800',
        deactivation_epoch: U64_MAX.toString(),
        slot: SLOT,
        checked_at: CLOCK_MS,
        last_reminder_days: null,
        fingerprint: stakeDataFingerprint(encodeBase64(account.data)),
        created_at: CLOCK_MS,
      },
    ] satisfies Row[]);
  });

  it('stores an undelegated account, and counts the reminder threshold the lock is already within as sent', async () => {
    // 10 days left on the cluster clock: the 14-day reminder is past, the 7-day one is still to come.
    const account = stake({ state: 'initialized', unixTimestamp: CLOCK_UNIX + 10n * DAY });
    const res = await testApp(chainUpstream(chainOf({ [STAKE]: account }))).watch({ accounts: [STAKE] });
    expect(await res.json()).toEqual({ slot: String(SLOT), results: [{ account: STAKE, status: 'watched' }] });
    expect(await rows()).toEqual([
      expect.objectContaining({
        lock_until: (CLOCK_UNIX + 10n * DAY).toString(),
        state: 'initialized',
        voter: null,
        activation_epoch: null,
        deactivation_epoch: null,
        last_reminder_days: 14,
      }),
    ]);
  });

  it('accepts a lock that ends exactly 10 years after the cluster clock', async () => {
    const account = stake({ unixTimestamp: CLOCK_UNIX + WATCH_MAX_LOCK_SECONDS });
    const res = await testApp(chainUpstream(chainOf({ [STAKE]: account }))).watch({ accounts: [STAKE] });
    expect(await res.json()).toMatchObject({ results: [{ account: STAKE, status: 'watched' }] });
  });
});

describe('POST /api/watch: rejects what is not a lock worth watching, and writes nothing', () => {
  const endedByCluster = CLOCK_UNIX - DAY;
  const rejections: [string, AccountJson, WatchRejectReason][] = [
    ['a lock timestamp of 0', stake({ unixTimestamp: 0n }), 'not-locked'],
    ['a lock ended by the cluster clock, though still ahead by the worker clock', stake({ unixTimestamp: endedByCluster }), 'not-locked'],
    ['a lock ending exactly at the cluster clock', stake({ unixTimestamp: CLOCK_UNIX }), 'not-locked'],
    ['an epoch-only lock', stake({ unixTimestamp: 0n, lockupEpoch: EPOCH + 10n }), 'not-locked'],
    ['the main key as the second key', stake({ custodian: MAIN }), 'unsupported-lock'],
    ['the zero key as the second key', stake({ custodian: ZERO_ADDRESS }), 'unsupported-lock'],
    ['a lock ending more than 10 years ahead', stake({ unixTimestamp: CLOCK_UNIX + WATCH_MAX_LOCK_SECONDS + 1n }), 'unsupported-lock'],
    ['an account owned by the System program', stake({}, BIG_LAMPORTS, SYSTEM_PROGRAM_ADDRESS), 'not-stake-account'],
    ['a 199-byte stake account', { ...stake(), data: stake().data.slice(0, 199) }, 'not-stake-account'],
    ['an uninitialized stake account', { data: new Uint8Array(200), lamports: 2_282_880n, owner: STAKE_PROGRAM_ADDRESS }, 'not-stake-account'],
    ['a missing account', null, 'not-found'],
  ];

  it('the worker clock is earlier than the end of the lock the cluster clock has ended', () => {
    expect(endedByCluster > WORKER_NOW_S).toBe(true);
    expect(endedByCluster < CLOCK_UNIX).toBe(true);
  });

  it.each(rejections)('%s', async (_case, account, reason) => {
    const upstream = chainUpstream(chainOf(account === null ? {} : { [STAKE]: account }));
    const res = await testApp(upstream).watch({ accounts: [STAKE] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ slot: String(SLOT), results: [{ account: STAKE, status: 'rejected', reason }] });
    expect(upstream.calls).toHaveLength(1);
    expect(await rows()).toEqual([]);
  });
});

describe('POST /api/watch: never changes a watched row', () => {
  it('a second POST after the chain changed answers already-watched and the row stays identical', async () => {
    const chain = chainOf({ [STAKE]: stake() });
    const client = testApp(chainUpstream(chain));
    expect(await (await client.watch({ accounts: [STAKE] })).json()).toMatchObject({
      results: [{ account: STAKE, status: 'watched' }],
    });
    const before = await rows();
    expect(before).toHaveLength(1);

    // The thief deactivates the stake and takes the staker role; the cluster moves on. A refreshed snapshot would hide
    // the Deactivate from the monitor.
    chain.slot = SLOT + 1000;
    chain.clock = clockAccount(chain.slot, EPOCH + 1n, CLOCK_UNIX + 600n);
    chain.accounts.set(STAKE, stake({ staker: THIEF, deactivationEpoch: EPOCH + 1n }, BIG_LAMPORTS - 1n));
    const res = await client.watch({ accounts: [STAKE] });
    expect(await res.json()).toEqual({ slot: String(SLOT + 1000), results: [{ account: STAKE, status: 'already-watched' }] });
    expect(await rows()).toEqual(before);
  });

  it('a closed row revives from a fresher read and answers watched', async () => {
    const chain = chainOf({ [STAKE]: stake() });
    const client = testApp(chainUpstream(chain));
    await client.watch({ accounts: [STAKE] });
    await env.DB.prepare("UPDATE accounts SET state = 'closed', fingerprint = NULL WHERE stake_account = ?1").bind(STAKE).run();

    chain.slot = SLOT + 1;
    const res = await client.watch({ accounts: [STAKE] });
    expect(await res.json()).toMatchObject({ results: [{ account: STAKE, status: 'watched' }] });
    expect(await rows()).toEqual([expect.objectContaining({ state: 'delegated', slot: SLOT + 1, created_at: CLOCK_MS })]);
  });
});

describe('POST /api/watch: one read for the whole request', () => {
  it('answers in request order, from one getMultipleAccounts for [Clock, ...accounts], and logs counts only', async () => {
    const [missing, fresh, unlocked, watched, system] = [key(20), key(21), key(22), key(23), key(24)];
    const accounts = { [fresh]: stake(), [unlocked]: stake({ unixTimestamp: 0n }), [watched]: stake(), [system]: stake({}, 1n, SYSTEM_PROGRAM_ADDRESS) };
    await testApp(chainUpstream(chainOf(accounts))).watch({ accounts: [watched] });

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const upstream = chainUpstream(chainOf(accounts));
    const asked = [missing, fresh, unlocked, watched, system];
    const res = await testApp(upstream).watch({ accounts: asked });

    expect(await res.json()).toEqual({
      slot: String(SLOT),
      results: [
        { account: missing, status: 'rejected', reason: 'not-found' },
        { account: fresh, status: 'watched' },
        { account: unlocked, status: 'rejected', reason: 'not-locked' },
        { account: watched, status: 'already-watched' },
        { account: system, status: 'rejected', reason: 'not-stake-account' },
      ],
    });
    expect(upstream.calls).toHaveLength(1);
    expect(upstream.calls[0]?.endpoint).toBe('primary');
    expect(upstream.calls[0]?.json).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'getMultipleAccounts',
      params: [[SYSVAR_CLOCK_ADDRESS, ...asked], { encoding: 'base64', commitment: 'confirmed' }],
    });
    expect((await rows()).map((r) => r.stake_account).sort()).toEqual([fresh, watched].sort());

    const lines = log.mock.calls.map((args) => args.map(String).join(' '));
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      { msg: 'watch', requested: 5, watched: 1, already: 1, rejected: 3 },
    ]);
    for (const address of asked) expect(lines.join('\n')).not.toContain(address);
  });

  it(`takes up to ${String(MAX_WATCH_ACCOUNTS)} accounts in one request`, async () => {
    const asked = Array.from({ length: MAX_WATCH_ACCOUNTS }, (_, i) => key(100 + i));
    const upstream = chainUpstream(chainOf(Object.fromEntries(asked.map((a) => [a, stake()]))));
    const res = await testApp(upstream).watch({ accounts: asked });
    const json = await res.json();
    expect(watchResponseFromJson(json, asked).results.every((r) => r.status === 'watched')).toBe(true);
    expect(upstream.calls).toHaveLength(1);
    expect((await rows()).length).toBe(MAX_WATCH_ACCOUNTS);
  });
});

describe('POST /api/watch: bad requests never reach the upstream', () => {
  const tooMany = Array.from({ length: MAX_WATCH_ACCOUNTS + 1 }, (_, i) => key(100 + i));
  const badBodies: [string, unknown, string][] = [
    ['text that is not JSON', '{"accounts":', 'Body is not JSON'],
    ['an empty body', '', 'Body is not JSON'],
    ['an array', [STAKE], 'body'],
    ['an extra key', { accounts: [STAKE], extra: 1 }, 'body'],
    ['no accounts', {}, 'body.accounts'],
    ['accounts that are not a list', { accounts: STAKE }, 'body.accounts'],
    ['0 accounts', { accounts: [] }, 'body.accounts'],
    [`${String(MAX_WATCH_ACCOUNTS + 1)} accounts`, { accounts: tooMany }, 'body.accounts'],
    ['a duplicate account', { accounts: [STAKE, key(11), STAKE] }, 'body.accounts: Duplicate account'],
    ['an invalid address', { accounts: ['not-an-address'] }, 'body.accounts[0]: Expected a base58 address'],
    ['a 31-byte address', { accounts: ['1'.repeat(31)] }, 'body.accounts[0]: Expected a base58 address'],
    ['a number', { accounts: [42] }, 'body.accounts[0]'],
    ['the all-zero address', { accounts: [key(11), ZERO_ADDRESS] }, 'body.accounts[1]: The all-zero address is not a stake account'],
  ];

  it.each(badBodies)('400 for %s', async (_case, body, message) => {
    const upstream = noUpstream();
    const res = await testApp(upstream).watch(body);
    expect(res.status).toBe(400);
    const json = await res.json<{ error: string; message: string }>();
    expect(json.error).toBe('invalid-body');
    expect(json.message.startsWith(message)).toBe(true);
    expect(upstream.calls).toHaveLength(0);
    expect(await rows()).toEqual([]);
  });

  it.each([['text/plain'], ['application/jsonp'], ['application/x-www-form-urlencoded']])(
    '415 for Content-Type %s',
    async (contentType) => {
      const upstream = noUpstream();
      const res = await testApp(upstream).watch({ accounts: [STAKE] }, { headers: { 'Content-Type': contentType } });
      expect(res.status).toBe(415);
      expect(await res.json()).toEqual({ error: 'unsupported-media-type', message: 'Content-Type must be application/json' });
      expect(upstream.calls).toHaveLength(0);
    },
  );

  it(`reads a body of ${String(MAX_WATCH_BODY_BYTES)} bytes and refuses one byte more with 413`, async () => {
    const atLimit = JSON.stringify({ accounts: [STAKE] }).padEnd(MAX_WATCH_BODY_BYTES, ' ');
    const upstream = chainUpstream(chainOf({ [STAKE]: stake() }));
    const ok = await testApp(upstream).watch(atLimit, { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    expect(ok.status).toBe(200);
    expect(upstream.calls).toHaveLength(1);

    const res = await testApp(upstream).watch(`${atLimit} `);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'too-large', message: 'Request body too large' });
    expect(upstream.calls).toHaveLength(1);
  });
});

describe('POST /api/watch: upstream problems write nothing', () => {
  /** A getMultipleAccounts answer whose `value` holds these raw JSON entries. */
  const answerWith = (call: UpstreamCall, value: unknown[]) =>
    new Response(JSON.stringify({ jsonrpc: '2.0', id: call.json.id, result: { context: { slot: SLOT }, value } }));
  const goodStakeEntry = () => ({ data: [encodeBase64(stake().data), 'base64'], executable: false, lamports: 5, owner: STAKE_PROGRAM_ADDRESS, space: 200 });
  const clockEntry = () => ({ data: [encodeBase64(clockData(1n, EPOCH, CLOCK_UNIX)), 'base64'], executable: false, lamports: 1, owner: SYSVAR_PROGRAM_ADDRESS, space: 40 });

  const failures: [string, (call: UpstreamCall) => Outcome, number, string][] = [
    ['an HTTP error (after the read retries)', () => new Response('', { status: 503 }), 502, 'upstream-unavailable'],
    ['a network error', () => 'network-error', 502, 'upstream-unavailable'],
    ['a JSON-RPC error', (call) => new Response(JSON.stringify({ jsonrpc: '2.0', id: call.json.id, error: { code: -32005, message: 'Node is behind' } })), 502, 'upstream-error'],
    ['text that is not JSON', () => new Response('<html>'), 502, 'upstream-error'],
    ['a short answer', (call) => multipleAccountsAnswer(call.json.id, SLOT, [CLOCK]), 502, 'upstream-error'],
    ['a long answer', (call) => multipleAccountsAnswer(call.json.id, SLOT, [CLOCK, stake(), null]), 502, 'upstream-error'],
    ['a malformed account', (call) => answerWith(call, [clockEntry(), { ...goodStakeEntry(), data: ['AB==', 'base64'] }]), 502, 'upstream-error'],
    ['negative lamports', (call) => answerWith(call, [clockEntry(), { ...goodStakeEntry(), lamports: -1 }]), 502, 'upstream-error'],
    ['a missing Clock', (call) => multipleAccountsAnswer(call.json.id, SLOT, [null, stake()]), 502, 'upstream-error'],
    ['a Clock of another owner', (call) => multipleAccountsAnswer(call.json.id, SLOT, [{ ...CLOCK, owner: SYSTEM_PROGRAM_ADDRESS }, stake()]), 502, 'upstream-error'],
    ['a Clock under 40 bytes', (call) => multipleAccountsAnswer(call.json.id, SLOT, [{ ...CLOCK, data: CLOCK.data.slice(0, 39) }, stake()]), 502, 'upstream-error'],
  ];

  it('the well-formed variant of these answers is accepted (the cases below differ only where they say)', async () => {
    const upstream = fakeUpstream((call) => answerWith(call, [clockEntry(), goodStakeEntry()]));
    const res = await testApp(upstream).watch({ accounts: [STAKE] });
    expect(await res.json()).toMatchObject({ results: [{ account: STAKE, status: 'watched' }] });
  });

  it.each(failures)('%s -> %i %s', async (_case, script, status, error) => {
    const upstream = fakeUpstream(script);
    const res = await testApp(upstream).watch({ accounts: [STAKE] });
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ error });
    expect(await rows()).toEqual([]);
  });

  it('a hanging upstream -> 504 upstream-timeout', async () => {
    const res = await testApp(fakeUpstream(() => 'hang'), { timeoutMs: 30 }).watch({ accounts: [STAKE] });
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: 'upstream-timeout', message: 'The RPC node did not answer in time' });
    expect(await rows()).toEqual([]);
  });

  it("RPC_URL '' -> 503 without calling anything", async () => {
    const upstream = noUpstream();
    const res = await testApp(upstream, { rpcUrl: '' }).watch({ accounts: [STAKE] });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'upstream-unavailable', message: 'RPC is not configured' });
    expect(upstream.calls).toHaveLength(0);
    expect(await rows()).toEqual([]);
  });
});
