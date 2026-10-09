import type { Address } from '@solana/kit';
import type { WalletRole } from '@stakeward/core';
import { resolveSlot, WALLET_ROLES, type Ports } from '@/ports';
import type { SignerResolver } from './types.ts';

/**
 * Finds the wallet that signs for `address` from the key slots (CLAUDE.md section 6: main, second, new). Reads the
 * slots and the wallets AT CALL TIME, so a key connected after the round was built is found. The role is the slot
 * holding the address; with no such slot, `hint` (the role the action names) or else Main key.
 */
export function slotSignerResolver(ports: Pick<Ports, 'slots' | 'wallets'>): SignerResolver {
  return (address: Address, hint: WalletRole | null) => {
    const slots = ports.slots.getSnapshot();
    const role = WALLET_ROLES.find((candidate) => slots[candidate]?.address === address);
    if (role === undefined) return { kind: 'missing', role: hint ?? 'main' };
    const resolved = resolveSlot(slots[role], ports.wallets.getSnapshot());
    const wallet = resolved?.wallet ?? null;
    return wallet === null ? { kind: 'missing', role } : { kind: 'ready', role, wallet };
  };
}
