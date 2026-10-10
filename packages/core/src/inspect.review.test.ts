// Adversarial review of the inspector (CLAUDE.md section 3). The attacker controls a phishing /cosign link, a
// compromised data source or a client of the worker's RPC proxy, and hands crafted bytes to inspectTransaction.
//   - "holes": the inspector accepted something it should not. These failed before the fix pass (the shared
//     compareMessages in verify.ts, and the builder that the inspector's backstop rebuilds with) and now guard it.
//   - "what the summary exposes": accepted on purpose; the screens must act on the reported fields (chain state, fee
//     payer, signers). They pin that the information is there.
//   - "regression": structural attacks that are rejected today.
// Malicious inputs are built with kit or edited at the compiled-message level (test/craft.ts).
import {
  AccountRole,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  createAddressWithSeed,
  createNoopSigner,
  createTransactionMessage,
  getCompiledTransactionMessageEncoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
  type Nonce,
} from '@solana/kit';
import { getSetComputeUnitPriceInstruction } from '@solana-program/compute-budget';
import {
  getSetLockupCheckedInstruction,
  getSetLockupInstruction,
  getWithdrawInstruction,
  STAKE_PROGRAM_ADDRESS,
} from '@solana-program/stake';
import {
  getAdvanceNonceAccountInstruction,
  getCreateAccountWithSeedInstruction,
  getInitializeNonceAccountInstruction,
  getWithdrawNonceAccountInstruction,
} from '@solana-program/system';
import { describe, expect, it } from 'vitest';
import {
  appendLighthouseTail,
  build,
  craft,
  decodeMessage,
  editMessage,
  instructionsOf,
  key,
  lifetimeToken,
  lighthouseInstruction,
  prefixInstructions,
  relist,
  wireFromMessage,
} from '../test/craft.ts';
import type { BlockhashLifetime, Lifetime, NonceLifetime, TransactionAction, TransactionKind } from './actions.ts';
import { buildTransaction, deriveNonceAccountAddress } from './builders.ts';
import {
  I64_MAX,
  LIGHTHOUSE_PROGRAM_ADDRESS,
  MAX_LOCKUP_END,
  NONCE_ACCOUNT_SEED,
  NONCE_ACCOUNT_SIZE,
  SYSTEM_PROGRAM_ADDRESS,
  SYSVAR_CLOCK_ADDRESS,
  SYSVAR_STAKE_HISTORY_ADDRESS,
  ZERO_ADDRESS,
} from './constants.ts';
import { inspectTransaction, type InspectErrorCode, type TransactionSummary } from './inspect.ts';
import { toLegacyLayout } from './legacy-layout.ts';

const A = key(1); // main key
const K = key(2); // second key
const D = key(3); // new wallet
const S = key(4); // stake account
const VOTE = key(5);
const NONCE = key(6);
const THIEF = key(8);
const THIEF2 = key(9);
const T = 1_825_545_600n;
const SETUP_NONCE = await deriveNonceAccountAddress(D);
const RENT_SYSVAR = 'SysvarRent111111111111111111111111111111111' as Address;
const RECENT_BLOCKHASHES_SYSVAR = 'SysvarRecentB1ockHashes11111111111111111111' as Address;

const BLOCKHASH: BlockhashLifetime = { kind: 'blockhash', blockhash: blockhash(key(20)), lastValidBlockHeight: 100n };
const NONCE_LIFETIME: NonceLifetime = { kind: 'nonce', nonceAccount: NONCE, nonceAuthority: D, nonceValue: key(21) as string as Nonce };

const ACTIONS: { [Kind in TransactionKind]: Extract<TransactionAction, { kind: Kind }> } = {
  protect: { kind: 'protect', stakeAccount: S, mainKey: A, secondKey: K, lockUntil: T },
  extend: { kind: 'extend', stakeAccount: S, secondKey: K, lockUntil: T },
  unlock: { kind: 'unlock', stakeAccount: S, secondKey: K },
  withdraw: { kind: 'withdraw', stakeAccount: S, mainKey: A, secondKey: K, recipient: A, lamports: 5_000_000_000n },
  deactivate: { kind: 'deactivate', stakeAccount: S, staker: A },
  delegate: { kind: 'delegate', stakeAccount: S, staker: A, voteAccount: VOTE },
  rescue: { kind: 'rescue', stakeAccount: S, mainKey: A, secondKey: K, newWallet: D },
  'change-second-key': { kind: 'change-second-key', stakeAccount: S, secondKey: K, newWallet: D },
  'nonce-setup': { kind: 'nonce-setup', nonceAccount: SETUP_NONCE, nonceAuthority: D, seed: NONCE_ACCOUNT_SEED, lamports: 1_056_640n },
  'nonce-close': { kind: 'nonce-close', nonceAccount: SETUP_NONCE, nonceAuthority: D, recipient: D, lamports: 1_056_640n },
};

const signer = createNoopSigner;

async function verdict(bytes: Uint8Array): Promise<'ok' | InspectErrorCode> {
  const result = await inspectTransaction(bytes);
  return result.ok ? 'ok' : result.error.code;
}

async function summaryOf(bytes: Uint8Array): Promise<TransactionSummary> {
  const result = await inspectTransaction(bytes);
  if (!result.ok) throw new Error(`rejected: ${result.error.code}: ${result.error.message}`);
  return result.summary;
}

/** [prefix for the lifetime] + `body`, compiled by kit with `feePayer`. */
function craftBody(body: readonly Instruction[], feePayer: Address = A, lifetime: Lifetime = BLOCKHASH): Uint8Array {
  return craft([...prefixInstructions(lifetime), ...body], feePayer, lifetimeToken(lifetime));
}

/** Appends a raw compiled instruction (program by index) to the message; nothing else changes. */
function appendCompiled(bytes: Uint8Array, programAddressIndex: number, accountIndices: number[] = []): Uint8Array {
  return editMessage(bytes, (message) => ({
    ...message,
    instructions: [
      ...message.instructions,
      { programAddressIndex, ...(accountIndices.length === 0 ? {} : { accountIndices }), data: Uint8Array.of(0x0b, 0) },
    ],
  }));
}

function indexOf(bytes: Uint8Array, account: Address): number {
  const index = decodeMessage(bytes).staticAccounts.indexOf(account);
  if (index === -1) throw new Error(`${account} is not in the message`);
  return index;
}

/** Replaces account `position` of the instruction at `index` (decompiled) and recompiles. */
function replaceAccount(bytes: Uint8Array, feePayer: Address, token: string, index: number, position: number, account: Address) {
  const instructions = instructionsOf(bytes).map((ix, i) =>
    i === index
      ? { ...ix, accounts: (ix.accounts ?? []).map((meta, p) => (p === position ? { ...meta, address: account } : meta)) }
      : ix,
  );
  return craft(instructions, feePayer, token);
}

describe('review holes (fixed)', () => {
  // Rule (inspect.ts, verify.ts): the tail calls Lighthouse and every account it adds is a read-only non-signer.
  // Before the fix nothing required the Lighthouse program account itself to be one of the added accounts, so the tail
  // could call an address the body already lists as the fee payer, a signer or a writable account. With the fee payer as program,
  // Agave's sanitize rejects the message ("A program cannot be a payer"), so the proxy forwards bytes that cannot
  // land; in the other cases a program account is a signer or writable, which no real tail produces.
  it('H1: the tail may only call a Lighthouse account it appended itself (not the fee payer, a signer or a body account)', async () => {
    const lighthousePays = buildTransaction(ACTIONS.protect, { feePayer: LIGHTHOUSE_PROGRAM_ADDRESS, lifetime: BLOCKHASH }).bytes;
    expect(await verdict(appendCompiled(lighthousePays, 0))).not.toBe('ok');

    const toLighthouse = build({ ...ACTIONS.withdraw, recipient: LIGHTHOUSE_PROGRAM_ADDRESS }, BLOCKHASH).bytes;
    expect(await verdict(appendCompiled(toLighthouse, indexOf(toLighthouse, LIGHTHOUSE_PROGRAM_ADDRESS)))).not.toBe('ok');

    const lighthouseSigns = build({ ...ACTIONS.protect, secondKey: LIGHTHOUSE_PROGRAM_ADDRESS }, BLOCKHASH).bytes;
    expect(await verdict(appendCompiled(lighthouseSigns, indexOf(lighthouseSigns, LIGHTHOUSE_PROGRAM_ADDRESS)))).not.toBe(
      'ok',
    );
  });

  // The summary carries the seed, and a signing screen that prints it renders bidi overrides and invisible characters
  // (React escapes HTML, not U+202E). The nonce also lands at an address the app never derives
  // (deriveNonceAccountAddress uses NONCE_ACCOUNT_SEED), so "close nonce account" will not find the deposit.
  // Stakeward only ever uses NONCE_ACCOUNT_SEED (scripts/gate/run.ts too).
  it('H2: a nonce setup whose seed holds Unicode control or format characters', async () => {
    const setup = async (seed: string) => {
      const nonceAccount = await createAddressWithSeed({ baseAddress: D, programAddress: SYSTEM_PROGRAM_ADDRESS, seed });
      return craftBody(
        [
          getCreateAccountWithSeedInstruction({
            payer: signer(D),
            newAccount: nonceAccount,
            base: D,
            seed,
            amount: 1_056_640n,
            space: NONCE_ACCOUNT_SIZE,
            programAddress: SYSTEM_PROGRAM_ADDRESS,
          }),
          getInitializeNonceAccountInstruction({ nonceAccount, nonceAuthority: D }),
        ],
        D,
      );
    };
    expect(await verdict(await setup(NONCE_ACCOUNT_SEED))).toBe('ok');
    expect(await verdict(await setup('stakeward-‮nonce'))).not.toBe('ok'); // right-to-left override
    expect(await verdict(await setup('stakeward​-nonce'))).not.toBe('ok'); // zero-width space
    expect(await verdict(await setup('stakeward-nonce\n'))).not.toBe('ok'); // control character
  });

  // Any i64 > 0 was accepted as a lockup end. Past 8.64e12 s a JavaScript Date cannot hold it: formatUtcDate
  // (format.ts) returns null, so the screen that must show "locked until T" before signing has nothing to show.
  // Stakeward never builds T more than about 13 months ahead (D13). Fixed in the builder (T <= MAX_LOCKUP_END,
  // 2100-01-01), which the inspector's backstop rebuilds with; so the bytes are crafted here.
  it('H3: a lockup end the signing screen cannot display', async () => {
    const huge = 8_640_000_000_001n;
    const protect = (lockUntil: bigint) =>
      craftBody([
        getSetLockupCheckedInstruction({ stake: S, authority: signer(A), newAuthority: signer(K), unixTimestamp: lockUntil, epoch: null }),
      ]);
    const extend = (lockUntil: bigint) =>
      craftBody([getSetLockupInstruction({ stake: S, authority: signer(K), unixTimestamp: lockUntil, epoch: null, custodian: null })], K);
    expect(protect(MAX_LOCKUP_END)).toEqual(build({ ...ACTIONS.protect, lockUntil: MAX_LOCKUP_END }, BLOCKHASH).bytes);
    expect(await verdict(protect(MAX_LOCKUP_END))).toBe('ok');
    expect(await verdict(extend(MAX_LOCKUP_END))).toBe('ok');
    for (const lockUntil of [MAX_LOCKUP_END + 1n, huge, I64_MAX]) {
      expect(() => build({ ...ACTIONS.protect, lockUntil }, BLOCKHASH)).toThrow();
      expect(() => build({ ...ACTIONS.extend, lockUntil }, BLOCKHASH)).toThrow();
      expect(await verdict(protect(lockUntil))).not.toBe('ok');
      expect(await verdict(extend(lockUntil))).not.toBe('ok');
    }
  });
});

describe('review: what the summary exposes (accepted on purpose; the screens must act on it)', () => {
  // SetLockupChecked is signed by the withdrawer only while no lock is in force; under a lock the CUSTODIAN signs it.
  // A thief holding A sends K's holder a /cosign link: SetLockupChecked by K with THIEF2 as new custodian. The
  // inspector calls it "protect" with mainKey = K. /cosign must check mainKey against the on-chain withdrawer; if
  // it is the current custodian, this is a custody handover (F7) and must say so.
  it('S1: "protect" signed by the current custodian, handing custody to someone else', async () => {
    const handover = craftBody(
      [getSetLockupCheckedInstruction({ stake: S, authority: signer(K), newAuthority: signer(THIEF2), unixTimestamp: T, epoch: null })],
      K,
    );
    const summary = await summaryOf(handover);
    expect(summary.action).toStrictEqual({ kind: 'protect', stakeAccount: S, mainKey: K, secondKey: THIEF2, lockUntil: T });
  });

  // "extend" is any SetLockup with T > 0: it can shorten the lock or end it at once (T in the past). The screen
  // must compare lockUntil with the on-chain lockup and the clock.
  it('S2: "extend" to a time in the past (effectively unlock)', async () => {
    const shorten = craftBody(
      [getSetLockupInstruction({ stake: S, authority: signer(K), unixTimestamp: 1n, epoch: null, custodian: null })],
      K,
    );
    expect((await summaryOf(shorten)).action).toStrictEqual({ kind: 'extend', stakeAccount: S, secondKey: K, lockUntil: 1n });
  });

  // A rescue paid by A or on a nonce A owns (section 5) is accepted today; spec.review.test.ts R3/R4 already asks the
  // inspector to reject it, so it is not pinned here. A stranger's key as nonce authority is an extra required signer
  // outside the action; it is listed, and its AdvanceNonceAccount is reported as the lifetime.
  it('S3: a nonce authority outside the action is listed as a required signer and as the lifetime', async () => {
    const bytes = build(ACTIONS.deactivate, { ...NONCE_LIFETIME, nonceAuthority: THIEF }).bytes;
    const summary = await summaryOf(bytes);
    expect(summary.requiredSigners).toStrictEqual([A, THIEF]);
    expect(summary.lifetime).toStrictEqual({ kind: 'nonce', nonceAccount: NONCE, nonceAuthority: THIEF, nonceValue: key(21) });
    expect(summary.networkFeeLamports).toBe(10_600n);
  });

  // Withdraw and nonce close accept any recipient; nonce setup accepts any deposit. Shown in full on screen (a
  // short "7xK...9fQ" form can be matched by a ground vanity address).
  it('S4: recipients and deposits are taken from the bytes', async () => {
    const toThief = await summaryOf(build({ ...ACTIONS.withdraw, recipient: THIEF }, BLOCKHASH).bytes);
    expect(toThief.action).toMatchObject({ kind: 'withdraw', recipient: THIEF });
    const close = await summaryOf(build({ ...ACTIONS['nonce-close'], recipient: THIEF }, BLOCKHASH).bytes);
    expect(close.action).toMatchObject({ kind: 'nonce-close', recipient: THIEF });
    const deposit = await summaryOf(build({ ...ACTIONS['nonce-setup'], lamports: 500_000_000_000n }, BLOCKHASH).bytes);
    expect(deposit.action).toMatchObject({ kind: 'nonce-setup', lamports: 500_000_000_000n });
  });

  // The proxy must not forward on inspectTransaction alone for sendTransaction: unsigned bytes pass it.
  it('S5: unsigned bytes pass (the proxy must also run verifyAllSignatures before sendTransaction)', async () => {
    const summary = await summaryOf(build(ACTIONS.withdraw, BLOCKHASH).bytes);
    expect(summary.presentSignatures).toStrictEqual([]);
  });

  // The tail may reference the stake program, the stake account and the signers A and K: Lighthouse runs with A's and
  // K's signer privilege and could CPI into the stake program (a callee must be among the caller's accounts).
  // Today's Lighthouse has no such instruction; this is trust in Lighthouse (and its upgrade authority).
  it('S6: a Lighthouse tail may pass the stake program and the signers to Lighthouse', async () => {
    const bytes = appendLighthouseTail(build(ACTIONS.protect, BLOCKHASH).bytes, [STAKE_PROGRAM_ADDRESS, S, A, K]);
    expect((await summaryOf(bytes)).lighthouseTail).toStrictEqual({
      instructionCount: 1,
      addedAccounts: [LIGHTHOUSE_PROGRAM_ADDRESS],
    });
  });
});

describe('review regression: structural attacks rejected today', () => {
  it('a program as fee payer, or an instruction whose program is a signer', async () => {
    // The stake program pays (a writable signer at index 0) and SetLockupChecked calls index 0; A and K still sign.
    // Kit refuses to compile this, so the message is edited: [A ws, K rs, S w, CB r, Stake r] becomes
    // [Stake ws, A rs, K rs, S w, CB r].
    const stakePays = editMessage(build(ACTIONS.protect, BLOCKHASH).bytes, (message) => {
      const rest = message.staticAccounts.filter((a) => a !== STAKE_PROGRAM_ADDRESS && a !== A && a !== K);
      return relist(message, [STAKE_PROGRAM_ADDRESS, A, K, ...rest], {
        numSignerAccounts: 3,
        numReadonlySignerAccounts: 2,
        numReadonlyNonSignerAccounts: message.header.numReadonlyNonSignerAccounts - 1,
      });
    });
    expect(decodeMessage(stakePays).instructions[2]?.programAddressIndex).toBe(0);
    expect(await verdict(stakePays)).toBe('unknown-instruction');
    // The SetLockupChecked program index points at the second key K (a signer).
    const signerProgram = editMessage(build(ACTIONS.protect, BLOCKHASH).bytes, (message) => ({
      ...message,
      instructions: message.instructions.map((ix, i) => (i === 2 ? { ...ix, programAddressIndex: 1 } : ix)),
    }));
    expect(await verdict(signerProgram)).toBe('unknown-program');
  });

  it('a v1 (message-first) transaction, a non-canonical signature count, a header with no signer', async () => {
    const v1 = pipe(
      createTransactionMessage({ version: 1 }),
      (m) => setTransactionMessageFeePayer(A, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(key(20)), lastValidBlockHeight: 0n }, m),
      (m) => appendTransactionMessageInstructions(instructionsOf(build(ACTIONS.protect, BLOCKHASH).bytes), m),
    );
    const v1Bytes = new Uint8Array(getTransactionEncoder().encode(compileTransaction(v1)));
    expect(await verdict(v1Bytes)).not.toBe('ok');

    const built = build(ACTIONS.protect, BLOCKHASH).bytes;
    expect(built[0]).toBe(2);
    // shortU16 2 encoded in two bytes (0x82 0x00): kit decodes it, Agave rejects it.
    expect(await verdict(Uint8Array.from([0x82, 0x00, ...built.slice(1)]))).toBe('malformed');

    const message = decodeMessage(built);
    const noSigner = getCompiledTransactionMessageEncoder().encode({
      ...message,
      header: { ...message.header, numSignerAccounts: 0 },
    });
    expect(await verdict(Uint8Array.from([0, ...noSigner]))).toBe('malformed');
  });

  it('nonce instructions with a sysvar replaced, swapped or an extra account', async () => {
    const token = lifetimeToken(NONCE_LIFETIME);
    const rescue = build(ACTIONS.rescue, NONCE_LIFETIME).bytes;
    // AdvanceNonceAccount: account 2 is RecentBlockhashes.
    expect(await verdict(replaceAccount(rescue, D, token, 0, 1, SYSVAR_CLOCK_ADDRESS))).toBe('bad-layout');
    const [advance, ...rest] = instructionsOf(rescue);
    if (advance === undefined) throw new Error('no advance');
    const extra = { ...advance, accounts: [...(advance.accounts ?? []), { address: THIEF, role: AccountRole.READONLY }] };
    expect(await verdict(craft([extra, ...rest], D, token))).toBe('bad-layout');

    // InitializeNonceAccount: Rent replaced. WithdrawNonceAccount: sysvars swapped.
    const setup = build(ACTIONS['nonce-setup'], BLOCKHASH).bytes;
    const bh = lifetimeToken(BLOCKHASH);
    expect(await verdict(replaceAccount(setup, D, bh, 3, 2, SYSVAR_CLOCK_ADDRESS))).toBe('bad-layout');
    const close = getWithdrawNonceAccountInstruction({
      nonceAccount: SETUP_NONCE,
      recipientAccount: D,
      nonceAuthority: signer(D),
      withdrawAmount: 1_056_640n,
    });
    const swapped = {
      ...close,
      accounts: close.accounts.map((meta, i) =>
        i === 2 ? { ...meta, address: RENT_SYSVAR } : i === 3 ? { ...meta, address: RECENT_BLOCKHASHES_SYSVAR } : meta,
      ),
    };
    expect(await verdict(craftBody([swapped], D))).toBe('bad-layout');
    // Nonce close whose authority is not a signer (someone else pays, so nothing else makes D sign).
    const unsigned = {
      ...close,
      accounts: close.accounts.map((meta, i) => (i === 4 ? { ...meta, role: AccountRole.READONLY } : meta)),
    };
    expect(await verdict(craftBody([close], THIEF))).toBe('ok');
    expect(await verdict(craftBody([unsigned], THIEF))).toBe('bad-layout');
  });

  it('CreateAccountWithSeed with a separate base account', async () => {
    const withBase = getCreateAccountWithSeedInstruction({
      payer: signer(D),
      newAccount: await createAddressWithSeed({
        baseAddress: THIEF,
        programAddress: SYSTEM_PROGRAM_ADDRESS,
        seed: NONCE_ACCOUNT_SEED,
      }),
      baseAccount: signer(THIEF),
      base: THIEF,
      seed: NONCE_ACCOUNT_SEED,
      amount: 1_056_640n,
      space: NONCE_ACCOUNT_SIZE,
      programAddress: SYSTEM_PROGRAM_ADDRESS,
    });
    expect(withBase.accounts).toHaveLength(3);
    expect(await verdict(craftBody([withBase], D))).toBe('bad-layout');
  });

  it('custodian moves hidden in SetLockup / SetLockupChecked, keys the builder refuses', async () => {
    const setLockup = (custodian: Address) =>
      craftBody([getSetLockupInstruction({ stake: S, authority: signer(K), unixTimestamp: T, epoch: null, custodian })], K);
    expect(await verdict(setLockup(ZERO_ADDRESS))).toBe('unknown-instruction');
    expect(await verdict(setLockup(K))).toBe('unknown-instruction');
    // Option tag 2 for the custodian decodes as None; the canonical re-encoding catches it.
    const tag2 = craftBody(
      [getSetLockupInstruction({ stake: S, authority: signer(K), unixTimestamp: T, epoch: null, custodian: null })].map((ix) => ({
        ...ix,
        data: ix.data.map((byte, i) => (i === ix.data.length - 1 ? 2 : byte)),
      })),
      K,
    );
    expect(await verdict(tag2)).toBe('malformed');
    // SetLockupChecked whose new custodian is the zero key or the stake account (the builder refuses both).
    for (const newAuthority of [ZERO_ADDRESS, S]) {
      const checked = getSetLockupCheckedInstruction({
        stake: S,
        authority: signer(A),
        newAuthority: signer(newAuthority),
        unixTimestamp: T,
        epoch: null,
      });
      expect(await verdict(craftBody([checked]))).toBe('unknown-instruction');
    }
    // Withdraw whose custodian is the withdrawer itself (legacy layout, so only the key check can catch it).
    const sameKey = toLegacyLayout(
      getWithdrawInstruction({ stake: S, recipient: A, withdrawAuthority: signer(A), lockupAuthority: signer(A), args: 1n }),
      { at: 2, sysvars: [SYSVAR_CLOCK_ADDRESS, SYSVAR_STAKE_HISTORY_ADDRESS] },
    );
    expect(sameKey.accounts).toHaveLength(6);
    expect(await verdict(craftBody([sameKey]))).toBe('unknown-instruction');
    // Rescue whose new wallet is the second key or the stake account.
    for (const newWallet of [K, S]) expect(await verdict(rescueTo(newWallet))).toBe('unknown-instruction');
  });

  it('instructions after the Lighthouse tail, a tail with nothing before it, more than 64 instructions', async () => {
    const built = build(ACTIONS.protect, BLOCKHASH).bytes;
    const body = instructionsOf(built);
    const token = lifetimeToken(BLOCKHASH);
    const [limit, price, protect] = body;
    if (limit === undefined || price === undefined || protect === undefined) throw new Error('no body');
    expect(await verdict(craft([...body, lighthouseInstruction(), protect], A, token))).toBe('bad-lighthouse-tail');
    expect(await verdict(craft([...body, lighthouseInstruction(), price], A, token))).toBe('bad-lighthouse-tail');
    const advance = getAdvanceNonceAccountInstruction({ nonceAccount: NONCE, nonceAuthority: signer(A) });
    expect(await verdict(craft([...body, lighthouseInstruction(), advance], A, token))).toBe('bad-lighthouse-tail');
    expect(await verdict(craft([lighthouseInstruction()], A, token))).toBe('bad-layout');
    const prices = Array.from({ length: 64 }, () => getSetComputeUnitPriceInstruction({ microLamports: 1n }));
    const many = decodeMessage(craft(prices, A, token));
    const first = many.instructions[0];
    if (first === undefined) throw new Error('no instruction');
    const eighty = wireFromMessage({ ...many, instructions: Array.from({ length: 80 }, () => first) });
    expect(await verdict(eighty)).toBe('bad-layout');
  });

  it('non-canonical data on AuthorizeChecked and AdvanceNonceAccount', async () => {
    const rescue = build(ACTIONS.rescue, NONCE_LIFETIME);
    const token = lifetimeToken(NONCE_LIFETIME);
    const trailing = (index: number) =>
      craft(
        instructionsOf(rescue.bytes).map((ix, i) =>
          i === index ? { ...ix, data: Uint8Array.from([...(ix.data ?? []), 0]) } : ix,
        ),
        D,
        token,
      );
    expect(await verdict(trailing(0))).toBe('malformed');
    expect(await verdict(trailing(3))).toBe('malformed');
    expect(await verdict(trailing(4))).toBe('malformed');
  });

  it('bytes passed as a view into a larger buffer give the same summary', async () => {
    const built = build(ACTIONS.rescue, NONCE_LIFETIME).bytes;
    const buffer = new Uint8Array(built.length + 16).fill(0xff);
    buffer.set(built, 8);
    expect(await summaryOf(buffer.subarray(8, 8 + built.length))).toStrictEqual(await summaryOf(built));
  });
});

/** The rescue pair with `newWallet` in place of D (the builder refuses K or S there), paid by `newWallet` (section 5). */
function rescueTo(newWallet: Address): Uint8Array {
  const [staker, withdrawer] = instructionsOf(build(ACTIONS.rescue, BLOCKHASH).bytes).slice(2);
  if (staker === undefined || withdrawer === undefined) throw new Error('no rescue pair');
  const swap = (ix: Instruction): Instruction => ({
    ...ix,
    accounts: (ix.accounts ?? []).map((meta) =>
      meta.address === D ? { address: newWallet, role: AccountRole.READONLY_SIGNER } : meta,
    ),
  });
  return craftBody([swap(staker), swap(withdrawer)], newWallet);
}
