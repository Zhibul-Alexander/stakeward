import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createAddressWithSeed,
  createNoopSigner,
  createTransactionMessage,
  getTransactionEncoder,
  getUtf8Encoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageLifetimeUsingDurableNonce,
  type Address,
  type Instruction,
} from '@solana/kit';
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from '@solana-program/compute-budget';
import {
  getAuthorizeCheckedInstruction,
  getDeactivateInstruction,
  getDelegateStakeInstruction,
  getSetLockupCheckedInstruction,
  getSetLockupInstruction,
  getWithdrawInstruction,
  StakeAuthorize,
  StakeInstruction,
} from '@solana-program/stake';
import {
  getCreateAccountWithSeedInstruction,
  getInitializeNonceAccountInstruction,
  getWithdrawNonceAccountInstruction,
} from '@solana-program/system';
import type { Lifetime, TransactionAction } from './actions.ts';
import {
  COMPUTE_UNIT_LIMIT,
  COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
  I64_MAX,
  NONCE_ACCOUNT_SEED,
  NONCE_ACCOUNT_SIZE,
  SYSTEM_PROGRAM_ADDRESS,
  U64_MAX,
  ZERO_ADDRESS,
} from './constants.ts';
import { LEGACY_SYSVAR_SLOTS, toLegacyLayout, type StakeIx } from './legacy-layout.ts';

export type BuildOptions = {
  /** Fee payer; see `expectedFeePayer` for who it should be. Always a required signer. */
  feePayer: Address;
  lifetime: Lifetime;
};

export type BuiltTransaction = {
  /**
   * Unsigned wire transaction: compact array of zero-filled signature slots, then the legacy message.
   * Wallets sign exactly these bytes.
   */
  bytes: Uint8Array;
  meta: {
    action: TransactionAction;
    feePayer: Address;
    lifetime: Lifetime;
    /** Every address that must sign, in message order (fee payer first). */
    signers: readonly Address[];
  };
};

/** Seeds of System CreateAccountWithSeed are at most 32 bytes. */
const MAX_SEED_BYTES = 32;

/**
 * Builds the unsigned transaction for one Stakeward action, in the only format the inspector accepts
 * (CLAUDE.md section 4):
 *
 *   [AdvanceNonceAccount, only with a nonce lifetime] [SetComputeUnitLimit, SetComputeUnitPrice] [action]
 *
 * where [action] is exactly one stake instruction over one stake account, the rescue pair, the nonce setup pair or
 * the nonce close instruction.
 * The message is a legacy message (no address lookup tables; also the smallest form, and the one every wallet and
 * Ledger understand). Withdraw, AuthorizeChecked, Deactivate and DelegateStake use the legacy account layout (D1).
 * Keys are addresses only: the builder never sees a private key, wallets sign the returned bytes.
 * Throws on inputs the program would reject anyway (zero or negative amounts, a second key equal to the main key, ...).
 */
export function buildTransaction(action: TransactionAction, options: BuildOptions): BuiltTransaction {
  const instructions = [
    getSetComputeUnitLimitInstruction({ units: COMPUTE_UNIT_LIMIT }),
    getSetComputeUnitPriceInstruction({ microLamports: COMPUTE_UNIT_PRICE_MICRO_LAMPORTS }),
    ...actionInstructions(action),
  ];
  const { lifetime } = options;
  const unsigned = pipe(
    createTransactionMessage({ version: 'legacy' }),
    (message) => setTransactionMessageFeePayer(options.feePayer, message),
    (message) => appendTransactionMessageInstructions(instructions, message),
  );
  // The durable nonce setter prepends AdvanceNonceAccount, so the instruction order above is kept after it.
  const transaction =
    lifetime.kind === 'blockhash'
      ? compileTransaction(
          setTransactionMessageLifetimeUsingBlockhash(
            { blockhash: lifetime.blockhash, lastValidBlockHeight: lifetime.lastValidBlockHeight },
            unsigned,
          ),
        )
      : compileTransaction(
          setTransactionMessageLifetimeUsingDurableNonce(
            {
              nonce: lifetime.nonceValue,
              nonceAccountAddress: lifetime.nonceAccount,
              nonceAuthorityAddress: lifetime.nonceAuthority,
            },
            unsigned,
          ),
        );
  return {
    bytes: new Uint8Array(getTransactionEncoder().encode(transaction)),
    meta: {
      action,
      feePayer: options.feePayer,
      lifetime,
      signers: Object.keys(transaction.signatures) as Address[],
    },
  };
}

/** Address of the nonce account that `nonce-setup` creates for `nonceAuthority` (System CreateAccountWithSeed). */
export function deriveNonceAccountAddress(nonceAuthority: Address, seed: string = NONCE_ACCOUNT_SEED): Promise<Address> {
  return createAddressWithSeed({ baseAddress: nonceAuthority, programAddress: SYSTEM_PROGRAM_ADDRESS, seed });
}

function actionInstructions(action: TransactionAction): Instruction[] {
  const signer = createNoopSigner;
  switch (action.kind) {
    case 'protect':
      requireLockupTimestamp(action.lockUntil);
      requireDistinct([action.mainKey, action.secondKey, action.stakeAccount]);
      check(action.secondKey !== ZERO_ADDRESS, 'Second key must not be the zero key');
      return [
        getSetLockupCheckedInstruction({
          stake: action.stakeAccount,
          authority: signer(action.mainKey),
          newAuthority: signer(action.secondKey),
          unixTimestamp: action.lockUntil,
          epoch: null,
        }),
      ];
    case 'extend':
    case 'unlock': {
      const unixTimestamp = action.kind === 'extend' ? action.lockUntil : 0n;
      if (action.kind === 'extend') requireLockupTimestamp(action.lockUntil);
      return [
        getSetLockupInstruction({
          stake: action.stakeAccount,
          authority: signer(action.secondKey),
          unixTimestamp,
          epoch: null,
          custodian: null,
        }),
      ];
    }
    case 'withdraw':
      requireLamports(action.lamports);
      if (action.secondKey !== null) requireDistinct([action.mainKey, action.secondKey]);
      return [
        legacy(
          StakeInstruction.Withdraw,
          getWithdrawInstruction({
            stake: action.stakeAccount,
            recipient: action.recipient,
            withdrawAuthority: signer(action.mainKey),
            ...(action.secondKey === null ? {} : { lockupAuthority: signer(action.secondKey) }),
            args: action.lamports,
          }),
        ),
      ];
    case 'deactivate':
      return [
        legacy(
          StakeInstruction.Deactivate,
          getDeactivateInstruction({ stake: action.stakeAccount, stakeAuthority: signer(action.staker) }),
        ),
      ];
    case 'delegate':
      return [
        legacy(
          StakeInstruction.DelegateStake,
          getDelegateStakeInstruction({
            stake: action.stakeAccount,
            vote: action.voteAccount,
            stakeAuthority: signer(action.staker),
          }),
        ),
      ];
    case 'rescue':
      requireDistinct([action.mainKey, action.secondKey, action.newWallet, action.stakeAccount]);
      return [
        legacy(
          StakeInstruction.AuthorizeChecked,
          getAuthorizeCheckedInstruction({
            stake: action.stakeAccount,
            authority: signer(action.mainKey),
            newAuthority: signer(action.newWallet),
            stakeAuthorize: StakeAuthorize.Staker,
          }),
        ),
        legacy(
          StakeInstruction.AuthorizeChecked,
          getAuthorizeCheckedInstruction({
            stake: action.stakeAccount,
            authority: signer(action.mainKey),
            newAuthority: signer(action.newWallet),
            lockupAuthority: signer(action.secondKey),
            stakeAuthorize: StakeAuthorize.Withdrawer,
          }),
        ),
      ];
    case 'nonce-setup':
      requireLamports(action.lamports);
      check(
        action.seed.length > 0 && getUtf8Encoder().encode(action.seed).length <= MAX_SEED_BYTES,
        `Nonce seed must be 1 to ${String(MAX_SEED_BYTES)} bytes`,
      );
      return [
        getCreateAccountWithSeedInstruction({
          payer: signer(action.nonceAuthority),
          newAccount: action.nonceAccount,
          base: action.nonceAuthority,
          seed: action.seed,
          amount: action.lamports,
          space: NONCE_ACCOUNT_SIZE,
          programAddress: SYSTEM_PROGRAM_ADDRESS,
        }),
        getInitializeNonceAccountInstruction({
          nonceAccount: action.nonceAccount,
          nonceAuthority: action.nonceAuthority,
        }),
      ];
    case 'nonce-close':
      requireLamports(action.lamports);
      return [
        getWithdrawNonceAccountInstruction({
          nonceAccount: action.nonceAccount,
          recipientAccount: action.recipient,
          nonceAuthority: signer(action.nonceAuthority),
          withdrawAmount: action.lamports,
        }),
      ];
  }
}

function legacy(instruction: StakeInstruction, ix: StakeIx): StakeIx {
  const slot = LEGACY_SYSVAR_SLOTS[instruction];
  if (slot === undefined) throw new Error(`No legacy layout for stake instruction ${String(instruction)}`);
  return toLegacyLayout(ix, slot);
}

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requireLockupTimestamp(unixTimestamp: bigint): void {
  check(unixTimestamp > 0n && unixTimestamp <= I64_MAX, 'Lockup end must be a positive unix timestamp');
}

function requireLamports(lamports: bigint): void {
  check(lamports > 0n && lamports <= U64_MAX, 'Amount must be a positive u64 number of lamports');
}

function requireDistinct(addresses: readonly Address[]): void {
  check(new Set(addresses).size === addresses.length, 'Keys in one action must be different addresses');
}
