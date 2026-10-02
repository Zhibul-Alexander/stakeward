// Adversarial spec review of packages/core against CLAUDE.md sections 5, 8, 9, 11 and step 2 "Готово, когда".
// The tests named after a finding (R1-R4, E1, E2, P1, P2, B1, N1, N2) failed before the fix pass and are now regression
// tests for the fix; the *-guard tests pin rules that held up. Pure tests only (no LiteSVM): this file is type-checked with the product tsconfig.
import { createNoopSigner, SolanaError, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, type Address, type Nonce } from '@solana/kit';
import { getAuthorizeCheckedInstruction, StakeAuthorize } from '@solana-program/stake';
import { describe, expect, it } from 'vitest';
import { appendLighthouseTail, craft, key, lifetimeToken, prefixInstructions } from '../test/craft.ts';
import {
  expectedFeePayer,
  type BlockhashLifetime,
  type Lifetime,
  type NonceLifetime,
  type RescueAction,
  type TransactionAction,
} from './actions.ts';
import { buildTransaction } from './builders.ts';
import { SYSVAR_CLOCK_ADDRESS, U64_MAX } from './constants.ts';
import type { StakeAccount } from './decode.ts';
import { diffSnapshots, MONITOR_EVENT_TYPES, snapshotOf, type AccountSnapshot, type MonitorEvent } from './diff.ts';
import { translateError } from './errors.ts';
import { inspectTransaction } from './inspect.ts';
import { toLegacyLayout } from './legacy-layout.ts';
import { lockupEndForPeriod } from './lockup.ts';
import { scannerStatus, stakeActivationStatus } from './status.ts';

const A = key(1); // main key (compromised in a rescue)
const K = key(2); // second key
const D = key(3); // new wallet
const S = key(4); // stake account
const NONCE = key(6);
const V1 = key(10);
const V2 = key(11);
const X = key(12); // thief
const DAY = 86_400n;
const EPOCH = 1_000n;
/** 2027-04-12T00:00:00Z */
const T = 1_807_488_000n;

const BLOCKHASH: BlockhashLifetime = { kind: 'blockhash', blockhash: key(20) as string as BlockhashLifetime['blockhash'], lastValidBlockHeight: 100n };
const nonceOwnedBy = (authority: Address): NonceLifetime => ({
  kind: 'nonce',
  nonceAccount: NONCE,
  nonceAuthority: authority,
  nonceValue: key(21) as string as Nonce,
});
const RESCUE: RescueAction = { kind: 'rescue', stakeAccount: S, mainKey: A, secondKey: K, newWallet: D };

/** The rescue pair from the generated client in the legacy layout (D1), compiled with any fee payer and lifetime. */
function rescueBytes(feePayer: Address, lifetime: Lifetime): Uint8Array {
  const authorize = (stakeAuthorize: StakeAuthorize, custodian?: Address) =>
    toLegacyLayout(
      getAuthorizeCheckedInstruction({
        stake: S,
        authority: createNoopSigner(A),
        newAuthority: createNoopSigner(D),
        ...(custodian === undefined ? {} : { lockupAuthority: createNoopSigner(custodian) }),
        stakeAuthorize,
      }),
      { at: 1, sysvars: [SYSVAR_CLOCK_ADDRESS] },
    );
  const pair = [authorize(StakeAuthorize.Staker), authorize(StakeAuthorize.Withdrawer, K)];
  return craft([...prefixInstructions(lifetime), ...pair], feePayer, lifetimeToken(lifetime));
}

// ---------------------------------------------------------------------------------------------------------------
// R. CLAUDE.md section 5 and section 11 ("Обязательно"): the compromised key never pays the fee and never owns the
// nonce account. In a rescue the main key A is the compromised key by definition (F4).

describe('R: a rescue is never paid by the main key and never runs on its nonce', () => {
  it('R-guard: expectedFeePayer gives the new wallet, and the inspector accepts the rescue D pays on its own nonce', async () => {
    expect(expectedFeePayer(RESCUE)).toBe(D);
    for (const lifetime of [BLOCKHASH, nonceOwnedBy(D)]) {
      const built = buildTransaction(RESCUE, { feePayer: D, lifetime }).bytes;
      expect(rescueBytes(D, lifetime)).toEqual(built); // the crafted bytes below differ only in the key under test
      expect((await inspectTransaction(built)).ok).toBe(true);
    }
  });

  it('R1: buildTransaction refuses a rescue paid by the main key', () => {
    expect(() => buildTransaction(RESCUE, { feePayer: A, lifetime: BLOCKHASH })).toThrow();
  });

  it('R2: buildTransaction refuses a rescue on a nonce account the main key owns', () => {
    expect(() => buildTransaction(RESCUE, { feePayer: D, lifetime: nonceOwnedBy(A) })).toThrow();
  });

  it('R3: the inspector (/cosign, RPC proxy) rejects a rescue paid by the main key', async () => {
    const result = await inspectTransaction(rescueBytes(A, BLOCKHASH));
    expect(result.ok).toBe(false);
  });

  it('R4: the inspector rejects a rescue whose nonce account the main key owns', async () => {
    const result = await inspectTransaction(rescueBytes(D, nonceOwnedBy(A)));
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// E. EXPIRED exactly once (step 2 bullet 5, section 8). The review found EXPIRED decided from previous.checkedAt (ms)
// and context.clock.unixTimestamp (s), two values the worker samples separately: a worker that reads `now` at the start
// of a pass and stamps checked_at when it writes the row lost or duplicated EXPIRED around T. Fixed: DiffContext takes
// `checkedAt`, the value the worker stores for this read, and EXPIRED iff previous.checkedAt < T * 1000 <= checkedAt.

const locked: StakeAccount = {
  address: S,
  lamports: 5_001_666_240n,
  kind: 'delegated',
  rentExemptReserve: 1_666_240n,
  staker: A,
  withdrawer: A,
  lockup: { unixTimestamp: T, epoch: 0n, custodian: K },
  delegation: { voter: V1, stake: 5_000_000_000n, activationEpoch: 990n, deactivationEpoch: U64_MAX },
};

type Pass = { now: bigint; checkedAt: number };

/** Runs the monitor over `passes` on an unchanged locked account; returns how many EXPIRED events came out. */
function expiredCount(passes: readonly Pass[], account: StakeAccount = locked): number {
  let stored: AccountSnapshot = snapshotOf(account, 1n, Number(T - 30n * DAY) * 1000);
  let count = 0;
  passes.forEach((pass, index) => {
    const slot = BigInt(index + 2);
    const context = { slot, clock: { unixTimestamp: pass.now, epoch: EPOCH }, checkedAt: pass.checkedAt };
    count += diffSnapshots(stored, account, context).filter((event) => event.type === 'EXPIRED').length;
    stored = snapshotOf(account, slot, pass.checkedAt);
  });
  return count;
}

const PASS_MS = 120_000;
const T_MS = Number(T) * 1000;

describe('E: EXPIRED comes out exactly once around T', () => {
  it('E-guard: once for many pass schedules when now and checked_at are the same instant', () => {
    let seed = 7;
    const random = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
    for (let run = 0; run < 500; run += 1) {
      let at = T_MS - 3 * PASS_MS + Math.floor(random() * PASS_MS);
      const passes: Pass[] = [];
      for (let i = 0; i < 6; i += 1) {
        passes.push({ now: BigInt(Math.floor(at / 1000)), checkedAt: at });
        at += PASS_MS - 2_000 + Math.floor(random() * 4_000);
      }
      expect(expiredCount(passes)).toBe(1);
    }
  });

  it('E1: once when now is read at the pass start and checked_at after the 500 ms read (before the fix: never)', () => {
    const starts = [T_MS - PASS_MS - 400, T_MS - 400, T_MS + PASS_MS - 400];
    const passes = starts.map((start) => ({ now: BigInt(Math.floor(start / 1000)), checkedAt: start + 500 }));
    expect(expiredCount(passes)).toBe(1);
  });

  it('E2: once when checked_at is the pass start and now is read after the account (before the fix: twice)', () => {
    const starts = [T_MS - PASS_MS - 300, T_MS - 300, T_MS + PASS_MS - 300];
    const passes = starts.map((start) => ({ now: BigInt(Math.floor((start + 500) / 1000)), checkedAt: start }));
    expect(expiredCount(passes)).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// P. Lockups held by the epoch. The stake program keeps a lock in force while lockup.epoch > clock.epoch
// (lockup.ts isLockupInForce), and /api/watch takes any account whose lock is in force. Stakeward never sets the
// epoch (D19), but watched or scanned accounts can carry one (genesis-era vesting locks).

describe('P: a lock still held by its epoch', () => {
  const epochHeld: StakeAccount = { ...locked, lockup: { unixTimestamp: T, epoch: EPOCH + 50n, custodian: K } };

  it('P1: no EXPIRED (and no "main key alone can withdraw" alert) at T while the epoch still holds the lock', () => {
    const previous = snapshotOf(epochHeld, 1n, T_MS - PASS_MS);
    const events = diffSnapshots(previous, epochHeld, { slot: 2n, checkedAt: T_MS, clock: { unixTimestamp: T, epoch: EPOCH } });
    expect(events.map((event) => event.type)).not.toContain('EXPIRED');
  });

  it('P2: not "expiring" when the timestamp ends within 30 days but the epoch keeps the lock in force', () => {
    const now = T - 10n * DAY;
    expect(scannerStatus(epochHeld, [K], { unixTimestamp: now, epoch: EPOCH }).status).not.toBe('expiring');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// B. Bootstrap (genesis) delegations have activation_epoch = u64::MAX; the stake program treats them as fully active
// from the start (Delegation::is_bootstrap). While not deactivating their deactivation_epoch is u64::MAX too, so the
// first section 5 rule (activation == deactivation -> inactive) calls an active stake "inactive", and F3 / step 6 would
// offer Withdraw instead of Deactivate (the simulation then fails with InsufficientFunds: a dead end).

describe('B: stake status from epochs', () => {
  it('B1: a bootstrap delegation (activation epoch u64::MAX, not deactivating) is active', () => {
    const bootstrap = { voter: V1, stake: 1n, activationEpoch: U64_MAX, deactivationEpoch: U64_MAX };
    expect(stakeActivationStatus(bootstrap, EPOCH)).toBe('active');
  });

  it('B-guard: the section 5 rules at their boundaries', () => {
    const d = (activationEpoch: bigint, deactivationEpoch: bigint) => ({ voter: V1, stake: 1n, activationEpoch, deactivationEpoch });
    expect(stakeActivationStatus(d(EPOCH, EPOCH), EPOCH)).toBe('inactive');
    expect(stakeActivationStatus(d(EPOCH, U64_MAX), EPOCH)).toBe('activating');
    expect(stakeActivationStatus(d(EPOCH - 1n, U64_MAX), EPOCH)).toBe('active');
    expect(stakeActivationStatus(d(EPOCH - 5n, EPOCH), EPOCH)).toBe('deactivating');
    expect(stakeActivationStatus(d(EPOCH - 5n, EPOCH - 1n), EPOCH)).toBe('inactive');
  });

  it('S-guard: Expiring is strictly under 30 days; an ended lock and a self-custodied lock are Unprotected', () => {
    const at = (unixTimestamp: bigint, custodian: Address = K) =>
      scannerStatus({ ...locked, lockup: { unixTimestamp, epoch: 0n, custodian } }, [K], { unixTimestamp: T - 30n * DAY, epoch: EPOCH }).status;
    expect(at(T)).toBe('protected');
    expect(at(T - 1n)).toBe('expiring');
    expect(at(T - 30n * DAY)).toBe('unprotected');
    expect(at(T, A)).toBe('unprotected');
  });
});

describe('L-guard: T = 00:00 UTC after the end of the period (section 5, D13)', () => {
  /** Independent oracle: setUTCMonth on the 1st, clamp the day, then the next multiple of a day strictly after. */
  const oracle = (now: bigint, months: number): bigint => {
    const start = new Date(Number(now) * 1000);
    const end = new Date(start.getTime());
    end.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
    end.setUTCDate(Math.min(start.getUTCDate(), lastDay));
    const endSeconds = BigInt(end.getTime() / 1000);
    return (endSeconds / DAY + 1n) * DAY;
  };

  it('matches the oracle every 7 hours over two years, for every month period', () => {
    const from = 1_798_761_600n; // 2027-01-01T00:00:00Z, so 2028-02-29 is inside
    for (let now = from; now < from + 730n * DAY; now += 7n * 3_600n) {
      for (const months of [1, 3, 6, 12] as const) expect(lockupEndForPeriod(now, months)).toBe(oracle(now, months));
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// N. Error translation outside the program errors.

describe('N: errors that are not the wallet and not the chain', () => {
  it('N1: WebKit\'s "TypeError: cancelled" (a cancelled fetch) is a network failure, not a wallet rejection', () => {
    expect(translateError(new TypeError('cancelled')).code).toBe('network');
  });

  it('N2: an HTTP 4xx from /api/rpc (e.g. the proxy refused the bytes) is not "network did not respond"', () => {
    const refused = new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, {
      headers: undefined as never,
      message: 'Bad Request',
      statusCode: 400,
    });
    expect(translateError(refused).code).not.toBe('network');
  });

  it('N-guard: HTTP 429 and 503 stay network problems', () => {
    for (const statusCode of [429, 503]) {
      const error = new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, { headers: undefined as never, message: 'x', statusCode });
      expect(translateError(error).code).toBe('network');
    }
  });
});

describe('C-guard: custom codes are attributed by the instruction index, also with a Lighthouse tail', () => {
  const custom = (index: number, code: number) => ({ InstructionError: [index, { Custom: code }] });
  const onNonce = buildTransaction(RESCUE, { feePayer: D, lifetime: nonceOwnedBy(D) }).bytes;
  const withTail = appendLighthouseTail(onNonce, [S]);

  it('7 from AdvanceNonceAccount is not CustodianMissing; 7 from the withdrawer AuthorizeChecked is', () => {
    expect(translateError(custom(0, 7), { transaction: withTail }).code).toBe('unknown');
    expect(translateError(custom(4, 7), { transaction: withTail }).code).toBe('custodian-missing');
    expect(translateError(custom(4, 7)).code).toBe('unknown');
  });

  it("a custom error from the wallet's Lighthouse assertion is the wallet's safety check, not a stake error", () => {
    const result = translateError(custom(5, 1), { transaction: withTail });
    expect(result.code).toBe('unknown');
    expect(result.title).toMatch(/wallet's own safety check/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// D. Step 2 bullet 5: every event type exactly once and nothing on an unchanged account, also across passes.

describe('D-guard: each event once, then quiet on the next pass once the snapshot is stored', () => {
  const NOW = T - 100n * DAY;
  const previous = snapshotOf(locked, 1n, Number(NOW - 120n) * 1000);
  const change = (patch: Partial<StakeAccount>): StakeAccount => ({ ...locked, ...patch });
  const cases: [MonitorEvent['type'], StakeAccount, bigint][] = [
    ['DEACTIVATED', change({ delegation: { voter: V1, stake: 5_000_000_000n, activationEpoch: 990n, deactivationEpoch: EPOCH } }), NOW],
    ['DELEGATION_CHANGED', change({ delegation: { voter: V2, stake: 5_000_000_000n, activationEpoch: EPOCH, deactivationEpoch: U64_MAX } }), NOW],
    ['STAKER_CHANGED', change({ staker: X }), NOW],
    ['WITHDRAWER_CHANGED', change({ withdrawer: D }), NOW],
    ['LOCKUP_CHANGED', change({ lockup: { unixTimestamp: 0n, epoch: 0n, custodian: K } }), NOW],
    ['BALANCE_DECREASED', change({ lamports: 2_001_666_240n }), NOW],
    ['EXPIRED', locked, T + 60n],
  ];

  it('covers every type but ACCOUNT_CLOSED (a closed account has no snapshot to store)', () => {
    expect(cases.map(([type]) => type)).toEqual(MONITOR_EVENT_TYPES.filter((type) => type !== 'ACCOUNT_CLOSED'));
  });

  it.each(cases)('%s', (type, next, now) => {
    const at = (unixTimestamp: bigint, slot: bigint) => ({ slot, checkedAt: Number(unixTimestamp) * 1000, clock: { unixTimestamp, epoch: EPOCH } });
    const first = diffSnapshots(previous, next, at(now, 2n));
    expect(first.map((event) => event.type)).toEqual([type]);
    const stored = snapshotOf(next, 2n, Number(now) * 1000);
    expect(diffSnapshots(stored, next, at(now + 120n, 3n))).toEqual([]);
  });

  it('rewards only add lamports: no event; a whole-delegation MoveStake (Stake -> Initialized) is not a deactivation', () => {
    const context = { slot: 2n, checkedAt: Number(NOW) * 1000, clock: { unixTimestamp: NOW, epoch: EPOCH } };
    const rewarded = change({ lamports: locked.lamports + 900_000n });
    expect(diffSnapshots(previous, rewarded, context)).toEqual([]);
    const moved = change({ kind: 'initialized', delegation: null, lamports: 1_666_240n });
    const events = diffSnapshots(previous, moved, context);
    expect(events.map((event) => event.type)).toEqual(['DELEGATION_CHANGED', 'BALANCE_DECREASED']);
  });
});

// Keeps the action helpers honest: every kind still builds with the section 5 fee payer.
describe('F-guard: the section 5 fee payer builds every kind', () => {
  const actions: TransactionAction[] = [
    { kind: 'protect', stakeAccount: S, mainKey: A, secondKey: K, lockUntil: T },
    { kind: 'extend', stakeAccount: S, secondKey: K, lockUntil: T },
    { kind: 'unlock', stakeAccount: S, secondKey: K },
    { kind: 'withdraw', stakeAccount: S, mainKey: A, secondKey: K, recipient: A, lamports: 1n },
    RESCUE,
  ];
  it.each(actions)('$kind', (action) => {
    const built = buildTransaction(action, { feePayer: expectedFeePayer(action), lifetime: BLOCKHASH });
    expect(built.meta.signers[0]).toBe(expectedFeePayer(action));
  });
});
