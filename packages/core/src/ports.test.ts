import { address, blockhash, signature } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import type { ChainPort, WalletPort, WalletSlots } from './index.ts';

// The ports are pure types; this file pins their shape: a minimal fake of each must compile with `satisfies`.

const KEY = address('7xKTg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgA9fQ');
const SIGNATURE = signature('5'.repeat(88));

const chain = {
  getAccounts: (addresses) => Promise.resolve({ slot: 1n, accounts: addresses.map(() => null) }),
  getClock: () => Promise.resolve({ slot: 1n, epochStartTimestamp: 1_790_800_000n, epoch: 1000n, unixTimestamp: 1_790_812_800n }),
  getLatestBlockhash: () =>
    Promise.resolve({ blockhash: blockhash('EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N'), lastValidBlockHeight: 150n }),
  getBlockHeight: () => Promise.resolve(1n),
  getEpochInfo: () => Promise.resolve({ epoch: 1000n, slotIndex: 1n, slotsInEpoch: 432_000n, blockHeight: 1n }),
  getBalance: () => Promise.resolve(0n),
  getMinimumBalanceForRentExemption: (size) => Promise.resolve(BigInt(size) * 5_080n),
  simulate: () => Promise.resolve({ ok: true, logs: [], unitsConsumed: 450n }),
  send: () => Promise.resolve(SIGNATURE),
  getSignatureStatuses: (signatures) =>
    Promise.resolve(signatures.map(() => ({ slot: 1n, confirmationStatus: 'confirmed' as const, error: null }))),
  findStakeAccounts: () => Promise.resolve({ slot: 1n, accounts: [] }),
} satisfies ChainPort;

const accounts = [KEY] as const;
const wallet = {
  id: 'Test Wallet',
  name: 'Test Wallet',
  icon: 'data:image/svg+xml;base64,',
  accounts,
  connect: () => Promise.resolve(accounts),
  disconnect: () => Promise.resolve(),
  signTransactions: (_address, transactions) => Promise.resolve(transactions.map((tx) => new Uint8Array(tx))),
  onChange: () => () => undefined,
} satisfies WalletPort;

describe('ports', () => {
  it('fakes of ChainPort and WalletPort type-check and behave as documented', async () => {
    const slots: WalletSlots = { main: { walletId: wallet.id, address: KEY }, second: null, new: null };
    expect(slots.main?.address).toBe(KEY);
    expect((await chain.getAccounts([KEY])).accounts).toEqual([null]);
    expect(await wallet.signTransactions(KEY, [new Uint8Array([1, 2])])).toEqual([new Uint8Array([1, 2])]);
  });
});
