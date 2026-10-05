import { isAddress, type Address } from '@solana/kit';
import {
  DEFAULT_LOCK_PERIOD,
  protectBlock,
  validateSecondKey,
  ZERO_ADDRESS,
  type ChainClock,
  type ClockView,
  type LockPeriod,
  type ProtectBlock,
  type SecondKeyViolation,
  type StakeAccount,
} from '@stakeward/core';
import type { JobState, JobView } from '@/signing/machine';

/**
 * The protect wizard's rules and state (F1, DECISIONS.md D48), pure. The selection lives only in the URL
 * (`?account=` repeated); step, period, lock end, the seed checkbox and the outcomes live in React state, so Back keeps
 * them and a reload starts again from the URL with fresh reads.
 */

/** Live signing asks each wallet for one round of every selected account (RPC proxy limit, DECISIONS.md D40). */
export const MAX_ACCOUNTS_PER_RUN = 10;

/** A lock end closer than this to the cluster clock is refused: it would be over before the transaction lands. */
export const LOCK_END_MARGIN_SECONDS = 60n;

export type WizardStep = 'accounts' | 'second-key' | 'period' | 'sign' | 'done';

/** The order StepProgress shows. */
export const WIZARD_STEPS: readonly WizardStep[] = ['accounts', 'second-key', 'period', 'sign', 'done'];

/** The stake accounts of `?account=` (repeated): valid addresses only, never the zero address, each once, in order. */
export function parseAccountParams(params: URLSearchParams): Address[] {
  const accounts: Address[] = [];
  for (const value of params.getAll('account')) {
    if (!isAddress(value) || value === ZERO_ADDRESS || accounts.includes(value)) continue;
    accounts.push(value);
  }
  return accounts;
}

/** `?account=A&account=B` for the selection. */
export function accountParams(accounts: readonly Address[]): URLSearchParams {
  return new URLSearchParams(accounts.map((account) => ['account', account]));
}

/** A stake account of the main key, and why it cannot be protected now (null: it can). */
export type Candidate = { account: StakeAccount; block: ProtectBlock | null };

/** The main key's stake accounts with their protect block (core `protectBlock`); others' accounts are not candidates. */
export function candidates(
  accounts: readonly StakeAccount[],
  mainKey: Address,
  knownSecondKeys: readonly Address[],
  clock: ClockView,
): Candidate[] {
  return accounts
    .filter((account) => account.withdrawer === mainKey)
    .map((account) => ({ account, block: protectBlock(account, mainKey, knownSecondKeys, clock) }));
}

/** What the run will protect: the selected candidates that are not blocked, in the selection's order. */
export function effectiveSelection(selected: readonly Address[], cands: readonly Candidate[]): Address[] {
  return selected.filter((address) => cands.some((candidate) => candidate.account.address === address && candidate.block === null));
}

/** Selected accounts the main key does not hold (a link names accounts; the chain decides, DECISIONS.md D36). */
export function leftOut(selected: readonly Address[], cands: readonly Candidate[]): Address[] {
  return selected.filter((address) => !cands.some((candidate) => candidate.account.address === address));
}

export type SecondKeyProblem = { account: Address; violations: SecondKeyViolation[] };

/** Every selected account the second key cannot lock (CLAUDE.md section 5: not A, not its staker, not itself, not zero). */
export function secondKeyProblems(second: Address, mainKey: Address, accounts: readonly StakeAccount[]): SecondKeyProblem[] {
  return accounts.flatMap((account) => {
    const violations = validateSecondKey({ second, mainKey, staker: account.staker, stakeAccount: account.address });
    return violations.length === 0 ? [] : [{ account: account.address, violations }];
  });
}

export type Blocker =
  | 'need-main'
  | 'need-one'
  | 'too-many'
  | 'need-second'
  | 'second-key-problem'
  | 'need-seed-check'
  | 'need-clock';

export type BlockerInput = {
  mainReady: boolean;
  /** Accounts in the effective selection. */
  selection: number;
  secondReady: boolean;
  /** Accounts with a second-key problem. */
  problems: number;
  seedConfirmed: boolean;
  clockReady: boolean;
};

/** What keeps Continue from going on at a step, in the order the screen lists them; empty = go on. */
export function blockers(step: 'accounts' | 'second-key' | 'period', input: BlockerInput): Blocker[] {
  const found: Blocker[] = [];
  switch (step) {
    case 'accounts':
      if (!input.mainReady) found.push('need-main');
      else if (input.selection === 0) found.push('need-one');
      else if (input.selection > MAX_ACCOUNTS_PER_RUN) found.push('too-many');
      return found;
    case 'second-key':
      if (!input.secondReady) found.push('need-second');
      else if (input.problems > 0) found.push('second-key-problem');
      if (!input.seedConfirmed) found.push('need-seed-check');
      return found;
    case 'period':
      if (!input.clockReady) found.push('need-clock');
      return found;
  }
}

export type WizardState = {
  step: WizardStep;
  seedConfirmed: boolean;
  period: LockPeriod;
  /** T, fixed when the period step's Continue is pressed; reused by every retry of the run. */
  lockUntil: bigint | null;
  /** The signing run; a new key is a new signing session. */
  run: { key: number; ids: readonly Address[] } | null;
  /** Each account's last outcome, across runs. */
  outcomes: Readonly<Record<string, JobView>>;
  /** Accounts in the order they were first signed. */
  order: readonly Address[];
  clock: ChainClock | null;
};

export type WizardAction =
  | { type: 'go'; step: 'accounts' | 'second-key' | 'period' }
  | { type: 'confirm-seed'; value: boolean }
  | { type: 'period'; value: LockPeriod }
  | { type: 'sign'; lockUntil: bigint; ids: readonly Address[] }
  | { type: 'finished'; jobs: readonly JobView[]; clock: ChainClock | null }
  | { type: 'retry'; ids: readonly Address[] }
  | { type: 'checked'; states: Readonly<Record<string, JobState>> };

export function initialWizardState(): WizardState {
  return {
    step: 'accounts',
    seedConfirmed: false,
    period: DEFAULT_LOCK_PERIOD,
    lockUntil: null,
    run: null,
    outcomes: {},
    order: [],
    clock: null,
  };
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'go':
      return { ...state, step: action.step };
    case 'confirm-seed':
      return { ...state, seedConfirmed: action.value };
    case 'period':
      return { ...state, period: action.value };
    case 'sign':
      return { ...state, step: 'sign', lockUntil: action.lockUntil, run: nextRun(state, action.ids) };
    case 'finished': {
      const outcomes: Record<string, JobView> = { ...state.outcomes };
      const order = [...state.order];
      for (const job of action.jobs) {
        outcomes[job.id] = job;
        if (!order.includes(job.id as Address)) order.push(job.id as Address);
      }
      return { ...state, step: 'done', outcomes, order, clock: action.clock ?? state.clock };
    }
    case 'retry':
      return { ...state, step: 'sign', run: nextRun(state, action.ids) };
    case 'checked': {
      const outcomes: Record<string, JobView> = { ...state.outcomes };
      for (const [id, next] of Object.entries(action.states)) {
        const job = outcomes[id];
        if (job !== undefined) outcomes[id] = { ...job, state: next };
      }
      return { ...state, outcomes };
    }
  }
}

function nextRun(state: WizardState, ids: readonly Address[]): { key: number; ids: readonly Address[] } {
  return { key: (state.run?.key ?? 0) + 1, ids: [...ids] };
}

function idsWhere(state: WizardState, kinds: readonly JobState['kind'][]): Address[] {
  return state.order.filter((id) => {
    const kind = state.outcomes[id]?.state.kind;
    return kind !== undefined && kinds.includes(kind);
  });
}

/** Protected on the chain: landed in a run, or already showing this lock when a run read it. */
export function protectedIds(state: WizardState): Address[] {
  return idsWhere(state, ['done', 'already-done']);
}

/** Known not to have landed: a new run may try them again. */
export function retryableIds(state: WizardState): Address[] {
  return idsWhere(state, ['sim-failed', 'failed', 'expired', 'not-sent']);
}

/** Sent, outcome not known yet: only a fresh read may tell (Check again). */
export function uncertainIds(state: WizardState): Address[] {
  return idsWhere(state, ['unknown']);
}
