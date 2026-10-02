import { getAddressDecoder, getBase58Decoder, type Address, type Nonce } from '@solana/kit';
import { NONCE_ACCOUNT_SIZE, SYSTEM_PROGRAM_ADDRESS, type RawAccount } from '@stakeward/core';

/**
 * The durable nonce account of the main key, as the dev page needs it (created by core's `nonce-setup`).
 *
 * Layout (System program `nonce::state::Versions`, bincode, 80 bytes): u32 version (1 = current), u32 state
 * (1 = initialized), authority (32), durable nonce value (32, base58 like a blockhash), u64 lamports per signature.
 * Core has no nonce decoder yet; the product's rescue flow (step 8) needs one there.
 */
export type NonceAccountState =
  | { kind: 'missing' }
  | { kind: 'ready'; authority: Address; value: Nonce; lamports: bigint }
  /** Exists but cannot serve as this key's nonce (wrong owner, size, state or authority). */
  | { kind: 'unusable'; reason: 'owner' | 'size' | 'state' | 'authority'; lamports: bigint };

const CURRENT_VERSION = 1;
const INITIALIZED = 1;
const AUTHORITY_OFFSET = 8;
const VALUE_OFFSET = 40;

export function readNonceAccount(raw: RawAccount | null, expectedAuthority: Address): NonceAccountState {
  if (raw === null) return { kind: 'missing' };
  const { lamports } = raw;
  if (raw.owner !== SYSTEM_PROGRAM_ADDRESS) return { kind: 'unusable', reason: 'owner', lamports };
  if (raw.data.length !== NONCE_ACCOUNT_SIZE) return { kind: 'unusable', reason: 'size', lamports };
  const data = Uint8Array.from(raw.data);
  const view = new DataView(data.buffer);
  if (view.getUint32(0, true) !== CURRENT_VERSION || view.getUint32(4, true) !== INITIALIZED) {
    return { kind: 'unusable', reason: 'state', lamports };
  }
  const authority = getAddressDecoder().decode(data.subarray(AUTHORITY_OFFSET, AUTHORITY_OFFSET + 32));
  if (authority !== expectedAuthority) return { kind: 'unusable', reason: 'authority', lamports };
  const value = getBase58Decoder().decode(data.subarray(VALUE_OFFSET, VALUE_OFFSET + 32)) as Nonce;
  return { kind: 'ready', authority, value, lamports };
}
