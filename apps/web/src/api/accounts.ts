import { isAddress, type Address } from '@solana/kit';

/**
 * GET /api/accounts?wallet= of the worker (CLAUDE.md section 8): the watched stake accounts whose main key or second
 * key is the wallet, as the monitor last stored them, and their recent events (reminders left out). Public data only:
 * the worker leaves out whether a chat gets alerts. "Explain this alert" (D125) reads it to show what happened.
 */
export type WatchedAccount = {
  address: Address;
  roles: ('main' | 'second')[];
  /** Unix seconds; 0 = no lock. */
  lockUntil: bigint;
  /** `ending-soon`: in force for less than 30 more days. */
  lock: 'in-force' | 'ending-soon' | 'ended';
  daysLeft: number | null;
  lamports: bigint;
  state: 'initialized' | 'delegated' | 'closed';
};

export type WatchedEvent = { stakeAccount: Address; type: string; detectedAt: Date };

export type WatchedAccounts = { accounts: WatchedAccount[]; events: WatchedEvent[] };

const URL_BASE = '/api/accounts';
/** Same per-request limit as the RPC transport (CLAUDE.md section 12). */
const TIMEOUT_MS = 8_000;

export type WatchedAccountsOptions = { fetch?: typeof fetch; timeoutMs?: number };

/** Rejects on a network failure, a timeout, another HTTP status than 200 or a malformed body. */
export async function fetchWatchedAccounts(wallet: Address, options: WatchedAccountsOptions = {}): Promise<WatchedAccounts> {
  const fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const timer = setTimeout(() => {
    const timeout = new Error(`No answer within ${String(timeoutMs / 1000)} s`);
    timeout.name = 'TimeoutError';
    controller.abort(timeout);
  }, timeoutMs);
  try {
    const response = await fetchImpl(`${URL_BASE}?${new URLSearchParams({ wallet }).toString()}`, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.status !== 200) throw new Error(`GET /api/accounts answered HTTP ${String(response.status)}`);
    return parseWatchedAccounts(await response.json());
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const LOCKS: readonly WatchedAccount['lock'][] = ['in-force', 'ending-soon', 'ended'];
const STATES: readonly WatchedAccount['state'][] = ['initialized', 'delegated', 'closed'];
const DECIMAL = /^[0-9]{1,20}$/;
const EVENT_TYPE = /^[A-Z][A-Z0-9_]{0,39}$/;

/** Reads the worker's JSON strictly: anything that does not fit is an error, not a guess. */
export function parseWatchedAccounts(body: unknown): WatchedAccounts {
  if (!isRecord(body) || !Array.isArray(body.accounts) || !Array.isArray(body.events)) throw malformed();
  const accounts = body.accounts.map((entry: unknown): WatchedAccount => {
    if (!isRecord(entry)) throw malformed();
    const { address, roles, lockUntil, lock, daysLeft, lamports, state } = entry;
    const lockValue = LOCKS.find((value) => value === lock);
    const stateValue = STATES.find((value) => value === state);
    if (
      typeof address !== 'string' ||
      !isAddress(address) ||
      !Array.isArray(roles) ||
      !roles.every((role) => role === 'main' || role === 'second') ||
      typeof lockUntil !== 'string' ||
      !DECIMAL.test(lockUntil) ||
      lockValue === undefined ||
      !(daysLeft === null || (typeof daysLeft === 'number' && Number.isSafeInteger(daysLeft))) ||
      typeof lamports !== 'string' ||
      !DECIMAL.test(lamports) ||
      stateValue === undefined
    ) {
      throw malformed();
    }
    return {
      address,
      roles: roles as ('main' | 'second')[],
      lockUntil: BigInt(lockUntil),
      lock: lockValue,
      daysLeft,
      lamports: BigInt(lamports),
      state: stateValue,
    };
  });
  const events = body.events.map((entry: unknown): WatchedEvent => {
    if (!isRecord(entry)) throw malformed();
    const { stakeAccount, type, detectedAt } = entry;
    if (typeof stakeAccount !== 'string' || !isAddress(stakeAccount) || typeof type !== 'string' || !EVENT_TYPE.test(type)) {
      throw malformed();
    }
    const date = typeof detectedAt === 'string' ? new Date(detectedAt) : null;
    if (date === null || Number.isNaN(date.getTime())) throw malformed();
    return { stakeAccount, type, detectedAt: date };
  });
  return { accounts, events };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function malformed(): Error {
  return new Error('Malformed /api/accounts response');
}
