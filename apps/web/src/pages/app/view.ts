import type { Address } from '@solana/kit';
import {
  groupForViewer,
  isLockupInForce,
  scannerStatus,
  stakeActivationStatus,
  type ActivationStatus,
  type ClockView,
  type ProtectionStatus,
  type StakeAccount,
} from '@stakeward/core';

/** One row of the accounts page: the account and what core says about it. */
export type AccountView = {
  account: StakeAccount;
  activation: ActivationStatus;
  protection: ProtectionStatus;
  managedByService: boolean;
  /** This browser knows a second key for the account's main key (AccountRow words a lock none of them holds by it). */
  secondKeyKnown: boolean;
  /** F6: remembered on this device as protected and now without a lock. */
  wasProtected: boolean;
};

export type AccountsView = {
  /** Accounts whose main key (withdrawer) is the address, most urgent first. */
  owned: AccountView[];
  /** Accounts whose lock the address holds as second key (custodian), lock in force, other main key. */
  secondKeyFor: AccountView[];
  totals: { count: number; lamports: bigint; protectedLamports: bigint };
  /** F6: owned accounts remembered as protected that now stand without a lock. */
  noLongerProtected: Address[];
  /** Owned accounts protected by a known second key: the page remembers them for F6. */
  confirmedProtected: Address[];
  /**
   * Some owned lock is held by a key that is none of the viewer's known second keys (always the case with none known):
   * offer to connect the second key.
   */
  unconfirmedLock: boolean;
  /**
   * SOL of owned accounts locked by a second key while this browser knows none (a new device): said next to the total,
   * never added to the protected SOL (D14, D35, D102).
   */
  lockedUnconfirmedLamports: bigint;
  /** The rows grouped by what they ask of the viewer, each group most urgent first (DECISIONS.md D109). */
  groups: AccountGroups;
  /** The screen's one filled button, or none when nothing needs doing (D109). */
  primaryAction: PrimaryAction;
};

/**
 * The page's groups. Every owned row is in exactly one of the first three; the fourth is `secondKeyFor`.
 */
export type AccountGroups = {
  /**
   * What to act on: locks that ended (F6), locks that end soon, accounts without a lock, and locked accounts whose stake
   * key is another key (a thief with the main key changes it first, SECURITY-CHECK П6).
   */
  attention: AccountView[];
  /** Locked by a second key this browser knows, nothing to do. */
  protected: AccountView[];
  /** Locked by a key this browser does not hold: view only (D14, D35, D102). */
  locked: AccountView[];
  /** The address holds their lock as second key. */
  secondKeyFor: AccountView[];
};

/**
 * The screen's one filled button (D109), most urgent first: the F6 banner's Protect again, then Rescue on the first
 * row whose stake key changed under the viewer's own lock (the sign of a stolen main key, SECURITY-CHECK П6), then
 * protecting the accounts of Needs attention in one go, then extending the lock that ends first.
 */
export type PrimaryAction =
  | { kind: 'protect-again'; accounts: Address[] }
  | { kind: 'rescue'; account: Address }
  | { kind: 'protect-group'; accounts: Address[] }
  | { kind: 'extend'; account: Address }
  | null;

export type AccountsViewInput = {
  /** The main key whose stake is shown. */
  address: Address;
  /** Stake accounts found by withdrawer and by custodian (duplicates allowed). */
  accounts: readonly StakeAccount[];
  clock: ClockView;
  /** The viewer's known second keys (DECISIONS.md D14). */
  knownSecondKeys: readonly Address[];
  /** Stake accounts remembered on this device as protected. */
  rememberedProtected: readonly Address[];
};

/** Most urgent first: a lock that ended (F6), then expiring, unprotected, protected, someone else's. */
const ORDER: Record<ProtectionStatus | 'was-protected', number> = {
  'was-protected': 0,
  expiring: 1,
  unprotected: 2,
  protected: 3,
  'locked-by-other': 4,
};

/**
 * Everything the accounts page shows, from chain data only plus two lists kept on this device (known second keys,
 * accounts seen protected). Pure, so the page stays reload-safe (CLAUDE.md section 5): the same input gives the same
 * screen.
 */
export function buildAccountsView(input: AccountsViewInput): AccountsView {
  const { address, clock } = input;
  const unique = new Map<Address, StakeAccount>();
  for (const account of input.accounts) unique.set(account.address, account);
  const { owned, secondKeyFor } = groupForViewer([...unique.values()], address);

  const ownedViews = owned.map((account) => {
    const view = scannerStatus(account, input.knownSecondKeys, clock);
    return {
      account,
      activation: stakeActivationStatus(account.delegation, clock.epoch),
      protection: view.status,
      managedByService: view.managedByService,
      secondKeyKnown: input.knownSecondKeys.length > 0,
      wasProtected: view.status === 'unprotected' && input.rememberedProtected.includes(account.address),
    };
  });
  ownedViews.sort(byUrgency);

  // The address is the second key of these; a lock that ended gives it no say over the account any more.
  const secondKeyViews = secondKeyFor
    .filter((account) => isLockupInForce(account.lockup, clock))
    .map((account) => {
      const view = scannerStatus(account, [address], clock);
      return {
        account,
        activation: stakeActivationStatus(account.delegation, clock.epoch),
        protection: view.status,
        managedByService: view.managedByService,
        // The address holds these locks itself.
        secondKeyKnown: true,
        wasProtected: false,
      };
    });
  secondKeyViews.sort(byUrgency);

  // Protected or Expiring means the lock is held by a known second key (core `scannerStatus`, D14).
  const isLocked = (view: AccountView) => view.protection === 'protected' || view.protection === 'expiring';
  const groups = groupAccounts(ownedViews, secondKeyViews);
  const noLongerProtected = ownedViews.filter((view) => view.wasProtected).map((view) => view.account.address);
  return {
    owned: ownedViews,
    secondKeyFor: secondKeyViews,
    totals: {
      count: ownedViews.length,
      lamports: sum(ownedViews),
      protectedLamports: sum(ownedViews.filter(isLocked)),
    },
    noLongerProtected,
    confirmedProtected: ownedViews.filter(isLocked).map((view) => view.account.address),
    unconfirmedLock: ownedViews.some((view) => view.protection === 'locked-by-other'),
    lockedUnconfirmedLamports: sum(groups.locked.filter((view) => !view.secondKeyKnown)),
    groups,
    primaryAction: choosePrimaryAction(noLongerProtected, groups),
  };
}

/** Another stake key under the viewer's own lock: what a thief with the main key does first (SECURITY-CHECK П6). */
export function stakeKeyChanged(view: AccountView): boolean {
  return view.managedByService && (view.protection === 'protected' || view.protection === 'expiring');
}

/**
 * The accounts of Needs attention that "Protect N accounts" takes to the wizard: every one without a lock, except
 * those a staking service may manage (the lock may stop the service; their own row keeps its Protect).
 */
export function protectableInGroup(attention: readonly AccountView[]): Address[] {
  return attention
    .filter((view) => view.protection === 'unprotected' && !view.managedByService)
    .map((view) => view.account.address);
}

/**
 * What Needs attention says once for its rows (D109), worded so it is true of every row it covers: without a lock the
 * main key alone withdraws now (`open`); a lock that ends soon allows it once it ends (`ending`); both kinds, or open
 * rows next to a changed stake key, get the sentence that covers both (`open-or-ending`). A changed stake key alone
 * says its own warning on the row (null).
 */
export function attentionNote(attention: readonly AccountView[]): 'open' | 'ending' | 'open-or-ending' | null {
  const open = attention.some((view) => view.protection === 'unprotected');
  const locked = attention.some((view) => view.protection !== 'unprotected');
  if (open) return locked ? 'open-or-ending' : 'open';
  return attention.some((view) => view.protection === 'expiring') ? 'ending' : null;
}

/** Groups keep the order of their input, which is already most urgent first. */
function groupAccounts(owned: readonly AccountView[], secondKeyFor: AccountView[]): AccountGroups {
  const groups: AccountGroups = { attention: [], protected: [], locked: [], secondKeyFor };
  for (const view of owned) {
    if (view.protection === 'locked-by-other') groups.locked.push(view);
    else if (view.protection === 'protected' && !stakeKeyChanged(view)) groups.protected.push(view);
    else groups.attention.push(view);
  }
  return groups;
}

function choosePrimaryAction(noLongerProtected: Address[], groups: AccountGroups): PrimaryAction {
  if (noLongerProtected.length > 0) return { kind: 'protect-again', accounts: noLongerProtected };
  // Never a calm Extend, least of all on another wallet's stake, while the viewer's own stake shows this warning.
  const changed = groups.attention.find(stakeKeyChanged);
  if (changed !== undefined) return { kind: 'rescue', account: changed.account.address };
  const protectable = protectableInGroup(groups.attention);
  if (protectable.length > 0) return { kind: 'protect-group', accounts: protectable };
  // The lock that ends first, of the viewer's own stake or of a stake whose lock the address holds.
  let first: AccountView | null = null;
  for (const view of [...groups.attention, ...groups.secondKeyFor]) {
    if (view.protection !== 'expiring') continue;
    if (first === null || view.account.lockup.unixTimestamp < first.account.lockup.unixTimestamp) first = view;
  }
  return first === null ? null : { kind: 'extend', account: first.account.address };
}

function byUrgency(a: AccountView, b: AccountView): number {
  const rank = (view: AccountView) => ORDER[view.wasProtected ? 'was-protected' : view.protection];
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (a.account.lamports !== b.account.lamports) return a.account.lamports > b.account.lamports ? -1 : 1;
  return a.account.address < b.account.address ? -1 : a.account.address > b.account.address ? 1 : 0;
}

function sum(views: readonly AccountView[]): bigint {
  return views.reduce((total, view) => total + view.account.lamports, 0n);
}

/** Routes the row actions lead to (CLAUDE.md section 9). */
export const appLinks = {
  /** The protect wizard with these accounts selected (`account` repeated for several). */
  protect: (accounts: readonly Address[]) => `/protect?${new URLSearchParams(accounts.map((a) => ['account', a])).toString()}`,
  extend: (account: Address) => `/extend/${account}`,
  withdraw: (account: Address) => `/withdraw/${account}`,
  rescue: (mainKey: Address) => `/rescue?${new URLSearchParams({ address: mainKey }).toString()}`,
  /** The recovery card of the pair of keys that locks this account (DECISIONS.md D74). */
  recovery: (account: Address) => `/recovery/${account}`,
};
