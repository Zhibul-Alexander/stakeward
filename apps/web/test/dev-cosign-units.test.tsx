// @vitest-environment node
import {
  appendTransactionMessageInstruction,
  compileTransaction,
  decompileTransactionMessage,
  generateKeyPairSigner,
  getCompiledTransactionMessageDecoder,
  getCompiledTransactionMessageEncoder,
  getTransactionDecoder,
  getTransactionEncoder,
  type Address,
  type Blockhash,
  type Signature,
  type TransactionMessageBytes,
} from '@solana/kit';
import { buildTransaction, LIGHTHOUSE_PROGRAM_ADDRESS, type LegacyMessage } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { describeMessageChange } from '@/pages/dev-cosign/diff';
import { DEV_SLOTS_STORAGE_KEY } from '@/pages/dev-cosign/ports';
import { createReportStore, formatReport, REPORTS_STORAGE_KEY, type RunReport } from '@/pages/dev-cosign/report';
import type { StorageLike } from '@/ports';

// The pieces of /dev/cosign that do not need a browser: the message diff, the report text and the report list kept in
// localStorage.

const BLOCKHASH = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N' as Blockhash;
const OTHER_BLOCKHASH = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin' as Blockhash;

/** Builders make legacy messages only (D17). */
type Message = LegacyMessage;

async function protectBytes(): Promise<Uint8Array> {
  const [main, second, stake] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner(), generateKeyPairSigner()]);
  return buildTransaction(
    { kind: 'protect', stakeAccount: stake.address, mainKey: main.address, secondKey: second.address, lockUntil: 1_800_000_000n },
    { feePayer: main.address, lifetime: { kind: 'blockhash', blockhash: BLOCKHASH, lastValidBlockHeight: 100n } },
  ).bytes;
}

/** Re-encodes the transaction with an edited compiled message and empty signature slots for its signers. */
function editMessage(bytes: Uint8Array, edit: (message: Message) => Message): Uint8Array {
  const transaction = getTransactionDecoder().decode(bytes);
  const message = edit(getCompiledTransactionMessageDecoder().decode(transaction.messageBytes) as Message);
  const signers = message.staticAccounts.slice(0, message.header.numSignerAccounts);
  return new Uint8Array(
    getTransactionEncoder().encode({
      messageBytes: getCompiledTransactionMessageEncoder().encode(message) as TransactionMessageBytes,
      signatures: Object.fromEntries(signers.map((signer) => [signer, null])),
    }),
  );
}

describe('describeMessageChange', () => {
  it('reports byte-identical messages as unchanged', async () => {
    const bytes = await protectBytes();
    expect(describeMessageChange(bytes, Uint8Array.from(bytes))).toEqual({ kind: 'none' });
  });

  it('reports a new blockhash as a lifetime change', async () => {
    const bytes = await protectBytes();
    const changed = describeMessageChange(bytes, editMessage(bytes, (m) => ({ ...m, lifetimeToken: OTHER_BLOCKHASH })));
    expect(changed).toEqual({ kind: 'other', parts: [{ code: 'lifetime', text: 'Blockhash or nonce: EkS...N1N -> 9xQ...Fin' }] });
  });

  it('reports an extra account as a header and account change, naming the account', async () => {
    const bytes = await protectBytes();
    const extra = (await generateKeyPairSigner()).address;
    const changed = describeMessageChange(
      bytes,
      editMessage(bytes, (m) => ({
        ...m,
        staticAccounts: [...m.staticAccounts, extra],
        header: { ...m.header, numReadonlyNonSignerAccounts: m.header.numReadonlyNonSignerAccounts + 1 },
      })),
    );
    expect(changed.kind).toBe('other');
    if (changed.kind !== 'other') return;
    expect(changed.parts.map((part) => part.code)).toEqual(['header', 'accounts']);
    expect(changed.parts[0]?.text).toBe('Header: signers 2, read-only signers 1, read-only other accounts 2 -> 3');
    expect(changed.parts[1]?.text).toBe(`Accounts: 5 -> 6; added ${extra}`);
  });

  it('reports a Lighthouse tail appended in the accepted layout with its instruction count and accounts', async () => {
    const bytes = await protectBytes();
    const withTail = editMessage(bytes, (m) => ({
      ...m,
      staticAccounts: [...m.staticAccounts, LIGHTHOUSE_PROGRAM_ADDRESS],
      header: { ...m.header, numReadonlyNonSignerAccounts: m.header.numReadonlyNonSignerAccounts + 1 },
      instructions: [
        ...m.instructions,
        { programAddressIndex: m.staticAccounts.length, data: Uint8Array.of(1) },
        { programAddressIndex: m.staticAccounts.length, data: Uint8Array.of(2) },
      ],
    }));
    expect(describeMessageChange(bytes, withTail)).toEqual({
      kind: 'lighthouse-tail',
      instructions: 2,
      addedAccounts: [LIGHTHOUSE_PROGRAM_ADDRESS],
    });
  });

  it('reports a Lighthouse tail from a wallet that recompiles (and reorders) the message as a tail-layout change', async () => {
    const bytes = await protectBytes();
    const compiled = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(bytes).messageBytes);
    const recompiled = compileTransaction(
      appendTransactionMessageInstruction(
        { programAddress: LIGHTHOUSE_PROGRAM_ADDRESS, data: Uint8Array.of(1) },
        decompileTransactionMessage(compiled),
      ),
    );
    const changed = describeMessageChange(bytes, new Uint8Array(getTransactionEncoder().encode(recompiled)));
    expect(changed.kind).toBe('other');
    if (changed.kind !== 'other') return;
    expect(changed.parts.map((part) => part.code)).toContain('tail-layout');
    expect(changed.parts.find((part) => part.code === 'instructions')?.text).toMatch(/^Instructions: 3 -> 4; .*added at the end: L2T\.\.\.S95$/);
  });

  it('reports bytes that are not a transaction', async () => {
    const bytes = await protectBytes();
    const changed = describeMessageChange(bytes, Uint8Array.of(1, 2, 3));
    expect(changed.kind === 'other' && changed.parts[0]?.code).toBe('not-a-transaction');
  });
});

describe('formatReport', () => {
  const base: RunReport = {
    date: new Date('2026-10-02T09:30:15.250Z'),
    cluster: 'devnet',
    stakeAccount: 'EAVGCaM2DHtM8CCeXhkVkWnEkyFpLgaWYuHLvzQwq9qu' as Address,
    order: 'second-first',
    lifetime: 'nonce',
    signers: [
      {
        role: 'second',
        walletName: 'Solflare',
        walletVersion: '1.0.0',
        accountsOffered: 2,
        address: 'D7sQxhVSAMkQNB5U1QPewGGNz9YkAr3J7cGYkg7fwBfV' as Address,
        outcome: { kind: 'wallet-error', code: 'unknown', message: 'Something went wrong.', detail: 'Error: one\nCaused by: two' },
      },
      {
        role: 'main',
        walletName: 'Phantom',
        walletVersion: '1.0.0',
        accountsOffered: 1,
        address: '5E5gJz5eWm3rEvMg9VSqNLc3BRm2JWUHQzbvX4eZzodY' as Address,
        outcome: { kind: 'not-reached' },
      },
    ],
    verify: null,
    send: null,
    lockupAfter: null,
  };

  it('writes the roles in slot order, the signers in signing order and indents multi-line details', () => {
    expect(formatReport(base).split('\n')).toEqual([
      'Stakeward wallet co-signing report',
      'Date: 2026-10-02T09:30:15Z',
      'Cluster: devnet',
      'Main key: Phantom (Wallet Standard 1.0.0, accounts offered: 1), 5E5...odY',
      'Second key: Solflare (Wallet Standard 1.0.0, accounts offered: 2), D7s...BfV',
      'Stake account: EAV...9qu',
      'Order: second key first',
      'Lifetime: durable nonce',
      'Signer 1 (Second key, Solflare): not signed: unknown: Something went wrong.',
      '  Error: one',
      '  Caused by: two',
      'Signer 2 (Main key, Phantom): not asked',
      'verifyAllSignatures: not run',
      'Send: not sent',
      'Wallet warnings shown:',
      'Ledger showed fields (yes/no):',
      'Notes:',
    ]);
  });

  it('reports a send that was not confirmed in time and a lock that is not the expected one', () => {
    const signature = '5VERYLONGSIGNATURE1111111111111111111111111111111111111111111111111111111111111111111' as Signature;
    const text = formatReport({
      ...base,
      verify: { ok: true },
      send: { kind: 'unconfirmed', signature, reason: 'timeout' },
      lockupAfter: { secondKey: base.signers[0]?.address ?? ('' as Address), unixTimestamp: 1_790_813_400n, asExpected: false },
    });
    expect(text).toContain('verifyAllSignatures: ok');
    expect(text).toContain(
      `Send: sent, no confirmation within the wait, signature ${signature}, https://explorer.solana.com/tx/${signature}?cluster=devnet`,
    );
    expect(text).toContain('Lock after: second key D7s...BfV, until 2026-10-01T00:10:00Z (NOT as expected)');
  });
});

describe('report list', () => {
  function memoryStorage(): StorageLike & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
      },
      removeItem: (key) => {
        data.delete(key);
      },
    };
  }

  it('keeps reports across page loads, oldest first, and clears them', () => {
    const storage = memoryStorage();
    const first = createReportStore(storage);
    first.add('one');
    first.add('two');
    expect(createReportStore(storage).getSnapshot()).toEqual(['one', 'two']);
    first.clear();
    expect(storage.data.has(REPORTS_STORAGE_KEY)).toBe(false);
    expect(createReportStore(storage).getSnapshot()).toEqual([]);
  });

  it('works in memory when storage is blocked or holds garbage, and keeps at most 50', () => {
    const blocked: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    const store = createReportStore(blocked);
    for (let i = 0; i < 55; i += 1) store.add(`report ${String(i)}`);
    expect(store.getSnapshot()).toHaveLength(50);
    expect(store.getSnapshot()[0]).toBe('report 5');

    const garbage = memoryStorage();
    garbage.setItem(REPORTS_STORAGE_KEY, '{"not":"a list"');
    expect(createReportStore(garbage).getSnapshot()).toEqual([]);
    garbage.setItem(REPORTS_STORAGE_KEY, JSON.stringify(['ok', 3, null]));
    expect(createReportStore(garbage).getSnapshot()).toEqual(['ok']);
  });

  it('uses its own storage keys, apart from the product slots', () => {
    expect(DEV_SLOTS_STORAGE_KEY).not.toBe('stakeward:wallet-slots:v1');
    expect([DEV_SLOTS_STORAGE_KEY, REPORTS_STORAGE_KEY].every((key) => key.startsWith('stakeward:dev-cosign:'))).toBe(true);
  });
});
