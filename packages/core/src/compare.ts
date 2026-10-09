import type { TransactionAction } from './actions.ts';
import type { InspectedLifetime, LighthouseTail, TransactionSummary } from './inspect.ts';

/** Same kind and every field strictly equal (addresses, bigints, null). */
export function actionsEqual(a: TransactionAction, b: TransactionAction): boolean {
  return a.kind === b.kind && sameFields(a, b);
}

/**
 * True when there are 2 or more summaries and they differ only in `action.stakeAccount`: same action kind and fields
 * (stakeAccount blanked), feePayer, requiredSigners (same list), presentSignatures (same list), networkFeeLamports,
 * computeBudget, lifetime (kind and every field) and lighthouseTail (both null, or same instructionCount and
 * addedAccounts). Actions without stakeAccount (nonce kinds) -> false. The signing screen then shows one summary for
 * the whole batch instead of one per transaction.
 */
export function summariesMatchExceptStakeAccount(summaries: readonly TransactionSummary[]): boolean {
  const [first, ...rest] = summaries;
  if (first === undefined || rest.length === 0) return false;
  return summaries.every((summary) => 'stakeAccount' in summary.action && sameExceptStakeAccount(first, summary));
}

function sameExceptStakeAccount(a: TransactionSummary, b: TransactionSummary): boolean {
  return (
    a.action.kind === b.action.kind &&
    sameFields({ ...a.action, stakeAccount: null }, { ...b.action, stakeAccount: null }) &&
    a.feePayer === b.feePayer &&
    sameList(a.requiredSigners, b.requiredSigners) &&
    sameList(a.presentSignatures, b.presentSignatures) &&
    a.networkFeeLamports === b.networkFeeLamports &&
    a.computeBudget.unitLimit === b.computeBudget.unitLimit &&
    a.computeBudget.microLamportsPerUnit === b.computeBudget.microLamportsPerUnit &&
    sameLifetime(a.lifetime, b.lifetime) &&
    sameTail(a.lighthouseTail, b.lighthouseTail)
  );
}

function sameLifetime(a: InspectedLifetime, b: InspectedLifetime): boolean {
  return a.kind === b.kind && sameFields(a, b);
}

function sameTail(a: LighthouseTail | null, b: LighthouseTail | null): boolean {
  if (a === null || b === null) return a === b;
  return a.instructionCount === b.instructionCount && sameList(a.addedAccounts, b.addedAccounts);
}

/** Same own keys, every value strictly equal. The values compared here are primitives only. */
function sameFields(a: object, b: object): boolean {
  const left = Object.entries(a);
  if (left.length !== Object.keys(b).length) return false;
  const right = new Map<string, unknown>(Object.entries(b));
  return left.every(([key, value]) => right.has(key) && right.get(key) === value);
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
