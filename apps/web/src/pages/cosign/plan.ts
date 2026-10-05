import type { Address } from '@solana/kit';
import {
  actionApplied,
  actionRoles,
  actionTarget,
  decodeStakeAccount,
  isLockupInForce,
  readNonceAccount,
  type StakeAccount,
  type TransactionAction,
  type TransactionSummary,
  type WalletRole,
} from '@stakeward/core';
import { t } from '@/i18n';
import type { SessionOptions } from '@/signing/session';
import type { JobPlan, SigningPlan } from '@/signing/types';

/** Why /cosign will not sign a link's transaction now; the page says it with `cosignRefusalText`. */
export type CosignRefusal = 'not-found' | 'not-stake-account' | 'link-used' | 'stale' | 'already-locked';

const REFUSALS: readonly CosignRefusal[] = ['not-found', 'not-stake-account', 'link-used', 'stale', 'already-locked'];

/**
 * The /cosign plan (DECISIONS.md D69): the link's partly signed bytes, signed here as they are (the engine inspects
 * and simulates them again, never rebuilds them). No `nonce` and no `remote`: the bytes carry the nonce, and every
 * remaining signer signs on this device. Every round reads the stake account and the link's nonce account together
 * (one call, one slot) with the clock; the first match decides:
 * 1. the chain already shows the change -> done (the link was used already: nothing to sign);
 * 2. no stake account -> not-found; 3. not a stake account -> not-stake-account;
 * 4. the nonce account no longer holds the link's value (used, cancelled, closed) -> link-used;
 * 5. the stake's main key is not the one the link names (a rescue ran first, or a second-key hand-over phish) -> stale;
 * 6. a protect over a lock in force -> already-locked. While a lock holds, the program lets its second key set any end
 *    when it signs, and a protect link asks exactly that key to sign: a thief with only the main key could end the lock
 *    this way. Stakeward never makes such a link (the protect wizard refuses a locked account);
 * 7. otherwise sign the bytes, with the account as read (the summary shows what was and what becomes).
 */
export function cosignPlan(bytes: Uint8Array, summary: TransactionSummary): SigningPlan {
  const { action, lifetime } = summary;
  const target = actionTarget(action);
  return {
    async prepare(chain, ids) {
      const nonce = lifetime.kind === 'nonce' ? lifetime : null;
      const reads: Address[] = nonce === null ? [target] : [target, nonce.nonceAccount];
      const [{ accounts }, clock] = await Promise.all([chain.getAccounts(reads), chain.getClock()]);
      const targetRaw = accounts[0] ?? null;
      const nonceRaw = accounts[1] ?? null;
      const decide = (): JobPlan => {
        const decoded = targetRaw === null ? null : decodeStakeAccount(targetRaw);
        const account: StakeAccount | null = decoded?.ok === true ? decoded.account : null;
        if (actionApplied(action, targetRaw, null)) return { kind: 'done', after: account };
        if (targetRaw === null) return { kind: 'refused', reason: 'not-found', before: null };
        if (account === null) return { kind: 'refused', reason: 'not-stake-account', before: null };
        const read = nonce === null ? null : readNonceAccount(nonceRaw, nonce.nonceAuthority);
        // Without a nonce the engine refuses the bytes itself (a link always has one, read.ts checked it).
        if (nonce !== null && (read?.kind !== 'ready' || read.value !== nonce.nonceValue)) {
          return { kind: 'refused', reason: 'link-used', before: account };
        }
        if (!('mainKey' in action) || account.withdrawer !== action.mainKey) {
          return { kind: 'refused', reason: 'stale', before: account };
        }
        if (action.kind === 'protect' && isLockupInForce(account.lockup, clock)) {
          return { kind: 'refused', reason: 'already-locked', before: account };
        }
        return { kind: 'bytes', bytes, before: account };
      };
      const plan = decide();
      return { clock, jobs: Object.fromEntries(ids.map((id) => [id, id === target ? plan : refusedOther])) };
    },
  };
}

/** An id that is not the link's stake account (never asked for by the page). */
const refusedOther: JobPlan = { kind: 'refused', reason: 'not-found', before: null };

/**
 * Signers on /cosign are named by the link's action, not by this device's slots: the wallet that holds the second key
 * here may sit in any slot of this browser (it may be someone's main key for their own stake). The wallet still comes
 * from `base` (the slots); only the role is the action's when the action names that address.
 */
export function cosignResolver(base: SessionOptions['resolveSigner'], action: TransactionAction): SessionOptions['resolveSigner'] {
  const named = new Map<Address, WalletRole>();
  for (const [role, address] of Object.entries(actionRoles(action)) as [WalletRole, Address | undefined][]) {
    if (address !== undefined && !named.has(address)) named.set(address, role);
  }
  return (address, hint) => {
    const role = named.get(address);
    const resolution = base(address, role ?? hint);
    return role === undefined ? resolution : { ...resolution, role };
  };
}

function isRefusal(reason: string): reason is CosignRefusal {
  return (REFUSALS as readonly string[]).includes(reason);
}

/** The refusal in plain words; an unknown reason reads as an unknown error. */
export function cosignRefusalText(reason: string): string {
  return isRefusal(reason) ? t(`cosign.refused.${reason}`) : t('errors.unknown');
}
