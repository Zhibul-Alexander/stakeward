import {
  appendTransactionMessageInstructions,
  compileTransaction,
  compileTransactionMessage,
  createAddressWithSeed,
  createNoopSigner,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageLifetimeUsingDurableNonce,
  type Address,
  type CompiledTransactionMessageWithLifetime,
  type Instruction,
  type LegacyCompiledTransactionMessage,
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
  MAX_LOCKUP_END,
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
 * Throws on inputs the program would reject anyway (zero or negative amounts, a second key equal to the main key, ...)
 * and on inputs Stakeward never sends: a lockup end after `MAX_LOCKUP_END`, a nonce seed other than
 * `NONCE_ACCOUNT_SEED`, and a rescue that the new wallet does not pay for or that runs on someone else's nonce
 * (CLAUDE.md section 5: the compromised main key never pays and never owns the nonce account). The inspector rebuilds
 * every transaction it accepts with this function, so these rules hold for /cosign links and the RPC proxy too.
 */
export function buildTransaction(action: TransactionAction, options: BuildOptions): BuiltTransaction {
  const transaction = compileTransaction(transactionMessage(action, options));
  return {
    bytes: new Uint8Array(transactionEncoder.encode(transaction)),
    meta: {
      action,
      feePayer: options.feePayer,
      lifetime: options.lifetime,
      signers: Object.keys(transaction.signatures) as Address[],
    },
  };
}

/**
 * The compiled message `buildTransaction` encodes, before encoding. The inspector's backstop compares it with the
 * message it inspects field by field: the same check as comparing bytes, without turning every address back into
 * bytes (DECISIONS.md D23, CPU). Throws like `buildTransaction`.
 */
export function compileActionMessage(
  action: TransactionAction,
  options: BuildOptions,
): LegacyCompiledTransactionMessage & CompiledTransactionMessageWithLifetime {
  return compileTransactionMessage(transactionMessage(action, options));
}

const transactionEncoder = /* @__PURE__ */ getTransactionEncoder();

function transactionMessage(action: TransactionAction, options: BuildOptions) {
  const { lifetime } = options;
  if (action.kind === 'rescue') {
    check(options.feePayer === action.newWallet, 'A rescue is paid by the new wallet');
    check(
      lifetime.kind === 'blockhash' || lifetime.nonceAuthority === action.newWallet,
      "A rescue runs on a blockhash or on the new wallet's nonce account",
    );
  }
  const instructions = [
    getSetComputeUnitLimitInstruction({ units: COMPUTE_UNIT_LIMIT }),
    getSetComputeUnitPriceInstruction({ microLamports: COMPUTE_UNIT_PRICE_MICRO_LAMPORTS }),
    ...actionInstructions(action),
  ];
  const unsigned = pipe(
    createTransactionMessage({ version: 'legacy' }),
    (message) => setTransactionMessageFeePayer(options.feePayer, message),
    (message) => appendTransactionMessageInstructions(instructions, message),
  );
  // The durable nonce setter prepends AdvanceNonceAccount, so the instruction order above is kept after it.
  return lifetime.kind === 'blockhash'
    ? setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: lifetime.blockhash, lastValidBlockHeight: lifetime.lastValidBlockHeight },
        unsigned,
      )
    : setTransactionMessageLifetimeUsingDurableNonce(
        {
          nonce: lifetime.nonceValue,
          nonceAccountAddress: lifetime.nonceAccount,
          nonceAuthorityAddress: lifetime.nonceAuthority,
        },
        unsigned,
      );
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
      check(action.seed === NONCE_ACCOUNT_SEED, `The nonce seed is always "${NONCE_ACCOUNT_SEED}"`);
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
  check(
    unixTimestamp > 0n && unixTimestamp <= MAX_LOCKUP_END,
    'Lockup end must be a positive unix timestamp no later than 2100-01-01',
  );
}

function requireLamports(lamports: bigint): void {
  check(lamports > 0n && lamports <= U64_MAX, 'Amount must be a positive u64 number of lamports');
}

function requireDistinct(addresses: readonly Address[]): void {
  check(new Set(addresses).size === addresses.length, 'Keys in one action must be different addresses');
}
