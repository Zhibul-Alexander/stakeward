import { getAddressDecoder, type Address } from '@solana/kit';
import { getNonceEncoder, NonceState, NonceVersion } from '@solana-program/system';
import { describe, expect, it } from 'vitest';
import { LIGHTHOUSE_PROGRAM_ADDRESS, NONCE_ACCOUNT_SIZE, SYSTEM_PROGRAM_ADDRESS } from './constants.ts';
import type { RawAccount } from './decode.ts';
import { readNonceAccount } from './nonce.ts';

// Nonce accounts crafted with the generated system client's encoder; test/nonce.svm.test.ts reads one the chain made.

const key = (n: number): Address => getAddressDecoder().decode(new Uint8Array(32).fill(n));
const OWNER = key(1);
const NONCE_ACCOUNT = key(2);
const VALUE = key(3);

function nonceAccount(
  fields: { version?: NonceVersion; state?: NonceState; authority?: Address } = {},
  raw: Partial<RawAccount> = {},
): RawAccount {
  const data = getNonceEncoder().encode({
    version: fields.version ?? NonceVersion.Current,
    state: fields.state ?? NonceState.Initialized,
    authority: fields.authority ?? OWNER,
    blockhash: VALUE,
    lamportsPerSignature: 5_000n,
  });
  return { address: NONCE_ACCOUNT, data, lamports: 1_056_640n, owner: SYSTEM_PROGRAM_ADDRESS, ...raw };
}

describe('readNonceAccount', () => {
  it('reads a ready nonce account: its authority, the stored value and the balance', () => {
    expect(readNonceAccount(nonceAccount(), OWNER)).toEqual({ kind: 'ready', authority: OWNER, value: VALUE, lamports: 1_056_640n });
  });

  it('reads an account whose data is a view into a larger buffer', () => {
    const { data } = nonceAccount();
    const buffer = new Uint8Array(NONCE_ACCOUNT_SIZE + 16);
    buffer.set(data, 16);
    expect(readNonceAccount(nonceAccount({}, { data: buffer.subarray(16) }), OWNER)).toMatchObject({ kind: 'ready', value: VALUE });
  });

  it('tells a missing account apart', () => {
    expect(readNonceAccount(null, OWNER)).toEqual({ kind: 'missing' });
  });

  it.each([
    ['wrong owner', nonceAccount({}, { owner: LIGHTHOUSE_PROGRAM_ADDRESS }), 'owner'],
    ['wrong size: a wallet', nonceAccount({}, { data: new Uint8Array() }), 'size'],
    ['wrong size: one byte more', nonceAccount({}, { data: new Uint8Array(NONCE_ACCOUNT_SIZE + 1) }), 'size'],
    ['wrong state: all zeroes', nonceAccount({}, { data: new Uint8Array(NONCE_ACCOUNT_SIZE) }), 'state'],
    ['wrong state: uninitialized', nonceAccount({ state: NonceState.Uninitialized }), 'state'],
    ['wrong state: legacy version', nonceAccount({ version: NonceVersion.Legacy }), 'state'],
    ['wrong authority', nonceAccount({ authority: key(4) }), 'authority'],
  ] as const)('%s -> unusable (%s)', (_name, raw, reason) => {
    expect(readNonceAccount(raw, OWNER)).toEqual({ kind: 'unusable', reason, lamports: raw.lamports });
  });
});
