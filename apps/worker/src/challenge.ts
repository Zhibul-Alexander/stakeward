import { getAddressDecoder, getBase58Encoder, type ReadonlyUint8Array } from '@solana/kit';
import type { Context } from 'hono';
import type { AppEnv } from './app.ts';

/**
 * The main key of the public "Try to steal it" wallet on each cluster (DECISIONS.md D133, D154), as
 * apps/web/src/pages/challenge/wallet.ts names it. Only a secret whose public half is this address is served.
 */
export const CHALLENGE_MAIN_KEYS: Readonly<Record<Env['CLUSTER'], string>> = {
  devnet: '9QeBtMG3LbdUz7sHHjmJMQ243Pn8Tb1A4WmwM3SJjRKf',
  mainnet: 'k58pveSMKrZzpmuhSxjVssPWpZLUoKgESwdWP4mJkrw',
};

/**
 * GET /api/challenge (DECISIONS.md D133, D154): the main key of this cluster's public "Try to steal it" wallet, which
 * the /challenge page shows. The key is published on purpose, but it lives in the Worker's CHALLENGE_MAIN_KEY secret
 * (base58 of the 64-byte keypair) rather than in the repository. The second key is never here. Answers 503 while the
 * secret is unset, is not a keypair, or is the keypair of any address but CHALLENGE_MAIN_KEYS of this cluster: a key
 * put in the wrong environment, or a second key put by mistake, never leaves the Worker.
 */
export function challengeHandler() {
  return (c: Context<AppEnv>): Response => {
    const keypair = challengeKeypair(c.env.CHALLENGE_MAIN_KEY);
    if (keypair === null || keypair.mainKey !== CHALLENGE_MAIN_KEYS[c.env.CLUSTER]) {
      return c.json({ error: 'challenge-not-configured', message: 'The challenge wallet is not set up yet' }, 503);
    }
    return c.json(keypair);
  };
}

/** The secret as { mainKey, mainKeySecret } when it is a base58 64-byte keypair (seed, then public key), else null. */
export function challengeKeypair(secret: string | undefined): { mainKey: string; mainKeySecret: string } | null {
  if (secret === undefined) return null;
  const text = secret.trim();
  let bytes: ReadonlyUint8Array;
  try {
    bytes = getBase58Encoder().encode(text);
  } catch {
    return null;
  }
  if (bytes.length !== 64) return null;
  return { mainKey: getAddressDecoder().decode(bytes.slice(32)), mainKeySecret: text };
}
