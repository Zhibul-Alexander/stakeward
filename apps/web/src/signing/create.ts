import type { Ports } from '@/ports';
import type { SigningState } from './machine.ts';
import { slotSignerResolver } from './resolve.ts';
import { appendsTail } from './rules.ts';
import { SigningSession, type SessionOptions } from './session.ts';
import type { SigningPlan } from './types.ts';

/**
 * Faster polls and rereads for scenario tests; every page leaves them out and gets the engine's defaults. `link` sets
 * the watch of a signing link (step 7).
 */
export type SigningTestOptions = {
  pollIntervalMs?: number | undefined;
  rereadDelayMs?: number | undefined;
  link?: { firstPollMs?: number | undefined; maxPollMs?: number | undefined; watchMs?: number | undefined } | undefined;
};

export type PageSessionInput = {
  plan: SigningPlan;
  ids: readonly string[];
  signing?: SigningTestOptions | undefined;
  /** Default: the engine's (every job in one round, at most MAX_ROUND_SIZE). */
  roundSize?: number | undefined;
  onFinished?: ((state: SigningState) => void) | undefined;
  /** Default: the key slots of `ports` (slotSignerResolver). */
  resolveSigner?: SessionOptions['resolveSigner'] | undefined;
};

/**
 * A page's signing session with the site's rules: the page's ports, the key slots as signers, the wallets that sign
 * first (appendsTail) and the engine's timings unless a test passes faster ones. Call it inside the `create` of
 * useSigningSession, never during render.
 */
export function createPageSession(ports: Ports, input: PageSessionInput): SigningSession {
  const { plan, ids, signing, roundSize, onFinished, resolveSigner } = input;
  return new SigningSession({
    chain: ports.chain,
    plan,
    ids,
    resolveSigner: resolveSigner ?? slotSignerResolver(ports),
    appendsTail,
    roundSize,
    confirm: { pollIntervalMs: signing?.pollIntervalMs },
    rereadDelayMs: signing?.rereadDelayMs,
    link: signing?.link,
    onFinished,
  });
}
