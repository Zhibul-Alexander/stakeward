import { address, getAddressDecoder, type Address } from '@solana/kit';
import type { WalletPort } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import {
  createSecondKeyMemory,
  createSlotStore,
  knownSecondKeys,
  resolveSlot,
  SECOND_KEYS_STORAGE_KEY,
  SLOTS_STORAGE_KEY,
  type StorageLike,
} from './slots.ts';

const A = address('7xKTg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgA9fQ');
const K = address('57RQ3ocAibVdC3n3S9i4gT39EpF4DhRCbqAivyg6wtQ6');
const D = address('63rAwzgKQ7P5CSHVtQi6Gasu3wVKhChmzxA2H2A5ssRD');

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}

const brokenStorage: StorageLike = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

function wallet(id: string, accounts: readonly Address[]): WalletPort {
  return {
    id,
    name: id,
    icon: 'data:image/svg+xml;base64,',
    accounts,
    connect: () => Promise.resolve(accounts),
    disconnect: () => Promise.resolve(),
    signTransactions: () => Promise.resolve([]),
    onChange: () => () => undefined,
  };
}

describe('slot store', () => {
  it('fills, refuses one address in two roles, clears, and notifies', () => {
    const store = createSlotStore(memoryStorage());
    let changes = 0;
    store.subscribe(() => (changes += 1));
    expect(store.getSnapshot()).toEqual({ main: null, second: null, new: null });

    expect(store.assign('main', { walletId: 'Phantom', address: A })).toEqual({ ok: true });
    // Different accounts of one wallet are fine.
    expect(store.assign('second', { walletId: 'Phantom', address: K })).toEqual({ ok: true });
    expect(store.assign('new', { walletId: 'Solflare', address: A })).toEqual({
      ok: false,
      reason: 'address-in-other-role',
      role: 'main',
    });
    const snapshot = store.getSnapshot();
    expect(snapshot).toEqual({ main: { walletId: 'Phantom', address: A }, second: { walletId: 'Phantom', address: K }, new: null });
    expect(store.getSnapshot()).toBe(snapshot);
    expect(changes).toBe(2);

    // The same slot again changes nothing.
    store.assign('main', { walletId: 'Phantom', address: A });
    expect(changes).toBe(2);
    store.clear('main');
    store.clear('main');
    expect(store.getSnapshot().main).toBeNull();
    expect(changes).toBe(3);
  });

  it('remembers slots across page loads and ignores stored junk', () => {
    const storage = memoryStorage();
    createSlotStore(storage).assign('second', { walletId: 'Backpack', address: K });
    expect(createSlotStore(storage).getSnapshot().second).toEqual({ walletId: 'Backpack', address: K });

    const junk = memoryStorage({
      [SLOTS_STORAGE_KEY]: JSON.stringify({
        main: { walletId: 'X', address: 'not-an-address' },
        second: { walletId: '', address: K },
        new: { walletId: 'Y', address: D },
      }),
    });
    expect(createSlotStore(junk).getSnapshot()).toEqual({ main: null, second: null, new: { walletId: 'Y', address: D } });
    expect(createSlotStore(memoryStorage({ [SLOTS_STORAGE_KEY]: '{' })).getSnapshot().main).toBeNull();
    const duplicated = memoryStorage({
      [SLOTS_STORAGE_KEY]: JSON.stringify({ main: { walletId: 'X', address: A }, second: { walletId: 'Y', address: A } }),
    });
    expect(createSlotStore(duplicated).getSnapshot()).toMatchObject({ main: { address: A }, second: null });
  });

  it('works without storage (blocked, full, private mode)', () => {
    for (const storage of [null, brokenStorage]) {
      const store = createSlotStore(storage);
      expect(store.assign('main', { walletId: 'Phantom', address: A })).toEqual({ ok: true });
      expect(store.getSnapshot().main?.address).toBe(A);
    }
  });
});

describe('resolveSlot', () => {
  it('finds the wallet and says whether it can sign for the address now', () => {
    const slot = { walletId: 'Phantom', address: K };
    expect(resolveSlot(null, [])).toBeNull();
    expect(resolveSlot(slot, [])).toEqual({ slot, wallet: null, ready: false });
    const phantom = wallet('Phantom', [A]);
    expect(resolveSlot(slot, [phantom])).toEqual({ slot, wallet: phantom, ready: false }); // switch accounts, then Continue
    const switched = wallet('Phantom', [K]);
    expect(resolveSlot(slot, [switched])).toEqual({ slot, wallet: switched, ready: true });
  });
});

describe('known second keys (DECISIONS.md D14)', () => {
  it('is the connected second slot plus keys remembered on this device', () => {
    const memory = createSecondKeyMemory(memoryStorage());
    const slots = { main: { walletId: 'Phantom', address: A }, second: { walletId: 'Solflare', address: K }, new: null };
    expect(knownSecondKeys(slots, [], memory.getSnapshot())).toEqual([]); // second wallet not connected
    expect(knownSecondKeys(slots, [wallet('Solflare', [K])], [])).toEqual([K]);

    memory.remember(D);
    memory.remember(K);
    expect(memory.getSnapshot()).toEqual([K, D]);
    expect(knownSecondKeys(slots, [wallet('Solflare', [K])], memory.getSnapshot())).toEqual([K, D]);
    memory.forget(K);
    expect(knownSecondKeys(slots, [], memory.getSnapshot())).toEqual([D]);
  });

  it('remembers across page loads, keeps the 20 most recent, survives broken storage', () => {
    const storage = memoryStorage();
    const memory = createSecondKeyMemory(storage);
    let changes = 0;
    memory.subscribe(() => (changes += 1));
    memory.remember(K);
    memory.remember(K);
    expect(changes).toBe(1);
    expect(createSecondKeyMemory(storage).getSnapshot()).toEqual([K]);
    expect(JSON.parse(storage.data.get(SECOND_KEYS_STORAGE_KEY) ?? '[]')).toEqual([K]);

    const junk = memoryStorage({ [SECOND_KEYS_STORAGE_KEY]: JSON.stringify([K, 'nope', 5, K, D]) });
    expect(createSecondKeyMemory(junk).getSnapshot()).toEqual([K, D]);

    const many = createSecondKeyMemory(null);
    const addresses = Array.from({ length: 25 }, (_, i) => getAddressDecoder().decode(new Uint8Array(32).fill(i + 1)));
    for (const item of addresses) many.remember(item);
    expect(many.getSnapshot()).toHaveLength(20);
    expect(many.getSnapshot()[0]).toBe(addresses[24]);

    const broken = createSecondKeyMemory(brokenStorage);
    broken.remember(D);
    expect(broken.getSnapshot()).toEqual([D]);
  });
});
