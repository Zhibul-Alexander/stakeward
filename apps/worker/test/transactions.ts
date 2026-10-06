// Real Stakeward transactions for the proxy tests, built with core's builder and signed by in-memory test wallets.
import {
  AccountRole,
  appendTransactionMessageInstruction,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  getAddressDecoder,
  getAddressEncoder,
  getI64Encoder,
  getTransactionEncoder,
  getU32Encoder,
  getU64Encoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Nonce,
} from '@solana/kit';
import { buildTransaction, SYSTEM_PROGRAM_ADDRESS, U64_MAX } from '@stakeward/core';
import { newTestWallet, type TestWallet } from '@stakeward/core/test/wallet';
import { encodeBase64 } from '../src/base64.ts';

export const BLOCKHASH = blockhash('EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N');
/** 2027-04-13T00:00:00Z */
export const LOCK_UNTIL = 1_807_574_400n;

/** A deterministic address: 32 bytes of `n` (nothing has to sign for it). */
export function key(n: number): Address {
  return getAddressDecoder().decode(new Uint8Array(32).fill(n));
}

export type ProtectSetup = { mainKey: TestWallet; secondKey: TestWallet; stakeAccount: Address; bytes: Uint8Array };

/** Unsigned protect (SetLockupChecked) for a fresh main key and second key, on a blockhash. */
export async function unsignedProtect(): Promise<ProtectSetup> {
  const mainKey = await newTestWallet();
  const secondKey = await newTestWallet();
  const stakeAccount = key(7);
  const built = buildTransaction(
    { kind: 'protect', stakeAccount, mainKey: mainKey.address, secondKey: secondKey.address, lockUntil: LOCK_UNTIL },
    { feePayer: mainKey.address, lifetime: { kind: 'blockhash', blockhash: BLOCKHASH, lastValidBlockHeight: 1000n } },
  );
  return { mainKey, secondKey, stakeAccount, bytes: built.bytes };
}

export async function signedProtect(): Promise<ProtectSetup> {
  const setup = await unsignedProtect();
  const [byMain] = await setup.mainKey.signTransactions([setup.bytes]);
  const [bySecond] = await setup.secondKey.signTransactions([byMain ?? new Uint8Array()]);
  return { ...setup, bytes: bySecond ?? new Uint8Array() };
}

export type ChangeSecondKeySetup = { secondKey: TestWallet; newSecondKey: TestWallet; stakeAccount: Address; bytes: Uint8Array };

/** Unsigned change of second key (F7, SetLockupChecked without lock values) on a blockhash, paid by the new key. */
export async function unsignedChangeSecondKey(): Promise<ChangeSecondKeySetup> {
  const [secondKey, newSecondKey] = await Promise.all([newTestWallet(), newTestWallet()]);
  const stakeAccount = key(7);
  const built = buildTransaction(
    { kind: 'change-second-key', stakeAccount, secondKey: secondKey.address, newSecondKey: newSecondKey.address },
    { feePayer: newSecondKey.address, lifetime: { kind: 'blockhash', blockhash: BLOCKHASH, lastValidBlockHeight: 1000n } },
  );
  return { secondKey, newSecondKey, stakeAccount, bytes: built.bytes };
}

/** The same change, signed by the new second key (the fee payer) and then the old one. */
export async function signedChangeSecondKey(): Promise<ChangeSecondKeySetup> {
  const setup = await unsignedChangeSecondKey();
  const [byNew] = await setup.newSecondKey.signTransactions([setup.bytes]);
  const [byBoth] = await setup.secondKey.signTransactions([byNew ?? new Uint8Array()]);
  return { ...setup, bytes: byBoth ?? new Uint8Array() };
}

/** Fully signed rescue on the new wallet's durable nonce: the heaviest kind (3 signatures, 2 stake instructions). */
export async function signedNonceRescue(): Promise<Uint8Array> {
  const [mainKey, secondKey, newWallet] = await Promise.all([newTestWallet(), newTestWallet(), newTestWallet()]);
  const built = buildTransaction(
    { kind: 'rescue', stakeAccount: key(9), mainKey: mainKey.address, secondKey: secondKey.address, newWallet: newWallet.address },
    {
      feePayer: newWallet.address,
      lifetime: {
        kind: 'nonce',
        nonceAccount: key(11),
        nonceAuthority: newWallet.address,
        nonceValue: BLOCKHASH as string as Nonce,
      },
    },
  );
  let bytes = built.bytes;
  for (const wallet of [newWallet, mainKey, secondKey]) {
    const [signed] = await wallet.signTransactions([bytes]);
    if (signed === undefined) throw new Error('wallet returned nothing');
    bytes = signed;
  }
  return bytes;
}

/** A System transfer signed by a fresh wallet: a well-formed transaction the inspector must refuse. */
export async function signedSystemTransfer(): Promise<Uint8Array> {
  const payer = await newTestWallet();
  const data = new Uint8Array(12);
  data.set(getU32Encoder().encode(2), 0);
  data.set(getU64Encoder().encode(1_000_000n), 4);
  const message = pipe(
    createTransactionMessage({ version: 'legacy' }),
    (m) => setTransactionMessageFeePayer(payer.address, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH, lastValidBlockHeight: 1000n }, m),
    (m) =>
      appendTransactionMessageInstruction(
        {
          programAddress: SYSTEM_PROGRAM_ADDRESS,
          accounts: [
            { address: payer.address, role: AccountRole.WRITABLE_SIGNER },
            { address: key(3), role: AccountRole.WRITABLE },
          ],
          data,
        },
        m,
      ),
  );
  const unsigned = new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
  const [signed] = await payer.signTransactions([unsigned]);
  if (signed === undefined) throw new Error('wallet returned nothing');
  return signed;
}

export const b64 = encodeBase64;

/** Flips one bit of the first signature (the fee payer's). */
export function corruptFirstSignature(bytes: Uint8Array): Uint8Array {
  const copy = bytes.slice();
  copy[1] = (copy[1] ?? 0) ^ 0x01;
  return copy;
}

export type StakeAccountSpec = {
  state?: 'initialized' | 'delegated';
  staker: Address;
  withdrawer: Address;
  unixTimestamp?: bigint;
  lockupEpoch?: bigint;
  custodian?: Address;
  voter?: Address;
  /** Delegated lamports (default 5 SOL); epoch rewards raise it. */
  stake?: bigint;
  activationEpoch?: bigint;
  /** Default u64::MAX: not deactivating. */
  deactivationEpoch?: bigint;
  /** credits_observed; epoch rewards change it. */
  credits?: bigint;
};

/**
 * Raw 200-byte stake account data, written by hand from the layout in CLAUDE.md section 4, so the decoding test does
 * not reuse the generated encoder that core decodes with.
 */
export function stakeAccountData(spec: StakeAccountSpec): Uint8Array {
  const data = new Uint8Array(200);
  const put = (offset: number, bytes: ArrayLike<number>) => {
    data.set(bytes, offset);
  };
  put(0, getU32Encoder().encode(spec.state === 'delegated' ? 2 : 1));
  put(4, getU64Encoder().encode(2_282_880n));
  put(12, getAddressEncoder().encode(spec.staker));
  put(44, getAddressEncoder().encode(spec.withdrawer));
  put(76, getI64Encoder().encode(spec.unixTimestamp ?? 0n));
  put(84, getU64Encoder().encode(spec.lockupEpoch ?? 0n));
  put(92, getAddressEncoder().encode(spec.custodian ?? key(0)));
  if (spec.state === 'delegated') {
    put(124, getAddressEncoder().encode(spec.voter ?? key(42)));
    put(156, getU64Encoder().encode(spec.stake ?? 5_000_000_000n));
    put(164, getU64Encoder().encode(spec.activationEpoch ?? 800n));
    put(172, getU64Encoder().encode(spec.deactivationEpoch ?? U64_MAX));
    put(188, getU64Encoder().encode(spec.credits ?? 0n));
  }
  return data;
}

/**
 * Clock sysvar data (40 bytes): slot @0, epoch_start_timestamp @8, epoch @16, leader_schedule_epoch @24,
 * unix_timestamp @32.
 */
export function clockData(slot: bigint, epoch: bigint, unixTimestamp: bigint): Uint8Array {
  const data = new Uint8Array(40);
  data.set(getU64Encoder().encode(slot), 0);
  data.set(getI64Encoder().encode(unixTimestamp - 3_600n), 8);
  data.set(getU64Encoder().encode(epoch), 16);
  data.set(getU64Encoder().encode(epoch + 1n), 24);
  data.set(getI64Encoder().encode(unixTimestamp), 32);
  return data;
}
