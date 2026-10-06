import type { Address } from '@solana/kit';
import {
  isLockupInForce,
  networkFeeFor,
  ZERO_ADDRESS,
  type ChainClock,
  type ClockView,
  type StakeAccount,
  type WalletSlots,
} from '@stakeward/core';
import { retryableOutcomes } from '@/pages/account/check';
import type { JobState, JobView } from '@/signing/machine';
import type { SignMode } from '@/signing/SignWhere';

/**
 * The rescue wizard's rules and state (F4, DECISIONS.md D70), pure. Nothing is stored: the main key comes from the
 * address (`?address=`), the main key slot or the field; the new wallet and the second key from the key slots and the
 * chain. Back keeps what was entered; a reload starts again with fresh reads.
 */

export type RescueStep = 'stake' | 'new-wallet' | 'keys' | 'move' | 'done';

/** The order StepProgress shows. */
export const RESCUE_STEPS: readonly RescueStep[] = ['stake', 'new-wallet', 'keys', 'move', 'done'];

/** What the new wallet should hold before the move: enough for every fee here, the deposit and a margin. */
export const SUGGESTED_RESCUE_LAMPORTS = 10_000_000n;

/** Stake accounts one run moves (each one is its own transaction on the new wallet's nonce). */
export const MAX_RESCUE_ACCOUNTS = 10;

/** Locks that end this soon are named on the first screen: finish the move before then. */
export const ENDS_SOON_SECONDS = 7n * 86_400n;

/**
 * The main key's stake accounts by what this run can do with them, for the second key `secondKey` (null: none chosen):
 * - `unsupported`: a lock in force held by the main key itself or by no key; Stakeward cannot move it;
 * - `otherKey`: a lock in force held by another key than `secondKey` (another run, with that key);
 * - `movable`: the rest (no lock in force, or one `secondKey` holds), most urgent first: unlocked (anyone with the main
 *   key can withdraw them now), then by lock end (locks an epoch holds, which have no date, after those that end on a
 *   date, by epoch), then the larger balance first.
 */
export type RescueGroups = { movable: StakeAccount[]; otherKey: StakeAccount[]; unsupported: StakeAccount[] };

export function rescueGroups(
  accounts: readonly StakeAccount[],
  mainKey: Address,
  secondKey: Address | null,
  clock: ClockView,
): RescueGroups {
  const groups: RescueGroups = { movable: [], otherKey: [], unsupported: [] };
  for (const account of accounts) {
    const { lockup } = account;
    if (!isLockupInForce(lockup, clock)) groups.movable.push(account);
    else if (lockup.custodian === mainKey || lockup.custodian === ZERO_ADDRESS) groups.unsupported.push(account);
    else if (secondKey === null || lockup.custodian !== secondKey) groups.otherKey.push(account);
    else groups.movable.push(account);
  }
  groups.movable.sort((a, b) => {
    const aLocked = isLockupInForce(a.lockup, clock);
    const bLocked = isLockupInForce(b.lockup, clock);
    if (aLocked !== bLocked) return aLocked ? 1 : -1;
    if (aLocked) {
      const aDate = lockEndDate(a, clock);
      const bDate = lockEndDate(b, clock);
      if ((aDate === null) !== (bDate === null)) return aDate === null ? 1 : -1;
      if (aDate !== null && bDate !== null && aDate !== bDate) return aDate < bDate ? -1 : 1;
      if (aDate === null && a.lockup.epoch !== b.lockup.epoch) return a.lockup.epoch < b.lockup.epoch ? -1 : 1;
    }
    if (a.lamports !== b.lamports) return a.lamports > b.lamports ? -1 : 1;
    return 0;
  });
  return groups;
}

/**
 * The date a lock in force ends, when a date is what holds it; null when no lock is in force or an epoch holds it (its
 * timestamp is then 0 or already past, or the epoch may outlast it): the screen never states a date the lock lacks.
 */
export function lockEndDate(account: StakeAccount, clock: ClockView): bigint | null {
  const { lockup } = account;
  return lockup.unixTimestamp > clock.unixTimestamp && lockup.epoch <= clock.epoch ? lockup.unixTimestamp : null;
}

/** Second keys that hold a lock in force on the main key's stake (not the main key, not the zero key), most SOL first. */
export function secondKeyChoices(accounts: readonly StakeAccount[], mainKey: Address, clock: ClockView): Address[] {
  const locked = new Map<Address, bigint>();
  for (const { lockup, lamports } of accounts) {
    if (!isLockupInForce(lockup, clock) || lockup.custodian === mainKey || lockup.custodian === ZERO_ADDRESS) continue;
    locked.set(lockup.custodian, (locked.get(lockup.custodian) ?? 0n) + lamports);
  }
  return [...locked.entries()].sort((a, b) => (a[1] === b[1] ? 0 : a[1] > b[1] ? -1 : 1)).map(([custodian]) => custodian);
}

/**
 * Least SOL the new wallet needs for a run of `count` stake accounts: the nonce account's deposit and its setup fee
 * (unless it is ready), per account the rescue (three signatures) and a later delegation (one), the nonce close, and the
 * minimum balance a wallet that keeps SOL must keep (core canPayFee).
 */
export function rescueMinimum(input: { count: number; nonceReady: boolean; nonceDeposit: bigint; rentExempt0: bigint }): bigint {
  const { count, nonceReady, nonceDeposit, rentExempt0 } = input;
  const setup = nonceReady ? 0n : nonceDeposit + networkFeeFor(1);
  return setup + BigInt(count) * (networkFeeFor(3) + networkFeeFor(1)) + networkFeeFor(1) + rentExempt0;
}

export type NewWalletProblem = 'zero-key' | 'main-key' | 'second-key' | 'stake-account';

/** Why `d` cannot be the new wallet: the zero key, the (possibly stolen) main key, a second key, a stake account. */
export function newWalletProblems(
  d: Address,
  mainKey: Address,
  secondKeys: readonly Address[],
  accounts: readonly StakeAccount[],
): NewWalletProblem[] {
  const problems: NewWalletProblem[] = [];
  if (d === ZERO_ADDRESS) problems.push('zero-key');
  if (d === mainKey) problems.push('main-key');
  if (secondKeys.includes(d)) problems.push('second-key');
  if (accounts.some((account) => account.address === d)) problems.push('stake-account');
  return problems;
}

/** Every account each wallet app has offered this page so far, by wallet id (SECURITY-CHECK П5). */
export type OfferedAccounts = ReadonlyMap<string, readonly Address[]>;

/**
 * `seen` plus every account `wallets` offer now. A wallet app that shows one account at a time keeps what it showed
 * before the user switched it to another account. Never changes `seen`; returns it as is when nothing is new.
 */
export function addOfferedAccounts(
  seen: OfferedAccounts,
  wallets: readonly { readonly id: string; readonly accounts: readonly Address[] }[],
): OfferedAccounts {
  let next: Map<string, readonly Address[]> | null = null;
  for (const wallet of wallets) {
    const known = (next ?? seen).get(wallet.id) ?? [];
    const added = wallet.accounts.filter((address) => !known.includes(address));
    if (added.length === 0) continue;
    next ??= new Map(seen);
    next.set(wallet.id, [...known, ...added]);
  }
  return next ?? seen;
}

/** The keys of this rescue: the new wallet it moves to, the main key and the second keys that may co-sign. */
export type RescueKeys = { newWallet: Address | null; main: Address | null; second: readonly Address[] };

/**
 * The key roles that share a wallet app with the new wallet (SECURITY-CHECK П5): that key's slot is in the new wallet's
 * wallet app, or that app has offered the key on this page (`offered`), even if the user has switched it away since
 * (adding an account next to the stolen main key is the panic move). Accounts of one wallet app, and every account of
 * one Ledger, usually come from one seed phrase: next to the main key the "new" wallet is the thief's too; next to the
 * second key one phrase would make both keys. Only this rescue's keys count (`keys`), and only while the new wallet slot
 * holds `keys.newWallet`; empty without a new wallet.
 */
export function newWalletSharesWallet(slots: WalletSlots, keys: RescueKeys, offered: OfferedAccounts): ('main' | 'second')[] {
  const fresh = slots.new;
  if (fresh === null || keys.newWallet === null || fresh.address !== keys.newWallet) return [];
  const inApp = offered.get(fresh.walletId) ?? [];
  const shares = (role: 'main' | 'second', key: Address) => {
    const slot = slots[role];
    return inApp.includes(key) || (slot !== null && slot.walletId === fresh.walletId && slot.address === key);
  };
  return (['main', 'second'] as const).filter((role) =>
    (role === 'main' ? (keys.main === null ? [] : [keys.main]) : keys.second).some((key) => shares(role, key)),
  );
}

export type RescueBlocker =
  | 'need-main'
  | 'need-movable'
  | 'need-new'
  | 'new-problem'
  | 'need-seed-check'
  | 'balance-loading'
  | 'low-balance'
  | 'need-second'
  | 'second-problem';

export type RescueBlockerInput = {
  mainKey: Address | null;
  /** Movable accounts with the second key chosen now. */
  movable: number;
  /** Second keys to choose from (secondKeyChoices). */
  choices: number;
  /** The new wallet, once its slot is ready. */
  newWallet: Address | null;
  newProblems: number;
  seedConfirmed: boolean;
  /** The new wallet's balance; null while it is read. */
  balance: bigint | null;
  /** rescueMinimum; null while it is read. */
  needed: bigint | null;
  secondKey: Address | null;
};

/** What keeps Continue from going on at a step, in the order the screen lists them; empty = go on. */
export function rescueBlockers(step: 'stake' | 'new-wallet' | 'keys', input: RescueBlockerInput): RescueBlocker[] {
  const found: RescueBlocker[] = [];
  switch (step) {
    case 'stake':
      if (input.mainKey === null) found.push('need-main');
      else if (input.movable === 0 && input.choices === 0) found.push('need-movable');
      return found;
    case 'new-wallet':
      if (input.newWallet === null) found.push('need-new');
      else if (input.newProblems > 0) found.push('new-problem');
      if (!input.seedConfirmed) found.push('need-seed-check');
      if (input.newWallet !== null && input.newProblems === 0) {
        if (input.balance === null || input.needed === null) found.push('balance-loading');
        else if (input.balance < input.needed) found.push('low-balance');
      }
      return found;
    case 'keys':
      if (input.secondKey === null) found.push('need-second');
      else if (input.secondKey === input.mainKey || input.secondKey === input.newWallet) found.push('second-problem');
      return found;
  }
}

/** One run of the move: these accounts, this second key, this new wallet; a new key is a new signing session. */
export type RescueRun = { key: number; ids: readonly Address[]; secondKey: Address; newWallet: Address };

export type RescueState = {
  step: RescueStep;
  /** The main key field's text. */
  typed: string;
  /** The main key: from the address, the field, or fixed when the first step's Continue is pressed. */
  mainKey: Address | null;
  seedConfirmed: boolean;
  /** The second key chosen among several (null: the first choice). */
  secondChoice: Address | null;
  /** Where each key signs; null until the user chooses (the page then takes the default from the key slots). */
  mainMode: SignMode | null;
  secondMode: SignMode | null;
  /** Reads the main key's stake accounts again when it changes (Look for more). */
  attempt: number;
  run: RescueRun | null;
  /** Each account's last outcome, across runs. */
  outcomes: Readonly<Record<string, JobView>>;
  /** Accounts in the order they were first signed. */
  order: readonly Address[];
  clock: ChainClock | null;
};

export type RescueAction =
  | { type: 'go'; step: 'stake' | 'new-wallet' | 'keys' }
  | { type: 'typed'; text: string }
  | { type: 'main-key'; address: Address | null }
  | { type: 'confirm-seed'; value: boolean }
  | { type: 'second-choice'; address: Address }
  | { type: 'main-mode'; value: SignMode }
  | { type: 'second-mode'; value: SignMode }
  | { type: 'move'; ids: readonly Address[]; secondKey: Address; newWallet: Address }
  | { type: 'finished'; jobs: readonly JobView[]; clock: ChainClock | null }
  | { type: 'checked'; states: Readonly<Record<string, JobState>> }
  /** Back to the first step for a fresh search (splits made meanwhile); keeps the new wallet, the key and the modes. */
  | { type: 'look-again' };

export function initialRescueState(address: Address | null): RescueState {
  return {
    step: 'stake',
    typed: address ?? '',
    mainKey: address,
    seedConfirmed: false,
    secondChoice: null,
    mainMode: null,
    secondMode: null,
    attempt: 0,
    run: null,
    outcomes: {},
    order: [],
    clock: null,
  };
}

export function rescueReducer(state: RescueState, action: RescueAction): RescueState {
  switch (action.type) {
    case 'go':
      return { ...state, step: action.step };
    case 'typed':
      return { ...state, typed: action.text };
    case 'main-key':
      return { ...state, mainKey: action.address };
    case 'confirm-seed':
      return { ...state, seedConfirmed: action.value };
    case 'second-choice':
      return { ...state, secondChoice: action.address };
    case 'main-mode':
      return { ...state, mainMode: action.value };
    case 'second-mode':
      return { ...state, secondMode: action.value };
    case 'move':
      return {
        ...state,
        step: 'move',
        run: { key: (state.run?.key ?? 0) + 1, ids: [...action.ids], secondKey: action.secondKey, newWallet: action.newWallet },
      };
    case 'finished': {
      const outcomes: Record<string, JobView> = { ...state.outcomes };
      const order = [...state.order];
      for (const job of action.jobs) {
        outcomes[job.id] = job;
        if (!order.includes(job.id as Address)) order.push(job.id as Address);
      }
      return { ...state, step: 'done', outcomes, order, clock: action.clock ?? state.clock };
    }
    case 'checked': {
      const outcomes: Record<string, JobView> = { ...state.outcomes };
      for (const [id, next] of Object.entries(action.states)) {
        const job = outcomes[id];
        if (job !== undefined) outcomes[id] = { ...job, state: next };
      }
      return { ...state, outcomes };
    }
    case 'look-again':
      return { ...state, step: 'stake', attempt: state.attempt + 1 };
  }
}

function idsWhere(state: RescueState, kinds: readonly JobState['kind'][]): Address[] {
  return state.order.filter((id) => {
    const kind = state.outcomes[id]?.state.kind;
    return kind !== undefined && kinds.includes(kind);
  });
}

/** Moved on the chain: landed in a run, or already the new wallet's when a run read it. */
export function movedIds(state: RescueState): Address[] {
  return idsWhere(state, ['done', 'already-done']);
}

/** Known not to have landed: a new run may try them again (none while a link is still open, retryableOutcomes). */
export function retryableRescueIds(state: RescueState): Address[] {
  return retryableOutcomes(state.order.flatMap((id) => state.outcomes[id] ?? [])).map((job) => job.id as Address);
}

/** Sent, outcome not known yet: only a fresh read may tell (Check again). */
export function uncertainRescueIds(state: RescueState): Address[] {
  return idsWhere(state, ['unknown']);
}
