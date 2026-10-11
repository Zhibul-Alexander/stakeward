import type { Address } from '@solana/kit';
import {
  MAX_WATCH_ACCOUNTS,
  SYSVAR_CLOCK_ADDRESS,
  watchResponseToJson,
  watchVerdict,
  ZERO_ADDRESS,
  type RawAccount,
  type WatchResult,
  type WatchVerdict,
} from '@stakeward/core';
import type { Context } from 'hono';
import * as z from 'zod';
import { isAddressText } from './address.ts';
import { decodeBase64 } from './base64.ts';
import { readChunk, type ChunkRead } from './monitor/read.ts';
import { insertWatchedStatements, watchRowOf, type WatchRow } from './monitor/store.ts';
import { describeIssue } from './rpc-params.ts';
import type { UpstreamOptions } from './upstream.ts';
import type { AppEnv } from './app.ts';

/**
 * POST /api/watch { accounts } (CLAUDE.md section 8): takes stake accounts under monitoring. No login and no
 * signature: the worker reads every account itself, in ONE getMultipleAccounts with the Clock sysvar first, and core
 * `watchVerdict` judges each one by the cluster clock of that read (a lock is a date; the second key is neither the
 * main key nor the zero key; the lock ends at most 10 years ahead).
 *
 * Accepted accounts are written through `insertWatchedStatements`, one row per statement in one D1 batch (the step 5
 * contract): a new row is inserted, a closed row revives only from a fresher read, a live row is never changed.
 * Otherwise a thief who deactivated the stake could POST it and refresh the snapshot before the monitor reports the
 * Deactivate. `meta.changes` of each statement tells `watched` (1) from `already-watched` (0). Nothing is written
 * when the read fails in any way. The answer is core `watchResponseToJson`, one result per account in request order.
 */

/** Largest body accepted: 20 addresses take about 1 KB. */
export const MAX_WATCH_BODY_BYTES = 4096;

const account = z
  .string()
  .refine(isAddressText, 'Expected a base58 address')
  .refine((a) => a !== ZERO_ADDRESS, 'The all-zero address is not a stake account');

export const watchBody = z.strictObject({
  accounts: z
    .array(account)
    .min(1)
    .max(MAX_WATCH_ACCOUNTS)
    .refine((list) => new Set(list).size === list.length, 'Duplicate account'),
});

/** One account of a request: the verdict and, when it is accepted, the row to insert. */
export type WatchJudgement = { account: Address; verdict: WatchVerdict; row: WatchRow | null };

/**
 * Judges `accounts` from `read`, the answer to `[Clock, ...accounts]`: each by the cluster clock read with it. A row's
 * `checked_at` is that clock (ms), its slot the context slot, and the reminder threshold the lock is already within
 * counts as sent. Pure (test/cpu.test.ts measures it).
 */
export function judgeAccounts(accounts: readonly Address[], read: ChunkRead): WatchJudgement[] {
  return accounts.map((address, index) => {
    const item = read.items[index] ?? null;
    let raw: RawAccount | null = null;
    if (item !== null) {
      const data = decodeBase64(item.dataBase64);
      // parseMultipleAccounts accepts canonical base64 only, which always decodes.
      if (data === null) throw new Error('judgeAccounts: account data is not canonical base64');
      raw = { address, data, lamports: item.lamports, owner: item.owner };
    }
    const verdict = watchVerdict(raw, read.clock);
    const row =
      verdict.ok && item !== null
        ? watchRowOf(verdict.account, BigInt(read.slot), read.clockMs, item.dataBase64, read.clock.unixTimestamp)
        : null;
    return { account: address, verdict, row };
  });
}

export function watchHandler(upstreamOptions: UpstreamOptions) {
  return async (c: Context<AppEnv>): Promise<Response> => {
    const contentType = c.req.header('Content-Type') ?? '';
    if (!/^application\/json\s*(;|$)/i.test(contentType)) {
      return c.json({ error: 'unsupported-media-type', message: 'Content-Type must be application/json' }, 415);
    }
    let body: unknown;
    try {
      body = JSON.parse(await c.req.text());
    } catch {
      return c.json({ error: 'invalid-body', message: 'Body is not JSON' }, 400);
    }
    const parsed = watchBody.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid-body', message: describeIssue(parsed.error, 'body') }, 400);
    }
    const { accounts } = parsed.data;

    if (c.env.RPC_URL === '') return c.json({ error: 'upstream-unavailable', message: 'RPC is not configured' }, 503);
    const chunk = await readChunk([SYSVAR_CLOCK_ADDRESS, ...accounts], {
      endpoints: { primary: c.env.RPC_URL, fallback: c.env.RPC_FALLBACK_URL },
      options: upstreamOptions,
    });
    if (!chunk.ok) {
      switch (chunk.reason) {
        case 'timeout':
          return c.json({ error: 'upstream-timeout', message: 'The RPC node did not answer in time' }, 504);
        case 'unavailable':
          return c.json({ error: 'upstream-unavailable', message: 'The RPC node is unavailable' }, 502);
        case 'malformed':
          return c.json({ error: 'upstream-error', message: 'The RPC node returned an error' }, 502);
      }
    }
    const { read } = chunk;

    const judged = judgeAccounts(accounts, read);
    const db = c.env.DB;
    // created_at = checked_at: the first sighting is the cluster time of the read.
    const statements = judged.flatMap((j) => (j.row === null ? [] : insertWatchedStatements(db, [j.row], read.clockMs)));
    const changes = statements.length === 0 ? [] : (await db.batch(statements)).map((result) => result.meta.changes);

    let written = 0;
    const results = judged.map(({ account: address, verdict }): WatchResult => {
      if (!verdict.ok) return { account: address, status: 'rejected', reason: verdict.reason };
      const inserted = changes[written] === 1;
      written += 1;
      return { account: address, status: inserted ? 'watched' : 'already-watched', reason: null };
    });

    const count = (status: WatchResult['status']) => results.filter((r) => r.status === status).length;
    const log = {
      msg: 'watch',
      requested: accounts.length,
      watched: count('watched'),
      already: count('already-watched'),
      rejected: count('rejected'),
    };
    console.log(JSON.stringify(log));
    return c.json(watchResponseToJson({ slot: BigInt(read.slot), results }), 200, { 'Cache-Control': 'no-store' });
  };
}
