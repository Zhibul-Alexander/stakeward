// Adversarial review of the signing-flow checks (CLAUDE.md section 6, section 11): a malicious or buggy wallet in the
// middle of a multi-signer flow (Phantom first, fee payer next, then the others) tries to change the transaction in
// ways the step check would let through, and `verifyAllSignatures` / the /cosign link codec are probed for edge cases.
// Tests outside "HOLES" defended correctly from the start; the tests under "HOLES" failed against the first version
// (a message-only `compareSignedMessage`) and guard the fix (`checkSigningStep`).
import {
  AccountRole,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  getAddressDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
  type Nonce,
} from '@solana/kit';
import { getSetComputeUnitPriceInstruction } from '@solana-program/compute-budget';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  relist,
  replaceSignature,
  signatureOf,
} from '../test/craft.ts';
import { newTestWallet, type TestWallet } from '../test/wallet.ts';
import type { BlockhashLifetime, Lifetime, TransactionAction } from './actions.ts';
import { COMPUTE_BUDGET_PROGRAM_ADDRESS, STAKE_PROGRAM_ADDRESS } from './constants.ts';
import { inspectTransaction } from './inspect.ts';
import { cosignFragment, decodeBase64Url, encodeBase64Url, MAX_TRANSACTION_BYTES, parseCosignFragment } from './link.ts';
import { checkSigningStep, verifyAllSignatures, type SigningStepErrorCode } from './verify.ts';

const STAKE = key(4);
const X = key(8);
const Y = key(9);
const NONCE_ACCOUNT = key(6);
const BLOCKHASH: BlockhashLifetime = { kind: 'blockhash', blockhash: blockhash(key(20)), lastValidBlockHeight: 100n };
const T = 1_825_545_600n;
const RECENT_BLOCKHASHES = 'SysvarRecentB1ockHashes11111111111111111111' as Address;

async function sign(wallet: TestWallet, bytes: Uint8Array): Promise<Uint8Array> {
  const [signed] = await wallet.signTransactions([bytes]);
  if (signed === undefined) throw new Error('wallet returned nothing');
  return signed;
}

/** One signing step, `sent` into the wallet and `returned` out: 'ok:<n>' (n Lighthouse instructions) or the error code. */
async function verdict(sent: Uint8Array, returned: Uint8Array): Promise<`ok:${string}` | SigningStepErrorCode> {
  const result = await checkSigningStep(sent, returned);
  return result.ok ? `ok:${String(result.lighthouseInstructions)}` : result.error.code;
}

/**
 * One signing step as the flow runs it: the transaction that went into the wallet and the one that came back. The
 * first version took only the input's message and an `isFirstSigner` flag; the step check now reads both from the
 * input transaction.
 */
async function checkStep(input: Uint8Array, output: Uint8Array) {
  return checkSigningStep(input, output);
}

async function inspectCode(bytes: Uint8Array): Promise<string> {
  const result = await inspectTransaction(bytes);
  return result.ok ? `ok:${result.summary.action.kind}` : result.error.code;
}

/** Protect with real keys: A (main, fee payer) and K (second key); on a nonce, A is also the nonce authority. */
async function protect(lifetimeKind: Lifetime['kind'] = 'blockhash') {
  const [main, second] = await Promise.all([newTestWallet(), newTestWallet()]);
  const action: TransactionAction = {
    kind: 'protect',
    stakeAccount: STAKE,
    mainKey: main.address,
    secondKey: second.address,
    lockUntil: T,
  };
  const lifetime: Lifetime =
    lifetimeKind === 'blockhash'
      ? BLOCKHASH
      : { kind: 'nonce', nonceAccount: NONCE_ACCOUNT, nonceAuthority: main.address, nonceValue: key(21) as string as Nonce };
  return { main, second, action, lifetime, built: build(action, lifetime) };
}

/** Wire bytes split by hand: compact-u16 signature count (one byte here), the 64-byte slots, the message. */
function splitWire(bytes: Uint8Array) {
  const count = bytes[0] ?? 0;
  if (count >= 0x80) throw new Error('test helper expects fewer than 128 signatures');
  return { count, slots: bytes.slice(1, 1 + 64 * count), message: bytes.slice(1 + 64 * count) };
}

function concat(...parts: (Uint8Array | number[])[]): Uint8Array {
  return Uint8Array.from(parts.flatMap((part) => [...part]));
}

/** The same instructions as a kit 8.4 v1 (message-first) transaction. */
function craftV1(instructions: readonly Instruction[], feePayer: Address, token: string): Uint8Array {
  const message = pipe(
    createTransactionMessage({ version: 1 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(token), lastValidBlockHeight: 0n }, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
}

const hex = (text: string): Uint8Array => Uint8Array.from(text.match(/../g) ?? [], (byte) => parseInt(byte, 16));

describe('review: the signing step refuses what a wallet may not change', () => {
  it('refuses a tail whose header edit turns an existing account into a signer or writable', async () => {
    const { built } = await protect();
    const tailed = appendLighthouseTail(built.bytes, [X]);
    expect(await verdict(built.bytes, tailed)).toBe('ok:1');
    // K (read-only signer) made a writable signer.
    const kWritable = editMessage(tailed, (m) => ({
      ...m,
      header: { ...m.header, numReadonlySignerAccounts: m.header.numReadonlySignerAccounts - 1 },
    }));
    expect(await verdict(built.bytes, kWritable)).toBe('tail-adds-signer');
    // The first non-signer (the stake account) pulled into the signer section.
    const stakeSigner = editMessage(tailed, (m) => ({
      ...m,
      header: {
        ...m.header,
        numSignerAccounts: m.header.numSignerAccounts + 1,
        numReadonlySignerAccounts: m.header.numReadonlySignerAccounts + 1,
      },
    }));
    expect(await verdict(built.bytes, stakeSigner)).toBe('tail-adds-signer');
    // Both new accounts (Lighthouse and X) moved into the writable section.
    const bothWritable = editMessage(tailed, (m) => ({
      ...m,
      header: { ...m.header, numReadonlyNonSignerAccounts: m.header.numReadonlyNonSignerAccounts - 2 },
    }));
    expect(await verdict(built.bytes, bothWritable)).toBe('tail-adds-signer');
    // The same header edits without a tail are plain changes.
    const noTail = editMessage(built.bytes, (m) => ({
      ...m,
      header: { ...m.header, numReadonlySignerAccounts: m.header.numReadonlySignerAccounts - 1 },
    }));
    expect(await verdict(built.bytes, noTail)).toBe('message-changed');
  });

  it('refuses a kit-compiled tail that makes the stake account a signer or a sysvar writable', async () => {
    const { main, built } = await protect();
    const token = lifetimeToken(BLOCKHASH);
    const stakeSigner = craft(
      [...instructionsOf(built.bytes), lighthouseInstruction([{ address: STAKE, role: AccountRole.READONLY_SIGNER }])],
      main.address,
      token,
    );
    expect(await verdict(built.bytes, stakeSigner)).toBe('tail-adds-signer');

    const nonce = await protect('nonce');
    const sysvarWritable = craft(
      [
        ...instructionsOf(nonce.built.bytes),
        lighthouseInstruction([{ address: RECENT_BLOCKHASHES, role: AccountRole.WRITABLE }]),
      ],
      nonce.main.address,
      lifetimeToken(nonce.lifetime),
    );
    expect(await verdict(nonce.built.bytes, sysvarWritable)).toBe('tail-adds-signer');
  });

  it('refuses a valid-looking tail combined with reordered static accounts', async () => {
    const { built } = await protect();
    const count = decodeMessage(built.bytes).staticAccounts.length;
    const tailed = appendLighthouseTail(built.bytes, [X]);
    // Two original read-only accounts (programs) swapped; header and tail otherwise as accepted.
    const swapped = editMessage(tailed, (m) => {
      const accounts = [...m.staticAccounts];
      [accounts[count - 1], accounts[count - 2]] = [accounts[count - 2] ?? X, accounts[count - 1] ?? X];
      return relist(m, accounts);
    });
    expect(await verdict(built.bytes, swapped)).toBe('message-changed');
    // The tail's Lighthouse program moved in front of the last original account.
    const lighthouseFirst = editMessage(tailed, (m) => {
      const accounts = [...m.staticAccounts];
      [accounts[count - 1], accounts[count]] = [accounts[count] ?? X, accounts[count - 1] ?? X];
      return relist(m, accounts);
    });
    expect(await verdict(built.bytes, lighthouseFirst)).toBe('message-changed');
  });

  it('refuses a changed blockhash, nonce value or nonce account, with or without a tail', async () => {
    const { built } = await protect();
    const otherHash = (bytes: Uint8Array) => editMessage(bytes, (m) => ({ ...m, lifetimeToken: key(23) }));
    expect(await verdict(built.bytes, otherHash(built.bytes))).toBe('message-changed');
    expect(await verdict(built.bytes, otherHash(appendLighthouseTail(built.bytes)))).toBe('message-changed');

    const nonce = await protect('nonce');
    expect(await verdict(nonce.built.bytes, otherHash(nonce.built.bytes))).toBe('message-changed');
    const otherNonceAccount = (bytes: Uint8Array) =>
      editMessage(bytes, (m) => ({
        ...m,
        staticAccounts: m.staticAccounts.map((address) => (address === NONCE_ACCOUNT ? key(7) : address)),
      }));
    expect(await verdict(nonce.built.bytes, otherNonceAccount(nonce.built.bytes))).toBe('message-changed');
    expect(await verdict(nonce.built.bytes, otherNonceAccount(appendLighthouseTail(nonce.built.bytes)))).toBe(
      'message-changed',
    );
  });

  it('refuses a non-Lighthouse instruction after the tail, and a Lighthouse instruction moved to the front', async () => {
    const { built } = await protect();
    const tailed = appendLighthouseTail(built.bytes, [X]);
    // A compute-budget price bump that reuses the existing program account (no new account, header untouched).
    const priceBump = editMessage(tailed, (m) => ({
      ...m,
      instructions: [
        ...m.instructions,
        {
          programAddressIndex: m.staticAccounts.indexOf(COMPUTE_BUDGET_PROGRAM_ADDRESS),
          data: getSetComputeUnitPriceInstruction({ microLamports: 10n ** 12n }).data,
        },
      ],
    }));
    expect(await verdict(built.bytes, priceBump)).toBe('message-changed');
    expect(await inspectCode(priceBump)).not.toMatch(/^ok/);
    // A stake instruction (a copy of the original one) appended after the tail.
    const stakeAgain = editMessage(tailed, (m) => {
      const stakeIx = m.instructions.find((ix) => m.staticAccounts[ix.programAddressIndex] === STAKE_PROGRAM_ADDRESS);
      if (stakeIx === undefined) throw new Error('no stake instruction');
      return { ...m, instructions: [...m.instructions, stakeIx] };
    });
    expect(await verdict(built.bytes, stakeAgain)).toBe('message-changed');
    // The Lighthouse instruction moved in front of the compute budget instructions, account layout as accepted.
    const lighthouseFirst = editMessage(tailed, (m) => ({
      ...m,
      instructions: [...m.instructions.slice(-1), ...m.instructions.slice(0, -1)],
    }));
    expect(await verdict(built.bytes, lighthouseFirst)).toBe('message-changed');
  });

  it('refuses duplicated accounts, truncated, padded and re-slotted wire bytes', async () => {
    const { main, built } = await protect();
    const byMain = await sign(main, built.bytes);
    // A tail account that duplicates the stake account.
    const duplicate = editMessage(appendLighthouseTail(built.bytes, [X]), (m) => ({
      ...m,
      staticAccounts: m.staticAccounts.map((address) => (address === X ? STAKE : address)),
    }));
    expect(await verdict(built.bytes, duplicate)).toBe('malformed');
    // Truncated anywhere.
    for (const cut of [1, 64, 65, 129, byMain.length - 33, byMain.length - 1]) {
      expect(await verdict(built.bytes, byMain.slice(0, cut))).toBe('malformed');
    }
    // Two copies glued together.
    expect(await verdict(built.bytes, concat(byMain, byMain))).toBe('malformed');
    const { count, slots, message } = splitWire(byMain);
    // One signature slot too many, one too few.
    expect(await verdict(built.bytes, concat([count + 1], slots, new Uint8Array(64), message))).toBe('malformed');
    expect(await verdict(built.bytes, concat([count - 1], slots.slice(64), message))).toBe('malformed');
    // The same count in a non-canonical two-byte compact-u16.
    expect(await verdict(built.bytes, concat([count | 0x80, 0x00], slots, message))).toBe('malformed');
    // Sanity: the split re-joins to the accepted bytes.
    expect(await verdict(built.bytes, concat([count], slots, message))).toBe('ok:0');
  });

  it('refuses the same instructions re-encoded as a v1 (message-first) transaction', async () => {
    const { main, built } = await protect();
    const v1 = craftV1(instructionsOf(built.bytes), main.address, lifetimeToken(BLOCKHASH));
    expect(v1[0]).toBe(0x81);
    expect(await verdict(built.bytes, v1)).toBe('message-changed');
    expect(await verifyAllSignatures(v1)).toMatchObject({ ok: false, error: { code: 'malformed' } });
    expect(await inspectCode(v1)).toBe('unsupported-version');
  });

  it('lets only the first signer touch the tail', async () => {
    const { main, second, built } = await protect();
    const byPhantom = await sign(main, appendLighthouseTail(built.bytes, [STAKE, X]));
    expect(await verdict(built.bytes, byPhantom)).toBe('ok:1');
    // The next wallet appends one more assertion reusing the accounts already listed (no header change).
    const another = editMessage(byPhantom, (m) => ({
      ...m,
      instructions: [...m.instructions, ...m.instructions.slice(-1)],
    }));
    expect(await verdict(byPhantom, await sign(second, another))).toBe('tail-not-first-signer');
    // ... appends an assertion over a new read-only account.
    expect(await verdict(byPhantom, await sign(second, appendLighthouseTail(byPhantom, [Y])))).toBe(
      'tail-not-first-signer',
    );
    // ... rewrites the data of Phantom's assertion.
    const rewritten = editMessage(byPhantom, (m) => ({
      ...m,
      instructions: m.instructions.map((ix, i) =>
        i === m.instructions.length - 1 ? { ...ix, data: Uint8Array.of(0x0b, 0xff) } : ix,
      ),
    }));
    expect(await verdict(byPhantom, await sign(second, rewritten))).toBe('message-changed');
    // ... strips the tail again (going back to the built message).
    expect(await verdict(byPhantom, await sign(second, built.bytes))).toBe('message-changed');
  });

  it('keeps the inspector summary identical at every accepted step and rejects the escalations', async () => {
    const { main, second, action, built } = await protect('nonce');
    const byPhantom = await sign(main, appendLighthouseTail(built.bytes, [STAKE, NONCE_ACCOUNT, X], 2));
    const bySecond = await sign(second, byPhantom);
    for (const bytes of [built.bytes, byPhantom, bySecond]) {
      const result = await inspectTransaction(bytes);
      expect(result.ok && result.summary.action).toStrictEqual(action);
    }
    const kWritable = editMessage(byPhantom, (m) => ({
      ...m,
      header: { ...m.header, numReadonlySignerAccounts: m.header.numReadonlySignerAccounts - 1 },
    }));
    expect(await inspectCode(kWritable)).not.toMatch(/^ok/);
  });

  it('accepts a tail that references the existing signers: Lighthouse then holds their signer privilege (design)', async () => {
    // Recorded behaviour, see the review report: a tail may pass A (withdrawer, fee payer) and K (custodian) to
    // Lighthouse. Their roles do not change, so `compareMessages` accepts it.
    const { main, second, built } = await protect();
    const tailed = appendLighthouseTail(built.bytes, [main.address, second.address, STAKE]);
    expect(await verdict(built.bytes, tailed)).toBe('ok:1');
    expect(await inspectCode(tailed)).toBe('ok:protect');
  });
});

describe('review: verifyAllSignatures', () => {
  it('refuses a signature by the right key over another message (other blockhash)', async () => {
    const { main, second, action, built } = await protect();
    const other = build(action, { ...BLOCKHASH, blockhash: blockhash(key(22)) });
    const foreign = signatureOf(await sign(main, other.bytes), main.address);
    const both = await sign(second, replaceSignature(built.bytes, main.address, foreign));
    expect(await verifyAllSignatures(both)).toMatchObject({
      ok: false,
      error: { code: 'invalid-signatures', signers: [main.address] },
    });
  });

  it('refuses a malleated signature (S + L, same R)', async () => {
    const L = (1n << 252n) + 27_742_317_777_372_353_535_851_937_790_883_648_493n;
    const { main, second, built } = await protect();
    const both = await sign(second, await sign(main, built.bytes));
    const original = signatureOf(both, main.address);
    let s = 0n;
    for (let i = 63; i >= 32; i--) s = (s << 8n) | BigInt(original[i] ?? 0);
    let bumped = s + L;
    expect(bumped < 1n << 256n).toBe(true);
    const malleated = Uint8Array.from(original);
    for (let i = 32; i < 64; i++) {
      malleated[i] = Number(bumped & 0xffn);
      bumped >>= 8n;
    }
    expect(await verifyAllSignatures(replaceSignature(both, main.address, malleated))).toMatchObject({
      ok: false,
      error: { code: 'invalid-signatures', signers: [main.address] },
    });
  });

  it('refuses forged signatures for small-order public keys (Node WebCrypto; browsers unverified)', async () => {
    const torsion = [
      '0100000000000000000000000000000000000000000000000000000000000000',
      'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
      '0000000000000000000000000000000000000000000000000000000000000080',
      'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a',
      'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa',
      '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05',
      '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85',
    ].map(hex);
    for (const point of torsion) {
      const signer = getAddressDecoder().decode(point);
      const unsigned = craft([lighthouseInstruction()], signer, lifetimeToken(BLOCKHASH));
      for (const r of torsion) {
        // R a small-order point, S = 0: verifies for every message under a cofactorless check without key checks.
        const forged = replaceSignature(unsigned, signer, concat(r, new Uint8Array(32)));
        expect((await verifyAllSignatures(forged)).ok).toBe(false);
      }
    }
  });

  it('refuses signatures swapped between slots', async () => {
    const { main, second, built } = await protect();
    const both = await sign(second, await sign(main, built.bytes));
    const swapped = replaceSignature(
      replaceSignature(both, main.address, signatureOf(both, second.address)),
      second.address,
      signatureOf(both, main.address),
    );
    expect(await verifyAllSignatures(swapped)).toMatchObject({
      ok: false,
      error: { code: 'invalid-signatures', signers: [main.address, second.address] },
    });
  });
});

describe('review: /cosign link codec', () => {
  it.each([
    ['trailing newline', 'AAAA\n'],
    ['leading space', ' AAAA'],
    ['one padding char', 'AAA='],
    ['standard alphabet plus', 'AA+A'],
    ['standard alphabet slash', 'AA/A'],
    ['percent-encoded dash', 'AA%2DA'],
    ['dot', 'AA.A'],
    ['non-ASCII letter', 'AAАA'],
    ['length 4n+1', 'AAAAA'],
    ['non-canonical 2-char tail', 'AB'],
    ['non-canonical 3-char tail', 'AAB'],
    ['non-canonical 6-char tail', 'AAAAAB'],
  ])('decodeBase64Url rejects %s', (_name, text) => {
    expect(decodeBase64Url(text)).toBeNull();
  });

  it('round-trips bytes whose standard base64 needs + and /', () => {
    const bytes = Uint8Array.of(0xfb, 0xef, 0xbe, 0xff, 0xff, 0xff, 0x3e);
    const text = encodeBase64Url(bytes);
    expect(text).not.toMatch(/[+/=]/);
    expect(decodeBase64Url(text)).toEqual(bytes);
  });

  it.each([
    ['upper-case key', (tx: string) => `#TX=${tx}`],
    ['two fragments', (tx: string) => `#tx=${tx}#tx=${tx}`],
    ['repeated parameter', (tx: string) => `#tx=${tx}&tx=${tx}`],
    ['leading slash', (tx: string) => `#/tx=${tx}`],
    ['query-style', (tx: string) => `?tx=${tx}`],
  ])('parseCosignFragment rejects %s', (_name, make) => {
    const tx = encodeBase64Url(Uint8Array.from({ length: 300 }, (_, i) => i % 256));
    expect(parseCosignFragment(make(tx))).toBeNull();
  });

  it('rejects oversize payloads without throwing, and accepts a real signed transaction', async () => {
    expect(parseCosignFragment(cosignFragment(new Uint8Array(MAX_TRANSACTION_BYTES + 1)))).toBeNull();
    expect(parseCosignFragment(`#tx=${'A'.repeat(1_000_000)}`)).toBeNull();
    const { main, built } = await protect('nonce');
    const byMain = await sign(main, built.bytes);
    expect(parseCosignFragment(`#${cosignFragment(byMain)}`)).toEqual(byMain);
  });
});

describe('review: HOLES (fixed)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('H1 a step check refuses a wallet that wipes an earlier signature', async () => {
    const { main, second, built } = await protect();
    const byMain = await sign(main, built.bytes);
    // K's wallet signs, but returns the transaction with A's signature removed.
    const wiped = replaceSignature(await sign(second, byMain), main.address, null);
    expect(await checkStep(byMain, wiped)).toMatchObject({ ok: false, error: { code: 'signature-changed' } });
  });

  it('H2 a step check refuses a returned signature that belongs to another message', async () => {
    const { main, action, built } = await protect();
    // A's wallet signs a different message (another blockhash) and returns that signature on our message.
    const other = build(action, { ...BLOCKHASH, blockhash: blockhash(key(22)) });
    const returned = replaceSignature(built.bytes, main.address, signatureOf(await sign(main, other.bytes), main.address));
    expect(await checkStep(built.bytes, returned)).toMatchObject({ ok: false, error: { code: 'invalid-signature' } });
  });

  it('H3 a Lighthouse tail is refused once the transaction that went in carries a signature', async () => {
    // /cosign: A has signed on the first device; K's wallet is Phantom, the first wallet on this device, and appends
    // a tail. Accepting it voids A's signature.
    const { main, second, built } = await protect('nonce');
    const byMain = await sign(main, built.bytes);
    const byPhantomK = await sign(second, appendLighthouseTail(byMain, [STAKE]));
    expect(await checkStep(byMain, byPhantomK)).toMatchObject({ ok: false, error: { code: 'tail-not-first-signer' } });
  });

  it('H4 verification that cannot run (no Ed25519 in this browser) is not reported as an invalid signature', async () => {
    const { main, second, built } = await protect();
    const both = await sign(second, await sign(main, built.bytes));
    const subtle = (globalThis as unknown as { crypto: { subtle: { importKey: (...args: unknown[]) => unknown } } })
      .crypto.subtle;
    vi.spyOn(subtle, 'importKey').mockRejectedValue(
      Object.assign(new Error('Algorithm: Unrecognized name'), { name: 'NotSupportedError' }),
    );
    const verified = await verifyAllSignatures(both);
    expect(verified.ok).toBe(false);
    expect(!verified.ok && verified.error.code).toBe('verification-unavailable');
    expect(await inspectCode(both)).toBe('verification-unavailable');
    expect(await checkStep(await sign(main, built.bytes), both)).toMatchObject({
      ok: false,
      error: { code: 'verification-unavailable' },
    });
  });
});
