import type { WalletPort } from '@stakeward/core';

/**
 * Site rules of the signing engine (DECISIONS.md D5, D24; CLAUDE.md section 6). Revised after the wallet matrix.
 */

/** Wallets that may append a Lighthouse tail to what they sign, so they sign first while nothing is signed yet. */
export const TAIL_FIRST_WALLETS: readonly string[] = ['Phantom'];

/** True when `wallet` may append a Lighthouse tail (core `signingOrder` then puts it first). */
export function appendsTail(wallet: WalletPort): boolean {
  return TAIL_FIRST_WALLETS.includes(wallet.name);
}

/** Most transactions one wallet request signs at once (RPC proxy rate limit, DECISIONS.md D40). */
export const MAX_ROUND_SIZE = 10;

/** About 24 s of blocks. With fewer left before the first signature, the round is built again before asking. */
export const MIN_BLOCKS_LEFT_TO_SIGN = 60n;

/** After a confirmation, the stake account is read again this many times while it does not show the change. */
export const REREAD_ATTEMPTS = 3;

/** Pause between those reads (a lagging RPC node catches up). */
export const REREAD_DELAY_MS = 2_000;
