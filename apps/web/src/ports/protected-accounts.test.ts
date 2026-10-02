import { address, getAddressDecoder, type Address } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';
import {
  createProtectedAccountMemory,
  MAX_REMEMBERED_PROTECTED_ACCOUNTS,
  PROTECTED_ACCOUNTS_STORAGE_KEY,
} from './protected-accounts.ts';
import type { StorageLike } from './slots.ts';

const S1 = address('AYA9kYsn7XVDTPARBfAuASypyyDGFJw1Xds2vHgW9DfW');
const S2 = address('2Xtq6iZ2mXjxTNsv5FrYCzayG5qYRJwZ6837A1X3TjF6');

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}

describe('protected account memory (F6)', () => {
  it('remembers accounts once, newest first, and keeps them across page loads', () => {
    const storage = memoryStorage();
    const memory = createProtectedAccountMemory(storage);
    const listener = vi.fn();
    memory.subscribe(listener);

    memory.remember([S1]);
    memory.remember([S2, S1, S2]);
    expect(memory.getSnapshot()).toEqual([S2, S1]);
    expect(listener).toHaveBeenCalledTimes(2);

    // Nothing new: same snapshot, no re-render.
    const snapshot = memory.getSnapshot();
    memory.remember([S1, S2]);
    expect(memory.getSnapshot()).toBe(snapshot);
    expect(listener).toHaveBeenCalledTimes(2);

    expect(createProtectedAccountMemory(storage).getSnapshot()).toEqual([S2, S1]);

    memory.forget(S2);
    expect(createProtectedAccountMemory(storage).getSnapshot()).toEqual([S1]);
  });

  it('ignores what is not a list of addresses in storage', () => {
    const corrupt = memoryStorage({ [PROTECTED_ACCOUNTS_STORAGE_KEY]: '{"not":"a list"' });
    expect(createProtectedAccountMemory(corrupt).getSnapshot()).toEqual([]);
    const mixed = memoryStorage({ [PROTECTED_ACCOUNTS_STORAGE_KEY]: JSON.stringify([S1, 'nope', 42, S1]) });
    expect(createProtectedAccountMemory(mixed).getSnapshot()).toEqual([S1]);
  });

  it('works in memory when storage is missing or throws', () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    for (const storage of [null, throwing]) {
      const memory = createProtectedAccountMemory(storage);
      memory.remember([S1]);
      expect(memory.getSnapshot()).toEqual([S1]);
    }
  });

  it('keeps only the most recent accounts', () => {
    const many: Address[] = [];
    for (let i = 0; i <= MAX_REMEMBERED_PROTECTED_ACCOUNTS; i += 1) many.push(getAddressDecoder().decode(new Uint8Array(32).fill(i)));
    const memory = createProtectedAccountMemory(null);
    for (const account of many) memory.remember([account]);
    expect(memory.getSnapshot()).toHaveLength(MAX_REMEMBERED_PROTECTED_ACCOUNTS);
    expect(memory.getSnapshot()[0]).toBe(many.at(-1));
    expect(memory.getSnapshot()).not.toContain(many[0]);
  });
});
