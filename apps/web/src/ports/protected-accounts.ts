import { isAddress, type Address } from '@solana/kit';
import { browserStorage, type StorageLike } from './slots.ts';

/**
 * Stake accounts this device has seen protected by one of the viewer's second keys (F6, CLAUDE.md section 7): the
 * accounts page shows a red banner while one of them stands without a lock. Written by the protect flow after a
 * successful protect, and by the accounts page when it reads a lock held by a known second key on the stake of the
 * main key connected here (never on a view by address: test/app-f6-memory.review.test.tsx).
 *
 * Kept in localStorage as a per-viewer convenience, like the slots (wrapped in try/catch; without storage it lives in
 * memory for this page). Public stake account addresses only.
 */
export interface ProtectedAccountMemory {
  getSnapshot: () => readonly Address[];
  subscribe: (listener: () => void) => () => void;
  /** Adds the accounts not remembered yet; no change (and no notification) when all are known. */
  remember: (accounts: readonly Address[]) => void;
  forget: (account: Address) => void;
}

export const PROTECTED_ACCOUNTS_STORAGE_KEY = 'stakeward:protected-accounts:v1';
/** A convenience, not a ledger: keep the most recent ones. */
export const MAX_REMEMBERED_PROTECTED_ACCOUNTS = 200;

export function createProtectedAccountMemory(
  storage: StorageLike | null = browserStorage(),
  key = PROTECTED_ACCOUNTS_STORAGE_KEY,
): ProtectedAccountMemory {
  let remembered = readAddresses(storage, key);
  const listeners = new Set<() => void>();
  const update = (next: readonly Address[]) => {
    remembered = next;
    try {
      storage?.setItem(key, JSON.stringify(remembered));
    } catch {
      // Full, blocked or private: the list lives in memory for this page.
    }
    for (const listener of [...listeners]) listener();
  };
  return {
    getSnapshot: () => remembered,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    remember(accounts) {
      const added = [...new Set(accounts)].filter((account) => !remembered.includes(account));
      if (added.length === 0) return;
      update([...added, ...remembered].slice(0, MAX_REMEMBERED_PROTECTED_ACCOUNTS));
    },
    forget(account) {
      if (remembered.includes(account)) update(remembered.filter((other) => other !== account));
    },
  };
}

function readAddresses(storage: StorageLike | null, key: string): readonly Address[] {
  let value: unknown;
  try {
    const text = storage?.getItem(key) ?? null;
    value = text === null ? null : (JSON.parse(text) as unknown);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const out: Address[] = [];
  for (const item of value) {
    if (typeof item === 'string' && isAddress(item) && !out.includes(item)) out.push(item);
  }
  return out.slice(0, MAX_REMEMBERED_PROTECTED_ACCOUNTS);
}
