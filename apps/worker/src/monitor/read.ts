import type { Address } from '@solana/kit';
import {
  decodeClockSysvar,
  STAKE_PROGRAM_ADDRESS,
  SYSVAR_PROGRAM_ADDRESS,
  type ChainClock,
} from '@stakeward/core';
import { isAddressText } from '../address.ts';
import { decodeBase64, isCanonicalBase64 } from '../base64.ts';
import { isRecord, parseJsonExactLamports } from '../stake-accounts.ts';
import { callUpstream, type EndpointName, type UpstreamEndpoints, type UpstreamOptions } from '../upstream.ts';

/**
 * Chain reads of the monitor pass and of POST /api/watch: one getMultipleAccounts per chunk, with the Clock sysvar as
 * the first key so that every account is judged by the cluster clock of the same slot. Parsing is strict: an answer
 * that is not exactly what was asked fails the whole chunk, so a broken node never turns into ACCOUNT_CLOSED events.
 */

/** One account of the answer, not decoded: the monitor compares fingerprints first and decodes only what changed. */
export type RawItem = { owner: Address; dataBase64: string; lamports: bigint };

/** `items` are aligned with the keys after the Clock (keys[1..]); null = the account does not exist. */
export type ChunkRead = { slot: number; clock: ChainClock; clockMs: number; items: (RawItem | null)[] };

export function multipleAccountsRequest(keys: readonly Address[]): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getMultipleAccounts',
    params: [keys, { encoding: 'base64', commitment: 'confirmed' }],
  });
}

/**
 * The answer to `multipleAccountsRequest(keys)` with `keys.length === keyCount` and the Clock sysvar first. Null (the
 * chunk failed) when: the text is not JSON; it is a JSON-RPC error; `result.context.slot` is not a safe integer;
 * `result.value` does not hold exactly `keyCount` entries; any non-null entry is malformed (data not
 * `[canonical base64, 'base64']`, owner not an address, lamports not an integer >= 0); or the first entry is not
 * the Clock: null, another owner than the Sysvar program, or fewer than 40 bytes.
 */
export function parseMultipleAccounts(text: string, keyCount: number): ChunkRead | null {
  let json: unknown;
  try {
    json = parseJsonExactLamports(text);
  } catch {
    return null;
  }
  if (!isRecord(json) || 'error' in json || !isRecord(json.result) || !isRecord(json.result.context)) return null;
  const { slot } = json.result.context;
  const { value } = json.result;
  if (typeof slot !== 'number' || !Number.isSafeInteger(slot) || slot < 0) return null;
  if (!Array.isArray(value) || value.length !== keyCount || keyCount < 1) return null;

  const items: (RawItem | null)[] = [];
  for (const entry of value) {
    if (entry === null) {
      items.push(null);
      continue;
    }
    const item = rawItem(entry);
    if (item === null) return null;
    items.push(item);
  }

  const clockItem = items.shift();
  if (clockItem === undefined || clockItem === null || clockItem.owner !== SYSVAR_PROGRAM_ADDRESS) return null;
  const clockData = decodeBase64(clockItem.dataBase64);
  const clock = clockData === null ? null : decodeClockSysvar(clockData);
  if (clock === null) return null;
  return { slot, clock, clockMs: Number(clock.unixTimestamp) * 1000, items };
}

/**
 * One account entry, checked by hand like `gpaItem` (CPU: up to 100 per chunk). A stake-program owner is compared as
 * a string, which also proves it valid; any other owner is checked as an address.
 */
function rawItem(entry: unknown): RawItem | null {
  if (!isRecord(entry)) return null;
  const { data, owner, lamports } = entry;
  if (typeof lamports !== 'bigint' || lamports < 0n) return null;
  if (typeof owner !== 'string' || (owner !== STAKE_PROGRAM_ADDRESS && !isAddressText(owner))) return null;
  if (!Array.isArray(data) || data.length !== 2 || data[1] !== 'base64' || typeof data[0] !== 'string') return null;
  if (!isCanonicalBase64(data[0])) return null;
  return { owner, dataBase64: data[0], lamports };
}

/** `endpoint`: the node that answered (callUpstream). */
export type ChunkReadResult =
  | { ok: true; read: ChunkRead; endpoint: EndpointName }
  | { ok: false; reason: 'timeout' | 'unavailable' | 'malformed' };

/** One getMultipleAccounts for `keys` (the Clock sysvar first), with the read retries of callUpstream. Never throws. */
export async function readChunk(
  keys: readonly Address[],
  deps: { endpoints: UpstreamEndpoints; options: UpstreamOptions },
): Promise<ChunkReadResult> {
  const result = await callUpstream(deps.endpoints, multipleAccountsRequest(keys), 'read', deps.options);
  if (!result.ok) return result;
  const read = parseMultipleAccounts(result.body, keys.length);
  return read === null ? { ok: false, reason: 'malformed' } : { ok: true, read, endpoint: result.endpoint };
}

export const GENESIS_REQUEST = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getGenesisHash', params: [] });

/** The hash of a getGenesisHash answer; null for anything but a base58 32-byte hash. */
export function parseGenesisHash(text: string): string | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(json) || 'error' in json || typeof json.result !== 'string') return null;
  return isAddressText(json.result) ? json.result : null;
}

/**
 * True when any account is missing or no longer a stake account: before such a chunk can turn into ACCOUNT_CLOSED
 * events, the pass checks that the node that answered serves the right cluster (a wrong RPC_URL or RPC_FALLBACK_URL
 * reads as every account gone, and with one or two rows watched that is one or two accounts).
 */
export function anyGone(items: readonly (RawItem | null)[]): boolean {
  return items.some((item) => item === null || item.owner !== STAKE_PROGRAM_ADDRESS);
}
