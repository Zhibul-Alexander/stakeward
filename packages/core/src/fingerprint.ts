// Monitor fast path (DECISIONS.md D49): most passes find a watched account unchanged, or changed only by epoch rewards.
// The worker stores a fingerprint of the bytes diffSnapshots depends on and skips the decode while it stays the same.
// The fingerprint is compared for equality only; every read of a field still goes through the generated client.
import { STAKE_PROGRAM_ADDRESS } from './constants.ts';

/** Base64 length of a 200-byte stake account. */
export const STAKE_DATA_BASE64_LENGTH = 268;

// Base64 turns every 3 bytes into 4 characters, so a byte range that starts and ends on a multiple of 3 is a character
// range: bytes [0,156) are chars [0,208), bytes [162,180) are chars [216,240).
const HEAD_END = 208;
const TAIL_START = 216;
const TAIL_END = 240;

/**
 * The base64 text of the bytes diffSnapshots depends on: chars [0,208) = bytes 0..156 (state tag, rent reserve,
 * staker, withdrawer, lockup timestamp/epoch/custodian, voter) and chars [216,240) = bytes 162..180 (2 high bytes
 * of delegation.stake, activation epoch, deactivation epoch). Excluded: the low 6 bytes of delegation.stake,
 * warmup rate, credits_observed and stake_flags, which epoch rewards change. 232 chars.
 *
 * Null unless `dataBase64` is the padded base64 of exactly 200 bytes: 268 chars ending in one `=` (268 chars ending in
 * `==` or in no `=` are 199 or 201 bytes, which do not decode as a stake account). Characters outside the fingerprint
 * are not checked; the full path decodes them.
 */
export function stakeDataFingerprint(dataBase64: string): string | null {
  if (
    dataBase64.length !== STAKE_DATA_BASE64_LENGTH ||
    dataBase64[STAKE_DATA_BASE64_LENGTH - 1] !== '=' ||
    dataBase64[STAKE_DATA_BASE64_LENGTH - 2] === '='
  ) {
    return null;
  }
  return dataBase64.slice(0, HEAD_END) + dataBase64.slice(TAIL_START, TAIL_END);
}

/**
 * True when diffSnapshots(stored, decode(read), {checkedAt}) is provably empty without decoding:
 * stored.fingerprint !== null, read.owner is the stake program, the fingerprints are equal,
 * read.lamports >= stored.lamports, and the lock end is not in (stored.checkedAt, checkedAt]
 * (lockUntil * 1000 compared as bigint, same rule as EXPIRED in diff.ts).
 *
 * `stored` is the D1 row: its fingerprint must come from the same read as its other columns. The lock end check ignores
 * the lockup epoch, so it may send an account to the full path that gives no EXPIRED there; never the other way round.
 */
export function canSkipDecode(
  stored: { fingerprint: string | null; lamports: bigint; lockUntil: bigint; checkedAt: number },
  read: { owner: string; dataBase64: string; lamports: bigint },
  checkedAt: number,
): boolean {
  if (stored.fingerprint === null || read.owner !== STAKE_PROGRAM_ADDRESS || read.lamports < stored.lamports) {
    return false;
  }
  if (stakeDataFingerprint(read.dataBase64) !== stored.fingerprint) return false;
  const endMs = stored.lockUntil * 1000n;
  const endsInThisPass = endMs > BigInt(Math.floor(stored.checkedAt)) && endMs <= BigInt(Math.floor(checkedAt));
  return !endsInThisPass;
}
