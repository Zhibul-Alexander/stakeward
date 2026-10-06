import {
  GENESIS_HASH,
  STAKE_PROGRAM_ADDRESS,
  SYSTEM_PROGRAM_ADDRESS,
  SYSVAR_CLOCK_ADDRESS,
  SYSVAR_PROGRAM_ADDRESS,
} from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { encodeBase64 } from '../../src/base64.ts';
import {
  anyGone,
  GENESIS_REQUEST,
  multipleAccountsRequest,
  parseGenesisHash,
  parseMultipleAccounts,
  readChunk,
  type RawItem,
} from '../../src/monitor/read.ts';
import {
  FALLBACK_URL,
  fakeUpstream,
  multipleAccountsAnswer,
  multipleAccountsText,
  PRIMARY_URL,
  rpcResponse,
  type AccountJson,
} from '../fakes.ts';
import { clockData, key, stakeAccountData } from '../transactions.ts';

const MAIN = key(1);
const CLOCK_UNIX = 1_791_201_600n; // 2026-10-05T12:00:00Z
const CLOCK: AccountJson = { data: clockData(4_000_123n, 950n, CLOCK_UNIX), lamports: 1_169_280n, owner: SYSVAR_PROGRAM_ADDRESS };
const STAKE_DATA = stakeAccountData({ state: 'delegated', staker: MAIN, withdrawer: MAIN, custodian: key(2) });
const STAKE: AccountJson = { data: STAKE_DATA, lamports: 9_007_199_254_740_993n, owner: STAKE_PROGRAM_ADDRESS };
const KEYS = [SYSVAR_CLOCK_ADDRESS, key(10), key(11), key(12)];

/** The answer text with one entry of `value` replaced by raw JSON (for malformed entries). */
function withEntry(index: number, entry: unknown): string {
  const json = JSON.parse(multipleAccountsText(1, 5000, [CLOCK, STAKE, null, STAKE])) as { result: { value: unknown[] } };
  json.result.value[index] = entry;
  return JSON.stringify(json);
}

const goodEntry = () => ({ data: [encodeBase64(STAKE_DATA), 'base64'], executable: false, lamports: 5, owner: STAKE_PROGRAM_ADDRESS, space: 200 });

describe('getMultipleAccounts request', () => {
  it('asks base64 data at confirmed commitment, keys in order', () => {
    expect(JSON.parse(multipleAccountsRequest(KEYS))).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'getMultipleAccounts',
      params: [KEYS, { encoding: 'base64', commitment: 'confirmed' }],
    });
  });
});

describe('parseMultipleAccounts', () => {
  it('reads the slot, the Clock (first key) and the accounts aligned with the other keys, lamports exact', () => {
    const read = parseMultipleAccounts(multipleAccountsText(1, 5000, [CLOCK, STAKE, null, STAKE]), 4);
    expect(read).toEqual({
      slot: 5000,
      clock: { slot: 4_000_123n, epochStartTimestamp: CLOCK_UNIX - 3_600n, epoch: 950n, unixTimestamp: CLOCK_UNIX },
      clockMs: Number(CLOCK_UNIX) * 1000,
      items: [
        { owner: STAKE_PROGRAM_ADDRESS, dataBase64: encodeBase64(STAKE_DATA), lamports: 9_007_199_254_740_993n },
        null,
        { owner: STAKE_PROGRAM_ADDRESS, dataBase64: encodeBase64(STAKE_DATA), lamports: 9_007_199_254_740_993n },
      ],
    });
  });

  it('keeps an account of another owner (it may have been closed and reused) and of any size', () => {
    const system: AccountJson = { data: new Uint8Array(0), lamports: 0n, owner: SYSTEM_PROGRAM_ADDRESS };
    const read = parseMultipleAccounts(multipleAccountsText(1, 5000, [CLOCK, system]), 2);
    expect(read?.items).toEqual([{ owner: SYSTEM_PROGRAM_ADDRESS, dataBase64: '', lamports: 0n }]);
  });

  const failures: [string, string, number][] = [
    ['not JSON', '{"jsonrpc":"2.0",', 4],
    ['a JSON-RPC error', JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32005, message: 'Node is behind' } }), 4],
    ['no result', JSON.stringify({ jsonrpc: '2.0', id: 1 }), 4],
    ['a result without context', JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value: [] } }), 0],
    ['a slot that is a string', multipleAccountsText(1, 5000, [CLOCK]).replace('"slot":5000', '"slot":"5000"'), 1],
    ['a negative slot', multipleAccountsText(1, -1, [CLOCK]), 1],
    ['a slot above 2^53', multipleAccountsText(1, 5000, [CLOCK]).replace('"slot":5000', '"slot":9007199254740993'), 1],
    ['a short array', multipleAccountsText(1, 5000, [CLOCK, STAKE, null]), 4],
    ['a long array', multipleAccountsText(1, 5000, [CLOCK, STAKE, null, STAKE, null]), 4],
    ['value not an array', JSON.stringify({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: {} } }), 1],
    ['no keys at all', multipleAccountsText(1, 5000, []), 0],
    ['an entry that is not an object', withEntry(1, 'account'), 4],
    ['data not [string, base64]', withEntry(1, { ...goodEntry(), data: [encodeBase64(STAKE_DATA), 'base58'] }), 4],
    ['data as a bare string', withEntry(1, { ...goodEntry(), data: encodeBase64(STAKE_DATA) }), 4],
    ['data with a third element', withEntry(1, { ...goodEntry(), data: [encodeBase64(STAKE_DATA), 'base64', 'x'] }), 4],
    ['data that is not canonical base64', withEntry(1, { ...goodEntry(), data: ['AB==', 'base64'] }), 4],
    ['data with a bad character', withEntry(1, { ...goodEntry(), data: ['AA-A', 'base64'] }), 4],
    ['an owner that is not a string', withEntry(1, { ...goodEntry(), owner: 7 }), 4],
    ['an owner that is not an address', withEntry(1, { ...goodEntry(), owner: 'Stake111' }), 4],
    ['lamports as a string', withEntry(1, { ...goodEntry(), lamports: '5' }), 4],
    ['negative lamports', withEntry(1, { ...goodEntry(), lamports: -5 }), 4],
    ['fractional lamports', withEntry(1, { ...goodEntry(), lamports: 5.5 }), 4],
    ['no lamports', withEntry(1, { data: goodEntry().data, owner: STAKE_PROGRAM_ADDRESS }), 4],
    ['a missing Clock', multipleAccountsText(1, 5000, [null, STAKE, null, STAKE]), 4],
    ['a Clock of another owner', multipleAccountsText(1, 5000, [{ ...CLOCK, owner: STAKE_PROGRAM_ADDRESS }, STAKE, null, STAKE]), 4],
    ['a Clock under 40 bytes', multipleAccountsText(1, 5000, [{ ...CLOCK, data: clockData(1n, 1n, 1n).slice(0, 39) }, STAKE, null, STAKE]), 4],
    ['a stake account where the Clock should be', multipleAccountsText(1, 5000, [STAKE, CLOCK, null, STAKE]), 4],
  ];

  it.each(failures)('fails the whole chunk on %s', (_case, text, keyCount) => {
    expect(parseMultipleAccounts(text, keyCount)).toBeNull();
  });
});

describe('readChunk', () => {
  const deps = (upstream: { fetch: typeof fetch }, timeoutMs = 200) => ({
    endpoints: { primary: PRIMARY_URL },
    options: { timeoutMs, retryDelayMs: 0, fetch: upstream.fetch },
  });

  it('one getMultipleAccounts for the keys; the parsed read and the endpoint that answered', async () => {
    const upstream = fakeUpstream((call) => multipleAccountsAnswer(call.json.id, 5000, [CLOCK, STAKE, null, STAKE]));
    const result = await readChunk(KEYS, deps(upstream));
    expect(result.ok && result.read.items).toHaveLength(3);
    expect(result.ok && result.endpoint).toBe('primary');
    expect(upstream.calls.map((c) => c.raw)).toEqual([multipleAccountsRequest(KEYS)]);

    const fallback = fakeUpstream((call, i) =>
      i === 0 ? new Response('no', { status: 503 }) : multipleAccountsAnswer(call.json.id, 5000, [CLOCK, STAKE, null, STAKE]),
    );
    const viaFallback = await readChunk(KEYS, { ...deps(fallback), endpoints: { primary: PRIMARY_URL, fallback: FALLBACK_URL } });
    expect(viaFallback.ok && viaFallback.endpoint).toBe('fallback');
  });

  it('a malformed answer is not retried and reads as malformed', async () => {
    const upstream = fakeUpstream((call) => multipleAccountsAnswer(call.json.id, 5000, [CLOCK, STAKE]));
    expect(await readChunk(KEYS, deps(upstream))).toEqual({ ok: false, reason: 'malformed' });
    expect(upstream.calls).toHaveLength(1);
  });

  it('upstream failures after the read retries: unavailable, timeout', async () => {
    const down = fakeUpstream(() => new Response('no', { status: 503 }));
    expect(await readChunk(KEYS, deps(down))).toEqual({ ok: false, reason: 'unavailable' });
    expect(down.calls).toHaveLength(3);
    const hang = fakeUpstream(() => 'hang');
    expect(await readChunk(KEYS, deps(hang, 30))).toEqual({ ok: false, reason: 'timeout' });
  });
});

describe('genesis hash', () => {
  it('GENESIS_REQUEST asks getGenesisHash', () => {
    expect(JSON.parse(GENESIS_REQUEST)).toEqual({ jsonrpc: '2.0', id: 1, method: 'getGenesisHash', params: [] });
  });

  it('parseGenesisHash: the hash, or null for anything else', async () => {
    const text = async (response: Response) => response.text();
    expect(parseGenesisHash(await text(rpcResponse(1, GENESIS_HASH.devnet)))).toBe(GENESIS_HASH.devnet);
    expect(parseGenesisHash(await text(rpcResponse(1, GENESIS_HASH.mainnet)))).toBe(GENESIS_HASH.mainnet);
    expect(parseGenesisHash('not json')).toBeNull();
    expect(parseGenesisHash(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'x' } }))).toBeNull();
    expect(parseGenesisHash(await text(rpcResponse(1, 42)))).toBeNull();
    expect(parseGenesisHash(await text(rpcResponse(1, 'not-a-hash')))).toBeNull();
  });
});

describe('anyGone', () => {
  const stake: RawItem = { owner: STAKE_PROGRAM_ADDRESS, dataBase64: '', lamports: 1n };
  const system: RawItem = { owner: SYSTEM_PROGRAM_ADDRESS, dataBase64: '', lamports: 1n };
  const items = (gone: number, total: number, as: RawItem | null = null) =>
    Array.from({ length: total }, (_, i) => (total - i <= gone ? as : stake));

  it('true as soon as one account is missing or no longer owned by the stake program', () => {
    expect(anyGone(items(1, 1))).toBe(true);
    expect(anyGone(items(1, 2))).toBe(true);
    expect(anyGone(items(1, 99))).toBe(true);
    expect(anyGone(items(1, 99, system))).toBe(true);
    expect(anyGone(items(99, 99))).toBe(true);
    expect(anyGone(items(0, 99))).toBe(false);
    expect(anyGone([])).toBe(false);
  });
});
