// A scripted Solana RPC for the monitor tests: accounts in a map, a slot and a cluster clock, answering
// getMultipleAccounts (Clock sysvar included), getProgramAccounts (filters applied for real), getGenesisHash and
// sendTransaction (scripted by `sendReply`) the way an RPC node writes them (lamports as bare JSON numbers, exact above
// 2^53).
import { getBase58Encoder, type Address } from '@solana/kit';
import { GENESIS_HASH, STAKE_PROGRAM_ADDRESS, SYSVAR_CLOCK_ADDRESS, SYSVAR_PROGRAM_ADDRESS } from '@stakeward/core';
import { encodeBase64 } from '../../src/base64.ts';
import { multipleAccountsText, type AccountJson } from '../fakes.ts';
import { clockData, stakeAccountData, type StakeAccountSpec } from '../transactions.ts';

export type ChainAccount = { data: Uint8Array; lamports: bigint; owner?: Address };

/**
 * A scripted failure of one call: HTTP 503, no answer until aborted, a network error, a JSON-RPC error, or (for
 * getMultipleAccounts) one entry too few.
 */
export type ChainFailure = 503 | 'hang' | 'network-error' | { rpcError: number } | 'short';

export type ChainCall = {
  endpoint: 'primary' | 'fallback' | 'monitor';
  method: string;
  params: unknown[];
  /** Keys of a getMultipleAccounts call. */
  keys: Address[];
  /** What the call got: 'answer' or the scripted failure. */
  outcome: 'answer' | ChainFailure;
};

type Filter = { dataSize?: number; memcmp?: { offset: number; bytes: string; encoding?: string } };

const CLOCK_LAMPORTS = 1_169_280n;

export class FakeChain {
  readonly accounts = new Map<Address, ChainAccount>();
  /** The harness moves it with the time (harness.ts `at`). */
  slot = 1;
  clock = { unixTimestamp: 0n, epoch: 950n };
  readonly calls: ChainCall[] = [];
  private readonly failures = new Map<string, ChainFailure[]>();
  private flakyTimes = 0;
  private readonly flakyLeft = new Map<string, number>();
  private lag = 0;
  private genesisHash: string = GENESIS_HASH.devnet;
  private readonly hooks: ((call: ChainCall) => void | Promise<void>)[] = [];
  /** What sendTransaction answers: a signature (`result`) by default, or a JSON-RPC error. */
  sendReply: (params: unknown[]) => { result: string } | { error: { code: number; message: string; data?: unknown } } =
    () => ({ result: '1111111111111111111111111111111111111111111111111111111111111111' });

  /** Puts a stake account built from `spec` (test/transactions.ts) at `address`. */
  putStake(address: Address, spec: StakeAccountSpec, lamports = 10_000_000_000n): void {
    this.accounts.set(address, { data: stakeAccountData(spec), lamports });
  }

  set(address: Address, account: ChainAccount): void {
    this.accounts.set(address, account);
  }

  remove(address: Address): void {
    this.accounts.delete(address);
  }

  /** The next calls of `method` ('*' = any method) fail with `outcomes`, one each, in order. */
  failNext(method: string, outcomes: readonly ChainFailure[]): void {
    this.failures.set(method, [...(this.failures.get(method) ?? []), ...outcomes]);
  }

  /** Every logical call fails `times` times with HTTP 503 before it is answered (per method; 0 turns it off). */
  flaky(times: number): void {
    this.flakyTimes = times;
    this.flakyLeft.clear();
  }

  /** Answers report a context slot `slots` behind the chain (a lagging node). */
  lagBy(slots: number): void {
    this.lag = slots;
  }

  genesis(hash: string): void {
    this.genesisHash = hash;
  }

  /** Runs after the answer is computed and before it is returned: a pause there is a pass paused after its read. */
  onCall(hook: (call: ChainCall) => void | Promise<void>): void {
    this.hooks.push(hook);
  }

  callsOf(method: string): ChainCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  async handle(endpoint: ChainCall['endpoint'], body: string, signal: AbortSignal | null | undefined): Promise<Response> {
    const json = JSON.parse(body) as { id: unknown; method: string; params: unknown[] };
    const { id, method, params } = json;
    const keys = method === 'getMultipleAccounts' ? ((params[0] ?? []) as Address[]) : [];
    const failure = this.nextFailure(method);
    const call: ChainCall = { endpoint, method, params, keys, outcome: failure ?? 'answer' };
    this.calls.push(call);

    let text: string | null = null;
    if (failure === null || failure === 'short') text = this.answer(id, method, params, failure === 'short');
    for (const hook of this.hooks) await hook(call);

    if (failure === 'network-error') throw new TypeError('Network connection lost');
    if (failure === 'hang') {
      return new Promise<Response>((_, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'));
        });
      });
    }
    if (failure === 503) return new Response('Service Unavailable', { status: 503 });
    if (failure !== null && typeof failure === 'object') {
      return jsonResponse(JSON.stringify({ jsonrpc: '2.0', id, error: { code: failure.rpcError, message: 'scripted error' } }));
    }
    return jsonResponse(text ?? '');
  }

  private nextFailure(method: string): ChainFailure | null {
    for (const name of [method, '*']) {
      const queue = this.failures.get(name);
      const next = queue?.shift();
      if (next !== undefined) return next;
    }
    if (this.flakyTimes > 0) {
      const left = this.flakyLeft.get(method) ?? this.flakyTimes;
      if (left > 0) {
        this.flakyLeft.set(method, left - 1);
        return 503;
      }
      this.flakyLeft.set(method, this.flakyTimes);
    }
    return null;
  }

  private answer(id: unknown, method: string, params: unknown[], short: boolean): string {
    const slot = this.slot - this.lag;
    switch (method) {
      case 'getMultipleAccounts': {
        const keys = (params[0] ?? []) as Address[];
        const items = keys.map((key): AccountJson => {
          if (key === SYSVAR_CLOCK_ADDRESS) {
            const data = clockData(BigInt(slot), this.clock.epoch, this.clock.unixTimestamp);
            return { data, lamports: CLOCK_LAMPORTS, owner: SYSVAR_PROGRAM_ADDRESS };
          }
          const account = this.accounts.get(key);
          return account === undefined ? null : { ...account, owner: account.owner ?? STAKE_PROGRAM_ADDRESS };
        });
        return multipleAccountsText(id, slot, short ? items.slice(0, -1) : items);
      }
      case 'getProgramAccounts':
        return this.programAccounts(id, slot, params);
      case 'getGenesisHash':
        return JSON.stringify({ jsonrpc: '2.0', id, result: this.genesisHash });
      case 'sendTransaction':
        return JSON.stringify({ jsonrpc: '2.0', id, ...this.sendReply(params) });
      default:
        return JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
    }
  }

  private programAccounts(id: unknown, slot: number, params: unknown[]): string {
    const program = params[0] as Address;
    const config = (params[1] ?? {}) as { filters?: Filter[]; withContext?: boolean; encoding?: string };
    if (config.encoding !== 'base64') throw new Error('FakeChain: getProgramAccounts without base64 encoding');
    const filters = config.filters ?? [];
    const value: unknown[] = [];
    for (const [pubkey, account] of [...this.accounts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if ((account.owner ?? STAKE_PROGRAM_ADDRESS) !== program) continue;
      if (!filters.every((filter) => matches(account.data, filter))) continue;
      value.push({
        pubkey,
        account: {
          data: [encodeBase64(account.data), 'base64'],
          executable: false,
          lamports: account.lamports.toString(),
          owner: program,
          rentEpoch: '18446744073709551615',
          space: account.data.length,
        },
      });
    }
    const result = config.withContext === true ? { context: { apiVersion: '3.0.6', slot }, value } : value;
    return JSON.stringify({ jsonrpc: '2.0', id, result }).replace(/"(lamports|rentEpoch)":"([0-9]+)"/g, '"$1":$2');
  }
}

function matches(data: Uint8Array, filter: Filter): boolean {
  if (filter.dataSize !== undefined) return data.length === filter.dataSize;
  if (filter.memcmp !== undefined) {
    if (filter.memcmp.encoding !== undefined && filter.memcmp.encoding !== 'base58') {
      throw new Error('FakeChain: memcmp in another encoding than base58');
    }
    const bytes = getBase58Encoder().encode(filter.memcmp.bytes);
    const { offset } = filter.memcmp;
    if (offset + bytes.length > data.length) return false;
    return bytes.every((byte, i) => data[offset + i] === byte);
  }
  throw new Error('FakeChain: unknown filter');
}

function jsonResponse(text: string): Response {
  return new Response(text, { headers: { 'Content-Type': 'application/json' } });
}
