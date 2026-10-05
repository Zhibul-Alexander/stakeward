import type { Address } from '@solana/kit';
import { EXPIRING_THRESHOLD_SECONDS, U64_MAX } from './constants.ts';
import type { Delegation, StakeAccount } from './decode.ts';
import { isLockupInForce, type ClockView } from './lockup.ts';
import type { EpochInfo } from './ports.ts';

/** Milliseconds per slot for epoch-end estimates: the cluster's target (getRecentPerformanceSamples is not allowed). */
export const SLOT_MS_ESTIMATE = 400n;

/**
 * Estimated unix seconds when `targetEpoch` ends (default: the current epoch, `info.epoch`):
 * slotsLeft = (slotsInEpoch - slotIndex) + max(0, targetEpoch - epoch) x slotsInEpoch, then
 * nowSeconds + ceil(slotsLeft x 400 / 1000). A target epoch already over gives `nowSeconds`.
 * An estimate only: slots run slower or faster than 400 ms; before a Withdraw the real check is a simulation.
 */
export function epochEndEstimate(
  info: Pick<EpochInfo, 'epoch' | 'slotIndex' | 'slotsInEpoch'>,
  nowSeconds: bigint,
  targetEpoch: bigint = info.epoch,
): bigint {
  if (targetEpoch < info.epoch) return nowSeconds;
  const inThisEpoch = info.slotsInEpoch > info.slotIndex ? info.slotsInEpoch - info.slotIndex : 0n;
  const slotsLeft = inThisEpoch + (targetEpoch - info.epoch) * info.slotsInEpoch;
  return nowSeconds + (slotsLeft * SLOT_MS_ESTIMATE + 999n) / 1000n;
}

export type ActivationStatus = 'inactive' | 'activating' | 'active' | 'deactivating';

/**
 * Stake status from epochs only (CLAUDE.md section 5). Warmup/cooldown math from stake history is deliberately not
 * ported: before a Withdraw the real check is a simulation.
 *
 * One deviation from the literal section 5 rules: a bootstrap (genesis) delegation stores activation epoch u64::MAX
 * and the stake program treats it as fully active from the start (`Delegation::is_bootstrap`). While it is not being
 * deactivated its deactivation epoch is u64::MAX too, which the first rule would call inactive; it is active.
 */
export function stakeActivationStatus(delegation: Delegation | null, currentEpoch: bigint): ActivationStatus {
  if (delegation === null) return 'inactive';
  const { activationEpoch, deactivationEpoch } = delegation;
  const bootstrap = activationEpoch === U64_MAX;
  if (!bootstrap && activationEpoch === deactivationEpoch) return 'inactive';
  if (deactivationEpoch === U64_MAX) return !bootstrap && activationEpoch >= currentEpoch ? 'activating' : 'active';
  if (deactivationEpoch >= currentEpoch) return 'deactivating';
  return 'inactive';
}

export type ProtectionStatus = 'unprotected' | 'protected' | 'expiring' | 'locked-by-other';

export type ScannerView = {
  status: ProtectionStatus;
  /** staker != withdrawer: a service (e.g. Marinade Native) may manage this stake and may break under a lockup. */
  managedByService: boolean;
};

/**
 * What the scanner shows for an account whose withdrawer is the viewer (CLAUDE.md section 5, DECISIONS.md D14).
 *
 * - `unprotected`: the lockup is not in force, or its custodian is the withdrawer itself (the main key alone can lift
 *   such a lock, so it protects nothing; the protect flow works on it because the main key signs as custodian).
 * - `protected` / `expiring`: in force and the custodian is one of `secondKeys`; `expiring` when the lockup timestamp
 *   is less than 30 days after `clock.unixTimestamp` and the lockup epoch does not hold the lock. A lock its epoch
 *   holds (now or past its timestamp) is never `expiring`.
 * - `locked-by-other`: in force and the custodian is not one of the viewer's known second keys; view only. With no
 *   second key known (a fresh device, a view by address) that is every lock: the chain cannot say whose key holds it,
 *   and a lock someone else set (CLAUDE.md section 11: a fake site that makes the thief the second key) must never
 *   read as Protected. The page offers to connect the second key instead.
 *
 * The chain cannot say which custodian belongs to the viewer. The caller passes the second keys it knows for this
 * viewer (the wallet in the "second" slot, second keys remembered on this device).
 * `clock.unixTimestamp` is the current time in seconds (cluster clock, or the local clock when that is not at hand).
 */
export function scannerStatus(
  account: StakeAccount,
  secondKeys: readonly Address[],
  clock: ClockView,
): ScannerView {
  const managedByService = account.staker !== account.withdrawer;
  const { lockup } = account;
  if (!isLockupInForce(lockup, clock) || lockup.custodian === account.withdrawer) {
    return { status: 'unprotected', managedByService };
  }
  if (!secondKeys.includes(lockup.custodian)) return { status: 'locked-by-other', managedByService };
  // A lock its epoch holds does not end at its timestamp, so it is never Expiring.
  const expiring =
    lockup.epoch <= clock.epoch &&
    lockup.unixTimestamp > clock.unixTimestamp &&
    lockup.unixTimestamp - clock.unixTimestamp < EXPIRING_THRESHOLD_SECONDS;
  return { status: expiring ? 'expiring' : 'protected', managedByService };
}

/** Why the protect flow cannot lock a stake account now. */
export type ProtectBlock = 'not-main-key' | 'already-protected' | 'locked-by-other';

/**
 * Why the protect flow cannot lock `account` for `mainKey` now; null = it can.
 * - The withdrawer is not `mainKey` -> `not-main-key`.
 * - The lockup is in force and its custodian is not the withdrawer: the custodian is one of `secondKeys` ->
 *   `already-protected` (only an extend can change it), otherwise -> `locked-by-other`.
 * - Otherwise null: no lock, an ended lock, or a lock held by the main key itself (D14: the main key signs the
 *   SetLockupChecked as custodian).
 */
export function protectBlock(
  account: StakeAccount,
  mainKey: Address,
  secondKeys: readonly Address[],
  clock: ClockView,
): ProtectBlock | null {
  if (account.withdrawer !== mainKey) return 'not-main-key';
  const { lockup } = account;
  if (isLockupInForce(lockup, clock) && lockup.custodian !== account.withdrawer) {
    return secondKeys.includes(lockup.custodian) ? 'already-protected' : 'locked-by-other';
  }
  return null;
}

/**
 * Splits accounts found for `viewer` into the main list (viewer is the withdrawer) and the separate
 * "You are the second key for" list (viewer is only the custodian). Accounts where the viewer has neither role
 * (for example only the staker) are in neither list.
 */
export function groupForViewer(
  accounts: readonly StakeAccount[],
  viewer: Address,
): { owned: StakeAccount[]; secondKeyFor: StakeAccount[] } {
  const owned: StakeAccount[] = [];
  const secondKeyFor: StakeAccount[] = [];
  for (const account of accounts) {
    if (account.withdrawer === viewer) owned.push(account);
    else if (account.lockup.custodian === viewer) secondKeyFor.push(account);
  }
  return { owned, secondKeyFor };
}
