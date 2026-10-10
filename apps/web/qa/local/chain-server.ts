// Local Solana JSON-RPC over LiteSVM for the QA suite (.claude/skills/qa-e2e/SKILL.md, target `local`). Test-only code:
// it runs the committed mainnet stake program build (core's TestChain) and answers the JSON-RPC methods the worker
// forwards (CLAUDE.md section 8) plus getProgramAccounts and getGenesisHash, in the shapes a real node answers with.
// The worker under `wrangler dev` uses it as RPC_URL, so the site, the worker and the stake program are all real;
// only the cluster is local. The clock follows this machine's wall clock (the site refuses a skewed network time).
//
// Control endpoints for the suite (never on a real cluster): POST /qa/fund, /qa/stake, /qa/warp-epoch,
// /qa/expire-blockhash, /qa/fail-next, /qa/hold, /qa/land-held, GET /qa/state.
//
// Usage: node apps/web/qa/local/chain-server.ts [--port 8899]
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  address,
  getBase58Encoder,
  getBase64Decoder,
  getBase64Encoder,
  getTransactionDecoder,
  isSolanaError,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
  type Address,
  type Signature,
  type SolanaError,
} from '@solana/kit';
import { GENESIS_HASH, STAKE_ACCOUNT_SIZE } from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { chainErrorFromSolanaError } from '@stakeward/core/test/support';
import { TestChain } from '@stakeward/core/test/svm';

const port = Number(argValue('--port') ?? process.env['QA_CHAIN_PORT'] ?? '8899');

const testChain = await TestChain.create();
// preflight: like a node with skipPreflight false, as the site sends (a failing transaction never lands).
const chain = new LiteSvmChain(testChain, { preflight: true });
let voteAccount: Address | null = null;
const startedAt = Date.now();

/** The chain clock follows the wall clock (seconds), so the site's clock-skew check passes and locks expire in time. */
function syncClock(): void {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (testChain.clock().unixTimestamp < now) testChain.setTime(now);
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

class RpcError extends Error {
  readonly code: number;
  readonly data: Json | undefined;
  constructor(code: number, message: string, data?: Json) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

const b64decode = getBase64Encoder(); // base64 string -> bytes
const b64encode = getBase64Decoder(); // bytes -> base64 string
const b58bytes = getBase58Encoder(); // base58 string -> bytes

function num(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RpcError(-32603, `value ${String(value)} exceeds JSON number range`);
  return Number(value);
}

function context(): { slot: number } {
  return { slot: num(testChain.svm.getClock().slot) };
}

function encodeAccount(raw: { data: ArrayLike<number>; lamports: bigint; owner: string } | null): Json {
  if (raw === null) return null;
  const data = Uint8Array.from(raw.data);
  return {
    data: [b64encode.decode(data), 'base64'],
    executable: false,
    lamports: num(raw.lamports),
    owner: raw.owner,
    rentEpoch: 0,
    space: data.length,
  };
}

/** A transaction error as RPC JSON (`{"InstructionError":[2,{"Custom":1}]}`, `"BlockhashNotFound"`), from kit's error. */
function errorJson(error: unknown): Json {
  if (!isSolanaError(error)) return { InstructionError: [0, 'GenericError'] };
  const plain = chainErrorFromSolanaError(error);
  if (plain.kind === 'custom') return { InstructionError: [plain.index, { Custom: plain.code }] };
  if (plain.kind === 'instruction') return { InstructionError: [plain.index, plain.name] };
  return plain.name;
}

function wire(param: unknown): Uint8Array {
  if (typeof param !== 'string') throw new RpcError(-32602, 'Invalid params: expected a base64 transaction');
  return Uint8Array.from(b64decode.encode(param));
}

function addr(param: unknown): Address {
  if (typeof param !== 'string') throw new RpcError(-32602, 'Invalid params: expected an address');
  try {
    return address(param);
  } catch {
    throw new RpcError(-32602, `Invalid param: ${param} is not an address`);
  }
}

type Filter = { dataSize?: number; memcmp?: { offset: number; bytes: string; encoding?: string } };

function matches(data: ArrayLike<number>, filters: readonly Filter[]): boolean {
  return filters.every((filter) => {
    if (filter.dataSize !== undefined) return data.length === filter.dataSize;
    if (filter.memcmp !== undefined) {
      const { offset, bytes, encoding } = filter.memcmp;
      const needle = encoding === 'base64' ? b64decode.encode(bytes) : b58bytes.encode(bytes);
      if (offset + needle.length > data.length) return false;
      return needle.every((byte, i) => data[offset + i] === byte);
    }
    return true;
  });
}

const methods: Record<string, (params: unknown[]) => Promise<Json> | Json> = {
  getHealth: () => 'ok',
  getVersion: () => ({ 'solana-core': 'stakeward-qa-litesvm', 'feature-set': 0 }),
  // The worker's monitor checks it; this local chain stands in for devnet.
  getGenesisHash: () => GENESIS_HASH.devnet,
  getSlot: () => context().slot,
  async getLatestBlockhash() {
    const { blockhash, lastValidBlockHeight } = await chain.getLatestBlockhash();
    return { context: context(), value: { blockhash, lastValidBlockHeight: num(lastValidBlockHeight) } };
  },
  async getEpochInfo() {
    const info = await chain.getEpochInfo();
    return {
      absoluteSlot: context().slot,
      blockHeight: num(info.blockHeight),
      epoch: num(info.epoch),
      slotIndex: num(info.slotIndex),
      slotsInEpoch: num(info.slotsInEpoch),
      transactionCount: null,
    };
  },
  async getAccountInfo([target]) {
    const { accounts } = await chain.getAccounts([addr(target)]);
    return { context: context(), value: encodeAccount(accounts[0] ?? null) };
  },
  async getMultipleAccounts([targets]) {
    if (!Array.isArray(targets)) throw new RpcError(-32602, 'Invalid params: expected a list of addresses');
    const { accounts } = await chain.getAccounts(targets.map(addr));
    return { context: context(), value: accounts.map((account) => encodeAccount(account)) };
  },
  async getBalance([target]) {
    return { context: context(), value: num(await chain.getBalance(addr(target))) };
  },
  async getMinimumBalanceForRentExemption([size]) {
    return num(await chain.getMinimumBalanceForRentExemption(Number(size)));
  },
  getProgramAccounts([program, config]) {
    const options = (config ?? {}) as { filters?: Filter[]; withContext?: boolean };
    const value: Json[] = [];
    for (const account of testChain.svm.getProgramAccounts(addr(program))) {
      if (!matches(account.data, options.filters ?? [])) continue;
      value.push({
        pubkey: account.address,
        account: encodeAccount({ data: account.data, lamports: account.lamports, owner: account.programAddress }),
      });
    }
    return options.withContext === true ? { context: context(), value } : value;
  },
  async simulateTransaction([transaction]) {
    const result = await chain.simulate(wire(transaction));
    return {
      context: context(),
      value: {
        err: result.ok ? null : errorJson(result.error),
        logs: [...result.logs],
        unitsConsumed: result.unitsConsumed === null ? null : num(result.unitsConsumed),
        accounts: null,
        returnData: null,
      },
    };
  },
  async sendTransaction([transaction]) {
    const bytes = wire(transaction);
    try {
      getTransactionDecoder().decode(bytes);
    } catch {
      throw new RpcError(-32602, 'failed to deserialize solana_transaction::versioned::VersionedTransaction');
    }
    try {
      return await chain.send(bytes);
    } catch (error) {
      if (isSolanaError(error, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE)) {
        const cause = (error as SolanaError).cause;
        const json = errorJson(cause);
        throw new RpcError(-32002, `Transaction simulation failed: ${JSON.stringify(json)}`, {
          err: json,
          logs: [...(error.context.logs ?? [])],
          accounts: null,
          unitsConsumed: error.context.unitsConsumed === null ? null : num(error.context.unitsConsumed),
          returnData: null,
        });
      }
      throw new RpcError(-32003, error instanceof Error ? error.message : String(error));
    }
  },
  async getSignatureStatuses([signatures]) {
    if (!Array.isArray(signatures)) throw new RpcError(-32602, 'Invalid params: expected a list of signatures');
    const statuses = await chain.getSignatureStatuses(signatures as Signature[]);
    return {
      context: context(),
      value: statuses.map((status) =>
        status === null
          ? null
          : {
              slot: num(status.slot),
              confirmations: null,
              err: status.error === null ? null : errorJson(status.error),
              status: status.error === null ? { Ok: null } : { Err: errorJson(status.error) },
              confirmationStatus: status.confirmationStatus,
            },
      ),
    };
  },
  requestAirdrop([target, lamports]) {
    testChain.airdrop(addr(target), BigInt(Number(lamports)));
    return '1111111111111111111111111111111111111111111111111111111111111111';
  },
};

// ---- Control endpoints (QA only) ----

type Body = Record<string, unknown>;

const control: Record<string, (body: Body) => Promise<Json> | Json> = {
  /** { address, sol } */
  fund(body) {
    const sol = Number(body['sol'] ?? 1);
    testChain.airdrop(addr(body['address']), BigInt(Math.round(sol * 1e9)));
    return { ok: true, balance: num(testChain.balance(addr(body['address']))) };
  },
  /** { owner, sol?, staker? }: a new initialized stake account, withdrawer = owner, staker = owner unless given. */
  async stake(body) {
    const owner = addr(body['owner']);
    const staker = body['staker'] === undefined ? owner : addr(body['staker']);
    const lamports = BigInt(Math.round(Number(body['sol'] ?? 2) * 1e9));
    return { address: await testChain.createStakeAccount({ staker, withdrawer: owner, lamports }) };
  },
  /** A vote account to delegate to (created once). */
  async 'vote-account'() {
    voteAccount ??= await testChain.createVoteAccount();
    return { address: voteAccount };
  },
  /** Moves the cluster to the next epoch (activating stake turns active, deactivating turns inactive). */
  'warp-epoch'() {
    const { epoch } = testChain.clock();
    testChain.warpToEpoch(epoch + 1n);
    syncClock();
    return { epoch: num(testChain.clock().epoch) };
  },
  'expire-blockhash'() {
    chain.expireBlockhash();
    return { ok: true };
  },
  /** { method, times? }: the next calls of a ChainPort method fail like a dropped connection (TypeError). */
  'fail-next'(body) {
    const method = String(body['method']) as Parameters<LiteSvmChain['failNext']>[0];
    chain.failNext(method, new TypeError('fetch failed (QA fault injection)'), Number(body['times'] ?? 1));
    return { ok: true };
  },
  hold() {
    chain.holdTransactions();
    return { ok: true };
  },
  'land-held'() {
    chain.landHeld();
    return { ok: true };
  },
  state() {
    const clock = testChain.clock();
    return {
      unixTimestamp: num(clock.unixTimestamp),
      epoch: num(clock.epoch),
      slot: context().slot,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    };
  },
};

// ---- HTTP ----

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text === '' ? {} : JSON.parse(text);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function rpc(request: unknown): Promise<unknown> {
  const { id = null, method, params = [] } = (request ?? {}) as { id?: Json; method?: string; params?: unknown[] };
  const handler = method === undefined ? undefined : methods[method];
  if (handler === undefined) return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${String(method)}` } };
  try {
    syncClock();
    return { jsonrpc: '2.0', id, result: await handler(Array.isArray(params) ? params : []) };
  } catch (error) {
    if (error instanceof RpcError) {
      return { jsonrpc: '2.0', id, error: { code: error.code, message: error.message, ...(error.data === undefined ? {} : { data: error.data }) } };
    }
    return { jsonrpc: '2.0', id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } };
  }
}

const server = createServer((req, res) => {
  void (async () => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname.startsWith('/qa/')) {
        const handler = control[url.pathname.slice(4)];
        if (handler === undefined) {
          send(res, 404, { error: `unknown control ${url.pathname}` });
          return;
        }
        syncClock();
        send(res, 200, await handler((await readBody(req)) as Body));
        return;
      }
      if (req.method === 'GET') {
        send(res, 200, { ok: true, stakeAccountSize: STAKE_ACCOUNT_SIZE });
        return;
      }
      const body = await readBody(req);
      send(res, 200, Array.isArray(body) ? await Promise.all(body.map(rpc)) : await rpc(body));
    } catch (error) {
      send(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  })();
});

server.listen(port, '127.0.0.1', () => {
  syncClock();
  console.log(`QA chain (LiteSVM, stands in for devnet) listening on http://127.0.0.1:${String(port)}`);
});

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}
