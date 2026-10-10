// Checks after each wallet signature (CLAUDE.md section 6): the message a wallet returns must be the one it was
// given, or that message with a Lighthouse tail appended by the first signer (the transaction went in unsigned); the
// signatures that went in come back unchanged and the new ones verify; before sending, every signature must verify.
// Wallets are in-memory test keys; changed messages are crafted with kit (test/craft.ts).
import { AccountRole, blockhash, createNoopSigner, type Address, type Nonce } from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
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
  relist,
  replaceSignature,
  signatureOf,
} from '../test/craft.ts';
import { newTestWallet, type TestWallet } from '../test/wallet.ts';
import type { BlockhashLifetime, Lifetime, TransactionAction } from './actions.ts';
import { inspectTransaction } from './inspect.ts';
import { checkSigningStep, verifyAllSignatures, type SigningStepErrorCode } from './verify.ts';

const STAKE = key(4);
const X = key(8);
const BLOCKHASH: BlockhashLifetime = { kind: 'blockhash', blockhash: blockhash(key(20)), lastValidBlockHeight: 100n };
const T = 1_825_545_600n;

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
      : { kind: 'nonce', nonceAccount: key(6), nonceAuthority: main.address, nonceValue: key(21) as string as Nonce };
  return { main, second, action, built: build(action, lifetime) };
}

describe('checkSigningStep', () => {
  it('accepts the unchanged message from every signer', async () => {
    const { main, second, built } = await protect();
    const byMain = await sign(main, built.bytes);
    expect(await verdict(built.bytes, byMain)).toBe('ok:0');
    expect(await verdict(byMain, await sign(second, byMain))).toBe('ok:0');
    // An unsigned copy of the same message also counts as unchanged.
    expect(await verdict(built.bytes, built.bytes)).toBe('ok:0');
  });

  it('accepts a Lighthouse tail appended by the first signer, then the next signer signs those bytes', async () => {
    for (const lifetimeKind of ['blockhash', 'nonce'] as const) {
      const { main, second, action, built } = await protect(lifetimeKind);
      // Phantom (the first signer) appends two assertions reading the stake account and a new account, then signs.
      const byPhantom = await sign(main, appendLighthouseTail(built.bytes, [STAKE, X], 2));
      expect(await verdict(built.bytes, byPhantom)).toBe('ok:2');
      const bySecond = await sign(second, byPhantom);
      expect(await verdict(byPhantom, bySecond)).toBe('ok:0');
      expect(await verifyAllSignatures(bySecond)).toStrictEqual({ ok: true });
      const inspected = await inspectTransaction(bySecond);
      expect(inspected.ok && inspected.summary).toMatchObject({
        action,
        presentSignatures: [main.address, second.address],
        lighthouseTail: { instructionCount: 2 },
      });
    }
  });

  it('accepts a Lighthouse tail from a wallet that recompiles the message and sorts the accounts its own way (D117)', async () => {
    for (const lifetimeKind of ['blockhash', 'nonce'] as const) {
      const { main, second, action, built } = await protect(lifetimeKind);
      const token = decodeMessage(built.bytes).lifetimeToken;
      const original = decodeMessage(built.bytes).staticAccounts;
      // Phantom on mainnet: the tail compiled into a new message, the accounts in the compiler's order.
      const recompiled = craft(
        [
          ...instructionsOf(built.bytes),
          lighthouseInstruction([
            { address: STAKE, role: AccountRole.READONLY },
            { address: X, role: AccountRole.READONLY },
          ]),
        ],
        main.address,
        token,
      );
      expect(decodeMessage(recompiled).staticAccounts.slice(0, original.length)).not.toStrictEqual(original);
      // The same tail with every non-signer group in reverse order: any order of the same accounts and roles.
      const reversed = editMessage(appendLighthouseTail(built.bytes, [STAKE, X]), (message) => {
        const signers = message.header.numSignerAccounts;
        const readonly = message.staticAccounts.length - message.header.numReadonlyNonSignerAccounts;
        const accounts = [
          ...message.staticAccounts.slice(0, signers),
          ...message.staticAccounts.slice(signers, readonly).reverse(),
          ...message.staticAccounts.slice(readonly).reverse(),
        ];
        return relist(message, accounts);
      });
      for (const tailed of [recompiled, reversed]) {
        const byPhantom = await sign(main, tailed);
        expect(await verdict(built.bytes, byPhantom)).toBe('ok:1');
        const bySecond = await sign(second, byPhantom);
        expect(await verdict(byPhantom, bySecond)).toBe('ok:0');
        expect(await verifyAllSignatures(bySecond)).toStrictEqual({ ok: true });
        const inspected = await inspectTransaction(bySecond);
        expect(inspected.ok && inspected.summary).toMatchObject({
          action,
          presentSignatures: [main.address, second.address],
          lighthouseTail: { instructionCount: 1 },
        });
      }
    }
  });

  it('rejects a re-sorted tail that changes the role of an original account or moves the fee payer (D117)', async () => {
    const { main, built } = await protect();
    const tailed = appendLighthouseTail(built.bytes, [X]);
    const swap = (from: Address, to: Address) =>
      editMessage(tailed, (message) => {
        const accounts = [...message.staticAccounts];
        const [i, j] = [accounts.indexOf(from), accounts.indexOf(to)];
        [accounts[i], accounts[j]] = [to, from];
        return relist(message, accounts);
      });
    const last = (message: Uint8Array) => decodeMessage(message).staticAccounts.at(-1) ?? X;
    // The stake account (writable) swapped with a read-only account: it loses write access, the other one gains it.
    expect(await verdict(built.bytes, swap(STAKE, last(tailed)))).not.toMatch(/^ok/);
    // The fee payer moved out of the first slot.
    const second = decodeMessage(tailed).staticAccounts[1] ?? X;
    expect(await verdict(built.bytes, swap(main.address, second))).not.toMatch(/^ok/);
    // Accounts re-sorted without any tail: not a change a wallet may make.
    const noTail = editMessage(built.bytes, (message) => {
      const accounts = [...message.staticAccounts];
      const [a, b] = [accounts.length - 1, accounts.length - 2];
      [accounts[a], accounts[b]] = [accounts[b] ?? X, accounts[a] ?? X];
      return relist(message, accounts);
    });
    expect(await verdict(built.bytes, noTail)).toBe('message-changed');
  });

  it('rejects a Lighthouse tail from a wallet that was not the first to sign', async () => {
    const { main, second, built } = await protect();
    const byMain = await sign(main, built.bytes);
    const tailed = await sign(second, appendLighthouseTail(byMain));
    expect(await verdict(byMain, tailed)).toBe('tail-not-first-signer');
  });

  it('rejects a tail that adds a signer or makes an account a signer or writable', async () => {
    const { main, second, built } = await protect();
    const withTail = (accounts: Parameters<typeof lighthouseInstruction>[0]) =>
      craft([...instructionsOf(built.bytes), lighthouseInstruction(accounts)], main.address, lifetimeToken(BLOCKHASH));
    expect(await verdict(built.bytes, withTail([{ address: X, role: AccountRole.READONLY_SIGNER }]))).toBe('tail-adds-signer');
    expect(await verdict(built.bytes, withTail([{ address: X, role: AccountRole.WRITABLE }]))).toBe('tail-adds-signer');
    // The second key, a read-only signer, made writable.
    expect(await verdict(built.bytes, withTail([{ address: second.address, role: AccountRole.WRITABLE_SIGNER }]))).toBe(
      'tail-adds-signer',
    );
    // Phantom-style append with the header bumped as if the new account were writable or a signer.
    const writable = editMessage(appendLighthouseTail(built.bytes, [X]), (message) => ({
      ...message,
      header: { ...message.header, numReadonlyNonSignerAccounts: message.header.numReadonlyNonSignerAccounts - 1 },
    }));
    expect(await verdict(built.bytes, writable)).toBe('tail-adds-signer');
    // Signed by the wallet: still rejected, signing does not matter here.
    expect(await verdict(built.bytes, await sign(main, withTail([{ address: X, role: AccountRole.READONLY_SIGNER }])))).toBe(
      'tail-adds-signer',
    );
  });

  it('rejects any other change', async () => {
    const { main, second, action, built } = await protect();
    const changed = async (bytes: Uint8Array) => verdict(built.bytes, bytes);
    const body = instructionsOf(built.bytes);
    const token = lifetimeToken(BLOCKHASH);
    // Another blockhash; another fee payer; another lockup end or second key (same length, other bytes).
    expect(await changed(build(action, { ...BLOCKHASH, blockhash: blockhash(key(22)) }).bytes)).toBe('message-changed');
    expect(await changed(build(action, BLOCKHASH, second.address).bytes)).toBe('message-changed');
    expect(await changed(build({ ...action, lockUntil: T + 1n }, BLOCKHASH).bytes)).toBe('message-changed');
    expect(await changed(build({ ...action, secondKey: X }, BLOCKHASH).bytes)).toBe('message-changed');
    // Lighthouse inserted before the last original instruction.
    const inserted = craft([...body.slice(0, -1), lighthouseInstruction(), ...body.slice(-1)], main.address, token);
    expect(await changed(inserted)).toBe('message-changed');
    // An appended instruction that is not Lighthouse (a transfer from the fee payer).
    const transfer = getTransferSolInstruction({ source: createNoopSigner(main.address), destination: X, amount: 1n });
    expect(await changed(craft([...body, transfer], main.address, token))).toBe('message-changed');
    // An instruction removed.
    expect(await changed(craft(body.slice(1), main.address, token))).toBe('message-changed');
    // The legacy message turned into v0.
    expect(await changed(craftV0(body, main.address, token))).toBe('message-changed');
    // Same instructions, accounts in another order.
    const reordered = editMessage(built.bytes, (message) => {
      const accounts = [...message.staticAccounts];
      const [a, b] = [accounts.length - 1, accounts.length - 2];
      [accounts[a], accounts[b]] = [accounts[b] ?? X, accounts[a] ?? X];
      return relist(message, accounts);
    });
    expect(await changed(reordered)).toBe('message-changed');
    // A tail account nobody uses.
    const unused = editMessage(appendLighthouseTail(built.bytes), (message) =>
      relist(message, [...message.staticAccounts, X], {
        ...message.header,
        numReadonlyNonSignerAccounts: message.header.numReadonlyNonSignerAccounts + 1,
      }),
    );
    expect(await changed(unused)).toBe('message-changed');
    // A signer dropped from the header.
    const fewerSigners = editMessage(built.bytes, (message) => ({
      ...message,
      header: {
        ...message.header,
        numSignerAccounts: message.header.numSignerAccounts - 1,
        numReadonlySignerAccounts: message.header.numReadonlySignerAccounts - 1,
      },
    }));
    expect(await changed(fewerSigners)).toBe('message-changed');
  });

  it('rejects bytes that are not a transaction, or list an account twice', async () => {
    const { main, built } = await protect();
    const byMain = await sign(main, built.bytes);
    expect(await verdict(built.bytes, new Uint8Array())).toBe('malformed');
    expect(await verdict(built.bytes, byMain.slice(0, 100))).toBe('malformed');
    expect(await verdict(built.bytes, Uint8Array.from([...byMain, 0]))).toBe('malformed');
    const duplicate = editMessage(built.bytes, (message) => ({
      ...message,
      staticAccounts: message.staticAccounts.map((address, i) => (i === message.staticAccounts.length - 1 ? main.address : address)),
    }));
    expect(await verdict(built.bytes, duplicate)).toBe('malformed');
    // A broken original is reported too, not compared.
    expect(await checkSigningStep(new Uint8Array([1, 2, 3]), byMain)).toMatchObject({
      ok: false,
      error: { code: 'malformed' },
    });
  });
});

describe('verifyAllSignatures', () => {
  it('accepts a fully signed transaction', async () => {
    const { main, second, built } = await protect();
    expect(await verifyAllSignatures(await sign(second, await sign(main, built.bytes)))).toStrictEqual({ ok: true });
  });

  it('names missing signatures', async () => {
    const { main, second, built } = await protect();
    expect(await verifyAllSignatures(built.bytes)).toMatchObject({
      ok: false,
      error: { code: 'missing-signatures', signers: [main.address, second.address] },
    });
    expect(await verifyAllSignatures(await sign(main, built.bytes))).toMatchObject({
      ok: false,
      error: { code: 'missing-signatures', signers: [second.address] },
    });
  });

  it('names invalid signatures, before missing ones', async () => {
    const { main, second, built } = await protect();
    const both = await sign(second, await sign(main, built.bytes));
    const corrupted = signatureOf(both, main.address);
    corrupted[63] = (corrupted[63] ?? 0) ^ 0x80;
    expect(await verifyAllSignatures(replaceSignature(both, main.address, corrupted))).toMatchObject({
      ok: false,
      error: { code: 'invalid-signatures', signers: [main.address] },
    });
    // A valid signature in the wrong slot, and the other slot empty.
    const swapped = replaceSignature(replaceSignature(both, second.address, signatureOf(both, main.address)), main.address, null);
    expect(await verifyAllSignatures(swapped)).toMatchObject({
      ok: false,
      error: { code: 'invalid-signatures', signers: [second.address] },
    });
    // Signatures over the message before a tail was appended do not cover the new message.
    const tailed = appendLighthouseTail(both);
    const stale = replaceSignature(replaceSignature(tailed, main.address, signatureOf(both, main.address)), second.address, signatureOf(both, second.address));
    expect(await verifyAllSignatures(stale)).toMatchObject({
      ok: false,
      error: { code: 'invalid-signatures', signers: [main.address, second.address] },
    });
  });

  it('rejects bytes that are not a transaction', async () => {
    const { built } = await protect();
    expect(await verifyAllSignatures(Uint8Array.from([...built.bytes, 1]))).toMatchObject({
      ok: false,
      error: { code: 'malformed', signers: [] },
    });
    expect(await verifyAllSignatures(new Uint8Array(10))).toMatchObject({ ok: false, error: { code: 'malformed' } });
  });

  it('treats a signer that is not an Ed25519 public key as unable to sign', async () => {
    // A program-derived-style address cannot sign: whatever sits in its slot is invalid.
    const offCurve: Address = key(9);
    const action: TransactionAction = { kind: 'deactivate', stakeAccount: STAKE, staker: offCurve };
    const built = build(action, BLOCKHASH);
    const forged = replaceSignature(built.bytes, offCurve, new Uint8Array(64).fill(7));
    expect(await verifyAllSignatures(forged)).toMatchObject({
      ok: false,
      error: { code: 'invalid-signatures', signers: [offCurve] },
    });
  });
});
