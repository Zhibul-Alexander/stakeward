import {
  getBase64Decoder,
  getBase64Encoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
  isAddress,
  isSolanaError,
  SOLANA_ERROR__TRANSACTION_ERROR__ALREADY_PROCESSED,
  unwrapSimulationError,
  type Address,
  type Blockhash,
  type ReadonlyUint8Array,
  type Signature,
} from '@solana/kit';
import {
  decodeClockSysvar,
  stakeAccountsFromJson,
  SYSVAR_CLOCK_ADDRESS,
  type ChainClock,
  type ChainPort,
  type EpochInfo,
  type LatestBlockhash,
  type RawAccount,
  type SimulationResult,
  type StakeAccount,
  type StakeAccountFilter,
  type TransactionStatus,
} from '@stakeward/core';
import { earlierUnanswered, isRecord, MAX_RETRIES, Transport, type TransportOptions } from './transport.ts';

export type HttpChainOptions = TransportOptions & {
  /** JSON-RPC proxy of the worker (CLAUDE.md section 8). */
  rpcUrl?: string;
  /** Stake account search of the worker. */
  stakeAccountsUrl?: string;
};

/** getMultipleAccounts takes up to 100 keys (the proxy enforces it); getSignatureStatuses up to 256. */
const MAX_ACCOUNTS_PER_CALL = 100;
const MAX_SIGNATURES_PER_CALL = 256;
const COMMITMENT = 'confirmed';

const READ = { retries: MAX_RETRIES } as const;

/**
 * A send whose answer was lost on an earlier attempt (that attempt may have reached the network) and whose resend of
 * the same bytes then failed, e.g. with a rate limit or a lagging node's BlockhashNotFound: the first attempt may still
 * land until its blockhash expires, so the outcome is not known. `cause` is the lost attempt's failure, so
 * translateError reads it as a network failure (polled, never rebuilt); `answer` is what the resend got.
 */
export class SendOutcomeUnknownError extends Error {
  readonly answer: unknown;

  constructor(lost: unknown, answer: unknown) {
    super('An earlier attempt to send got no answer, so the transaction may still go through', { cause: lost });
    this.name = 'SendOutcomeUnknownError';
    this.answer = answer;
  }
}

/**
 * Exactly what HttpChain sends to POST /api/rpc, method by method (the worker's allow-list checks the same shapes):
 *
 *   getMultipleAccounts      [addresses (1..100), { encoding: 'base64', commitment: 'confirmed' }]
 *   getAccountInfo           [SysvarC1ock11111111111111111111111111111111, { encoding: 'base64', commitment: 'confirmed' }]
 *   getLatestBlockhash       [{ commitment: 'confirmed' }]
 *   getEpochInfo             [{ commitment: 'confirmed' }]                      (epoch position and block height; getBlockHeight is not allowed)
 *   getBalance               [address, { commitment: 'confirmed' }]
 *   getMinimumBalanceForRentExemption [size]
 *   simulateTransaction      [base64 wire, { encoding: 'base64', sigVerify: false, commitment: 'confirmed' }]
 *   sendTransaction          [base64 wire, { encoding: 'base64', preflightCommitment: 'confirmed' }]
 *   getSignatureStatuses     [signatures (1..256)]
 *
 * plus GET /api/stake-accounts?withdrawer=<address> or ?custodian=<address>, answered as core's StakeAccountsJson.
 */
export class HttpChain implements ChainPort {
  private readonly transport: Transport;
  private readonly rpcUrl: string;
  private readonly stakeAccountsUrl: string;

  constructor(options: HttpChainOptions = {}) {
    this.transport = new Transport(options);
    this.rpcUrl = options.rpcUrl ?? '/api/rpc';
    this.stakeAccountsUrl = options.stakeAccountsUrl ?? '/api/stake-accounts';
  }

  async getAccounts(addresses: readonly Address[]): Promise<{ slot: bigint; accounts: readonly (RawAccount | null)[] }> {
    let slot: bigint | null = null;
    const accounts: (RawAccount | null)[] = [];
    // More than 100 addresses take several calls; the slot reported is the lowest one read.
    for (const chunk of chunks(addresses, MAX_ACCOUNTS_PER_CALL)) {
      const result = await this.call('getMultipleAccounts', [chunk, { encoding: 'base64', commitment: COMMITMENT }]);
      const { context, value } = contextValue(result, 'getMultipleAccounts');
      if (!Array.isArray(value) || value.length !== chunk.length) throw malformed('getMultipleAccounts: wrong length');
      slot = slot === null || context < slot ? context : slot;
      chunk.forEach((address, index) => accounts.push(rawAccount(address, value[index])));
    }
    return { slot: slot ?? (await this.getClock()).slot, accounts };
  }

  async getClock(): Promise<ChainClock> {
    const result = await this.call('getAccountInfo', [SYSVAR_CLOCK_ADDRESS, { encoding: 'base64', commitment: COMMITMENT }]);
    const account = rawAccount(SYSVAR_CLOCK_ADDRESS, contextValue(result, 'getAccountInfo').value);
    const clock = account === null ? null : decodeClockSysvar(account.data);
    if (clock === null) throw malformed('the Clock sysvar is missing');
    return clock;
  }

  async getLatestBlockhash(): Promise<LatestBlockhash> {
    const result = await this.call('getLatestBlockhash', [{ commitment: COMMITMENT }]);
    const value = contextValue(result, 'getLatestBlockhash').value;
    if (!isRecord(value) || typeof value['blockhash'] !== 'string' || typeof value['lastValidBlockHeight'] !== 'bigint') {
      throw malformed('getLatestBlockhash');
    }
    // A blockhash is 32 bytes in base58, the same alphabet and length as an address.
    if (!isAddress(value['blockhash'])) throw malformed('getLatestBlockhash: not a blockhash');
    return { blockhash: value['blockhash'] as string as Blockhash, lastValidBlockHeight: value['lastValidBlockHeight'] };
  }

  async getBlockHeight(): Promise<bigint> {
    return (await this.getEpochInfo()).blockHeight;
  }

  async getEpochInfo(): Promise<EpochInfo> {
    const result = await this.call('getEpochInfo', [{ commitment: COMMITMENT }]);
    if (!isRecord(result)) throw malformed('getEpochInfo');
    const { epoch, slotIndex, slotsInEpoch, blockHeight } = result;
    if (
      typeof epoch !== 'bigint' ||
      typeof slotIndex !== 'bigint' ||
      typeof slotsInEpoch !== 'bigint' ||
      typeof blockHeight !== 'bigint'
    ) {
      throw malformed('getEpochInfo');
    }
    // A slot index outside the epoch would make every estimate built on it nonsense.
    if (slotsInEpoch <= 0n || slotIndex < 0n || slotIndex >= slotsInEpoch) throw malformed('getEpochInfo: slot index');
    return { epoch, slotIndex, slotsInEpoch, blockHeight };
  }

  async getBalance(address: Address): Promise<bigint> {
    const result = await this.call('getBalance', [address, { commitment: COMMITMENT }]);
    const value = contextValue(result, 'getBalance').value;
    if (typeof value !== 'bigint') throw malformed('getBalance');
    return value;
  }

  async getMinimumBalanceForRentExemption(size: number): Promise<bigint> {
    const result = await this.call('getMinimumBalanceForRentExemption', [size]);
    if (typeof result !== 'bigint') throw malformed('getMinimumBalanceForRentExemption');
    return result;
  }

  async simulate(transaction: ReadonlyUint8Array): Promise<SimulationResult> {
    const result = await this.call('simulateTransaction', [
      base64(transaction),
      { encoding: 'base64', sigVerify: false, commitment: COMMITMENT },
    ]);
    const value = contextValue(result, 'simulateTransaction').value;
    if (!isRecord(value)) throw malformed('simulateTransaction');
    const logs = Array.isArray(value['logs']) ? value['logs'].filter((line) => typeof line === 'string') : [];
    const unitsConsumed = typeof value['unitsConsumed'] === 'bigint' ? value['unitsConsumed'] : null;
    const error = value['err'] ?? null;
    return error === null ? { ok: true, logs, unitsConsumed } : { ok: false, logs, unitsConsumed, error };
  }

  /**
   * Sends with preflight. Transient failures are retried with the same bytes (CLAUDE.md section 12); never with other
   * bytes. A transaction the cluster already processed (an earlier attempt that did reach it) resolves with its
   * signature: whether it succeeded is the status's business. A blockhash transaction tells by AlreadyProcessed; a
   * durable-nonce one cannot, since landing advanced its nonce and the resend fails preflight with BlockhashNotFound
   * first. So when a send fails, the signature's status decides: known to the cluster, the transaction went in.
   * Not known yet after an attempt whose answer was lost, it may still be in flight: SendOutcomeUnknownError.
   */
  async send(transaction: ReadonlyUint8Array): Promise<Signature> {
    // The fee payer's signature is the transaction id. Throws when it is missing (translateError: missing-signature).
    const signature = getSignatureFromTransaction(getTransactionDecoder().decode(transaction));
    let returned: unknown;
    try {
      returned = await this.call('sendTransaction', [
        base64(transaction),
        { encoding: 'base64', preflightCommitment: COMMITMENT },
      ]);
    } catch (error) {
      if (isSolanaError(unwrapSimulationError(error), SOLANA_ERROR__TRANSACTION_ERROR__ALREADY_PROCESSED)) return signature;
      if (await this.knownToCluster(signature)) return signature;
      const lost = earlierUnanswered(error);
      if (lost !== undefined) throw new SendOutcomeUnknownError(lost, error);
      throw error;
    }
    if (returned !== signature) throw malformed(`sendTransaction answered ${String(returned)} for ${signature}`);
    return signature;
  }

  async getSignatureStatuses(signatures: readonly Signature[]): Promise<readonly (TransactionStatus | null)[]> {
    const statuses: (TransactionStatus | null)[] = [];
    for (const chunk of chunks(signatures, MAX_SIGNATURES_PER_CALL)) {
      const result = await this.call('getSignatureStatuses', [chunk]);
      const { value } = contextValue(result, 'getSignatureStatuses');
      if (!Array.isArray(value) || value.length !== chunk.length) throw malformed('getSignatureStatuses: wrong length');
      for (const status of value) statuses.push(transactionStatus(status));
    }
    return statuses;
  }

  async findStakeAccounts(filter: StakeAccountFilter): Promise<{ slot: bigint; accounts: readonly StakeAccount[] }> {
    const query = 'withdrawer' in filter ? `withdrawer=${filter.withdrawer}` : `custodian=${filter.custodian}`;
    // Strict parse shared with the worker (core json.ts): a malformed body throws, never a partial list.
    const { slot, accounts } = stakeAccountsFromJson(await this.transport.getJson(`${this.stakeAccountsUrl}?${query}`, READ));
    // The worker filters already; checking again costs nothing and keeps someone else's stake out of the viewer's list.
    const matching = accounts.filter((account) =>
      'withdrawer' in filter ? account.withdrawer === filter.withdrawer : account.lockup.custodian === filter.custodian,
    );
    return { slot, accounts: matching };
  }

  /** One status read without retries (the send that failed may have been a network failure already); false on error. */
  private async knownToCluster(signature: Signature): Promise<boolean> {
    try {
      const result = await this.transport.rpc(this.rpcUrl, 'getSignatureStatuses', [[signature]], { retries: 0 });
      const { value } = contextValue(result, 'getSignatureStatuses');
      return Array.isArray(value) && value.length === 1 && transactionStatus(value[0]) !== null;
    } catch {
      return false;
    }
  }

  private call(method: string, params: readonly unknown[]): Promise<unknown> {
    // Every method may be retried: reads are idempotent and sendTransaction resends the same signed bytes.
    return this.transport.rpc(this.rpcUrl, method, params, READ);
  }
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) out.push(items.slice(start, start + size));
  return out;
}

function contextValue(result: unknown, method: string): { context: bigint; value: unknown } {
  if (!isRecord(result) || !isRecord(result['context']) || !('value' in result)) throw malformed(method);
  const slot = result['context']['slot'];
  if (typeof slot !== 'bigint') throw malformed(`${method}: context.slot`);
  return { context: slot, value: result['value'] };
}

function rawAccount(address: Address, value: unknown): RawAccount | null {
  if (value === null) return null;
  if (!isRecord(value)) throw malformed(`account ${address}`);
  const { data, lamports, owner } = value;
  if (!Array.isArray(data) || data[1] !== 'base64' || typeof data[0] !== 'string') {
    throw malformed(`account ${address}: data is not base64`);
  }
  if (typeof lamports !== 'bigint' || typeof owner !== 'string' || !isAddress(owner)) {
    throw malformed(`account ${address}`);
  }
  return { address, data: getBase64Encoder().encode(data[0]), lamports, owner };
}

function transactionStatus(value: unknown): TransactionStatus | null {
  if (value === null) return null;
  if (!isRecord(value) || typeof value['slot'] !== 'bigint') throw malformed('getSignatureStatuses: status');
  const confirmation = value['confirmationStatus'];
  return {
    slot: value['slot'],
    confirmationStatus:
      confirmation === 'processed' || confirmation === 'confirmed' || confirmation === 'finalized' ? confirmation : null,
    error: value['err'] ?? null,
  };
}

function base64(bytes: ReadonlyUint8Array): string {
  return getBase64Decoder().decode(bytes);
}

function malformed(detail: string): Error {
  return new Error(`Malformed RPC response: ${detail}`);
}
