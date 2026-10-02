// Layout of built transactions, without a chain: message version, instruction order, legacy account layouts,
// signers and input validation. Execution on LiteSVM is in test/builders.svm.test.ts.
import {
  AccountRole,
  blockhash,
  decompileTransactionMessage,
  getAddressDecoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  isAdvanceNonceAccountInstruction,
  type Address,
  type Instruction,
  type Nonce,
} from '@solana/kit';
import {
  getSetComputeUnitLimitInstructionDataDecoder,
  getSetComputeUnitPriceInstructionDataDecoder,
} from '@solana-program/compute-budget';
import {
  getAuthorizeCheckedInstructionDataDecoder,
  getSetLockupCheckedInstructionDataDecoder,
  getSetLockupInstructionDataDecoder,
  getWithdrawInstructionDataDecoder,
  StakeAuthorize,
} from '@solana-program/stake';
import {
  getCreateAccountWithSeedInstructionDataDecoder,
  getInitializeNonceAccountInstructionDataDecoder,
  getWithdrawNonceAccountInstructionDataDecoder,
} from '@solana-program/system';
import { describe, expect, it } from 'vitest';
import {
  expectedFeePayer,
  type BlockhashLifetime,
  type Lifetime,
  type NonceLifetime,
  type TransactionAction,
  type TransactionKind,
} from './actions.ts';
import { buildTransaction, deriveNonceAccountAddress } from './builders.ts';
import {
  COMPUTE_BUDGET_PROGRAM_ADDRESS,
  COMPUTE_UNIT_LIMIT,
  COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
  NONCE_ACCOUNT_SEED,
  NONCE_ACCOUNT_SIZE,
  STAKE_CONFIG_ADDRESS,
  STAKE_PROGRAM_ADDRESS,
  SYSTEM_PROGRAM_ADDRESS,
  SYSVAR_CLOCK_ADDRESS,
  SYSVAR_STAKE_HISTORY_ADDRESS,
  ZERO_ADDRESS,
} from './constants.ts';
import { MAX_TRANSACTION_BYTES } from './link.ts';

const key = (n: number): Address => getAddressDecoder().decode(new Uint8Array(32).fill(n));
const A = key(1);
const K = key(2);
const D = key(3);
const S = key(4);
const VOTE = key(5);
const NONCE = key(6);
const T = 1_825_545_600n;

const blockhashLifetime: BlockhashLifetime = { kind: 'blockhash', blockhash: blockhash(key(20)), lastValidBlockHeight: 100n };
const nonceLifetime: NonceLifetime = { kind: 'nonce', nonceAccount: NONCE, nonceAuthority: D, nonceValue: key(21) as string as Nonce };

const ACTIONS: { [Kind in TransactionKind]: Extract<TransactionAction, { kind: Kind }> } = {
  protect: { kind: 'protect', stakeAccount: S, mainKey: A, secondKey: K, lockUntil: T },
  extend: { kind: 'extend', stakeAccount: S, secondKey: K, lockUntil: T },
  unlock: { kind: 'unlock', stakeAccount: S, secondKey: K },
  withdraw: { kind: 'withdraw', stakeAccount: S, mainKey: A, secondKey: K, recipient: A, lamports: 5_000_000_000n },
  deactivate: { kind: 'deactivate', stakeAccount: S, staker: A },
  delegate: { kind: 'delegate', stakeAccount: S, staker: A, voteAccount: VOTE },
  rescue: { kind: 'rescue', stakeAccount: S, mainKey: A, secondKey: K, newWallet: D },
  'nonce-setup': { kind: 'nonce-setup', nonceAccount: NONCE, nonceAuthority: D, seed: NONCE_ACCOUNT_SEED, lamports: 1_447_680n },
  'nonce-close': { kind: 'nonce-close', nonceAccount: NONCE, nonceAuthority: D, recipient: D, lamports: 1_447_680n },
};

function decode(bytes: Uint8Array) {
  const transaction = getTransactionDecoder().decode(bytes);
  const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  const message = decompileTransactionMessage(compiled);
  const list: readonly Instruction[] = message.instructions;
  const instructions = list.map((ix) => ({
    programAddress: ix.programAddress,
    accounts: (ix.accounts ?? []).map((meta) => meta.address),
    roles: (ix.accounts ?? []).map((meta) => meta.role),
    data: Uint8Array.from(ix.data ?? []),
  }));
  return { transaction, compiled, message, instructions };
}

function build(action: TransactionAction, lifetime: Lifetime = blockhashLifetime) {
  const built = buildTransaction(action, { feePayer: expectedFeePayer(action), lifetime });
  return { built, ...decode(built.bytes) };
}

/** The action instructions after the [AdvanceNonce] [CU limit, CU price] prefix. */
function body(action: TransactionAction, lifetime: Lifetime = blockhashLifetime) {
  const { instructions } = build(action, lifetime);
  return instructions.slice(lifetime.kind === 'nonce' ? 3 : 2);
}

describe('every kind', () => {
  it.each(Object.values(ACTIONS))('$kind: legacy message, [CU limit, CU price] first, empty signature slots', (action) => {
    const { built, compiled, instructions, transaction } = build(action);
    expect(compiled.version).toBe('legacy');
    expect(built.bytes.length).toBeLessThanOrEqual(MAX_TRANSACTION_BYTES);

    const [limit, price] = instructions;
    expect(limit?.programAddress).toBe(COMPUTE_BUDGET_PROGRAM_ADDRESS);
    expect(getSetComputeUnitLimitInstructionDataDecoder().decode(limit?.data ?? new Uint8Array()).units).toBe(COMPUTE_UNIT_LIMIT);
    expect(price?.programAddress).toBe(COMPUTE_BUDGET_PROGRAM_ADDRESS);
    expect(getSetComputeUnitPriceInstructionDataDecoder().decode(price?.data ?? new Uint8Array()).microLamports).toBe(
      COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
    );

    expect(Object.keys(transaction.signatures)).toEqual(built.meta.signers);
    expect(Object.values(transaction.signatures).every((signature) => signature === null)).toBe(true);
    expect(built.meta.signers[0]).toBe(expectedFeePayer(action));
    expect(built.meta).toMatchObject({ action, feePayer: expectedFeePayer(action), lifetime: blockhashLifetime });
    expect(compiled.lifetimeToken).toBe(blockhashLifetime.blockhash);
  });

  it.each(Object.values(ACTIONS))('$kind on a nonce: AdvanceNonceAccount first, nonce value as lifetime', (action) => {
    const { compiled, message, instructions } = build(action, nonceLifetime);
    const [advance, limit, price]: readonly (Instruction | undefined)[] = message.instructions;
    expect(advance !== undefined && isAdvanceNonceAccountInstruction(advance)).toBe(true);
    expect(instructions[0]?.accounts[0]).toBe(NONCE);
    expect(instructions[0]?.accounts[2]).toBe(D);
    expect([limit?.programAddress, price?.programAddress]).toEqual([COMPUTE_BUDGET_PROGRAM_ADDRESS, COMPUTE_BUDGET_PROGRAM_ADDRESS]);
    expect(compiled.lifetimeToken).toBe(nonceLifetime.nonceValue);
  });
});

describe('stake instructions', () => {
  it('protect: SetLockupChecked(stake, A, K), unix timestamp T, epoch unchanged', () => {
    const [ix, ...rest] = body(ACTIONS.protect);
    expect(rest).toEqual([]);
    expect(ix?.programAddress).toBe(STAKE_PROGRAM_ADDRESS);
    expect(ix?.accounts).toEqual([S, A, K]);
    expect(getSetLockupCheckedInstructionDataDecoder().decode(ix?.data ?? new Uint8Array())).toEqual({
      discriminator: 12,
      unixTimestamp: { __option: 'Some', value: T },
      epoch: { __option: 'None' },
    });
    expect(build(ACTIONS.protect).built.meta.signers).toEqual([A, K]);
  });

  it('extend and unlock: SetLockup(stake, K), only the timestamp changes', () => {
    for (const [action, unixTimestamp] of [[ACTIONS.extend, T], [ACTIONS.unlock, 0n]] as const) {
      const [ix, ...rest] = body(action);
      expect(rest).toEqual([]);
      expect(ix?.accounts).toEqual([S, K]);
      expect(getSetLockupInstructionDataDecoder().decode(ix?.data ?? new Uint8Array())).toEqual({
        discriminator: 6,
        unixTimestamp: { __option: 'Some', value: unixTimestamp },
        epoch: { __option: 'None' },
        custodian: { __option: 'None' },
      });
    }
  });

  it('withdraw: legacy layout stake, recipient, Clock, StakeHistory, A, [K]', () => {
    const [ix] = body(ACTIONS.withdraw);
    expect(ix?.accounts).toEqual([S, A, SYSVAR_CLOCK_ADDRESS, SYSVAR_STAKE_HISTORY_ADDRESS, A, K]);
    expect(getWithdrawInstructionDataDecoder().decode(ix?.data ?? new Uint8Array()).args).toBe(5_000_000_000n);

    const [unlocked] = body({ ...ACTIONS.withdraw, secondKey: null, recipient: D });
    expect(unlocked?.accounts).toEqual([S, D, SYSVAR_CLOCK_ADDRESS, SYSVAR_STAKE_HISTORY_ADDRESS, A]);
    expect(unlocked?.roles).toEqual([
      AccountRole.WRITABLE,
      AccountRole.WRITABLE,
      AccountRole.READONLY,
      AccountRole.READONLY,
      AccountRole.WRITABLE_SIGNER, // A is also the fee payer
    ]);
  });

  it('deactivate: legacy layout stake, Clock, staker', () => {
    const [ix, ...rest] = body(ACTIONS.deactivate);
    expect(rest).toEqual([]);
    expect(ix?.accounts).toEqual([S, SYSVAR_CLOCK_ADDRESS, A]);
  });

  it('delegate: legacy layout stake, vote, Clock, StakeHistory, StakeConfig, staker', () => {
    const [ix, ...rest] = body(ACTIONS.delegate);
    expect(rest).toEqual([]);
    expect(ix?.accounts).toEqual([S, VOTE, SYSVAR_CLOCK_ADDRESS, SYSVAR_STAKE_HISTORY_ADDRESS, STAKE_CONFIG_ADDRESS, A]);
  });

  it('rescue: AuthorizeChecked(Staker -> D) then AuthorizeChecked(Withdrawer -> D) with custodian K, legacy layout', () => {
    const [staker, withdrawer, ...rest] = body(ACTIONS.rescue, nonceLifetime);
    expect(rest).toEqual([]);
    expect(staker?.accounts).toEqual([S, SYSVAR_CLOCK_ADDRESS, A, D]);
    expect(getAuthorizeCheckedInstructionDataDecoder().decode(staker?.data ?? new Uint8Array()).stakeAuthorize).toBe(
      StakeAuthorize.Staker,
    );
    expect(withdrawer?.accounts).toEqual([S, SYSVAR_CLOCK_ADDRESS, A, D, K]);
    expect(getAuthorizeCheckedInstructionDataDecoder().decode(withdrawer?.data ?? new Uint8Array()).stakeAuthorize).toBe(
      StakeAuthorize.Withdrawer,
    );
    const { built } = build(ACTIONS.rescue, nonceLifetime);
    expect(built.meta.signers[0]).toBe(D);
    expect([...built.meta.signers].sort()).toEqual([A, D, K].sort());
  });
});

describe('nonce instructions', () => {
  it('nonce setup: CreateAccountWithSeed (base = payer = authority) then InitializeNonceAccount', () => {
    const [create, initialize, ...rest] = body(ACTIONS['nonce-setup']);
    expect(rest).toEqual([]);
    expect(create?.programAddress).toBe(SYSTEM_PROGRAM_ADDRESS);
    expect(create?.accounts).toEqual([D, NONCE]);
    expect(getCreateAccountWithSeedInstructionDataDecoder().decode(create?.data ?? new Uint8Array())).toEqual({
      discriminator: 3,
      base: D,
      seed: NONCE_ACCOUNT_SEED,
      amount: 1_447_680n,
      space: BigInt(NONCE_ACCOUNT_SIZE),
      programAddress: SYSTEM_PROGRAM_ADDRESS,
    });
    expect(initialize?.accounts[0]).toBe(NONCE);
    expect(getInitializeNonceAccountInstructionDataDecoder().decode(initialize?.data ?? new Uint8Array()).nonceAuthority).toBe(D);
    expect(build(ACTIONS['nonce-setup']).built.meta.signers).toEqual([D]);
  });

  it('nonce close: WithdrawNonceAccount of the whole balance to the recipient', () => {
    const [ix, ...rest] = body(ACTIONS['nonce-close']);
    expect(rest).toEqual([]);
    expect(ix?.accounts[0]).toBe(NONCE);
    expect(ix?.accounts[1]).toBe(D);
    expect(ix?.accounts[4]).toBe(D);
    expect(getWithdrawNonceAccountInstructionDataDecoder().decode(ix?.data ?? new Uint8Array()).withdrawAmount).toBe(1_447_680n);
  });

  it('derives the nonce account address from the authority and the seed', async () => {
    const first = await deriveNonceAccountAddress(D);
    expect(await deriveNonceAccountAddress(D, NONCE_ACCOUNT_SEED)).toBe(first);
    expect(await deriveNonceAccountAddress(D, 'stakeward-nonce-2')).not.toBe(first);
    expect(await deriveNonceAccountAddress(A)).not.toBe(first);
  });
});

describe('fee payer', () => {
  it('follows CLAUDE.md section 5', () => {
    expect(Object.fromEntries(Object.values(ACTIONS).map((action) => [action.kind, expectedFeePayer(action)]))).toEqual({
      protect: A,
      extend: K,
      unlock: K,
      withdraw: A,
      deactivate: A,
      delegate: A,
      rescue: D,
      'nonce-setup': D,
      'nonce-close': D,
    });
  });

  it('adds an explicit fee payer as a signer (F5: main key pays for the second key)', () => {
    const built = buildTransaction(ACTIONS.extend, { feePayer: A, lifetime: blockhashLifetime });
    expect(built.meta.signers).toEqual([A, K]);
  });
});

describe('input validation', () => {
  it.each([
    ['protect with the main key as second key', { ...ACTIONS.protect, secondKey: A }],
    ['protect with the stake account as second key', { ...ACTIONS.protect, secondKey: S }],
    ['protect with the zero key', { ...ACTIONS.protect, secondKey: ZERO_ADDRESS }],
    ['protect with lock end 0', { ...ACTIONS.protect, lockUntil: 0n }],
    ['extend with lock end 0 (that is unlock)', { ...ACTIONS.extend, lockUntil: 0n }],
    ['extend past i64', { ...ACTIONS.extend, lockUntil: 2n ** 63n }],
    ['withdraw of 0 lamports', { ...ACTIONS.withdraw, lamports: 0n }],
    ['withdraw with the main key as custodian', { ...ACTIONS.withdraw, secondKey: A }],
    ['rescue to the main key', { ...ACTIONS.rescue, newWallet: A }],
    ['rescue to the second key', { ...ACTIONS.rescue, newWallet: K }],
    ['nonce setup with an empty seed', { ...ACTIONS['nonce-setup'], seed: '' }],
    ['nonce setup with a 33-byte seed', { ...ACTIONS['nonce-setup'], seed: 'x'.repeat(33) }],
    ['nonce close of 0 lamports', { ...ACTIONS['nonce-close'], lamports: 0n }],
  ] as [string, TransactionAction][])('rejects %s', (_name, action) => {
    expect(() => buildTransaction(action, { feePayer: A, lifetime: blockhashLifetime })).toThrow();
  });
});
