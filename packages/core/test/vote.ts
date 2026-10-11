// Vote account bytes for tests: bincode by hand from the anza-xyz/solana-sdk vote-interface layout, so the tests do
// not reuse the decoder they check (src/validator.ts).
import { VOTE_ACCOUNT_SIZE } from '../src/validator.ts';

export type Credits = [number, number, number][];

/** A vote account of `version` (VoteStateVersions tag: 1 V1_14_11, 2 V3, 3 V4), padded to VOTE_ACCOUNT_SIZE like a real one. */
export function voteAccountData(opts: {
  version: 1 | 2 | 3;
  commission: number;
  bls?: boolean;
  votes?: number;
  root?: boolean;
  voters?: number;
  credits: Credits;
}): Uint8Array {
  const out: number[] = [];
  const u8 = (v: number) => out.push(v & 0xff);
  const u16 = (v: number) => {
    u8(v);
    u8(v >> 8);
  };
  const u32 = (v: number) => {
    for (let i = 0; i < 4; i += 1) u8(v >>> (8 * i));
  };
  const u64 = (v: number | bigint) => {
    let b = BigInt(v);
    for (let i = 0; i < 8; i += 1) {
      u8(Number(b & 0xffn));
      b >>= 8n;
    }
  };
  const bytes = (n: number, fill = 7) => {
    for (let i = 0; i < n; i += 1) u8(fill);
  };
  const votes = opts.votes ?? 31;
  const voteSize = opts.version === 1 ? 12 : 13;
  u32(opts.version);
  if (opts.version === 3) {
    bytes(32 * 4);
    u16(opts.commission);
    u16(10_000);
    u64(0);
    if (opts.bls === true) {
      u8(1);
      bytes(48, 9);
    } else u8(0);
  } else {
    bytes(32 * 2);
    u8(opts.commission);
  }
  u64(votes);
  bytes(votes * voteSize);
  if (opts.root ?? true) {
    u8(1);
    u64(123);
  } else u8(0);
  u64(opts.voters ?? 2);
  bytes((opts.voters ?? 2) * 40);
  if (opts.version !== 3) bytes(32 * 48 + 8 + 1);
  u64(opts.credits.length);
  for (const [epoch, credits, prev] of opts.credits) {
    u64(epoch);
    u64(credits);
    u64(prev);
  }
  u64(1);
  u64(2);
  const data = new Uint8Array(VOTE_ACCOUNT_SIZE);
  data.set(out);
  return data;
}
