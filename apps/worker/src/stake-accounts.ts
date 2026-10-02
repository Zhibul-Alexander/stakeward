import { isAddress, type Address } from '@solana/kit';
import {
  decodeStakeAccount,
  STAKE_ACCOUNT_OFFSETS,
  STAKE_ACCOUNT_SIZE,
  STAKE_PROGRAM_ADDRESS,
  stakeAccountsToJson,
  ZERO_ADDRESS,
  type StakeAccount,
} from '@stakeward/core';
import type { Context } from 'hono';
import * as z from 'zod';
import { isAddressText } from './address.ts';
import { decodeBase64 } from './base64.ts';
import { callUpstream, type UpstreamOptions } from './upstream.ts';
import type { AppEnv } from './app.ts';

/**
 * GET /api/stake-accounts?withdrawer=<address> | ?custodian=<address> (CLAUDE.md section 8): stake accounts whose
 * withdrawer (main key) or lockup custodian (second key) is the address, via getProgramAccounts with the filters of
 * section 4, decoded with core and returned as StakeAccountsJson (core json.ts). Upstream data is not trusted either:
 * items that do not decode as stake accounts, or do not match the filter, are left out. Answers are cached for 30 s
 * at the edge (Cache API) under the normalised query; the browser gets `no-store`.
 */

export const STAKE_ACCOUNTS_CACHE_SECONDS = 30;

const address = z.string().refine(isAddress, 'Expected a base58 address');
const query = z.union([z.strictObject({ withdrawer: address }), z.strictObject({ custodian: address })]);

type Role = 'withdrawer' | 'custodian';

const gpaResponse = z.object({
  result: z.object({
    context: z.object({ slot: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }),
    value: z.array(z.unknown()),
  }),
});

export function stakeAccountsHandler(upstreamOptions: UpstreamOptions) {
  return async (c: Context<AppEnv>): Promise<Response> => {
    const url = new URL(c.req.url);
    const entries = [...url.searchParams.entries()];
    const parsed = query.safeParse(Object.fromEntries(entries));
    if (!parsed.success || entries.length !== 1) {
      return c.json(
        { error: 'invalid-query', message: 'Pass exactly one of withdrawer=<address> or custodian=<address>' },
        400,
      );
    }
    const [role, target] = 'withdrawer' in parsed.data
      ? (['withdrawer', parsed.data.withdrawer] as const)
      : (['custodian', parsed.data.custodian] as const);
    // The all-zero key (the System Program id) is nobody's wallet, and nearly every stake account without a lock has it
    // as custodian: that query would return most of the cluster's stake accounts (upstream credits, isolate memory, CPU).
    if (target === ZERO_ADDRESS) {
      return c.json({ error: 'invalid-query', message: 'The all-zero address is not a wallet' }, 400);
    }

    const cacheKey = new Request(new URL(`/api/stake-accounts?${role}=${target}`, url.origin).toString());
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached !== undefined) return respond(c, await cached.text());

    if (c.env.RPC_URL === '') return c.json({ error: 'upstream-unavailable', message: 'RPC is not configured' }, 503);
    const result = await callUpstream(
      { primary: c.env.RPC_URL, fallback: c.env.RPC_FALLBACK_URL },
      JSON.stringify(programAccountsRequest(role, target)),
      'read',
      upstreamOptions,
    );
    if (!result.ok) {
      return result.reason === 'timeout'
        ? c.json({ error: 'upstream-timeout', message: 'The RPC node did not answer in time' }, 504)
        : c.json({ error: 'upstream-unavailable', message: 'The RPC node is unavailable' }, 502);
    }
    const accounts = parseProgramAccounts(result.body, role, target);
    if (accounts === null) {
      return c.json({ error: 'upstream-error', message: 'The RPC node returned an error' }, 502);
    }

    const body = JSON.stringify(stakeAccountsToJson(accounts));
    try {
      await cache.put(
        cacheKey,
        new Response(body, {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': `public, max-age=${String(STAKE_ACCOUNTS_CACHE_SECONDS)}`,
          },
        }),
      );
    } catch (error) {
      console.warn(JSON.stringify({ msg: 'stake-accounts cache put failed', error: errorName(error) }));
    }
    return respond(c, body);
  };
}

function respond(c: Context<AppEnv>, body: string): Response {
  return c.body(body, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}

/** getProgramAccounts on the stake program: 200-byte accounts with the address at the role's offset (section 4). */
export function programAccountsRequest(role: Role, target: Address) {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'getProgramAccounts',
    params: [
      STAKE_PROGRAM_ADDRESS,
      {
        encoding: 'base64',
        commitment: 'confirmed',
        withContext: true,
        filters: [
          { dataSize: STAKE_ACCOUNT_SIZE },
          { memcmp: { offset: STAKE_ACCOUNT_OFFSETS[role], bytes: target, encoding: 'base58' } },
        ],
      },
    ],
  };
}

/**
 * Decoded stake accounts of a getProgramAccounts answer, sorted by address; null when the answer is a JSON-RPC
 * error or not the expected shape. Lamports are read from the JSON source text: JSON numbers lose precision
 * above 2^53.
 */
export function parseProgramAccounts(
  text: string,
  role: Role,
  target: Address,
): { slot: bigint; accounts: StakeAccount[] } | null {
  let json: unknown;
  try {
    json = JSON.parse(text, (key, value: unknown, context?: { source?: string }) => {
      const source = context?.source;
      return key === 'lamports' && typeof value === 'number' && source !== undefined && /^[0-9]+$/.test(source)
        ? BigInt(source)
        : value;
    });
  } catch {
    return null;
  }
  const response = gpaResponse.safeParse(json);
  if (!response.success) return null;

  const accounts: StakeAccount[] = [];
  const seen = new Set<string>();
  for (const value of response.data.result.value) {
    const item = gpaItem(value);
    if (item === null) continue;
    const data = decodeBase64(item.data);
    if (data === null) continue;
    const raw = { address: item.pubkey, data, lamports: item.lamports, owner: STAKE_PROGRAM_ADDRESS };
    const decoded = decodeStakeAccount(raw);
    if (!decoded.ok) continue;
    const { account } = decoded;
    const matches = role === 'withdrawer' ? account.withdrawer === target : account.lockup.custodian === target;
    if (matches && !seen.has(account.address)) {
      seen.add(account.address);
      accounts.push(account);
    }
  }
  accounts.sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
  return { slot: BigInt(response.data.result.context.slot), accounts };
}

/**
 * One item of the answer, checked by hand rather than with zod: this runs for every account and the free plan
 * allows 10 ms of CPU per request (test/cpu.test.ts). The owner is compared as a string, which also proves it valid;
 * the address is checked with `isAddressText` (kit's `isAddress`, cheaper).
 */
function gpaItem(raw: unknown): { pubkey: Address; data: string; lamports: bigint } | null {
  if (!isRecord(raw) || typeof raw.pubkey !== 'string' || !isRecord(raw.account)) return null;
  const { data, owner, lamports } = raw.account;
  if (owner !== STAKE_PROGRAM_ADDRESS || typeof lamports !== 'bigint' || lamports < 0n) return null;
  if (!Array.isArray(data) || data.length !== 2 || data[1] !== 'base64' || typeof data[0] !== 'string') return null;
  if (!isAddressText(raw.pubkey)) return null;
  return { pubkey: raw.pubkey, data: data[0], lamports };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}
