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
};

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
        wasProtected: false,
      };
    });
  secondKeyViews.sort(byUrgency);

  // Protected or Expiring means the lock is held by a known second key (core `scannerStatus`, D14).
  const isLocked = (view: AccountView) => view.protection === 'protected' || view.protection === 'expiring';
  return {
    owned: ownedViews,
    secondKeyFor: secondKeyViews,
    totals: {
      count: ownedViews.length,
      lamports: sum(ownedViews),
      protectedLamports: sum(ownedViews.filter(isLocked)),
    },
    noLongerProtected: ownedViews.filter((view) => view.wasProtected).map((view) => view.account.address),
    confirmedProtected: ownedViews.filter(isLocked).map((view) => view.account.address),
    unconfirmedLock: ownedViews.some((view) => view.protection === 'locked-by-other'),
  };
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
  secondKey: (account: Address) => `/second-key/${account}`,
  withdraw: (account: Address) => `/withdraw/${account}`,
  rescue: (mainKey: Address) => `/rescue?${new URLSearchParams({ address: mainKey }).toString()}`,
};
