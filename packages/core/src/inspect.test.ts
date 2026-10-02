// The inspector against every transaction the builder makes (the summary must equal the builder input) and against
// crafted transactions that differ in one way each. Malicious inputs are built with kit (see test/craft.ts).
import {
  AccountRole,
  address,
  blockhash,
  createNoopSigner,
  getTransactionDecoder,
  getTransactionEncoder,
  type AccountMeta,
  type Address,
  type Instruction,
  type Nonce,
  type SignatureBytes,
} from '@solana/kit';
import {
  getRequestHeapFrameInstruction,
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from '@solana-program/compute-budget';
import {
  getAuthorizeCheckedInstruction,
  getAuthorizeInstruction,
  getMergeInstruction,
  getSetLockupCheckedInstruction,
  getSetLockupInstruction,
  getSplitInstruction,
  getWithdrawInstruction,
  StakeAuthorize,
} from '@solana-program/stake';
import {
  getAdvanceNonceAccountInstruction,
  getCreateAccountWithSeedInstruction,
  getInitializeNonceAccountInstruction,
  getTransferSolInstruction,
} from '@solana-program/system';
import { describe, expect, it } from 'vitest';
import {
  appendLighthouseTail,
  build,
  craft,
  craftV0,
  decodeMessage,
  editMessage,
  instructionsOf,
  key,
  lifetimeToken,
  lighthouseInstruction,
  prefixInstructions,
  relist,
  replaceSignature,
  signatureOf,
  wireFromMessage,
} from '../test/craft.ts';
import { newTestWallet } from '../test/wallet.ts';
import type { BlockhashLifetime, Lifetime, NonceLifetime, TransactionAction, TransactionKind } from './actions.ts';
import { deriveNonceAccountAddress } from './builders.ts';
import {
  COMPUTE_UNIT_LIMIT,
  COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
  LIGHTHOUSE_PROGRAM_ADDRESS,
  NONCE_ACCOUNT_SEED,
  NONCE_ACCOUNT_SIZE,
  SYSTEM_PROGRAM_ADDRESS,
  SYSVAR_CLOCK_ADDRESS,
} from './constants.ts';
import { inspectTransaction, type InspectedLifetime, type InspectErrorCode } from './inspect.ts';
import { toLegacyLayout, type StakeIx } from './legacy-layout.ts';

const A = key(1); // main key
const K = key(2); // second key
const D = key(3); // new wallet
const S = key(4); // stake account
const VOTE = key(5);
const NONCE = key(6); // nonce account of the nonce lifetime
const S2 = key(7);
const X = key(8); // a stranger
const T = 1_825_545_600n;
const SETUP_NONCE = await deriveNonceAccountAddress(D);
const RENT_SYSVAR = address('SysvarRent111111111111111111111111111111111');

const BLOCKHASH: BlockhashLifetime = { kind: 'blockhash', blockhash: blockhash(key(20)), lastValidBlockHeight: 100n };
const NONCE_LIFETIME: NonceLifetime = { kind: 'nonce', nonceAccount: NONCE, nonceAuthority: D, nonceValue: key(21) as string as Nonce };
const LIFETIMES: readonly Lifetime[] = [BLOCKHASH, NONCE_LIFETIME];

const ACTIONS: { [Kind in TransactionKind]: Extract<TransactionAction, { kind: Kind }> } = {
  protect: { kind: 'protect', stakeAccount: S, mainKey: A, secondKey: K, lockUntil: T },
  extend: { kind: 'extend', stakeAccount: S, secondKey: K, lockUntil: T },
  unlock: { kind: 'unlock', stakeAccount: S, secondKey: K },
  withdraw: { kind: 'withdraw', stakeAccount: S, mainKey: A, secondKey: K, recipient: A, lamports: 5_000_000_000n },
  deactivate: { kind: 'deactivate', stakeAccount: S, staker: A },
  delegate: { kind: 'delegate', stakeAccount: S, staker: A, voteAccount: VOTE },
  rescue: { kind: 'rescue', stakeAccount: S, mainKey: A, secondKey: K, newWallet: D },
  'nonce-setup': { kind: 'nonce-setup', nonceAccount: SETUP_NONCE, nonceAuthority: D, seed: NONCE_ACCOUNT_SEED, lamports: 1_056_640n },
  'nonce-close': { kind: 'nonce-close', nonceAccount: SETUP_NONCE, nonceAuthority: D, recipient: D, lamports: 1_056_640n },
};

const signer = createNoopSigner;

function inspected(lifetime: Lifetime): InspectedLifetime {
  return lifetime.kind === 'blockhash' ? { kind: 'blockhash', blockhash: lifetime.blockhash } : lifetime;
}

/** 'ok' or the rejection code, so a failing expectation shows what happened. */
async function verdict(bytes: Uint8Array): Promise<'ok' | InspectErrorCode> {
  const result = await inspectTransaction(bytes);
  return result.ok ? 'ok' : result.error.code;
}

/** Crafts [prefix for the lifetime] + `body` with fee payer A (unless given). */
function craftBody(body: readonly Instruction[], lifetime: Lifetime = BLOCKHASH, feePayer: Address = A): Uint8Array {
  return craft([...prefixInstructions(lifetime), ...body], feePayer, lifetimeToken(lifetime));
}

/** The action instructions of a built transaction (after [AdvanceNonce]? [CU limit, CU price]). */
function actionInstructions(action: TransactionAction, lifetime: Lifetime = BLOCKHASH): Instruction[] {
  return instructionsOf(build(action, lifetime).bytes).slice(lifetime.kind === 'nonce' ? 3 : 2);
}

/** Replaces the instruction at `index` of a built transaction and recompiles with the same fee payer and token. */
function withInstruction(
  action: TransactionAction,
  index: number,
  change: (ix: Instruction) => Instruction,
  lifetime: Lifetime = BLOCKHASH,
): Uint8Array {
  const built = build(action, lifetime);
  const instructions = instructionsOf(built.bytes).map((ix, i) => (i === index ? change(ix) : ix));
  return craft(instructions, built.meta.feePayer, lifetimeToken(lifetime));
}

function mapAccounts(ix: Instruction, change: (meta: AccountMeta, index: number) => AccountMeta): Instruction {
  return { ...ix, accounts: (ix.accounts ?? []).map(change) };
}

function withData(ix: Instruction, change: (data: Uint8Array) => Uint8Array): Instruction {
  return { ...ix, data: change(Uint8Array.from(ix.data ?? [])) };
}

const protectIx = (stake: Address = S, authority: Address = A, newAuthority: Address = K) =>
  getSetLockupCheckedInstruction({
    stake,
    authority: signer(authority),
    newAuthority: signer(newAuthority),
    unixTimestamp: T,
    epoch: null,
  });

const authorizeIx = (
  stakeAuthorize: StakeAuthorize,
  options: { stake?: Address; authority?: Address; newAuthority?: Address; custodian?: Address } = {},
): StakeIx =>
  toLegacyLayout(
    getAuthorizeCheckedInstruction({
      stake: options.stake ?? S,
      authority: signer(options.authority ?? A),
      newAuthority: signer(options.newAuthority ?? D),
      ...(options.custodian === undefined ? {} : { lockupAuthority: signer(options.custodian) }),
      stakeAuthorize,
    }),
    { at: 1, sysvars: [SYSVAR_CLOCK_ADDRESS] },
  );

describe('accepts every transaction the builder makes, and says exactly what it does', () => {
  const cases = LIFETIMES.flatMap((lifetime) => Object.values(ACTIONS).map((action) => ({ action, lifetime })));

  it.each(cases)('$action.kind with a $lifetime.kind lifetime', async ({ action, lifetime }) => {
    const built = build(action, lifetime);
    const result = await inspectTransaction(built.bytes);
    expect(result).toStrictEqual({
      ok: true,
      summary: {
        action,
        feePayer: built.meta.feePayer,
        lifetime: inspected(lifetime),
        computeBudget: { unitLimit: COMPUTE_UNIT_LIMIT, microLamportsPerUnit: COMPUTE_UNIT_PRICE_MICRO_LAMPORTS },
        networkFeeLamports: 5_000n * BigInt(built.meta.signers.length) + 600n,
        requiredSigners: built.meta.signers,
        presentSignatures: [],
        lighthouseTail: null,
      },
    });
  });

  it.each([
    ['withdraw without the second key (lock ended)', { ...ACTIONS.withdraw, secondKey: null }],
    ['withdraw to another recipient', { ...ACTIONS.withdraw, recipient: D }],
    ['delegate by a staker that is not the main key', { ...ACTIONS.delegate, staker: X }],
  ] as [string, TransactionAction][])('%s', async (_name, action) => {
    for (const lifetime of LIFETIMES) {
      const built = build(action, lifetime);
      const result = await inspectTransaction(built.bytes);
      expect(result.ok && result.summary.action).toStrictEqual(action);
      expect(result.ok && result.summary.requiredSigners).toStrictEqual(built.meta.signers);
    }
  });

  it('extend and unlock paid by the main key (F5 fallback) report the main key as fee payer and signer', async () => {
    for (const action of [ACTIONS.extend, ACTIONS.unlock]) {
      const built = build(action, BLOCKHASH, A);
      const result = await inspectTransaction(built.bytes);
      expect(result.ok && result.summary).toMatchObject({ action, feePayer: A, requiredSigners: [A, K] });
    }
  });

  it('crafting the built instructions again gives the same bytes (the crafted cases below change one thing)', () => {
    for (const lifetime of LIFETIMES) {
      for (const action of Object.values(ACTIONS)) {
        const built = build(action, lifetime);
        expect(craft(instructionsOf(built.bytes), built.meta.feePayer, lifetimeToken(lifetime))).toStrictEqual(built.bytes);
      }
    }
  });

  it('the fee is 5000 lamports per signature plus limit x price', async () => {
    const fee = async (action: TransactionAction, lifetime: Lifetime) => {
      const result = await inspectTransaction(build(action, lifetime).bytes);
      return result.ok ? result.summary.networkFeeLamports : null;
    };
    expect(await fee(ACTIONS.protect, BLOCKHASH)).toBe(10_600n);
    expect(await fee(ACTIONS.rescue, NONCE_LIFETIME)).toBe(15_600n);
    expect(await fee(ACTIONS.unlock, BLOCKHASH)).toBe(5_600n);
  });
});

describe('signatures', () => {
  async function signedProtect() {
    const [main, second] = await Promise.all([newTestWallet(), newTestWallet()]);
    const action: TransactionAction = { ...ACTIONS.protect, mainKey: main.address, secondKey: second.address };
    const built = build(action, BLOCKHASH);
    const [byMain] = await main.signTransactions([built.bytes]);
    if (byMain === undefined) throw new Error('no signature');
    const [byBoth] = await second.signTransactions([byMain]);
    if (byBoth === undefined) throw new Error('no signature');
    return { main: main.address, second: second.address, action, built, byMain, byBoth };
  }

  it('reports the signatures already present', async () => {
    const { main, second, action, byMain, byBoth } = await signedProtect();
    const partly = await inspectTransaction(byMain);
    expect(partly.ok && partly.summary).toMatchObject({ action, requiredSigners: [main, second], presentSignatures: [main] });
    const fully = await inspectTransaction(byBoth);
    expect(fully.ok && fully.summary.presentSignatures).toStrictEqual([main, second]);
  });

  it('rejects a corrupted signature', async () => {
    const { second, byBoth } = await signedProtect();
    const corrupted = signatureOf(byBoth, second);
    corrupted[0] = (corrupted[0] ?? 0) ^ 1;
    expect(await verdict(replaceSignature(byBoth, second, corrupted))).toBe('invalid-signature');
  });

  it("rejects one signer's valid signature in another signer's slot", async () => {
    const { main, second, byBoth } = await signedProtect();
    expect(await verdict(replaceSignature(byBoth, second, signatureOf(byBoth, main)))).toBe('invalid-signature');
  });

  it('rejects a signature made before the message changed', async () => {
    const { main, byMain } = await signedProtect();
    const tailed = appendLighthouseTail(byMain);
    expect(await verdict(tailed)).toBe('ok');
    expect(await verdict(replaceSignature(tailed, main, signatureOf(byMain, main)))).toBe('invalid-signature');
  });
});

describe('rejects what CLAUDE.md step 2 names', () => {
  it('a foreign program', async () => {
    const foreign: Instruction = { programAddress: key(99), accounts: [], data: Uint8Array.of(1, 2, 3) };
    expect(await verdict(craftBody([protectIx(), foreign]))).toBe('unknown-program');
    expect(await verdict(craftBody([foreign]))).toBe('unknown-program');
    // The token program, for example, even before our instructions.
    const token: Instruction = { programAddress: address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), data: Uint8Array.of(9) };
    expect(await verdict(craft([token, ...prefixInstructions(BLOCKHASH), protectIx()], A, lifetimeToken(BLOCKHASH)))).toBe(
      'unknown-program',
    );
  });

  it('an address lookup table (v0 message)', async () => {
    const instructions = [...prefixInstructions(BLOCKHASH), protectIx()];
    const withTable = craftV0(instructions, A, lifetimeToken(BLOCKHASH), { address: key(50), addresses: [S] });
    expect(await verdict(withTable)).toBe('address-lookup-table');
    expect(await verdict(craftV0(instructions, A, lifetimeToken(BLOCKHASH)))).toBe('unsupported-version');
  });

  it('an unknown stake instruction (Split, Merge)', async () => {
    const split = getSplitInstruction({ stake: S, splitStake: S2, stakeAuthority: signer(A), args: 1_000_000n });
    expect(await verdict(craftBody([split]))).toBe('unknown-instruction');
    const merge = getMergeInstruction({ destinationStake: S, sourceStake: S2, stakeAuthority: signer(A) });
    expect(await verdict(craftBody([merge]))).toBe('unknown-instruction');
  });

  it('a System transfer, alone or next to a stake instruction', async () => {
    const transfer = getTransferSolInstruction({ source: signer(A), destination: X, amount: 1_000_000n });
    expect(await verdict(craftBody([transfer]))).toBe('unknown-instruction');
    expect(await verdict(craftBody([protectIx(), transfer]))).toBe('unknown-instruction');
  });

  it('two stake instructions over different accounts', async () => {
    expect(await verdict(craftBody([protectIx(S), protectIx(S2)]))).toBe('multiple-stake-accounts');
    const [withdraw] = actionInstructions(ACTIONS.withdraw);
    if (withdraw === undefined) throw new Error('no withdraw');
    expect(await verdict(craftBody([protectIx(S2), withdraw]))).toBe('multiple-stake-accounts');
  });

  it('a Lighthouse instruction that is not at the end', async () => {
    expect(await verdict(craftBody([lighthouseInstruction(), protectIx()]))).toBe('bad-lighthouse-tail');
    const [staker, withdrawer] = actionInstructions(ACTIONS.rescue);
    if (staker === undefined || withdrawer === undefined) throw new Error('no rescue pair');
    const between = craft(
      [...prefixInstructions(BLOCKHASH), staker, lighthouseInstruction(), withdrawer],
      D,
      lifetimeToken(BLOCKHASH),
    );
    expect(await verdict(between)).toBe('bad-lighthouse-tail');
    const first = craft([lighthouseInstruction(), ...prefixInstructions(BLOCKHASH), protectIx()], A, lifetimeToken(BLOCKHASH));
    expect(await verdict(first)).toBe('bad-lighthouse-tail');
  });
});

describe('rejects bytes that are not one canonical legacy transaction', () => {
  const built = build(ACTIONS.protect, BLOCKHASH);

  it('empty, garbage, truncated, too long', async () => {
    expect(await verdict(new Uint8Array())).toBe('malformed');
    expect(await verdict(Uint8Array.from({ length: 300 }, (_, i) => (i * 37 + 11) % 256))).toBe('malformed');
    expect(await verdict(built.bytes.slice(0, -1))).toBe('malformed');
    expect(await verdict(new Uint8Array(1233))).toBe('malformed');
  });

  it('trailing bytes', async () => {
    expect(await verdict(Uint8Array.from([...built.bytes, 0]))).toBe('malformed');
    expect(await verdict(Uint8Array.from([...built.bytes, ...built.bytes]))).toBe('malformed');
  });

  it('a wrong number of signature slots', async () => {
    const { messageBytes } = getTransactionDecoder().decode(built.bytes);
    const encode = (signatures: Record<Address, SignatureBytes | null>) =>
      new Uint8Array(getTransactionEncoder().encode({ messageBytes, signatures }));
    expect(await verdict(encode({ [A]: null }))).toBe('malformed');
    expect(await verdict(encode({ [A]: null, [K]: null, [X]: null }))).toBe('malformed');
    expect(await verdict(encode({ [A]: null, [K]: null }))).toBe('ok');
  });

  it('an account listed twice', async () => {
    const duplicated = editMessage(built.bytes, (message) => {
      const last = message.staticAccounts.length - 1;
      return { ...message, staticAccounts: message.staticAccounts.map((a, i) => (i === last ? S : a)) };
    });
    expect(await verdict(duplicated)).toBe('malformed');
  });

  it('a header or an index outside the account list', async () => {
    const header = editMessage(built.bytes, (message) => ({
      ...message,
      header: { ...message.header, numReadonlyNonSignerAccounts: message.staticAccounts.length },
    }));
    expect(await verdict(header)).toBe('malformed');
    const index = editMessage(built.bytes, (message) => ({
      ...message,
      instructions: message.instructions.map((ix) => ({ ...ix, programAddressIndex: message.staticAccounts.length })),
    }));
    expect(await verdict(index)).toBe('malformed');
    const readonlyFeePayer = editMessage(built.bytes, (message) => ({
      ...message,
      header: { ...message.header, numReadonlySignerAccounts: message.header.numSignerAccounts },
    }));
    expect(await verdict(readonlyFeePayer)).toBe('malformed');
  });

  it('instruction data that is not canonically encoded', async () => {
    const stakeIndex = 2;
    // SetLockupChecked data: u32 12, Option<i64> (tag 1 + 8 bytes), Option<u64> (tag 0). Tag 2 decodes as None.
    const tag2 = withInstruction(ACTIONS.protect, stakeIndex, (ix) =>
      withData(ix, (data) => data.map((byte, i) => (i === 13 ? 2 : byte))),
    );
    expect(await verdict(tag2)).toBe('malformed');
    const trailing = withInstruction(ACTIONS.protect, stakeIndex, (ix) => withData(ix, (data) => Uint8Array.from([...data, 0])));
    expect(await verdict(trailing)).toBe('malformed');
    const cuTrailing = withInstruction(ACTIONS.protect, 0, (ix) => withData(ix, (data) => Uint8Array.from([...data, 0])));
    expect(await verdict(cuTrailing)).toBe('malformed');
  });
});

describe('rejects layouts the builder never emits', () => {
  it('a legacy sysvar replaced or missing', async () => {
    const replaced = withInstruction(ACTIONS.withdraw, 2, (ix) =>
      mapAccounts(ix, (meta, i) => (i === 2 ? { address: RENT_SYSVAR, role: AccountRole.READONLY } : meta)),
    );
    expect(await verdict(replaced)).toBe('bad-layout');
    const rescueClock = withInstruction(
      ACTIONS.rescue,
      4,
      (ix) => mapAccounts(ix, (meta, i) => (i === 1 ? { address: X, role: AccountRole.READONLY } : meta)),
      NONCE_LIFETIME,
    );
    expect(await verdict(rescueClock)).toBe('bad-layout');
    // The generated (new) layout without sysvars is valid on chain, but Ledger cannot read it (D1).
    const newLayout = getWithdrawInstruction({
      stake: S,
      recipient: A,
      withdrawAuthority: signer(A),
      lockupAuthority: signer(K),
      args: 5_000_000_000n,
    });
    expect(await verdict(craftBody([newLayout]))).toBe('bad-layout');
  });

  it('an extra account on the stake instruction', async () => {
    for (const action of [ACTIONS.protect, ACTIONS.extend, ACTIONS.deactivate, ACTIONS.delegate, ACTIONS.withdraw]) {
      const extra = withInstruction(action, 2, (ix) => ({
        ...ix,
        accounts: [...(ix.accounts ?? []), { address: X, role: AccountRole.READONLY }],
      }));
      expect(await verdict(extra)).toBe('bad-layout');
    }
  });

  it('an account with a flipped role', async () => {
    const roleAt = (action: TransactionAction, account: number, role: AccountRole) =>
      withInstruction(action, 2, (ix) => mapAccounts(ix, (meta, i) => (i === account ? { ...meta, role } : meta)));
    // Stake account read-only; second key writable; second key not a signer at all; vote account writable.
    expect(await verdict(roleAt(ACTIONS.protect, 0, AccountRole.READONLY))).toBe('bad-layout');
    expect(await verdict(roleAt(ACTIONS.protect, 2, AccountRole.WRITABLE_SIGNER))).toBe('bad-layout');
    expect(await verdict(roleAt(ACTIONS.protect, 2, AccountRole.READONLY))).toBe('bad-layout');
    expect(await verdict(roleAt(ACTIONS.delegate, 1, AccountRole.WRITABLE))).toBe('bad-layout');
    expect(await verdict(roleAt(ACTIONS.withdraw, 2, AccountRole.WRITABLE))).toBe('bad-layout');
    // The stake account as a signer.
    expect(await verdict(roleAt(ACTIONS.deactivate, 0, AccountRole.WRITABLE_SIGNER))).toBe('bad-layout');
  });

  it('a signer no instruction uses', async () => {
    const built = build(ACTIONS.protect, BLOCKHASH);
    const extraSigner = editMessage(built.bytes, (message) =>
      relist(message, [message.staticAccounts[0] ?? A, X, ...message.staticAccounts.slice(1)], {
        ...message.header,
        numSignerAccounts: message.header.numSignerAccounts + 1,
        numReadonlySignerAccounts: message.header.numReadonlySignerAccounts + 1,
      }),
    );
    expect(decodeMessage(extraSigner).staticAccounts.slice(0, 3)).toContain(X);
    expect(await verdict(extraSigner)).toBe('bad-layout');
  });

  it('accounts in another order than the builder lists them', async () => {
    const built = build(ACTIONS.protect, BLOCKHASH);
    const swapped = editMessage(built.bytes, (message) => {
      const accounts = [...message.staticAccounts];
      const [a, b] = [accounts.length - 1, accounts.length - 2];
      [accounts[a], accounts[b]] = [accounts[b] ?? A, accounts[a] ?? A];
      return relist(message, accounts);
    });
    expect(await verdict(swapped)).toBe('bad-layout');
  });

  it('AdvanceNonceAccount anywhere but first, or without its authority signing', async () => {
    const [advance, limit, price] = prefixInstructions(NONCE_LIFETIME);
    if (advance === undefined || limit === undefined || price === undefined) throw new Error('no prefix');
    const token = lifetimeToken(NONCE_LIFETIME);
    expect(await verdict(craft([limit, price, advance, protectIx()], A, token))).toBe('bad-layout');
    expect(await verdict(craft([limit, advance, price, protectIx()], A, token))).toBe('bad-layout');
    expect(await verdict(craft([advance, advance, limit, price, protectIx()], A, token))).toBe('bad-layout');
    const unsigned = mapAccounts(advance, (meta, i) => (i === 2 ? { address: meta.address, role: AccountRole.READONLY } : meta));
    expect(await verdict(craft([unsigned, limit, price, protectIx()], A, token))).toBe('bad-layout');
  });

  it('a compute budget other than the fixed limit and price, or in another order', async () => {
    const limit = getSetComputeUnitLimitInstruction({ units: COMPUTE_UNIT_LIMIT });
    const price = getSetComputeUnitPriceInstruction({ microLamports: COMPUTE_UNIT_PRICE_MICRO_LAMPORTS });
    const token = lifetimeToken(BLOCKHASH);
    const higherPrice = getSetComputeUnitPriceInstruction({ microLamports: COMPUTE_UNIT_PRICE_MICRO_LAMPORTS * 1000n });
    expect(await verdict(craft([limit, higherPrice, protectIx()], A, token))).toBe('bad-layout');
    const lowerPrice = getSetComputeUnitPriceInstruction({ microLamports: 0n });
    expect(await verdict(craft([limit, lowerPrice, protectIx()], A, token))).toBe('bad-layout');
    const otherLimit = getSetComputeUnitLimitInstruction({ units: 1_400_000 });
    expect(await verdict(craft([otherLimit, price, protectIx()], A, token))).toBe('bad-layout');
    expect(await verdict(craft([price, limit, protectIx()], A, token))).toBe('bad-layout');
    expect(await verdict(craft([protectIx()], A, token))).toBe('bad-layout');
    expect(await verdict(craft([limit, price, limit, protectIx()], A, token))).toBe('bad-layout');
    expect(await verdict(craft([limit, price, protectIx(), price], A, token))).toBe('bad-layout');
    const heap = getRequestHeapFrameInstruction({ bytes: 64 * 1024 });
    expect(await verdict(craft([limit, price, heap, protectIx()], A, token))).toBe('unknown-instruction');
    const limitWithAccount = { ...limit, accounts: [{ address: X, role: AccountRole.READONLY }] };
    expect(await verdict(craft([limitWithAccount, price, protectIx()], A, token))).toBe('bad-layout');
  });

  it('a transaction with no action, or stake and system instructions mixed', async () => {
    expect(await verdict(craftBody([]))).toBe('bad-layout');
    const [close] = actionInstructions(ACTIONS['nonce-close']);
    if (close === undefined) throw new Error('no close');
    expect(await verdict(craftBody([protectIx(), close]))).toBe('bad-layout');
  });
});

describe('rejects parameters Stakeward never builds', () => {
  const setLockup = (values: { unixTimestamp: bigint | null; epoch: bigint | null; custodian: Address | null }) =>
    craftBody([getSetLockupInstruction({ stake: S, authority: signer(K), ...values })], BLOCKHASH, K);

  it('SetLockup that changes the custodian or the epoch, or sets no end', async () => {
    expect(await verdict(setLockup({ unixTimestamp: T, epoch: null, custodian: null }))).toBe('ok');
    expect(await verdict(setLockup({ unixTimestamp: 0n, epoch: null, custodian: null }))).toBe('ok');
    expect(await verdict(setLockup({ unixTimestamp: T, epoch: null, custodian: X }))).toBe('unknown-instruction');
    expect(await verdict(setLockup({ unixTimestamp: null, epoch: null, custodian: X }))).toBe('unknown-instruction');
    expect(await verdict(setLockup({ unixTimestamp: T, epoch: 2_000n, custodian: null }))).toBe('unknown-instruction');
    expect(await verdict(setLockup({ unixTimestamp: T, epoch: 0n, custodian: null }))).toBe('unknown-instruction');
    expect(await verdict(setLockup({ unixTimestamp: null, epoch: null, custodian: null }))).toBe('unknown-instruction');
    expect(await verdict(setLockup({ unixTimestamp: -1n, epoch: null, custodian: null }))).toBe('unknown-instruction');
  });

  it('SetLockupChecked without a new custodian, with an epoch, or without a future end', async () => {
    const checked = (input: { newAuthority?: Address; unixTimestamp: bigint | null; epoch: bigint | null }) =>
      craftBody([
        getSetLockupCheckedInstruction({
          stake: S,
          authority: signer(A),
          ...(input.newAuthority === undefined ? {} : { newAuthority: signer(input.newAuthority) }),
          unixTimestamp: input.unixTimestamp,
          epoch: input.epoch,
        }),
      ]);
    expect(await verdict(checked({ newAuthority: K, unixTimestamp: T, epoch: null }))).toBe('ok');
    expect(await verdict(checked({ unixTimestamp: T, epoch: null }))).toBe('unknown-instruction');
    expect(await verdict(checked({ newAuthority: K, unixTimestamp: T, epoch: 2_000n }))).toBe('unknown-instruction');
    expect(await verdict(checked({ newAuthority: K, unixTimestamp: 0n, epoch: null }))).toBe('unknown-instruction');
    expect(await verdict(checked({ newAuthority: K, unixTimestamp: null, epoch: null }))).toBe('unknown-instruction');
  });

  it('keys the builder refuses (second key = main key, zero amounts)', async () => {
    expect(await verdict(craftBody([protectIx(S, A, A)]))).toBe('unknown-instruction');
    const zero = withInstruction(ACTIONS.withdraw, 2, (ix) =>
      withData(ix, (data) => data.map((byte, i) => (i >= 4 ? 0 : byte))),
    );
    expect(await verdict(zero)).toBe('unknown-instruction');
  });

  it('a single AuthorizeChecked, or Authorize (unchecked)', async () => {
    expect(await verdict(craftBody([authorizeIx(StakeAuthorize.Staker)]))).toBe('unknown-instruction');
    expect(await verdict(craftBody([authorizeIx(StakeAuthorize.Withdrawer, { custodian: K })]))).toBe('unknown-instruction');
    const authorize = getAuthorizeInstruction({
      stake: S,
      authority: signer(A),
      lockupAuthority: signer(K),
      arg0: D,
      arg1: StakeAuthorize.Withdrawer,
    });
    expect(await verdict(craftBody([authorize]))).toBe('unknown-instruction');
    expect(await verdict(craftBody([toLegacyLayout(authorize, { at: 1, sysvars: [SYSVAR_CLOCK_ADDRESS] })]))).toBe(
      'unknown-instruction',
    );
  });

  it('a rescue pair that is not exactly the pair', async () => {
    const pair = (staker: StakeIx, withdrawer: StakeIx) => craftBody([staker, withdrawer], BLOCKHASH, D);
    const staker = authorizeIx(StakeAuthorize.Staker);
    const withdrawer = authorizeIx(StakeAuthorize.Withdrawer, { custodian: K });
    expect(await verdict(pair(staker, withdrawer))).toBe('ok');
    // Different stake accounts.
    expect(await verdict(pair(staker, authorizeIx(StakeAuthorize.Withdrawer, { stake: S2, custodian: K })))).toBe(
      'multiple-stake-accounts',
    );
    // Different authority, different new authority, reversed, custodian on the wrong one, staker twice.
    const variants: [StakeIx, StakeIx][] = [
      [staker, authorizeIx(StakeAuthorize.Withdrawer, { authority: X, custodian: K })],
      [staker, authorizeIx(StakeAuthorize.Withdrawer, { newAuthority: X, custodian: K })],
      [withdrawer, staker],
      [staker, authorizeIx(StakeAuthorize.Withdrawer)],
      [authorizeIx(StakeAuthorize.Staker, { custodian: K }), withdrawer],
      [staker, authorizeIx(StakeAuthorize.Staker, { custodian: K })],
    ];
    for (const [first, second] of variants) expect(await verdict(pair(first, second))).toBe('multiple-stake-accounts');
    // Three instructions.
    expect(await verdict(craftBody([staker, withdrawer, staker], BLOCKHASH, D))).toBe('multiple-stake-accounts');
  });

  it('a nonce setup that does not create our nonce account', async () => {
    const create = (input: { newAccount?: Address; seed?: string; space?: number; owner?: Address; base?: Address }) =>
      getCreateAccountWithSeedInstruction({
        payer: signer(D),
        newAccount: input.newAccount ?? SETUP_NONCE,
        base: input.base ?? D,
        seed: input.seed ?? NONCE_ACCOUNT_SEED,
        amount: 1_056_640n,
        space: input.space ?? NONCE_ACCOUNT_SIZE,
        programAddress: input.owner ?? SYSTEM_PROGRAM_ADDRESS,
      });
    const init = (nonceAccount: Address = SETUP_NONCE, nonceAuthority: Address = D) =>
      getInitializeNonceAccountInstruction({ nonceAccount, nonceAuthority });
    const setup = (...body: Instruction[]) => verdict(craftBody(body, BLOCKHASH, D));
    expect(await setup(create({}), init())).toBe('ok');
    expect(await setup(create({ newAccount: X }), init(X))).toBe('unknown-instruction');
    expect(await setup(create({ seed: 'other' }), init())).toBe('unknown-instruction');
    expect(await setup(create({ space: 200 }), init())).toBe('unknown-instruction');
    expect(await setup(create({ owner: key(60) }), init())).toBe('unknown-instruction');
    expect(await setup(create({ base: X }), init())).toBe('unknown-instruction');
    expect(await setup(create({}), init(SETUP_NONCE, X))).toBe('unknown-instruction');
    expect(await setup(create({}), init(X))).toBe('unknown-instruction');
    expect(await setup(create({ seed: 'x'.repeat(33) }), init())).toBe('unknown-instruction');
    expect(await setup(init(), create({}))).toBe('bad-layout');
    expect(await setup(init())).toBe('bad-layout');
    expect(await setup(create({}))).toBe('bad-layout');
  });

  it('a nonce instruction Stakeward never sends', async () => {
    const advance = getAdvanceNonceAccountInstruction({ nonceAccount: NONCE, nonceAuthority: signer(D) });
    expect(await verdict(craftBody([advance], BLOCKHASH, D))).toBe('bad-layout');
  });
});

describe('Lighthouse tail', () => {
  it('accepts Phantom-style assertions at the end and reports them', async () => {
    for (const lifetime of LIFETIMES) {
      for (const action of Object.values(ACTIONS)) {
        const built = build(action, lifetime);
        const result = await inspectTransaction(appendLighthouseTail(built.bytes, [S, X], 2));
        expect(result.ok && result.summary).toMatchObject({
          action,
          requiredSigners: built.meta.signers,
          lighthouseTail: {
            instructionCount: 2,
            addedAccounts: action.kind === 'nonce-setup' || action.kind === 'nonce-close' ? [LIGHTHOUSE_PROGRAM_ADDRESS, S, X] : [LIGHTHOUSE_PROGRAM_ADDRESS, X],
          },
        });
      }
    }
  });

  it('rejects a tail that adds a signer or makes an account a signer or writable', async () => {
    const built = build(ACTIONS.protect, BLOCKHASH);
    const withTail = (accounts: AccountMeta[]) =>
      craft([...instructionsOf(built.bytes), lighthouseInstruction(accounts)], A, lifetimeToken(BLOCKHASH));
    expect(await verdict(withTail([{ address: X, role: AccountRole.READONLY_SIGNER }]))).toBe('bad-lighthouse-tail');
    expect(await verdict(withTail([{ address: X, role: AccountRole.WRITABLE }]))).toBe('bad-lighthouse-tail');
    expect(await verdict(withTail([{ address: K, role: AccountRole.WRITABLE_SIGNER }]))).toBe('bad-lighthouse-tail');
    const delegate = build(ACTIONS.delegate, BLOCKHASH);
    const writableVote = craft(
      [...instructionsOf(delegate.bytes), lighthouseInstruction([{ address: VOTE, role: AccountRole.WRITABLE }])],
      A,
      lifetimeToken(BLOCKHASH),
    );
    expect(await verdict(writableVote)).toBe('bad-lighthouse-tail');
    // Phantom-style tail whose header also turns the first read-only account writable.
    const widened = editMessage(appendLighthouseTail(built.bytes, [X]), (message) => ({
      ...message,
      header: { ...message.header, numReadonlyNonSignerAccounts: message.header.numReadonlyNonSignerAccounts - 1 },
    }));
    expect(await verdict(widened)).toBe('bad-layout');
  });

  it('rejects a tail whose accounts are not appended at the end', async () => {
    // kit (like any recompiling wallet) sorts the new read-only accounts in among the existing ones.
    const built = build(ACTIONS.protect, BLOCKHASH);
    const recompiled = craft(
      [...instructionsOf(built.bytes), lighthouseInstruction([{ address: X, role: AccountRole.READONLY }])],
      A,
      lifetimeToken(BLOCKHASH),
    );
    const original = decodeMessage(built.bytes).staticAccounts;
    expect(decodeMessage(recompiled).staticAccounts.slice(0, original.length)).not.toStrictEqual(original);
    expect(await verdict(recompiled)).toBe('bad-lighthouse-tail');
    const tailed = appendLighthouseTail(build(ACTIONS.protect, BLOCKHASH).bytes, [X]);
    const reordered = editMessage(tailed, (message) => {
      const accounts = [...message.staticAccounts];
      const last = accounts.length - 1;
      [accounts[last], accounts[last - 3]] = [accounts[last - 3] ?? A, accounts[last] ?? A];
      return relist(message, accounts);
    });
    expect(await verdict(reordered)).toBe('bad-lighthouse-tail');
  });

  it('rejects an account the tail adds but never uses', async () => {
    const tailed = appendLighthouseTail(build(ACTIONS.protect, BLOCKHASH).bytes);
    const unused = editMessage(tailed, (message) =>
      relist(message, [...message.staticAccounts, X], {
        ...message.header,
        numReadonlyNonSignerAccounts: message.header.numReadonlyNonSignerAccounts + 1,
      }),
    );
    expect(await verdict(unused)).toBe('bad-layout');
  });
});

describe('never throws', () => {
  it('on every single-byte corruption of a signed-shape transaction', async () => {
    const built = build(ACTIONS.rescue, NONCE_LIFETIME);
    const results = await Promise.all(
      Array.from(built.bytes, (_, index) =>
        inspectTransaction(built.bytes.map((byte, i) => (i === index ? byte ^ 0xff : byte))),
      ),
    );
    for (const result of results) {
      expect(typeof result.ok).toBe('boolean');
      if (result.ok) expect(result.summary.action.kind).toBe('rescue');
    }
    expect(results.filter((result) => !result.ok).length).toBeGreaterThan(built.bytes.length / 2);
  });

  it('on wire messages kit cannot even decompile', async () => {
    const built = build(ACTIONS.protect, BLOCKHASH);
    const noAccounts = editMessage(built.bytes, (message) => ({
      ...message,
      instructions: message.instructions.map(({ programAddressIndex, data }) => ({
        programAddressIndex,
        ...(data === undefined ? {} : { data }),
      })),
    }));
    expect(await verdict(noAccounts)).toBe('bad-layout');
    const noData = editMessage(built.bytes, (message) => ({
      ...message,
      instructions: message.instructions.map(({ programAddressIndex, accountIndices }) => ({
        programAddressIndex,
        ...(accountIndices === undefined ? {} : { accountIndices }),
      })),
    }));
    expect(await verdict(noData)).toBe('unknown-instruction');
    expect(await verdict(wireFromMessage({ ...decodeMessage(built.bytes), instructions: [] }))).toBe('bad-layout');
  });
});
