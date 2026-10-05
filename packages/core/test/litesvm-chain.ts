// LiteSvmChain: the ChainPort (CLAUDE.md section 3) on the LiteSVM harness, so product flows run against the real
// stake program in tests. Test-only (Node): product code never imports it, and no build may contain
// LITESVM_CHAIN_MARKER (apps/web/test/test-code-guard.test.ts, apps/web/test/build-output.test.ts).
import { createHash } from 'node:crypto';
import { getSolanaErrorFromLiteSvmFailure } from '@solana/kit-plugin-litesvm';
import {
  decompileTransactionMessage,
  getBase58Decoder,
  getBase58Encoder,
  getCompiledTransactionMessageDecoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
  isSolanaError,
  isTransactionMessageWithDurableNonceLifetime,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
  SOLANA_ERROR__TRANSACTION_ERROR__ALREADY_PROCESSED,
  SolanaError,
  type Address,
  type Blockhash,
  type ReadonlyUint8Array,
  type Signature,
  type Transaction,
} from '@solana/kit';
import { FailedTransactionMetadata } from 'litesvm';
import {
  decodeStakeAccount,
  STAKE_ACCOUNT_SIZE,
  STAKE_PROGRAM_ADDRESS,
  type ChainClock,
  type ChainPort,
  type EpochInfo,
  type LatestBlockhash,
  type RawAccount,
  type SimulationResult,
  type StakeAccount,
  type StakeAccountFilter,
  type TransactionStatus,
} from '../src/index.ts';
import { SLOTS_PER_EPOCH, type TestChain } from './svm.ts';

/** Present in every LiteSvmChain; a build that contains this string shipped test code (CLAUDE.md section 11). */
export const LITESVM_CHAIN_MARKER = 'stakeward-test-only:litesvm-chain';

/** Blocks a blockhash stays valid for, as on the real cluster (lastValidBlockHeight = height + 150). */
export const BLOCKHASH_VALIDITY_BLOCKS = 150n;

const START_BLOCK_HEIGHT = 1_000n;

export type LiteSvmChainOptions = {
  /**
   * Like RPC sendTransaction with preflight (HttpChain's setting, the default): a transaction that fails in simulation
   * is rejected and never lands. `false` executes it anyway, so it lands with an error that getSignatureStatuses
   * reports (a transaction that passed preflight and failed on chain).
   */
  preflight?: boolean;
};

type Method = keyof ChainPort;

type HeldTransaction = { signature: Signature; transaction: Transaction };

/**
 * ChainPort over a {@link TestChain}. Answers the way HttpChain does over RPC, so tests exercise the same paths:
 * - failures are the shapes `translateError` reads: a failed simulation carries the kit `SolanaError` of the
 *   transaction error; a send rejected in preflight throws the RPC preflight `SolanaError` with that error as `cause`;
 * - a resend of the same bytes resolves with the same signature (AlreadyProcessed means it already landed);
 * - getSignatureStatuses reports executed transactions as `confirmed`, with the error of a failed one.
 *
 * LiteSVM has no block height and keeps only the latest blockhash valid (TestChain.blockhashLifetime and every setup
 * transaction expire it). The chain emulates heights: a blockhash gets lastValidBlockHeight = height + 150 when first
 * handed out; once LiteSVM's latest blockhash changes, the height jumps past every earlier blockhash, so expiry looks
 * the same as on a cluster. Test controls: {@link expireBlockhash}, {@link advanceBlocks}, {@link holdTransactions},
 * {@link failNext}.
 *
 * Not emulated: a Lighthouse tail cannot execute (LiteSVM has no Lighthouse program), and simulating or sending a
 * durable-nonce transaction whose nonce equals the latest blockhash first expires that blockhash (LiteSVM rejects
 * such a transaction; on a cluster time moves on by itself).
 */
export class LiteSvmChain implements ChainPort {
  readonly marker = LITESVM_CHAIN_MARKER;
  readonly testChain: TestChain;
  private readonly preflight: boolean;

  private height = START_BLOCK_HEIGHT;
  private currentBlockhash: Blockhash | null = null;
  private currentLastValid = START_BLOCK_HEIGHT;
  /** Slot at which each transaction sent through this chain landed. */
  private readonly landedAtSlot = new Map<Signature, bigint>();
  private holding = false;
  private readonly held: HeldTransaction[] = [];
  private readonly failures = new Map<Method, Error[]>();

  constructor(testChain: TestChain, options: LiteSvmChainOptions = {}) {
    this.testChain = testChain;
    this.preflight = options.preflight ?? true;
  }

  // ---- ChainPort ----

  getAccounts(addresses: readonly Address[]): Promise<{ slot: bigint; accounts: readonly (RawAccount | null)[] }> {
    return this.answer('getAccounts', () => ({
      slot: this.slot(),
      accounts: addresses.map((address) => this.testChain.account(address)),
    }));
  }

  getClock(): Promise<ChainClock> {
    return this.answer('getClock', () => {
      const clock = this.testChain.svm.getClock();
      return { slot: clock.slot, epoch: clock.epoch, unixTimestamp: clock.unixTimestamp };
    });
  }

  getLatestBlockhash(): Promise<LatestBlockhash> {
    return this.answer('getLatestBlockhash', () => {
      const blockhash = this.sync();
      return { blockhash, lastValidBlockHeight: this.currentLastValid };
    });
  }

  getBlockHeight(): Promise<bigint> {
    return this.answer('getBlockHeight', () => {
      this.sync();
      return this.height;
    });
  }

  /**
   * TestChain's epochs are SLOTS_PER_EPOCH slots long and start at slot epoch x SLOTS_PER_EPOCH (warpToEpoch); the slot
   * index is clamped into the epoch, since setTime and LiteSVM's own slot moves can leave the clock off that grid.
   * Block height is the emulated one (getBlockHeight).
   */
  getEpochInfo(): Promise<EpochInfo> {
    return this.answer('getEpochInfo', () => {
      this.sync();
      const { epoch, slot } = this.testChain.svm.getClock();
      const offset = slot - epoch * SLOTS_PER_EPOCH;
      const slotIndex = offset < 0n ? 0n : offset > SLOTS_PER_EPOCH - 1n ? SLOTS_PER_EPOCH - 1n : offset;
      return { epoch, slotIndex, slotsInEpoch: SLOTS_PER_EPOCH, blockHeight: this.height };
    });
  }

  getBalance(address: Address): Promise<bigint> {
    return this.answer('getBalance', () => this.testChain.balance(address));
  }

  getMinimumBalanceForRentExemption(size: number): Promise<bigint> {
    return this.answer('getMinimumBalanceForRentExemption', () =>
      this.testChain.svm.minimumBalanceForRentExemption(BigInt(size)),
    );
  }

  simulate(transaction: ReadonlyUint8Array): Promise<SimulationResult> {
    return this.answer('simulate', () => this.simulateDecoded(this.decode(transaction)));
  }

  send(transaction: ReadonlyUint8Array): Promise<Signature> {
    return this.answer('send', () => {
      const decoded = this.decode(transaction);
      // Throws like RPC when the fee payer has not signed (translateError: missing-signature).
      const signature = getSignatureFromTransaction(decoded);
      if (this.landedAtSlot.has(signature) || this.held.some((entry) => entry.signature === signature)) return signature;
      if (this.preflight) {
        const simulation = this.simulateDecoded(decoded);
        if (!simulation.ok) {
          if (isSolanaError(simulation.error, SOLANA_ERROR__TRANSACTION_ERROR__ALREADY_PROCESSED)) return signature;
          throw preflightFailure(simulation);
        }
      }
      if (this.holding) {
        this.held.push({ signature, transaction: decoded });
        return signature;
      }
      this.execute(signature, decoded);
      return signature;
    });
  }

  getSignatureStatuses(signatures: readonly Signature[]): Promise<readonly (TransactionStatus | null)[]> {
    return this.answer('getSignatureStatuses', () =>
      signatures.map((signature): TransactionStatus | null => {
        const result = this.testChain.svm.getTransaction(signature);
        if (result === null) return null;
        const error = result instanceof FailedTransactionMetadata ? getSolanaErrorFromLiteSvmFailure(result) : null;
        return { slot: this.landedAtSlot.get(signature) ?? this.slot(), confirmationStatus: 'confirmed', error };
      }),
    );
  }

  findStakeAccounts(filter: StakeAccountFilter): Promise<{ slot: bigint; accounts: readonly StakeAccount[] }> {
    return this.answer('findStakeAccounts', () => {
      const accounts: StakeAccount[] = [];
      for (const account of this.testChain.svm.getProgramAccounts(STAKE_PROGRAM_ADDRESS)) {
        // The worker filters with dataSize 200 and memcmp on the key (CLAUDE.md section 4); decoding first is the same.
        if (account.data.length !== STAKE_ACCOUNT_SIZE) continue;
        const decoded = decodeStakeAccount({
          address: account.address,
          data: account.data,
          lamports: account.lamports,
          owner: account.programAddress,
        });
        if (!decoded.ok) continue;
        const matches =
          'withdrawer' in filter
            ? decoded.account.withdrawer === filter.withdrawer
            : decoded.account.lockup.custodian === filter.custodian;
        if (matches) accounts.push(decoded.account);
      }
      // Sorted by address, as the worker answers.
      accounts.sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
      return { slot: this.slot(), accounts };
    });
  }

  // ---- Test controls ----

  /** Makes every blockhash handed out so far invalid, as when ~150 blocks pass (LiteSVM gets a new blockhash). */
  expireBlockhash(): void {
    this.testChain.svm.expireBlockhash();
    this.sync();
  }

  /** Moves block height on; past the current blockhash's lastValidBlockHeight, that blockhash expires too. */
  advanceBlocks(blocks: bigint): void {
    this.sync();
    this.height += blocks;
    if (this.height > this.currentLastValid) this.expireBlockhash();
  }

  /**
   * From now on, accepted transactions wait instead of landing: send resolves with the signature, statuses stay null
   * (a transaction in flight) until {@link landHeld} or {@link dropHeld}. Preflight still runs first.
   */
  holdTransactions(): void {
    this.holding = true;
  }

  /** Lands the held transactions in order and stops holding. A held transaction whose blockhash expired fails. */
  landHeld(): void {
    this.holding = false;
    for (const { signature, transaction } of this.held.splice(0)) this.execute(signature, transaction);
  }

  /** Forgets the held transactions (they never land) and stops holding. */
  dropHeld(): void {
    this.holding = false;
    this.held.splice(0);
  }

  /** The next `times` calls of `method` reject with `error` (e.g. a fetch TypeError for network failures). */
  failNext(method: Method, error: Error, times = 1): void {
    const queue = this.failures.get(method) ?? [];
    for (let i = 0; i < times; i += 1) queue.push(error);
    this.failures.set(method, queue);
  }

  // ---- Internals ----

  private answer<T>(method: Method, run: () => T): Promise<T> {
    const failure = this.failures.get(method)?.shift();
    if (failure !== undefined) return Promise.reject(failure);
    try {
      return Promise.resolve(run());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private slot(): bigint {
    return this.testChain.svm.getClock().slot;
  }

  /** Brings the emulated block height in line with LiteSVM's latest blockhash; returns that blockhash. */
  private sync(): Blockhash {
    const latest = this.testChain.svm.latestBlockhash();
    if (latest !== this.currentBlockhash) {
      // Every earlier blockhash is now rejected by LiteSVM: move past their last valid height.
      if (this.currentBlockhash !== null && this.height <= this.currentLastValid) this.height = this.currentLastValid + 1n;
      this.currentBlockhash = latest;
      this.currentLastValid = this.height + BLOCKHASH_VALIDITY_BLOCKS;
    }
    return latest;
  }

  private decode(bytes: ReadonlyUint8Array): Transaction {
    return getTransactionDecoder().decode(bytes);
  }

  /**
   * AdvanceNonceAccount fails (NonceBlockhashNotExpired) while the nonce still holds the value derived from the
   * current blockhash. On a cluster the next block fixes that; LiteSVM's blockhash only moves on request.
   */
  private prepareNonce(transaction: Transaction): void {
    const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
    if (compiled.lifetimeToken !== durableNonceOf(this.testChain.svm.latestBlockhash())) return;
    if (isTransactionMessageWithDurableNonceLifetime(decompileTransactionMessage(compiled))) this.expireBlockhash();
  }

  private simulateDecoded(transaction: Transaction): SimulationResult {
    this.prepareNonce(transaction);
    const svm = this.testChain.svm;
    // RPC simulateTransaction with sigVerify: false. TestChain's LiteSVM verifies signatures by default.
    svm.withSigverify(false);
    try {
      const result = svm.simulateTransaction(transaction);
      if (result instanceof FailedTransactionMetadata) {
        const meta = result.meta();
        return {
          ok: false,
          logs: meta.logs(),
          unitsConsumed: meta.computeUnitsConsumed(),
          error: getSolanaErrorFromLiteSvmFailure(result),
        };
      }
      const meta = result.meta();
      return { ok: true, logs: meta.logs(), unitsConsumed: meta.computeUnitsConsumed() };
    } finally {
      svm.withSigverify(true);
    }
  }

  /**
   * Executes on LiteSVM. A transaction that fails while executing lands like on a cluster (recorded, fee charged, its
   * status carries the error); one that cannot execute at all (expired blockhash) is dropped and its status stays null.
   */
  private execute(signature: Signature, transaction: Transaction): void {
    this.prepareNonce(transaction);
    this.testChain.svm.sendTransaction(transaction);
    if (this.testChain.svm.getTransaction(signature) !== null) this.landedAtSlot.set(signature, this.slot());
  }
}

/** The value a nonce account stores when advanced at `blockhash`: sha256("DURABLE_NONCE" || blockhash). */
function durableNonceOf(blockhash: Blockhash): string {
  const digest = createHash('sha256').update('DURABLE_NONCE').update(Uint8Array.from(getBase58Encoder().encode(blockhash))).digest();
  return getBase58Decoder().decode(digest);
}

/** The error kit's RPC client throws when sendTransaction's preflight simulation fails; `cause` is the chain error. */
function preflightFailure(simulation: Extract<SimulationResult, { ok: false }>): SolanaError {
  return new SolanaError(SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE, {
    accounts: null,
    fee: null,
    innerInstructions: null,
    loadedAccountsDataSize: null,
    loadedAddresses: null,
    logs: [...simulation.logs],
    postBalances: null,
    postTokenBalances: null,
    preBalances: null,
    preTokenBalances: null,
    replacementBlockhash: null,
    returnData: null,
    unitsConsumed: simulation.unitsConsumed,
    cause: simulation.error,
  });
}
