import { address, getAddressEncoder, getBase58Encoder, type Address, type Nonce } from '@solana/kit';
import {
  deriveNonceAccountAddress,
  NONCE_ACCOUNT_SEED,
  NONCE_ACCOUNT_SIZE,
  STAKE_PROGRAM_ADDRESS,
  SYSTEM_PROGRAM_ADDRESS,
  type ChainClock,
  type ChainPort,
  type RawAccount,
} from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { nonceRefusalText, noncePlan, readNonceInfo } from './nonce.ts';

const AUTHORITY = address('B1agBSrGRgub2jXMJEozYkRLRzFc9HLd5hHjSrCtuXu8');
const OTHER = address('9DpLwZiYboWcwYFVtSjSksfaP9EqVoSuZw7Jofet96fi');
const NONCE_VALUE = 'BZFufDqppShyDDC1njm4fMpRbfnLwrpzzwG6WGgcmsxb' as Nonce;
const DEPOSIT = 1_447_680n;
const CLOCK: ChainClock = { unixTimestamp: 1_790_000_000n, epoch: 850n, slot: 300_000_000n };

/** An initialized durable nonce account of `authority` (System program layout, 80 bytes). */
function nonceAccount(authority: Address, lamports = DEPOSIT, owner: Address = SYSTEM_PROGRAM_ADDRESS): RawAccount {
  const data = new Uint8Array(NONCE_ACCOUNT_SIZE);
  const view = new DataView(data.buffer);
  view.setUint32(0, 1, true);
  view.setUint32(4, 1, true);
  data.set(getAddressEncoder().encode(authority), 8);
  data.set(getBase58Encoder().encode(NONCE_VALUE), 40);
  view.setBigUint64(72, 5_000n, true);
  return { address: AUTHORITY, lamports, owner, data };
}

/** A ChainPort that answers the nonce reads only and records them. */
function fakeChain(raw: RawAccount | null): ChainPort & { reads: Address[][]; rentSizes: number[] } {
  const reads: Address[][] = [];
  const rentSizes: number[] = [];
  const unused = () => Promise.reject(new Error('not used by the nonce plan'));
  const chain: ChainPort & { reads: Address[][]; rentSizes: number[] } = {
    reads,
    rentSizes,
    getAccounts: (addresses: readonly Address[]) => {
      reads.push([...addresses]);
      return Promise.resolve({ slot: CLOCK.slot, accounts: addresses.map(() => raw) });
    },
    getMinimumBalanceForRentExemption: (size: number) => {
      rentSizes.push(size);
      return Promise.resolve(DEPOSIT);
    },
    getClock: () => Promise.resolve(CLOCK),
    getLatestBlockhash: unused,
    getBlockHeight: unused,
    getEpochInfo: unused,
    getBalance: unused,
    simulate: unused,
    send: unused,
    getSignatureStatuses: unused,
    findStakeAccounts: unused,
  };
  return chain;
}

describe('readNonceInfo', () => {
  it("reads the account at the key's derived address and the deposit for its size", async () => {
    const expected = await deriveNonceAccountAddress(AUTHORITY);
    const chain = fakeChain(nonceAccount(AUTHORITY));
    const info = await readNonceInfo(chain, AUTHORITY);
    expect(info.address).toBe(expected);
    expect(info.deposit).toBe(DEPOSIT);
    expect(info.state).toEqual({ kind: 'ready', authority: AUTHORITY, value: NONCE_VALUE, lamports: DEPOSIT });
    expect(chain.reads).toEqual([[expected]]);
    expect(chain.rentSizes).toEqual([NONCE_ACCOUNT_SIZE]);
  });

  it('missing when nothing is there; unusable when another key holds it', async () => {
    expect((await readNonceInfo(fakeChain(null), AUTHORITY)).state).toEqual({ kind: 'missing' });
    expect((await readNonceInfo(fakeChain(nonceAccount(OTHER)), AUTHORITY)).state).toMatchObject({ kind: 'unusable', reason: 'authority' });
  });
});

describe('noncePlan', () => {
  const run = async (mode: 'setup' | 'close', raw: RawAccount | null) => {
    const account = await deriveNonceAccountAddress(AUTHORITY);
    const chain = fakeChain(raw);
    const result = await noncePlan({ authority: AUTHORITY, nonceAccount: account, mode }).prepare(chain, [account]);
    return { account, chain, result, job: result.jobs[account] };
  };

  it('setup, missing: builds the setup with the deposit, paid by the owner; one read of the account', async () => {
    const { account, chain, result, job } = await run('setup', null);
    expect(result.clock).toEqual(CLOCK);
    expect(job).toEqual({
      kind: 'build',
      action: { kind: 'nonce-setup', nonceAccount: account, nonceAuthority: AUTHORITY, seed: NONCE_ACCOUNT_SEED, lamports: DEPOSIT },
      feePayer: AUTHORITY,
      before: null,
    });
    expect(chain.reads).toEqual([[account]]);
  });

  it('setup, ready: done, nothing to sign', async () => {
    expect((await run('setup', nonceAccount(AUTHORITY))).job).toEqual({ kind: 'done', after: null });
  });

  it('close, ready: returns the whole balance to the owner, who pays', async () => {
    const { account, job } = await run('close', nonceAccount(AUTHORITY, DEPOSIT + 7n));
    expect(job).toEqual({
      kind: 'build',
      action: { kind: 'nonce-close', nonceAccount: account, nonceAuthority: AUTHORITY, recipient: AUTHORITY, lamports: DEPOSIT + 7n },
      feePayer: AUTHORITY,
      before: null,
    });
  });

  it('close, missing: done (closed already)', async () => {
    expect((await run('close', null)).job).toEqual({ kind: 'done', after: null });
  });

  it.each([
    ['another key holds it', nonceAccount(OTHER)],
    ['another program owns it', nonceAccount(AUTHORITY, DEPOSIT, STAKE_PROGRAM_ADDRESS)],
  ])('unusable (%s): both modes refuse with nonce-unusable', async (_case, raw) => {
    for (const mode of ['setup', 'close'] as const) {
      expect((await run(mode, raw)).job).toEqual({ kind: 'refused', reason: 'nonce-unusable', before: null });
    }
  });
});

describe('nonceRefusalText', () => {
  it('says the address is taken; anything else reads as an unknown error', () => {
    expect(nonceRefusalText('nonce-unusable')).toMatch(/already taken by another account/);
    expect(nonceRefusalText('something-else')).toBe(nonceRefusalText('other'));
    expect(nonceRefusalText('something-else')).not.toMatch(/already taken/);
  });
});
