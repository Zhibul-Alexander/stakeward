// The lenient scanner behind /check (DECISIONS.md D126): any transaction from any site, read from its bytes alone.
import {
  AccountRole,
  blockhash,
  createNoopSigner,
  getBase58Decoder,
  getBase64Decoder,
  getTransactionDecoder,
  type Address,
  type Instruction,
} from '@solana/kit';
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from '@solana-program/compute-budget';
import {
  getAuthorizeCheckedInstruction,
  getAuthorizeInstruction,
  getDeactivateInstruction,
  getMergeInstruction,
  getSetLockupInstruction,
  getWithdrawInstruction,
  StakeAuthorize,
} from '@solana-program/stake';
import { getTransferSolInstruction } from '@solana-program/system';
import { describe, expect, it } from 'vitest';
import { build, craft, craftV0, key, lifetimeToken } from '../test/craft.ts';
import type { BlockhashLifetime } from './actions.ts';
import { SYSVAR_CLOCK_ADDRESS } from './constants.ts';
import { toLegacyLayout, type StakeIx } from './legacy-layout.ts';
import { cosignFragment } from './link.ts';
import { scanTransaction, scanTransactionText, type ScanReport } from './scan.ts';

const A = key(1); // the person's wallet
const K = key(2); // second key
const S = key(4); // stake account
const S2 = key(7);
const X = key(8); // thief
const VOTE = key(5);
const T = 1_825_545_600n;
const BLOCKHASH: BlockhashLifetime = { kind: 'blockhash', blockhash: blockhash(key(20)), lastValidBlockHeight: 100n };
const TOKEN = lifetimeToken(BLOCKHASH);
const signer = createNoopSigner;

async function scan(bytes: Uint8Array, wallet?: Address): Promise<ScanReport> {
  const result = await scanTransaction(bytes, { wallet });
  if (!result.ok) throw new Error(result.message);
  return result.report;
}

const base64 = (bytes: Uint8Array) => getBase64Decoder().decode(bytes);
const base58 = (bytes: Uint8Array) => getBase58Decoder().decode(bytes);

/** A transfer plus compute budget around a hidden AuthorizeChecked(Withdrawer -> X): the SwissBorg shape. */
function hiddenAuthorize(legacyLayout: boolean): Uint8Array {
  const authorize = getAuthorizeCheckedInstruction({
    stake: S,
    authority: signer(A),
    newAuthority: signer(X),
    stakeAuthorize: StakeAuthorize.Withdrawer,
  }) as StakeIx;
  const stakeIx = legacyLayout ? toLegacyLayout(authorize, { at: 1, sysvars: [SYSVAR_CLOCK_ADDRESS] }) : authorize;
  return craft(
    [
      getSetComputeUnitLimitInstruction({ units: 200_000 }),
      getSetComputeUnitPriceInstruction({ microLamports: 1_000n }),
      getTransferSolInstruction({ source: signer(A), destination: key(30), amount: 10_000n }),
      stakeIx,
    ],
    A,
    TOKEN,
  );
}

describe('scanTransaction', () => {
  it('reads a Stakeward protect transaction and recognises Stakeward format', async () => {
    const { bytes } = build({ kind: 'protect', stakeAccount: S, mainKey: A, secondKey: K, lockUntil: T }, BLOCKHASH);
    const report = await scan(bytes, A);
    expect(report.stakeward?.action.kind).toBe('protect');
    expect(report.touchesStake).toBe(true);
    expect(report.risk).toBe('danger');
    const stake = report.instructions.find((ix) => ix.effect.kind === 'set-lockup');
    expect(stake?.effect).toEqual({
      kind: 'set-lockup',
      variant: 'SetLockupChecked',
      stake: S,
      authority: A,
      unixTimestamp: T,
      epoch: null,
      newCustodian: K,
      custodianChanges: true,
    });
    expect(stake?.wallet).toBe('authority');
    const others = report.instructions.filter((ix) => ix.effect.kind === 'program');
    expect(others.map((ix) => ix.effect)).toEqual([
      { kind: 'program', program: 'compute-budget', name: 'SetComputeUnitLimit' },
      { kind: 'program', program: 'compute-budget', name: 'SetComputeUnitPrice' },
    ]);
    expect(others.every((ix) => ix.risk === 'ok')).toBe(true);
  });

  it('finds a hidden AuthorizeChecked(Withdrawer) next to a transfer and a compute budget, in both account layouts', async () => {
    for (const legacy of [true, false]) {
      const report = await scan(hiddenAuthorize(legacy), A);
      expect(report.stakeward).toBeNull();
      expect(report.risk).toBe('danger');
      expect(report.instructions.map((ix) => ix.risk)).toEqual(['ok', 'ok', 'ok', 'danger']);
      expect(report.instructions[2]?.effect).toEqual({ kind: 'program', program: 'system', name: 'TransferSol' });
      const authorize = report.instructions[3];
      expect(authorize?.effect).toEqual({
        kind: 'authorize',
        variant: 'AuthorizeChecked',
        role: 'withdrawer',
        stake: S,
        authority: A,
        newAuthority: X,
        custodian: null,
      });
      expect(authorize?.wallet).toBe('replaced');
      expect(report.requiredSigners).toEqual([A, X]);
    }
  });

  it('reads Authorize (new authority in the data), SetLockup with a custodian, Withdraw and Merge in the legacy layout', async () => {
    const authorize = toLegacyLayout(
      getAuthorizeInstruction({ stake: S, authority: signer(A), arg0: X, arg1: StakeAuthorize.Staker }),
      { at: 1, sysvars: [SYSVAR_CLOCK_ADDRESS] },
    );
    const lockup = getSetLockupInstruction({ stake: S, authority: signer(A), unixTimestamp: 0n, epoch: null, custodian: X });
    const report = await scan(craft([authorize, lockup], A, TOKEN), X);
    expect(report.instructions.map((ix) => ix.effect)).toEqual([
      { kind: 'authorize', variant: 'Authorize', role: 'staker', stake: S, authority: A, newAuthority: X, custodian: null },
      {
        kind: 'set-lockup',
        variant: 'SetLockup',
        stake: S,
        authority: A,
        unixTimestamp: 0n,
        epoch: null,
        newCustodian: X,
        custodianChanges: true,
      },
    ]);
    // X is the new authority, not the one replaced.
    expect(report.instructions.map((ix) => ix.wallet)).toEqual([null, null]);

    const withdraw = getWithdrawInstruction({ stake: S, recipient: X, withdrawAuthority: signer(A), lockupAuthority: signer(K), args: 5n });
    const merge = getMergeInstruction({ destinationStake: S2, sourceStake: S, stakeAuthority: signer(A) });
    const second = await scan(craft([withdraw, merge], A, TOKEN), A);
    expect(second.instructions.map((ix) => [ix.effect.kind, ix.risk, ix.wallet])).toEqual([
      ['withdraw', 'danger', 'replaced'],
      ['merge', 'danger', 'authority'],
    ]);
    expect(second.instructions[0]?.effect).toMatchObject({ recipient: X, authority: A, custodian: K, lamports: 5n });
  });

  it('calls Deactivate caution and a foreign program caution', async () => {
    const foreign: Instruction = {
      programAddress: key(60),
      accounts: [{ address: A, role: AccountRole.WRITABLE_SIGNER }],
      data: Uint8Array.of(1, 2, 3),
    };
    const report = await scan(craft([foreign, getDeactivateInstruction({ stake: S, stakeAuthority: signer(A) })], A, TOKEN));
    expect(report.risk).toBe('caution');
    expect(report.instructions.map((ix) => [ix.effect.kind, ix.risk])).toEqual([
      ['program', 'caution'],
      ['deactivate', 'caution'],
    ]);
    expect(report.instructions[0]?.programAddress).toBe(key(60));
  });

  it('is ok for a transaction that touches no stake account', async () => {
    const report = await scan(craft([getTransferSolInstruction({ source: signer(A), destination: X, amount: 1n })], A, TOKEN));
    expect(report.touchesStake).toBe(false);
    expect(report.risk).toBe('ok');
  });

  it('marks accounts behind a lookup table as unknown, and the transaction as needing caution', async () => {
    const transfer = getTransferSolInstruction({ source: signer(A), destination: X, amount: 1n });
    const quiet = await scan(craftV0([transfer], A, TOKEN, { address: key(50), addresses: [X] }));
    expect(quiet.version).toBe(0);
    expect(quiet.lookupTables).toEqual([key(50)]);
    expect(quiet.instructions[0]?.usesLookupTable).toBe(true);
    expect(quiet.risk).toBe('caution');

    const withdraw = getWithdrawInstruction({ stake: S, recipient: X, withdrawAuthority: signer(A), args: 5n });
    const hidden = await scan(craftV0([withdraw], A, TOKEN, { address: key(50), addresses: [X, VOTE] }), A);
    expect(hidden.risk).toBe('danger');
    expect(hidden.instructions[0]?.effect).toMatchObject({ kind: 'withdraw', stake: S, recipient: null, authority: A });
    expect(hidden.instructions[0]?.usesLookupTable).toBe(true);
    // The recipient is unknown, so the wallet's part cannot be "replaced" with certainty, but it is not its own either.
    expect(hidden.instructions[0]?.wallet).toBe('replaced');
  });

  it('reads a bare message as well as a transaction', async () => {
    const { bytes } = build({ kind: 'extend', stakeAccount: S, secondKey: K, lockUntil: T }, BLOCKHASH);
    const messageBytes = new Uint8Array(getTransactionDecoder().decode(bytes).messageBytes);
    const report = await scan(messageBytes);
    expect(report.messageOnly).toBe(true);
    expect(report.stakeward?.action.kind).toBe('extend');
  });

  it('refuses garbage and trailing bytes', async () => {
    expect((await scanTransaction(Uint8Array.of(1, 2, 3))).ok).toBe(false);
    expect((await scanTransaction(new Uint8Array())).ok).toBe(false);
    const { bytes } = build({ kind: 'protect', stakeAccount: S, mainKey: A, secondKey: K, lockUntil: T }, BLOCKHASH);
    expect((await scanTransaction(Uint8Array.of(...bytes, 0))).ok).toBe(false);
  });
});

describe('scanTransactionText', () => {
  const bytes = hiddenAuthorize(true);

  it('reads base64, base58, a /cosign link and a JSON byte array to the same report', async () => {
    const inputs = [
      base64(bytes),
      `  ${base64(bytes).slice(0, 40)}\n${base64(bytes).slice(40)}  `,
      base58(bytes),
      `https://stakeward.example/cosign#${cosignFragment(bytes)}`,
      JSON.stringify([...bytes]),
    ];
    const encodings: string[] = [];
    for (const input of inputs) {
      const result = await scanTransactionText(input, { wallet: A });
      if (!result.ok) throw new Error(`${input}: ${result.message}`);
      encodings.push(result.encoding);
      expect(result.report.instructions[3]?.effect).toMatchObject({ kind: 'authorize', newAuthority: X });
    }
    expect(encodings).toEqual(['base64', 'base64', 'base58', 'link', 'bytes']);
  });

  it('says what non-transactions are', async () => {
    expect(await scanTransactionText('   ')).toMatchObject({ ok: false, code: 'empty' });
    expect(await scanTransactionText('hello world, this is not a transaction')).toMatchObject({ ok: false, code: 'malformed' });
    expect(await scanTransactionText('@@@@')).toMatchObject({ ok: false, code: 'malformed' });
    expect(await scanTransactionText(A)).toMatchObject({ ok: false, code: 'address' });
    expect(await scanTransactionText(base58(new Uint8Array(64).fill(9)))).toMatchObject({ ok: false, code: 'secret' });
    expect(await scanTransactionText(JSON.stringify(Array.from({ length: 64 }, (_, i) => i)))).toMatchObject({ ok: false, code: 'secret' });
    const words = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
    expect(await scanTransactionText(words)).toMatchObject({ ok: false, code: 'secret' });
    expect(await scanTransactionText('/cosign#tx=@@')).toMatchObject({ ok: false, code: 'malformed' });
  });
});
