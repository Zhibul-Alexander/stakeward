import { generateKeyPairSigner, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { createSecondKeyMemory, createSlotStore } from '@/ports';
import { settle, type HandOver } from './memory.ts';

const [S, A, K, K2, X] = await Promise.all([1, 2, 3, 4, 5].map(() => generateKeyPairSigner())).then(
  (keys) => keys.map((key) => key.address) as [Address, Address, Address, Address, Address],
);
const RUN: HandOver = { account: S, mainKey: A, secondKey: K, newSecondKey: K2 };

/** A device that knows K, with K in the Second key slot and K2 in the New wallet slot (as after a run). */
function device(second: Address | null = K) {
  const ports = { secondKeys: createSecondKeyMemory(null), slots: createSlotStore(null) };
  ports.secondKeys.remember(K);
  if (second !== null) ports.slots.assign('second', { walletId: 'wallet-second', address: second });
  ports.slots.assign('new', { walletId: 'wallet-new', address: K2 });
  return ports;
}

describe('settle (F7 device memory)', () => {
  it('the old key holds no other lock: forgotten, and the new key moves to the Second key slot', () => {
    const ports = device();
    settle(ports, RUN, []);
    expect(ports.secondKeys.getSnapshot()).toEqual([K2]);
    expect(ports.slots.getSnapshot().second).toEqual({ walletId: 'wallet-new', address: K2 });
    expect(ports.slots.getSnapshot().new).toBeNull();
  });

  it('the old key still holds other locks, or that could not be read: both keys stay known, the slots as they are', () => {
    for (const held of [[X], null]) {
      const ports = device();
      settle(ports, RUN, held);
      expect([...ports.secondKeys.getSnapshot()].sort(), String(held)).toEqual([K, K2].sort());
      expect(ports.slots.getSnapshot().second?.address).toBe(K);
      expect(ports.slots.getSnapshot().new?.address).toBe(K2);
    }
  });

  it('a Second key slot holding some other key keeps it, and the new key stays in its slot (not dropped)', () => {
    const ports = device(X);
    settle(ports, RUN, []);
    expect(ports.secondKeys.getSnapshot()).toEqual([K2]);
    expect(ports.slots.getSnapshot().second?.address).toBe(X);
    expect(ports.slots.getSnapshot().new?.address).toBe(K2);
  });

  it('an empty Second key slot takes the new key', () => {
    const ports = device(null);
    settle(ports, RUN, []);
    expect(ports.slots.getSnapshot().second?.address).toBe(K2);
    expect(ports.slots.getSnapshot().new).toBeNull();
  });
});
