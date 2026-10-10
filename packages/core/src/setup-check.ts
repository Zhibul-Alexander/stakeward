import type { Address } from '@solana/kit';
import { EXPIRING_THRESHOLD_SECONDS } from './constants.ts';
import type { StakeAccount } from './decode.ts';
import { isLockupInForce, validateSecondKey, type ClockView, type SecondKeyViolation } from './lockup.ts';

/**
 * "Protection check" of /app (DECISIONS.md D125): a fixed checklist over one main key's stake, computed from chain data
 * and what the page already knows. Deterministic: no AI decides anything; the AI block under it only explains the
 * result. Pure, so the same input always gives the same checklist.
 */

export type SetupCheckId = 'locked' | 'not-ending' | 'second-key' | 'alerts' | 'rescue-kit' | 'staker' | 'recovery-card';

/**
 * `pass` and `fail` count toward the score (when the check is scored); `unknown` (the site cannot tell, or a lookup
 * failed), `not-applicable` (nothing to check) and `info` (a reminder, never scored) do not.
 */
export type SetupCheckStatus = 'pass' | 'fail' | 'unknown' | 'not-applicable' | 'info';

/** Why one account is listed under a check. */
export type SetupCheckReason =
  /** `locked`: no lock in force (or one the main key holds itself, which is no lock: D14). */
  | 'no-lock'
  /** `not-ending`: the lock ends within 30 days. */
  | 'ends-soon'
  /** `second-key`: the lock's second key breaks a rule of CLAUDE.md section 5. */
  | SecondKeyViolation
  /** `second-key`: this browser knows second keys, and none of them holds this lock (D35, D102). */
  | 'locked-by-other'
  /** `second-key`: this browser knows no second key yet, so it cannot tell whose key holds the lock. */
  | 'second-key-not-known'
  /** `rescue-kit`: no ready one-tap rescue kit for this locked account (D118). */
  | 'no-kit'
  /** `rescue-kit`: the kit's status could not be read. */
  | 'kit-unknown'
  /** `staker`: another stake key under a lock: what a thief with the main key changes first (SECURITY-CHECK П6). */
  | 'staker-changed'
  /** `staker`: another stake key, no lock: a staking service may manage the stake (CLAUDE.md section 5). */
  | 'managed-by-service'
  /** `recovery-card`: a lock whose card can be printed. */
  | 'card';

export type SetupCheckFinding = { account: Address; reason: SetupCheckReason };

export type SetupCheckItem = {
  id: SetupCheckId;
  status: SetupCheckStatus;
  /** The accounts behind the result: those that fail (or are unknown), or for `info` those it points at. */
  findings: SetupCheckFinding[];
  /** Counts toward "N of M checks pass" when it passes or fails. */
  scored: boolean;
  /** Good to have, not needed for the lock to work (one-tap rescue). */
  optional: boolean;
};

/** A rescue kit as the worker reports it (GET /api/rescue-kits): `ready` to send, or not; `unknown` if unread. */
export type KitCheckState = 'ready' | 'missing' | 'unknown';

export type SetupCheckInput = {
  /** The main key whose stake is checked. */
  mainKey: Address;
  /** Stake accounts read from the chain; only those whose main key (withdrawer) is `mainKey` are checked. */
  accounts: readonly StakeAccount[];
  clock: ClockView;
  /** Second keys this browser knows (D14). */
  knownSecondKeys: readonly Address[];
  /** One-tap rescue kits by stake account; a missing entry is `unknown`. */
  rescueKits: Readonly<Partial<Record<Address, KitCheckState>>>;
  /**
   * Whether Telegram alerts are linked for `mainKey`. The site cannot know it today: /api/accounts leaves it out on
   * purpose (anyone could learn whether a wallet gets alerts), so the page passes nothing and the check is `unknown`.
   */
  alerts?: 'linked' | 'not-linked' | undefined;
};

export type SetupCheck = {
  /** Always the seven checks, in this order: locked, not-ending, second-key, alerts, rescue-kit, staker, recovery-card. */
  items: SetupCheckItem[];
  /** Scored checks that pass. */
  passed: number;
  /** Scored checks that pass or fail. */
  total: number;
  /** Accounts of the main key and their SOL. */
  accountCount: number;
  lamports: bigint;
  /** Of them, under a lock in force held by another key than the main key. */
  lockedCount: number;
  lockedLamports: bigint;
};

/** A lock that counts as one: in force, and not held by the main key itself (core `scannerStatus`). */
function hasLock(account: StakeAccount, clock: ClockView): boolean {
  return isLockupInForce(account.lockup, clock) && account.lockup.custodian !== account.withdrawer;
}

/** The lock ends within 30 days (the same rule as Expiring soon: a lock its epoch holds never is). */
function endsSoon(account: StakeAccount, clock: ClockView): boolean {
  const { lockup } = account;
  return (
    lockup.epoch <= clock.epoch &&
    lockup.unixTimestamp > clock.unixTimestamp &&
    lockup.unixTimestamp - clock.unixTimestamp < EXPIRING_THRESHOLD_SECONDS
  );
}

function item(
  id: SetupCheckId,
  status: SetupCheckStatus,
  findings: SetupCheckFinding[],
  options: { scored?: boolean; optional?: boolean } = {},
): SetupCheckItem {
  return { id, status, findings, scored: options.scored ?? true, optional: options.optional ?? false };
}

/** Fails with any fail finding, else unknown with any unknown one, else passes; nothing to check: not applicable. */
function verdict(applicable: boolean, fails: number, unknowns: number): SetupCheckStatus {
  if (!applicable) return 'not-applicable';
  if (fails > 0) return 'fail';
  return unknowns > 0 ? 'unknown' : 'pass';
}

/** The checklist for `input.mainKey` (DECISIONS.md D125). */
export function setupCheck(input: SetupCheckInput): SetupCheck {
  const { clock, mainKey } = input;
  const unique = new Map<Address, StakeAccount>();
  for (const account of input.accounts) if (account.withdrawer === mainKey) unique.set(account.address, account);
  const owned = [...unique.values()].sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
  const locked = owned.filter((account) => hasLock(account, clock));
  const any = owned.length > 0;
  const anyLocked = locked.length > 0;

  // 1. Every account under a lock.
  const open = owned.filter((account) => !hasLock(account, clock)).map((account) => finding(account, 'no-lock'));
  const lockedItem = item('locked', verdict(any, open.length, 0), open);

  // 2. No lock ends within 30 days.
  const ending = locked.filter((account) => endsSoon(account, clock)).map((account) => finding(account, 'ends-soon'));
  const endingItem = item('not-ending', verdict(anyLocked, ending.length, 0), ending);

  // 3. The second key is a key of its own (section 5) and, once this browser knows the viewer's second keys, one of
  // them. A lock in force that the main key holds itself counts as no lock in check 1 and fails here too.
  const secondFails: SetupCheckFinding[] = [];
  const secondUnknown: SetupCheckFinding[] = [];
  for (const account of owned) {
    if (!isLockupInForce(account.lockup, clock)) continue;
    const violations = validateSecondKey({
      second: account.lockup.custodian,
      mainKey: account.withdrawer,
      staker: account.staker,
      stakeAccount: account.address,
    });
    const first = violations[0];
    if (first !== undefined) secondFails.push(finding(account, first));
    else if (input.knownSecondKeys.length === 0) secondUnknown.push(finding(account, 'second-key-not-known'));
    else if (!input.knownSecondKeys.includes(account.lockup.custodian)) secondFails.push(finding(account, 'locked-by-other'));
  }
  const anyInForce = owned.some((account) => isLockupInForce(account.lockup, clock));
  const secondItem = item('second-key', verdict(anyInForce, secondFails.length, secondUnknown.length), [
    ...secondFails,
    ...secondUnknown,
  ]);

  // 4. Telegram alerts: scored only when the site knows.
  const alertsStatus: SetupCheckStatus = !any
    ? 'not-applicable'
    : input.alerts === 'linked'
      ? 'pass'
      : input.alerts === 'not-linked'
        ? 'fail'
        : 'unknown';
  const alertsItem = item('alerts', alertsStatus, []);

  // 5. A one-tap rescue kit for each locked account (optional, D118).
  const noKit: SetupCheckFinding[] = [];
  const kitUnknown: SetupCheckFinding[] = [];
  for (const account of locked) {
    const kit = input.rescueKits[account.address] ?? 'unknown';
    if (kit === 'missing') noKit.push(finding(account, 'no-kit'));
    else if (kit === 'unknown') kitUnknown.push(finding(account, 'kit-unknown'));
  }
  const kitItem = item('rescue-kit', verdict(anyLocked, noKit.length, kitUnknown.length), [...noKit, ...kitUnknown], {
    optional: true,
  });

  // 6. The stake key is the main key.
  const otherStaker = owned
    .filter((account) => account.staker !== account.withdrawer)
    .map((account) => finding(account, hasLock(account, clock) ? 'staker-changed' : 'managed-by-service'));
  const stakerItem = item('staker', verdict(any, otherStaker.length, 0), otherStaker);

  // 7. The recovery card of each lock: a reminder, never scored.
  const cardItem = item(
    'recovery-card',
    anyLocked ? 'info' : 'not-applicable',
    locked.map((account) => finding(account, 'card')),
    { scored: false },
  );

  const items = [lockedItem, endingItem, secondItem, alertsItem, kitItem, stakerItem, cardItem];
  const scored = items.filter((entry) => entry.scored && (entry.status === 'pass' || entry.status === 'fail'));
  return {
    items,
    passed: scored.filter((entry) => entry.status === 'pass').length,
    total: scored.length,
    accountCount: owned.length,
    lamports: sum(owned),
    lockedCount: locked.length,
    lockedLamports: sum(locked),
  };
}

function finding(account: StakeAccount, reason: SetupCheckReason): SetupCheckFinding {
  return { account: account.address, reason };
}

function sum(accounts: readonly StakeAccount[]): bigint {
  return accounts.reduce((total, account) => total + account.lamports, 0n);
}
