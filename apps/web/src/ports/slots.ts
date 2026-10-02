import { isAddress, type Address } from '@solana/kit';
import type { WalletPort, WalletRole, WalletSlot, WalletSlots } from '@stakeward/core';

/**
 * The three key slots of CLAUDE.md section 6: main, second, new. Each holds one wallet account as
 * { walletId, address }: different wallets, or different accounts of one wallet. Never the account object (it goes
 * stale when the user switches accounts) and never the same address in two roles.
 *
 * Slots and the remembered second keys are kept in localStorage as a per-viewer convenience (wrapped in try/catch;
 * the site works the same without it). Nothing secret is stored: wallet names and public addresses.
 */

export const WALLET_ROLES: readonly WalletRole[] = ['main', 'second', 'new'];

const EMPTY_SLOTS: WalletSlots = { main: null, second: null, new: null };

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** window.localStorage, or null where it is missing or blocked (private mode, blocked site data, sandboxed frame). */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export type AssignResult = { ok: true } | { ok: false; reason: 'address-in-other-role'; role: WalletRole };

/** An external store for React (useSyncExternalStore); its functions do not depend on `this`. */
export interface SlotStore {
  getSnapshot: () => WalletSlots;
  subscribe: (listener: () => void) => () => void;
  /** Fills `role`. Refused when the address already fills another role (clear that one first). */
  assign: (role: WalletRole, slot: WalletSlot) => AssignResult;
  clear: (role: WalletRole) => void;
}

export const SLOTS_STORAGE_KEY = 'stakeward:wallet-slots:v1';
export const SECOND_KEYS_STORAGE_KEY = 'stakeward:second-keys:v1';
/** The remembered list is a convenience, not a ledger: keep the most recent ones. */
const MAX_REMEMBERED_SECOND_KEYS = 20;

export function createSlotStore(storage: StorageLike | null = browserStorage(), key = SLOTS_STORAGE_KEY): SlotStore {
  let slots = readSlots(storage, key);
  const listeners = new Set<() => void>();
  const update = (next: WalletSlots) => {
    slots = next;
    write(storage, key, slots);
    for (const listener of [...listeners]) listener();
  };
  return {
    getSnapshot: () => slots,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    assign(role, slot) {
      const other = WALLET_ROLES.find((candidate) => candidate !== role && slots[candidate]?.address === slot.address);
      if (other !== undefined) return { ok: false, reason: 'address-in-other-role', role: other };
      const current = slots[role];
      if (current?.address === slot.address && current.walletId === slot.walletId) return { ok: true };
      update({ ...slots, [role]: { walletId: slot.walletId, address: slot.address } });
      return { ok: true };
    },
    clear(role) {
      if (slots[role] !== null) update({ ...slots, [role]: null });
    },
  };
}

/** Where a slot stands right now: its wallet (when registered) and whether that wallet offers the address. */
export type ResolvedSlot = {
  slot: WalletSlot;
  /** null: the wallet is not installed or not loaded in this browser. */
  wallet: WalletPort | null;
  /**
   * The wallet offers the address now, so it can sign. When false with a wallet: connect it, or switch to this
   * account in the wallet and press Continue (section 6).
   */
  ready: boolean;
};

export function resolveSlot(slot: WalletSlot | null, wallets: readonly WalletPort[]): ResolvedSlot | null {
  if (slot === null) return null;
  const wallet = wallets.find((candidate) => candidate.id === slot.walletId) ?? null;
  return { slot, wallet, ready: wallet !== null && wallet.accounts.includes(slot.address) };
}

/** Second keys remembered on this device after a successful protect (DECISIONS.md D14). */
export interface SecondKeyMemory {
  getSnapshot: () => readonly Address[];
  subscribe: (listener: () => void) => () => void;
  remember: (address: Address) => void;
  forget: (address: Address) => void;
}

export function createSecondKeyMemory(
  storage: StorageLike | null = browserStorage(),
  key = SECOND_KEYS_STORAGE_KEY,
): SecondKeyMemory {
  let remembered = readAddresses(storage, key);
  const listeners = new Set<() => void>();
  const update = (next: readonly Address[]) => {
    remembered = next;
    write(storage, key, remembered);
    for (const listener of [...listeners]) listener();
  };
  return {
    getSnapshot: () => remembered,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    remember(address) {
      if (remembered[0] === address) return;
      update([address, ...remembered.filter((other) => other !== address)].slice(0, MAX_REMEMBERED_SECOND_KEYS));
    },
    forget(address) {
      if (remembered.includes(address)) update(remembered.filter((other) => other !== address));
    },
  };
}

/**
 * The second keys the site knows for this viewer (DECISIONS.md D14): the address in the "second" slot while its wallet
 * is connected and offers it, plus the second keys remembered on this device. scannerStatus needs this list; when it
 * is empty, a lock held by another key is not called someone else's.
 */
export function knownSecondKeys(
  slots: WalletSlots,
  wallets: readonly WalletPort[],
  remembered: readonly Address[],
): readonly Address[] {
  const second = resolveSlot(slots.second, wallets);
  const keys = second?.ready === true ? [second.slot.address] : [];
  for (const address of remembered) if (!keys.includes(address)) keys.push(address);
  return keys;
}

function readSlots(storage: StorageLike | null, key: string): WalletSlots {
  const value = read(storage, key);
  if (typeof value !== 'object' || value === null) return EMPTY_SLOTS;
  const record = value as Record<string, unknown>;
  const slots: Record<WalletRole, WalletSlot | null> = { main: null, second: null, new: null };
  const used: string[] = [];
  for (const role of WALLET_ROLES) {
    const slot = record[role];
    if (typeof slot !== 'object' || slot === null) continue;
    const { walletId, address } = slot as Record<string, unknown>;
    if (typeof walletId !== 'string' || walletId === '' || typeof address !== 'string' || !isAddress(address)) continue;
    if (used.includes(address)) continue;
    used.push(address);
    slots[role] = { walletId, address };
  }
  return slots;
}

function readAddresses(storage: StorageLike | null, key: string): readonly Address[] {
  const value = read(storage, key);
  if (!Array.isArray(value)) return [];
  const out: Address[] = [];
  for (const item of value) {
    if (typeof item === 'string' && isAddress(item) && !out.includes(item)) out.push(item);
  }
  return out.slice(0, MAX_REMEMBERED_SECOND_KEYS);
}

function read(storage: StorageLike | null, key: string): unknown {
  try {
    const text = storage?.getItem(key) ?? null;
    return text === null ? null : (JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

function write(storage: StorageLike | null, key: string, value: unknown): void {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Full, blocked or private: the value lives in memory for this page.
  }
}
