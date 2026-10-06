import {
  cosignLinkProblem,
  inspectTransaction,
  parseCosignFragment,
  type CosignLinkProblem,
  type InspectError,
  type TransactionSummary,
} from '@stakeward/core';
import { useSyncExternalStore } from 'react';

/**
 * What a /cosign link holds, read from its fragment alone (CLAUDE.md section 6), before any chain read:
 * - `bad`: no transaction Stakeward can read (not `#tx=`, not base64url, empty or too long, or bytes that are no whole
 *   transaction: the inspector's `malformed`, as when a messenger cut the link off);
 * - `rejected`: the inspector refuses a whole transaction (another program, an unknown instruction, a lookup table, ...);
 * - `problem`: the bytes are a Stakeward transaction, but not a link Stakeward makes (core `cosignLinkProblem`);
 * - `ok`: a link Stakeward makes; the chain decides the rest (plan.ts).
 */
export type LinkRead =
  | { kind: 'bad' }
  | { kind: 'rejected'; error: InspectError }
  | { kind: 'problem'; problem: CosignLinkProblem; summary: TransactionSummary }
  | { kind: 'ok'; bytes: Uint8Array; summary: TransactionSummary };

/** Reads the fragment (`#tx=...`): the bytes, then the inspector, then the link-format rules. Never rejects. */
export async function readLink(fragment: string): Promise<LinkRead> {
  const bytes = parseCosignFragment(fragment);
  if (bytes === null) return { kind: 'bad' };
  const inspected = await inspectTransaction(bytes);
  // A cut-off link is broken, not hostile: ask for the whole link, never "do not sign" the owner's own transaction.
  if (!inspected.ok) return inspected.error.code === 'malformed' ? { kind: 'bad' } : { kind: 'rejected', error: inspected.error };
  const problem = cosignLinkProblem(inspected.summary);
  if (problem !== null) return { kind: 'problem', problem, summary: inspected.summary };
  return { kind: 'ok', bytes, summary: inspected.summary };
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
  };
}

function hash(): string {
  return window.location.hash;
}

/** The page address's fragment (with its `#`), again whenever it changes. It never reaches the server. */
export function useLocationHash(): string {
  return useSyncExternalStore(subscribe, hash);
}
