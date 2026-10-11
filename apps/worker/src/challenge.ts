import { getAddressDecoder, getBase58Encoder, type ReadonlyUint8Array } from '@solana/kit';
import type { Context } from 'hono';
import type { AppEnv } from './app.ts';

/**
 * GET /api/challenge (DECISIONS.md D133), devnet only: the main key of the public "Try to steal it" wallet, which the
 * /challenge page shows. The key is published on purpose, but it lives in the CHALLENGE_MAIN_KEY secret of the dev
 * Worker (base58 of the 64-byte keypair) rather than in the repository. The second key is never here.
 * Answers 404 outside devnet and 503 while the secret is unset or is not a keypair.
 */
export function challengeHandler() {
  return (c: Context<AppEnv>): Response => {
    if (c.env.CLUSTER !== 'devnet') return c.json({ error: 'Not found' }, 404);
    const keypair = challengeKeypair(c.env.CHALLENGE_MAIN_KEY);
    if (keypair === null) {
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
