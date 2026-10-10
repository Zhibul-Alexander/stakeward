import type { Address } from '@solana/kit';
import {
  deriveNonceAccountAddress,
  NONCE_ACCOUNT_SEED,
  NONCE_ACCOUNT_SIZE,
  readNonceAccount,
  type ChainPort,
  type NonceAccountState,
} from '@stakeward/core';
import { useLoad, type Load } from '@/hooks/use-load';
import { t } from '@/i18n';
import type { JobPlan, SigningPlan } from './types.ts';

/**
 * The link-signing account (a durable nonce, CLAUDE.md section 6) of one key: its address (derived from the key, so it
 * is never stored), its state on the chain, and the deposit a new one locks (rent for NONCE_ACCOUNT_SIZE bytes).
 */
export type NonceInfo = { address: Address; state: NonceAccountState; deposit: bigint };

/**
 * Reads the nonce account of `authority` and the deposit it needs, in one round of calls. `seed` picks another account
 * of the same key: a one-tap rescue kit's (core `rescueKitNonceSeed`, D118).
 */
export async function readNonceInfo(chain: ChainPort, authority: Address, seed: string = NONCE_ACCOUNT_SEED): Promise<NonceInfo> {
  const address = await deriveNonceAccountAddress(authority, seed);
  const [{ accounts }, deposit] = await Promise.all([
    chain.getAccounts([address]),
    chain.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_SIZE),
  ]);
  return { address, state: readNonceAccount(accounts[0] ?? null, authority), deposit };
}

/** The nonce account of `authority` as a load (null: nothing to read yet). A new `attempt` reads it again. */
export function useNonceAccount(
  chain: ChainPort,
  authority: Address | null,
  attempt: number,
  seed: string = NONCE_ACCOUNT_SEED,
): Load<NonceInfo> {
  return useLoad(authority === null ? null : `nonce#${authority}#${seed}#${String(attempt)}`, () =>
    readNonceInfo(chain, authority as Address, seed),
  );
}

/** Why the plan will not set up or close the account: something else already holds its address. */
export type NonceRefusal = 'nonce-unusable';

/**
 * Create (`setup`) or close the link-signing account of `authority`, which signs and pays alone on a recent blockhash.
 * Every round reads the account, the deposit and the clock again; the first match decides:
 * - setup: ready -> done; missing -> build nonce-setup with the deposit; unusable -> refused nonce-unusable.
 * - close: ready -> build nonce-close returning its whole balance to `authority`; missing -> done; unusable -> refused.
 * The only job is `nonceAccount`. The inspector's summary shows the deposit and that it cannot touch any stake.
 */
export function noncePlan(input: {
  authority: Address;
  nonceAccount: Address;
  mode: 'setup' | 'close';
  seed?: string | undefined;
}): SigningPlan {
  const { authority, nonceAccount, mode, seed = NONCE_ACCOUNT_SEED } = input;
  return {
    async prepare(chain) {
      const [{ accounts }, rent, clock] = await Promise.all([
        chain.getAccounts([nonceAccount]),
        chain.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_SIZE),
        chain.getClock(),
      ]);
      const state = readNonceAccount(accounts[0] ?? null, authority);
      return { clock, jobs: { [nonceAccount]: decide(state, rent) } };
    },
  };

  function decide(state: NonceAccountState, rent: bigint): JobPlan {
    if (state.kind === 'unusable') return { kind: 'refused', reason: 'nonce-unusable', before: null };
    if (mode === 'setup') {
      if (state.kind === 'ready') return { kind: 'done', after: null };
      return {
        kind: 'build',
        action: { kind: 'nonce-setup', nonceAccount, nonceAuthority: authority, seed, lamports: rent },
        feePayer: authority,
        before: null,
      };
    }
    if (state.kind === 'missing') return { kind: 'done', after: null };
    return {
      kind: 'build',
      action: { kind: 'nonce-close', nonceAccount, nonceAuthority: authority, recipient: authority, lamports: state.lamports },
      feePayer: authority,
      before: null,
    };
  }
}

/** The refusal in plain words; an unknown reason reads as an unknown error. */
export function nonceRefusalText(reason: string): string {
  return reason === 'nonce-unusable' ? t('nonce.blocked') : t('errors.unknown');
}
