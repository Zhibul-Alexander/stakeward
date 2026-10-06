/**
 * Subrequest budget of one monitor pass (DECISIONS.md D48). Cloudflare's documentation can be read two ways: the
 * Workers limits count D1 queries as subrequests ("using the Fetch API or to Cloudflare services like R2, KV, or
 * D1", 50 on Free), and D1 allows "50 queries per Worker invocation" on Free, counting "each individual statement
 * contained within a batch". So the pass counts the worst reading: every fetch attempt (each retry of callUpstream
 * too) plus every D1 statement (a batch of n is n) stays within the plan's cap (48 on Free, below 50 either way).
 *
 * One fetch and one statement are reserved from the start, for the admin alert and the finish marker: whatever the
 * earlier phases spend, the pass can still report a problem and release its lease. A D1 batch is never retried inside
 * the pass: the next pass is the retry, and every write is idempotent.
 */

/** A batch that would pass the cap; the pass fails (a bug: phases check `left()` before they start). */
export class BudgetExhaustedError extends Error {
  override name = 'BudgetExhaustedError';
}

/** Budget a phase needs before it starts (step 5 spec section 6.2). */
export const COST = {
  /** getMultipleAccounts (3 attempts) + getGenesisHash (3 attempts) + the chunk commit (3 statements). */
  chunk: 9,
  /** Kept while reading chunks: the delivery load (2) + 10 sends + the delivery commit (4). */
  sendFloor: 16,
  /**
   * DAILY_REMINDER_ROWS, then the reminder events + REMINDER_DAYS + (a full page: more may be due) the open stage in
   * meta.
   */
  daily: 4,
  sendLoad: 2,
  sendCommit: 4,
  /** One rescan call and its post-processing. */
  urgentRescan: 5,
  /** getMultipleAccounts of the Clock alone (3 attempts), for rescans in a pass that read no chunk. */
  clockRead: 3,
  /** getProgramAccounts, 3 attempts. */
  rescanCall: 3,
  /** KNOWN_LIVE + INSERT_WATCHED after the rescan calls. */
  rescanPost: 2,
} as const;

export class PassBudget {
  /** Counting fetch for every outbound call. Past the cap it rejects (callUpstream sees a network error). */
  readonly fetch: typeof fetch;
  readonly used = { fetches: 0, statements: 0 };
  private readonly cap: number;
  private reserved = { finish: true, admin: true };

  constructor(cap: number, fetchFn: typeof fetch) {
    this.cap = cap;
    this.fetch = (input, init) => {
      if (this.left() < 1) return Promise.reject(new BudgetExhaustedError('fetch past the pass budget'));
      this.used.fetches += 1;
      return fetchFn(input, init);
    };
  }

  /** Runs `stmts` as one D1 batch, counted as stmts.length. Throws BudgetExhaustedError, before calling, past the cap. */
  async batch(db: D1Database, stmts: D1PreparedStatement[]): Promise<D1Result[]> {
    if (stmts.length > this.left()) {
      throw new BudgetExhaustedError(`batch of ${String(stmts.length)} past the pass budget`);
    }
    this.used.statements += stmts.length;
    return db.batch(stmts);
  }

  /** What is still free: the cap minus what was used and what is reserved. */
  left(): number {
    const reserved = (this.reserved.finish ? 1 : 0) + (this.reserved.admin ? 1 : 0);
    return this.cap - this.used.fetches - this.used.statements - reserved;
  }

  /** Frees a reserve right before it is spent: `finish` for the last statement, `admin` for the admin alert. */
  release(what: 'finish' | 'admin'): void {
    this.reserved[what] = false;
  }
}
