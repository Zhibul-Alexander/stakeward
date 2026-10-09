// LiteSVM test harness: a local chain with the mainnet stake program, a realistic clock, funded keys,
// vote and stake account factories, and send() that maps failures to plain data. Test-only code (Node).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getSolanaErrorFromLiteSvmFailure } from '@solana/kit-plugin-litesvm';
import {
  AccountRole,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  decompileTransactionMessage,
  generateKeyPairSigner,
  getAddressEncoder,
  getCompiledTransactionMessageDecoder,
  getSignatureFromTransaction,
  getStructEncoder,
  getTransactionDecoder,
  getU32Encoder,
  getU8Encoder,
  isAdvanceNonceAccountInstruction,
  lamports,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type AccountSignerMeta,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type Nonce,
  type Signature,
} from '@solana/kit';
import { getDelegateStakeInstruction, getInitializeInstruction } from '@solana-program/stake';
import { decodeNonce, getCreateAccountInstruction } from '@solana-program/system';
import { EpochSchedule, FailedTransactionMetadata, LiteSVM, Rent } from 'litesvm';
import {
  decodeStakeAccount,
  STAKE_ACCOUNT_SIZE,
  STAKE_PROGRAM_ADDRESS,
  SYSVAR_CLOCK_ADDRESS,
  ZERO_ADDRESS,
  type BlockhashLifetime,
  type ClockView,
  type Lockup,
  type RawAccount,
  type StakeAccount,
} from '../src/index.ts';
import { chainErrorFromSolanaError, STAKE_PROGRAM_PATH, STAKE_PROGRAM_SHA256, type ChainError } from './support.ts';

export { STAKE_PROGRAM_PATH, STAKE_PROGRAM_SHA256 } from './support.ts';

export const LAMPORTS_PER_SOL = 1_000_000_000n;

/** Start of every test chain: 2026-10-01T00:00:00Z, epoch 1000. */
export const START_UNIX_TIMESTAMP = 1_790_812_800n;
export const START_EPOCH = 1_000n;
/**
 * Rent as mainnet and devnet charge it (Rent sysvar `lamportsPerByte` 5080 with the exemption threshold folded in, read
 * 2026-10-02): a stake account needs 1 666 240 lamports, a nonce account 1 056 640, a wallet 650 240. LiteSVM 1.5.0
 * still defaults to 6960 (2 282 880 for a stake account).
 */
export const MAINNET_RENT_LAMPORTS_PER_BYTE = 5_080n;
/** Short linear epochs; only `clock.epoch` matters to the stake program. */
export const SLOTS_PER_EPOCH = 32n;

const VOTE_PROGRAM_ADDRESS = 'Vote111111111111111111111111111111111111111' as Address;
const SYSVAR_RENT_ADDRESS = 'SysvarRent111111111111111111111111111111111' as Address;
/** Serialized VoteState size the vote program expects. */
const VOTE_ACCOUNT_SIZE = 3_762n;
/** A setup transaction is signed at most this many times; the last signing is sent even on a moved blockhash. */
const SETUP_ATTEMPTS = 10;

/** Why a transaction failed (see ChainError in support.ts). */
export type SvmError = ChainError;

export type SendResult =
  | { ok: true; signature: Signature; computeUnits: bigint; logs: string[] }
  | { ok: false; signature: Signature; error: SvmError; logs: string[] };

export type NewStakeAccount = {
  staker: Address;
  withdrawer: Address;
  /** Lamports above the rent-exempt reserve. Default 2 SOL (delegation needs at least 1 SOL, D7). */
  lamports?: bigint;
  /** Default: no lockup. Set directly by Initialize, so no custodian signature is needed. */
  lockup?: Lockup;
  /** Delegate right after creation; the staker's key signs. */
  delegateTo?: { voteAccount: Address; stakerKey: KeyPairSigner };
};

export class TestChain {
  readonly svm: LiteSVM;
  /** Funds and pays for setup transactions; never one of the product keys. */
  private readonly bank: KeyPairSigner;

  private constructor(svm: LiteSVM, bank: KeyPairSigner) {
    this.svm = svm;
    this.bank = bank;
  }

  static async create(): Promise<TestChain> {
    const program = readFileSync(STAKE_PROGRAM_PATH);
    const sha256 = createHash('sha256').update(program).digest('hex');
    if (sha256 !== STAKE_PROGRAM_SHA256) throw new Error(`Unexpected stake program build: sha256 ${sha256}`);

    const svm = new LiteSVM();
    svm.addProgram(STAKE_PROGRAM_ADDRESS, program);
    svm.setEpochSchedule(new EpochSchedule(SLOTS_PER_EPOCH, SLOTS_PER_EPOCH, false, 0n, 0n));
    svm.setRent(new Rent(MAINNET_RENT_LAMPORTS_PER_BYTE, 1, svm.getRent().burnPercent));
    const chain = new TestChain(svm, await generateKeyPairSigner());
    chain.warpToEpoch(START_EPOCH);
    chain.setTime(START_UNIX_TIMESTAMP);
    chain.airdrop(chain.bank.address, 100_000n * LAMPORTS_PER_SOL); // LiteSVM's faucet holds 1M SOL
    return chain;
  }

  /** A new key with `sol` SOL on it. */
  async fundedKey(sol = 10n): Promise<KeyPairSigner> {
    const key = await generateKeyPairSigner();
    this.airdrop(key.address, sol * LAMPORTS_PER_SOL);
    return key;
  }

  /** An airdrop is a transaction too: it gets a fresh blockhash, so the same airdrop twice is not a duplicate. */
  airdrop(address: Address, amount: bigint): void {
    this.svm.expireBlockhash();
    const result = this.svm.airdrop(address, lamports(amount));
    if (result === null || result instanceof FailedTransactionMetadata) throw new Error(`Airdrop to ${address} failed`);
  }

  balance(address: Address): bigint {
    return this.svm.getBalance(address) ?? 0n;
  }

  clock(): ClockView {
    const clock = this.svm.getClock();
    return { unixTimestamp: clock.unixTimestamp, epoch: clock.epoch };
  }

  setTime(unixTimestamp: bigint): void {
    const clock = this.svm.getClock();
    clock.unixTimestamp = unixTimestamp;
    this.svm.setClock(clock);
  }

  advanceTime(seconds: bigint): void {
    this.setTime(this.svm.getClock().unixTimestamp + seconds);
  }

  /** Moves slot and epoch together (LiteSVM's warpToSlot alone leaves the epoch). Time is unchanged. */
  warpToEpoch(epoch: bigint): void {
    this.svm.warpToSlot(epoch * SLOTS_PER_EPOCH);
    const clock = this.svm.getClock();
    clock.epoch = epoch;
    clock.leaderScheduleEpoch = epoch + 1n;
    clock.epochStartTimestamp = clock.unixTimestamp;
    this.svm.setClock(clock);
  }

  /**
   * A fresh blockhash lifetime. LiteSVM's blockhash only changes on expireBlockhash(), and it rejects a byte-identical
   * transaction even after a failure, so every built transaction gets its own blockhash. Only the latest blockhash
   * is valid: build right before sending.
   */
  blockhashLifetime(): BlockhashLifetime {
    this.svm.expireBlockhash();
    return { kind: 'blockhash', blockhash: this.svm.latestBlockhash(), lastValidBlockHeight: 0n };
  }

  account(address: Address): RawAccount | null {
    const account = this.svm.getAccount(address);
    if (!account.exists) return null;
    return { address, data: account.data, lamports: account.lamports, owner: account.programAddress };
  }

  /** Decoded stake account, or null when the account does not exist. Throws on anything else. */
  stakeAccount(address: Address): StakeAccount | null {
    const raw = this.account(address);
    if (raw === null) return null;
    const decoded = decodeStakeAccount(raw);
    if (!decoded.ok) throw new Error(`${address} is not a usable stake account: ${decoded.error}`);
    return decoded.account;
  }

  /** The value stored in a durable nonce account (what a nonce lifetime must carry). */
  nonceValue(nonceAccount: Address): Nonce {
    const account = decodeNonce(this.svm.getAccount(nonceAccount));
    if (!account.exists) throw new Error(`Nonce account ${nonceAccount} does not exist`);
    return account.data.blockhash as string as Nonce;
  }

  /** A real vote account (native vote program, VoteInstruction::InitializeAccount). */
  async createVoteAccount(): Promise<Address> {
    const vote = await generateKeyPairSigner();
    const node = await this.fundedKey();
    const nodeMeta: AccountSignerMeta = { address: node.address, role: AccountRole.READONLY_SIGNER, signer: node };
    const initialize: Instruction = {
      programAddress: VOTE_PROGRAM_ADDRESS,
      accounts: [
        { address: vote.address, role: AccountRole.WRITABLE },
        { address: SYSVAR_RENT_ADDRESS, role: AccountRole.READONLY },
        { address: SYSVAR_CLOCK_ADDRESS, role: AccountRole.READONLY },
        nodeMeta,
      ],
      data: getStructEncoder([
        ['discriminator', getU32Encoder()],
        ['node', getAddressEncoder()],
        ['authorizedVoter', getAddressEncoder()],
        ['authorizedWithdrawer', getAddressEncoder()],
        ['commission', getU8Encoder()],
      ]).encode({
        discriminator: 0,
        node: node.address,
        authorizedVoter: node.address,
        authorizedWithdrawer: node.address,
        commission: 5,
      }),
    };
    await this.setup([
      getCreateAccountInstruction({
        payer: this.bank,
        newAccount: vote,
        lamports: this.svm.minimumBalanceForRentExemption(VOTE_ACCOUNT_SIZE),
        space: VOTE_ACCOUNT_SIZE,
        programAddress: VOTE_PROGRAM_ADDRESS,
      }),
      initialize,
    ]);
    return vote.address;
  }

  /** Creates (and optionally delegates) a stake account. Initialize takes authorities and lockup as data. */
  async createStakeAccount(options: NewStakeAccount): Promise<Address> {
    const stake = await generateKeyPairSigner();
    const rent = this.svm.minimumBalanceForRentExemption(BigInt(STAKE_ACCOUNT_SIZE));
    await this.setup([
      getCreateAccountInstruction({
        payer: this.bank,
        newAccount: stake,
        lamports: rent + (options.lamports ?? 2n * LAMPORTS_PER_SOL),
        space: STAKE_ACCOUNT_SIZE,
        programAddress: STAKE_PROGRAM_ADDRESS,
      }),
      getInitializeInstruction({
        stake: stake.address,
        arg0: { staker: options.staker, withdrawer: options.withdrawer },
        arg1: options.lockup ?? { unixTimestamp: 0n, epoch: 0n, custodian: ZERO_ADDRESS },
      }),
    ]);
    if (options.delegateTo !== undefined) {
      const { voteAccount, stakerKey } = options.delegateTo;
      if (stakerKey.address !== options.staker) throw new Error('delegateTo.stakerKey must be the staker');
      await this.setup([
        getDelegateStakeInstruction({ stake: stake.address, vote: voteAccount, stakeAuthority: stakerKey }),
      ]);
    }
    return stake.address;
  }

  /**
   * Signs wire bytes with every key in `signers` (the bytes may already carry other signatures), then sends.
   * A transaction with a durable nonce lifetime is sent after expiring the blockhash: LiteSVM rejects a nonce
   * transaction while its blockhash is still the one the nonce was stored at.
   * Throws when the transaction is not fully signed after that (a test bug, not a chain result).
   */
  async send(bytes: Uint8Array, signers: readonly KeyPairSigner[] = []): Promise<SendResult> {
    const decoded = getTransactionDecoder().decode(bytes);
    const transaction =
      signers.length === 0 ? decoded : await partiallySignTransaction(signers.map((s) => s.keyPair), decoded);
    const message = decompileTransactionMessage(getCompiledTransactionMessageDecoder().decode(transaction.messageBytes));
    const instructions: readonly Instruction[] = message.instructions;
    const [first] = instructions;
    if (first !== undefined && isAdvanceNonceAccountInstruction(first)) this.svm.expireBlockhash();

    const result = this.svm.sendTransaction(transaction);
    const signature = getSignatureFromTransaction(transaction);
    if (!(result instanceof FailedTransactionMetadata)) {
      return { ok: true, signature, computeUnits: result.computeUnitsConsumed(), logs: result.logs() };
    }
    return { ok: false, signature, error: toSvmError(result), logs: result.meta().logs() };
  }

  /**
   * Setup transactions (not product transactions): kit signers, fresh blockhash, must succeed. Signing is async, and
   * tests prepare accounts concurrently (Promise.all of fundedKey and createVoteAccount): an airdrop or another setup
   * in that window moves the only blockhash LiteSVM accepts. The transaction is then signed again on the blockhash that
   * is latest now, without expiring it, so two setups in flight do not keep voiding each other's signatures.
   */
  private async setup(instructions: Instruction[]): Promise<void> {
    let lifetime = this.blockhashLifetime();
    for (let attempt = 1; ; attempt += 1) {
      const message = pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(this.bank, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
        (m) => appendTransactionMessageInstructions(instructions, m),
      );
      const signed = await signTransactionMessageWithSigners(message);
      const latest = this.svm.latestBlockhash();
      if (latest !== lifetime.blockhash && attempt < SETUP_ATTEMPTS) {
        lifetime = { kind: 'blockhash', blockhash: latest, lastValidBlockHeight: 0n };
        continue;
      }
      const result = this.svm.sendTransaction(signed);
      if (result instanceof FailedTransactionMetadata) {
        throw new Error(`Setup transaction failed: ${JSON.stringify(toSvmError(result))}\n${result.meta().logs().join('\n')}`);
      }
      return;
    }
  }
}

function toSvmError(failure: FailedTransactionMetadata): SvmError {
  return chainErrorFromSolanaError(getSolanaErrorFromLiteSvmFailure(failure));
}
