import type { Address, Blockhash, Nonce, Signature } from '@solana/kit';
import { parseCosignFragment, type ChainClock, type TransactionSummary } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { initialSigningState, signingReducer, type JobView, type RoundTx, type SignStep, type SigningEvent, type SigningState } from './machine.ts';
import { backKind, defaultJobReason, jobItems, linkView, signerItems } from './view.ts';

// The panel's view of a run whose second key signs by link (DECISIONS.md D67).

const MAIN = 'B1agBSrGRgub2jXMJEozYkRLRzFc9HLd5hHjSrCtuXu8' as Address;
const SECOND = '9DpLwZiYboWcwYFVtSjSksfaP9EqVoSuZw7Jofet96fi' as Address;
const S1 = 'AYA9kYsn7XVDTPARBfAuASypyyDGFJw1Xds2vHgW9DfW' as Address;
const S2 = '2Xtq6iZ2mXjxTNsv5FrYCzayG5qYRJwZ6837A1X3TjF6' as Address;
const NONCE_ACCOUNT = '5xot9PVkphiX2adznghwrAuxGs2zeWisNSxMW6hU6Hkj' as Address;
const NONCE_VALUE = 'GfnhkAa2bfg4dTjLfwhLSWg1b8zrJw9u8jCmVSUJhy9Y' as Nonce;
const TX_ID = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW' as Signature;
const CLOCK: ChainClock = { slot: 64_000n, epochStartTimestamp: 1_790_800_000n, epoch: 1_000n, unixTimestamp: 1_790_812_800n };
const ORIGIN = 'https://stakeward.example';
const LIFETIME = { kind: 'nonce', nonceAccount: NONCE_ACCOUNT, nonceAuthority: MAIN, nonceValue: NONCE_VALUE } as const;

function tx(id: Address, present: readonly Address[]): RoundTx {
  const summary: TransactionSummary = {
    action: { kind: 'protect', stakeAccount: id, mainKey: MAIN, secondKey: SECOND, lockUntil: 1_807_488_000n },
    feePayer: MAIN,
    lifetime: LIFETIME,
    computeBudget: { unitLimit: 1_400, microLamportsPerUnit: 1n },
    networkFeeLamports: 10_600n,
    requiredSigners: [MAIN, SECOND],
    presentSignatures: present,
    lighthouseTail: null,
  };
  return { id, bytes: Uint8Array.of(1, 2, 3, present.length), summary, lifetime: LIFETIME };
}

const STEPS: readonly SignStep[] = [
  { address: MAIN, role: 'main', walletName: 'Main Wallet', count: 1, status: 'pending', local: true },
  { address: SECOND, role: 'second', walletName: null, count: 1, status: 'pending', local: false },
];

const job = (id: Address, state: JobView['state']): JobView => ({
  id,
  state,
  before: null,
  action: tx(id, []).summary.action,
  lifetime: LIFETIME,
  signature: null,
  bytes: null,
});

const reduce = (state: SigningState, ...events: SigningEvent[]): SigningState => events.reduce(signingReducer, state);

const ready = reduce(
  initialSigningState([S1, S2], 1),
  { type: 'start' },
  { type: 'prepared', clock: CLOCK, jobs: { [S1]: job(S1, { kind: 'ready' }) }, txs: [tx(S1, [])], steps: STEPS },
);
const watching = reduce(ready, { type: 'asking', step: 0 }, { type: 'signed', step: 0, txs: [tx(S1, [MAIN])], signature: TX_ID });

describe('signerItems', () => {
  it('a key that signs by link shows as such from the start, never as missing or current', () => {
    expect(signerItems(ready).map((item) => item.status)).toEqual(['current', 'link']);
    expect(signerItems(watching).map((item) => item.status)).toEqual(['signed', 'link']);
  });
});

describe('linkView', () => {
  it('only while a link is open: the /cosign link of the signed bytes, the transaction id and the keys by link', () => {
    expect(linkView(ready, ORIGIN)).toBeNull();
    const link = linkView(watching, ORIGIN);
    expect(link).toMatchObject({ signature: TX_ID, signers: [{ role: 'second', address: SECOND }], watching: true, lastCheckFailed: false });
    const url = new URL(link?.url ?? '');
    expect(url.origin + url.pathname).toBe(`${ORIGIN}/cosign`);
    expect(parseCosignFragment(url.hash)).toEqual(tx(S1, [MAIN]).bytes);
    expect(linkView(reduce(watching, { type: 'link-checked', ok: false }, { type: 'link-paused' }), ORIGIN)).toMatchObject({
      watching: false,
      lastCheckFailed: true,
    });
    expect(linkView(reduce(watching, { type: 'stop-waiting' }), ORIGIN)).toBeNull();
  });
});

describe('job reasons', () => {
  it('a nonce transaction that never lands: the link stopped working; a blockhash one: it expired', () => {
    expect(defaultJobReason(job(S1, { kind: 'expired' }))).toBe(
      'The link stopped working: it was used, cancelled or failed. Nothing changed.',
    );
    expect(defaultJobReason({ ...job(S1, { kind: 'expired' }), lifetime: { kind: 'blockhash', blockhash: NONCE_VALUE as string as Blockhash, lastValidBlockHeight: 1n } })).toBe(
      'This transaction expired before it reached the network. Nothing changed; try again.',
    );
  });

  it('stopped waiting while the link is open: signed here, the link still works', () => {
    const stopped = reduce(watching, { type: 'stop-waiting' });
    expect(jobItems(stopped)).toEqual([
      {
        address: S1,
        status: 'unknown',
        signature: TX_ID,
        reason: 'Signed here; the other device has not sent it yet. The link still works: check again, or cancel it.',
      },
    ]);
  });
});

describe('backKind', () => {
  it('no way back while a link is open (Stop waiting here ends it)', () => {
    expect(backKind(watching)).toBeNull();
    expect(backKind(reduce(watching, { type: 'link-paused' }))).toBeNull();
  });
});
