// RPC adapter for the gate (devnet, mainnet): kit's HTTP RPC, sendTransaction as base64 without preflight (so an
// expected failure lands on chain and gets a signature), then getSignatureStatuses until confirmed or expired.
import { setTimeout as sleep } from 'node:timers/promises';
import {
  createSolanaRpc,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getI64Decoder,
  getSignatureFromTransaction,
  getSolanaErrorFromTransactionError,
  getStructDecoder,
  getTransactionDecoder,
  getU64Decoder,
  isSolanaError,
  lamports as toLamports,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  type Address,
  type Base58EncodedBytes,
  type Rpc,
  type Signature,
  type SolanaRpcApi,
} from '@solana/kit';
import {
  STAKE_ACCOUNT_OFFSETS,
  STAKE_ACCOUNT_SIZE,
  STAKE_PROGRAM_ADDRESS,
  SYSVAR_CLOCK_ADDRESS,
  type RawAccount,
} from '@stakeward/core';
import { chainErrorFromSolanaError } from '@stakeward/core/test/support';
import { readProgramElf, type GateChain, type TxOutcome } from './chain.ts';

export const PUBLIC_RPC_URL = {
  devnet: 'https://api.devnet.solana.com',
  mainnet: 'https://api.mainnet-beta.solana.com',
} as const;

/** Moved to core (the worker's monitor checks it too); re-exported so the scripts keep importing it from here. */
export { GENESIS_HASH } from '@stakeward/core';

const REQUEST_TIMEOUT_MS = 15_000;
/** Public endpoints answer 429 when polled fast: retry with backoff (1, 2, 4, 8, 15 s). */
const MAX_REQUEST_ATTEMPTS = 6;
const MAX_RETRY_DELAY_MS = 15_000;

export type RpcChainOptions = {
  log?: (line: string) => void;
  /** Between getSignatureStatuses polls. Default 2 s. */
  pollIntervalMs?: number;
  /** Between repeated sendTransaction of the same bytes until it lands. Default 6 s. */
  resendIntervalMs?: number;
  /** First retry delay after a transient RPC failure; doubles each time. Default 1 s. */
  retryDelayMs?: number;
  /** A nonce transaction does not expire; give up on it after this long. Default 120 s. */
  nonceTimeoutMs?: number;
};

/** Clock sysvar layout: slot, epoch_start_timestamp, epoch, leader_schedule_epoch, unix_timestamp. */
const clockDecoder = getStructDecoder([
  ['slot', getU64Decoder()],
  ['epochStartTimestamp', getI64Decoder()],
  ['epoch', getU64Decoder()],
  ['leaderScheduleEpoch', getU64Decoder()],
  ['unixTimestamp', getI64Decoder()],
]);

export type RpcGateChain = GateChain & {
  genesisHash(): Promise<string>;
  epochInfo(): Promise<{ epoch: bigint; slotIndex: bigint; slotsInEpoch: bigint }>;
  requestAirdrop(address: Address, lamports: bigint): Promise<Signature>;
};

/** Rate limits, server errors, timeouts and dropped connections: worth another try. */
function isTransient(error: unknown): boolean {
  if (isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR)) {
    return error.context.statusCode === 429 || error.context.statusCode >= 500;
  }
  return error instanceof Error && ['TimeoutError', 'AbortError', 'TypeError'].includes(error.name);
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createRpcChain(url: string, options: RpcChainOptions = {}): RpcGateChain {
  return createRpcChainFromRpc(createSolanaRpc(url), options);
}

export function createRpcChainFromRpc(rpc: Rpc<SolanaRpcApi>, options: RpcChainOptions = {}): RpcGateChain {
  const log = options.log ?? (() => undefined);
  const pollIntervalMs = options.pollIntervalMs ?? 2_000;
  const resendIntervalMs = options.resendIntervalMs ?? 6_000;
  const retryDelayMs = options.retryDelayMs ?? 1_000;
  const nonceTimeoutMs = options.nonceTimeoutMs ?? 120_000;
  let voteAccount: Promise<Address> | null = null;

  /** Sends one RPC request (with a timeout), retrying transient failures with exponential backoff. */
  async function call<T>(method: string, request: { send(options: { abortSignal: AbortSignal }): Promise<T> }) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await request.send({ abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      } catch (error) {
        if (attempt >= MAX_REQUEST_ATTEMPTS || !isTransient(error)) throw error;
        const delay = Math.min(retryDelayMs * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
        log(`${method}: ${message(error)}; retrying in ${String(delay / 1_000)} s`);
        await sleep(delay);
      }
    }
  }

  async function account(address: Address): Promise<RawAccount | null> {
    const { value } = await call('getAccountInfo', rpc.getAccountInfo(address, { encoding: 'base64' }));
    if (value === null) return null;
    return { address, data: getBase64Encoder().encode(value.data[0]), lamports: value.lamports, owner: value.owner };
  }

  async function finalStatus(signature: Signature, searchTransactionHistory: boolean): Promise<TxOutcome | null> {
    const { value } = await call('getSignatureStatuses', rpc.getSignatureStatuses([signature], { searchTransactionHistory }));
    const [status] = value;
    if (status === null || status === undefined) return null;
    if (status.confirmationStatus !== 'confirmed' && status.confirmationStatus !== 'finalized') return null;
    if (status.err === null) return { status: 'ok', signature };
    return { status: 'failed', signature, error: chainErrorFromSolanaError(getSolanaErrorFromTransactionError(status.err)) };
  }

  return {
    async genesisHash() {
      return call('getGenesisHash', rpc.getGenesisHash());
    },
    async epochInfo() {
      const info = await call('getEpochInfo', rpc.getEpochInfo());
      return { epoch: info.epoch, slotIndex: info.slotIndex, slotsInEpoch: info.slotsInEpoch };
    },
    async requestAirdrop(address, lamports) {
      return call('requestAirdrop', rpc.requestAirdrop(address, toLamports(lamports)));
    },
    async clock() {
      const clock = await account(SYSVAR_CLOCK_ADDRESS);
      if (clock === null) throw new Error('Clock sysvar not found');
      const decoded = clockDecoder.decode(clock.data);
      return { unixTimestamp: decoded.unixTimestamp, epoch: decoded.epoch };
    },
    async lifetime() {
      const { value } = await call('getLatestBlockhash', rpc.getLatestBlockhash());
      return { kind: 'blockhash', blockhash: value.blockhash, lastValidBlockHeight: value.lastValidBlockHeight };
    },
    async rentExempt(space) {
      return call('getMinimumBalanceForRentExemption', rpc.getMinimumBalanceForRentExemption(BigInt(space)));
    },
    async balance(address) {
      const { value } = await call('getBalance', rpc.getBalance(address));
      return value;
    },
    account,
    async send(bytes, lifetime) {
      const transaction = getTransactionDecoder().decode(bytes);
      const signature = getSignatureFromTransaction(transaction);
      const wire = getBase64EncodedWireTransaction(transaction);
      const deadline = Date.now() + nonceTimeoutMs;
      let lastSend: number | null = null;
      for (;;) {
        if (lastSend === null || Date.now() - lastSend >= resendIntervalMs) {
          lastSend = Date.now();
          try {
            await call('sendTransaction', rpc.sendTransaction(wire, { encoding: 'base64', skipPreflight: true }));
          } catch (error) {
            log(`sendTransaction ${signature}: ${message(error)}`); // polled below; resent on the next round
          }
        }
        await sleep(pollIntervalMs);
        const outcome = await finalStatus(signature, false);
        if (outcome !== null) return outcome;
        const expired =
          lifetime.kind === 'blockhash'
            ? (await call('getBlockHeight', rpc.getBlockHeight())) > lifetime.lastValidBlockHeight
            : Date.now() > deadline;
        if (expired) return (await finalStatus(signature, true)) ?? { status: 'dropped', signature };
      }
    },
    voteAccount() {
      voteAccount ??= call('getVoteAccounts', rpc.getVoteAccounts()).then(({ current }) => {
        const [best] = [...current].sort((a, b) => (b.activatedStake > a.activatedStake ? 1 : -1));
        if (best === undefined) throw new Error('No active vote account on this cluster');
        return best.votePubkey;
      });
      return voteAccount;
    },
    async stakeAccountsOf(withdrawer) {
      const request = rpc.getProgramAccounts(STAKE_PROGRAM_ADDRESS, {
        encoding: 'base64',
        dataSlice: { offset: 0, length: 0 },
        filters: [
          { dataSize: BigInt(STAKE_ACCOUNT_SIZE) },
          {
            memcmp: {
              offset: BigInt(STAKE_ACCOUNT_OFFSETS.withdrawer),
              bytes: withdrawer as string as Base58EncodedBytes,
              encoding: 'base58',
            },
          },
        ],
      });
      return (await call('getProgramAccounts', request)).map((item) => item.pubkey);
    },
    programElf: () => readProgramElf(account),
  };
}
