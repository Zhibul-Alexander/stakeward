// What the mechanism gate needs from a chain. Two adapters implement it: LiteSVM (litesvm.ts) and RPC (rpc.ts).
import { createHash } from 'node:crypto';
import { getAddressDecoder, getU64Decoder, type Address, type Signature } from '@solana/kit';
import {
  STAKE_PROGRAM_ADDRESS,
  type BlockhashLifetime,
  type ClockView,
  type Lifetime,
  type RawAccount,
} from '@stakeward/core';
import { PROGRAMDATA_HEADER_SIZE, type ChainError } from '@stakeward/core/test/support';

export type GateCluster = 'litesvm' | 'devnet' | 'mainnet';

/** What happened to a sent transaction. */
export type TxOutcome =
  | { status: 'ok'; signature: Signature }
  /** Landed and failed (the fee was charged) or, on LiteSVM, failed at execution. */
  | { status: 'failed'; signature: Signature; error: ChainError }
  /** Never landed before its blockhash expired (RPC only); safe to build again with a new blockhash. */
  | { status: 'dropped'; signature: Signature };

/** The stake program as deployed on the chain: programdata account and a hash of the ELF inside it. */
export type ProgramElf = {
  programData: Address;
  deploySlot: bigint;
  /** sha256 of the programdata bytes after the 45-byte header. */
  sha256: string;
  size: number;
};

export interface GateChain {
  /** The Clock sysvar: the time and epoch the stake program sees. */
  clock(): Promise<ClockView>;
  /** A fresh blockhash lifetime; build the transaction right after. */
  lifetime(): Promise<BlockhashLifetime>;
  rentExempt(space: number): Promise<bigint>;
  balance(address: Address): Promise<bigint>;
  account(address: Address): Promise<RawAccount | null>;
  /** Sends fully signed wire bytes and waits until the transaction is confirmed, failed or dropped. */
  send(bytes: Uint8Array, lifetime: Lifetime): Promise<TxOutcome>;
  /** A vote account to delegate to: created on LiteSVM, an active validator on devnet. */
  voteAccount(): Promise<Address>;
  /** Stake accounts whose withdrawer is `withdrawer` (getProgramAccounts with a memcmp at offset 44). */
  stakeAccountsOf(withdrawer: Address): Promise<Address[]>;
  programElf(): Promise<ProgramElf>;
  /** LiteSVM only: moves the cluster clock (check 14). */
  readonly setTime?: (unixTimestamp: bigint) => void;
}

/** Reads the stake program's programdata (upgradeable loader) and hashes the ELF inside it. */
export async function readProgramElf(
  account: (address: Address) => Promise<RawAccount | null>,
): Promise<ProgramElf> {
  const program = await account(STAKE_PROGRAM_ADDRESS);
  if (program === null) throw new Error('The stake program account does not exist');
  // UpgradeableLoaderState::Program = u32 tag 2, then the programdata address.
  const programData = getAddressDecoder().decode(program.data, 4);
  const data = await account(programData);
  if (data === null) throw new Error(`Programdata ${programData} does not exist`);
  const elf = data.data.slice(PROGRAMDATA_HEADER_SIZE);
  return {
    programData,
    deploySlot: getU64Decoder().decode(data.data, 4),
    sha256: createHash('sha256').update(elf).digest('hex'),
    size: elf.length,
  };
}
