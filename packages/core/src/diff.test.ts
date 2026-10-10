// Snapshot comparison and alert texts, on hand-built StakeAccount values (the decoder's output type). The same
// comparison on accounts changed by real transactions on LiteSVM is in test/diff.svm.test.ts.
import { address, getAddressDecoder, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { U64_MAX } from './constants.ts';
import type { StakeAccount } from './decode.ts';
import {
  diffSnapshots,
  formatAlert,
  formatReminder,
  MONITOR_EVENT_TYPES,
  needsWithdrawerRescan,
  REMINDER_DAYS,
  reminderDue,
  snapshotOf,
  WITHDRAWER_RESCAN_EVENTS,
  type AccountSnapshot,
  type DiffContext,
  type MonitorEvent,
  type MonitorEventType,
} from './diff.ts';

const key = (n: number): Address => getAddressDecoder().decode(new Uint8Array(32).fill(n));
const DAY = 86_400n;

const STAKE = address('7xKTg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgA9fQ');
const A = key(2); // main key
const K = key(3); // second key
const V1 = key(4);
const V2 = key(5);
const X = key(6); // thief's key
const K2 = key(7);
const D = key(8); // new wallet

/** 2026-10-01T00:00:00Z, epoch 1000. */
const NOW = 1_790_812_800n;
const EPOCH = 1_000n;
/** Lockup end: 2027-04-12T00:00:00Z. */
const T = 1_807_488_000n;
/** The previous pass ran two minutes ago. */
const CHECKED_AT = Number(NOW - 120n) * 1000;

const locked: StakeAccount = {
  address: STAKE,
  lamports: 5_001_666_240n,
  kind: 'delegated',
  rentExemptReserve: 1_666_240n,
  staker: A,
  withdrawer: A,
  lockup: { unixTimestamp: T, epoch: 0n, custodian: K },
  delegation: { voter: V1, stake: 5_000_000_000n, activationEpoch: 990n, deactivationEpoch: U64_MAX },
};

const previous = snapshotOf(locked, 100n, CHECKED_AT);

/** A pass at `unixTimestamp` that stores checked_at = that instant. */
function context(unixTimestamp = NOW, epoch = EPOCH): DiffContext {
  return { slot: 200n, checkedAt: Number(unixTimestamp) * 1000, clock: { unixTimestamp, epoch } };
}

function change(patch: Partial<StakeAccount>): StakeAccount {
  return { ...locked, ...patch };
}

function types(events: readonly MonitorEvent[]): MonitorEventType[] {
  return events.map((e) => e.type);
}

describe('snapshotOf', () => {
  it('keeps the D1 chain columns of a delegated account', () => {
    expect(previous).toEqual({
      stakeAccount: STAKE,
      withdrawer: A,
      staker: A,
      custodian: K,
      lockUntil: T,
      lamports: 5_001_666_240n,
      state: 'delegated',
      voter: V1,
      activationEpoch: 990n,
      deactivationEpoch: U64_MAX,
      slot: 100n,
      checkedAt: CHECKED_AT,
    } satisfies AccountSnapshot);
  });

  it('has no delegation columns for an initialized account', () => {
    const snapshot = snapshotOf({ ...locked, kind: 'initialized', delegation: null }, 1n, 0);
    expect(snapshot).toMatchObject({ state: 'initialized', voter: null, activationEpoch: null, deactivationEpoch: null });
  });
});

describe('diffSnapshots', () => {
  it('first sighting gives no events', () => {
    expect(diffSnapshots(null, locked, context())).toEqual([]);
  });

  it('an unchanged account gives no events', () => {
    expect(diffSnapshots(previous, locked, context())).toEqual([]);
  });

  it('rewards (more lamports and stake) and a lockup epoch change give no events', () => {
    const next = change({
      lamports: locked.lamports + 1_000_000n,
      lockup: { ...locked.lockup, epoch: 5n },
      delegation: { voter: V1, stake: 5_001_000_000n, activationEpoch: 990n, deactivationEpoch: U64_MAX },
    });
    expect(diffSnapshots(previous, next, context())).toEqual([]);
  });

  // One crafted change per event type; each yields exactly that event, once.
  const cases: [MonitorEventType, StakeAccount | null, DiffContext, MonitorEvent['details']][] = [
    [
      'DEACTIVATED',
      change({ delegation: { voter: V1, stake: 5_000_000_000n, activationEpoch: 990n, deactivationEpoch: EPOCH } }),
      context(),
      { deactivationEpoch: '1000' },
    ],
    [
      'DELEGATION_CHANGED',
      change({ delegation: { voter: V2, stake: 5_000_000_000n, activationEpoch: EPOCH, deactivationEpoch: U64_MAX } }),
      context(),
      { fromVoter: V1, toVoter: V2 },
    ],
    ['STAKER_CHANGED', change({ staker: X }), context(), { from: A, to: X }],
    ['WITHDRAWER_CHANGED', change({ withdrawer: D }), context(), { from: A, to: D }],
    [
      'LOCKUP_CHANGED',
      change({ lockup: { unixTimestamp: T + 30n * DAY, epoch: 0n, custodian: K } }),
      context(),
      { changes: ['extended'], fromLockUntil: T.toString(), toLockUntil: (T + 30n * DAY).toString(), fromCustodian: K, toCustodian: K },
    ],
    [
      'BALANCE_DECREASED',
      change({ lamports: 3_001_666_240n }),
      context(),
      { fromLamports: '5001666240', toLamports: '3001666240' },
    ],
    ['ACCOUNT_CLOSED', null, context(), {}],
    ['EXPIRED', locked, context(T), { lockUntil: T.toString() }],
  ];

  it('the cases below cover every event type', () => {
    expect(cases.map(([type]) => type)).toEqual(MONITOR_EVENT_TYPES);
  });

  it.each(cases)('%s exactly once on its change', (type, next, ctx, details) => {
    expect(diffSnapshots(previous, next, ctx)).toEqual([{ type, details, stakeAccount: STAKE, slot: 200n }]);
  });

  it('ACCOUNT_CLOSED is the only event when the account is gone', () => {
    expect(diffSnapshots(previous, null, context(T + DAY))).toEqual([
      { type: 'ACCOUNT_CLOSED', details: {}, stakeAccount: STAKE, slot: 200n },
    ]);
  });

  it('every change at once gives every type once, in the documented order', () => {
    const next = change({
      lamports: 1_666_240n,
      staker: X,
      withdrawer: X,
      lockup: { unixTimestamp: T, epoch: 0n, custodian: X },
      delegation: { voter: V2, stake: 5_000_000_000n, activationEpoch: EPOCH, deactivationEpoch: EPOCH },
    });
    expect(types(diffSnapshots(previous, next, context(T)))).toEqual(
      MONITOR_EVENT_TYPES.filter((type) => type !== 'ACCOUNT_CLOSED'),
    );
  });

  it('a thief with the main key: deactivate, new staker and a split in one pass', () => {
    const next = change({
      lamports: 2_001_666_240n,
      staker: X,
      delegation: { voter: V1, stake: 2_000_000_000n, activationEpoch: 990n, deactivationEpoch: EPOCH },
    });
    const events = diffSnapshots(previous, next, context());
    expect(types(events)).toEqual(['DEACTIVATED', 'STAKER_CHANGED', 'BALANCE_DECREASED']);
    expect(needsWithdrawerRescan(events)).toBe(true);
  });

  it('a new withdrawer and a lower balance are both reported', () => {
    expect(types(diffSnapshots(previous, change({ withdrawer: X, lamports: 1_666_240n }), context()))).toEqual([
      'WITHDRAWER_CHANGED',
      'BALANCE_DECREASED',
    ]);
  });

  it('rescue: both authorities move to the new wallet, the lock stays', () => {
    const events = diffSnapshots(previous, change({ staker: D, withdrawer: D }), context());
    expect(events.map((e) => ({ type: e.type, details: e.details }))).toEqual([
      { type: 'STAKER_CHANGED', details: { from: A, to: D } },
      { type: 'WITHDRAWER_CHANGED', details: { from: A, to: D } },
    ]);
  });

  it('throws when the snapshot and the account are different accounts', () => {
    expect(() => diffSnapshots(previous, { ...locked, address: key(9) }, context())).toThrow(/compared with/);
  });

  describe('delegation', () => {
    const initialized = snapshotOf({ ...locked, kind: 'initialized', delegation: null }, 100n, CHECKED_AT);
    const deactivated = snapshotOf(
      change({ delegation: { voter: V1, stake: 5_000_000_000n, activationEpoch: 990n, deactivationEpoch: 995n } }),
      100n,
      CHECKED_AT,
    );

    it('the first delegation of an initialized account is DELEGATION_CHANGED from no voter', () => {
      const events = diffSnapshots(initialized, locked, context());
      expect(events.map((e) => [e.type, e.details])).toEqual([['DELEGATION_CHANGED', { fromVoter: null, toVoter: V1 }]]);
    });

    it('delegated and deactivated in the same epoch between two passes: both events', () => {
      const next = change({ delegation: { voter: V1, stake: 5_000_000_000n, activationEpoch: EPOCH, deactivationEpoch: EPOCH } });
      expect(types(diffSnapshots(initialized, next, context()))).toEqual(['DEACTIVATED', 'DELEGATION_CHANGED']);
    });

    it('a deactivated account that stays deactivated gives nothing', () => {
      const next = change({ delegation: { voter: V1, stake: 5_000_000_000n, activationEpoch: 990n, deactivationEpoch: 995n } });
      expect(diffSnapshots(deactivated, next, context())).toEqual([]);
    });

    it('re-activation (deactivation cancelled, same voter) is DELEGATION_CHANGED', () => {
      expect(types(diffSnapshots(deactivated, locked, context()))).toEqual(['DELEGATION_CHANGED']);
    });

    it('re-delegation to the same voter after the cooldown is DELEGATION_CHANGED', () => {
      const next = change({ delegation: { voter: V1, stake: 5_000_000_000n, activationEpoch: EPOCH, deactivationEpoch: U64_MAX } });
      const events = diffSnapshots(deactivated, next, context());
      expect(events.map((e) => [e.type, e.details])).toEqual([['DELEGATION_CHANGED', { fromVoter: V1, toVoter: V1 }]]);
    });

    it('re-delegation to another voter after deactivation is DELEGATION_CHANGED only', () => {
      const next = change({ delegation: { voter: V2, stake: 5_000_000_000n, activationEpoch: EPOCH, deactivationEpoch: U64_MAX } });
      expect(types(diffSnapshots(deactivated, next, context()))).toEqual(['DELEGATION_CHANGED']);
    });

    it('re-delegated and deactivated again between passes: DEACTIVATED and DELEGATION_CHANGED', () => {
      const next = change({ delegation: { voter: V2, stake: 5_000_000_000n, activationEpoch: EPOCH, deactivationEpoch: EPOCH } });
      expect(types(diffSnapshots(deactivated, next, context()))).toEqual(['DEACTIVATED', 'DELEGATION_CHANGED']);
    });
  });

  describe('lockup changes', () => {
    const lockupChanges = (unixTimestamp: bigint, custodian: Address = K, now = NOW) => {
      const events = diffSnapshots(previous, change({ lockup: { unixTimestamp, epoch: 0n, custodian } }), context(now));
      expect(types(events)).toEqual(['LOCKUP_CHANGED']);
      const [event] = events;
      return event?.type === 'LOCKUP_CHANGED' ? event.details.changes : undefined;
    };

    it('later end: extended', () => {
      expect(lockupChanges(T + 1n)).toEqual(['extended']);
    });

    it('earlier end still in the future: shortened', () => {
      expect(lockupChanges(NOW + 1n)).toEqual(['shortened']);
    });

    it('end set to 0 (early unlock): removed', () => {
      expect(lockupChanges(0n)).toEqual(['removed']);
    });

    it('end set to now or a past time: removed, the lock is no longer in force', () => {
      expect(lockupChanges(NOW)).toEqual(['removed']);
      expect(lockupChanges(NOW - DAY)).toEqual(['removed']);
    });

    it('only the second key changed', () => {
      expect(lockupChanges(T, K2)).toEqual(['custodian-changed']);
    });

    it('second key replaced and the end moved at once (F7)', () => {
      expect(lockupChanges(T - DAY, K2)).toEqual(['shortened', 'custodian-changed']);
      expect(lockupChanges(0n, K2)).toEqual(['removed', 'custodian-changed']);
    });

    it('protect again after the lock ended is extended', () => {
      const expired = snapshotOf(change({ lockup: { unixTimestamp: NOW - DAY, epoch: 0n, custodian: K } }), 1n, CHECKED_AT);
      const events = diffSnapshots(expired, change({ lockup: { unixTimestamp: T, epoch: 0n, custodian: K2 } }), context());
      expect(events).toMatchObject([{ type: 'LOCKUP_CHANGED', details: { changes: ['extended', 'custodian-changed'] } }]);
    });
  });

  describe('EXPIRED', () => {
    it('not before T', () => {
      expect(diffSnapshots(previous, locked, context(T - 1n))).toEqual([]);
    });

    it('exactly at T, when the stake program no longer enforces the lock', () => {
      expect(types(diffSnapshots(previous, locked, context(T)))).toEqual(['EXPIRED']);
    });

    it('on the first pass after T, however late', () => {
      expect(types(diffSnapshots(previous, locked, context(T + 3n * DAY)))).toEqual(['EXPIRED']);
    });

    it('once: the pass after the one that reported it gives nothing', () => {
      const atT = snapshotOf(locked, 300n, Number(T) * 1000);
      expect(diffSnapshots(atT, locked, context(T + 120n))).toEqual([]);
    });

    it('a previous check one millisecond before T still counts as in force', () => {
      const justBefore = snapshotOf(locked, 300n, Number(T) * 1000 - 1);
      expect(types(diffSnapshots(justBefore, locked, context(T)))).toEqual(['EXPIRED']);
    });

    it('never for an account without a lockup', () => {
      const unlocked = change({ lockup: { unixTimestamp: 0n, epoch: 0n, custodian: K } });
      expect(diffSnapshots(snapshotOf(unlocked, 1n, CHECKED_AT), unlocked, context(T))).toEqual([]);
    });

    it('not when the lock was extended in the same window (LOCKUP_CHANGED instead)', () => {
      const extended = change({ lockup: { unixTimestamp: T + DAY, epoch: 0n, custodian: K } });
      expect(types(diffSnapshots(previous, extended, context(T)))).toEqual(['LOCKUP_CHANGED']);
    });

    it('together with a withdrawal right after the end', () => {
      expect(types(diffSnapshots(previous, change({ lamports: 1_666_240n }), context(T + 60n)))).toEqual([
        'BALANCE_DECREASED',
        'EXPIRED',
      ]);
    });
  });
});

describe('withdrawer rescan', () => {
  it('follows DEACTIVATED, STAKER_CHANGED, BALANCE_DECREASED (section 8) and ACCOUNT_CLOSED (a full split)', () => {
    expect([...WITHDRAWER_RESCAN_EVENTS].sort()).toEqual(
      ['ACCOUNT_CLOSED', 'BALANCE_DECREASED', 'DEACTIVATED', 'STAKER_CHANGED'].sort(),
    );
    expect(needsWithdrawerRescan([{ type: 'LOCKUP_CHANGED' }, { type: 'EXPIRED' }])).toBe(false);
    expect(needsWithdrawerRescan([{ type: 'LOCKUP_CHANGED' }, { type: 'ACCOUNT_CLOSED' }])).toBe(true);
    expect(needsWithdrawerRescan([])).toBe(false);
  });
});

describe('formatAlert', () => {
  const lockedNow = { withdrawer: A, custodian: K, lockUntil: T, now: NOW };
  const alertFor = (next: StakeAccount | null, ctx = context()) => {
    const [event] = diffSnapshots(previous, next, ctx);
    if (event === undefined) throw new Error('no event');
    return event;
  };

  it('matches the section 8 example for a deactivation', () => {
    const event = alertFor(
      change({ delegation: { voter: V1, stake: 5_000_000_000n, activationEpoch: 990n, deactivationEpoch: EPOCH } }),
    );
    expect(formatAlert(event, lockedNow)).toEqual({
      text:
        'Stake 7xKT...A9fQ was deactivated. If this was not you, your main key may be stolen. ' +
        'Your SOL cannot be withdrawn without the second key.',
      buttonLabel: 'Open Rescue',
      path: `/rescue?address=${A}`,
    });
  });

  it('Open Rescue opens the rescue wizard with the stored main key filled in', () => {
    const event = alertFor(change({ staker: X }));
    expect(formatAlert(event, lockedNow)).toMatchObject({ buttonLabel: 'Open Rescue', path: `/rescue?address=${A}` });
    expect(formatAlert(event, { ...lockedNow, withdrawer: D }).path).toBe(`/rescue?address=${D}`);
  });

  it('says when the lock no longer protects the SOL', () => {
    const event = alertFor(change({ staker: X }));
    expect(formatAlert(event, { ...lockedNow, now: T }).text).toBe(
      'The key that can deactivate and delegate stake 7xKT...A9fQ changed to ' +
        `${X.slice(0, 4)}...${X.slice(-4)}. If this was not you, your main key may be stolen. ` +
        'The lock is not in force, so the main key alone can withdraw this SOL.',
    );
  });

  it('names the new owner and links to its accounts', () => {
    const event = alertFor(change({ withdrawer: D }));
    const alert = formatAlert(event, { ...lockedNow, withdrawer: D });
    expect(alert.text).toContain('The main key of stake 7xKT...A9fQ changed to');
    expect(alert.text).toContain('If this was not your rescue, both of your keys may be stolen.');
    expect(alert.path).toBe(`/app?address=${D}`);
  });

  describe('a lock change', () => {
    const lockMoved = (unixTimestamp: bigint, custodian: Address = K) =>
      alertFor(change({ lockup: { unixTimestamp, epoch: 0n, custodian } }));
    const secondKeyStolen = 'Only the second key can do this. If this was not you, your second key may be stolen.';
    // SECURITY-CHECK П9: the way out for an owner who still has the second key, and no promise to one who lost it.
    // Every sentence names the key it means: no "it" that could read as "this SOL".
    const removeAndProtect =
      'Only the second key can do this. If this was not you, your second key may be stolen. ' +
      'In that case, if you still have the second key, remove the lock with it now, then protect this stake again with a ' +
      'new second key; until then the main key alone can withdraw this SOL. ' +
      'If you no longer have the second key, you cannot undo this, but your SOL still cannot leave without the main key.';
    const accountsButton = { buttonLabel: 'Open Stakeward', path: `/app?address=${A}` };
    // A routine renewal by the second key (the answer to a reminder) moves the date too: a neutral button to the lock's
    // page, which offers both a new end and the removal, never straight to the removal.
    const lockButton = { buttonLabel: 'Review the lock', path: `/extend/${STAKE}` };
    const short = (address: Address) => `${address.slice(0, 4)}...${address.slice(-4)}`;

    it('the second key extended a lock in force: remove it now and protect again; the button opens the lock page', () => {
      expect(formatAlert(lockMoved(T + 30n * DAY), { ...lockedNow, lockUntil: T + 30n * DAY })).toEqual({
        text: `The lock on stake 7xKT...A9fQ was extended to 12 May 2027. ${removeAndProtect}`,
        ...lockButton,
      });
    });

    it('shortened and still in force: the same advice and button', () => {
      expect(formatAlert(lockMoved(NOW + 10n * DAY), { ...lockedNow, lockUntil: NOW + 10n * DAY })).toEqual({
        text: `The lock on stake 7xKT...A9fQ was shortened to 11 October 2026. ${removeAndProtect}`,
        ...lockButton,
      });
    });

    it('delivered only after a later pass saw another second key: no advice for the old key, the accounts page', () => {
      // The date move by K went out late (Telegram down, a full window); meanwhile the lock passed to K2, so K can no
      // longer remove it.
      expect(formatAlert(lockMoved(T + 30n * DAY), { ...lockedNow, custodian: K2, lockUntil: T + 30n * DAY })).toEqual({
        text: `The lock on stake 7xKT...A9fQ was extended to 12 May 2027. ${secondKeyStolen}`,
        ...accountsButton,
      });
    });

    it('the moved lock has ended by the time the alert goes out: nothing to remove, the accounts page', () => {
      const event = lockMoved(NOW + DAY);
      expect(formatAlert(event, { ...lockedNow, lockUntil: NOW + DAY, now: NOW + 2n * DAY })).toEqual({
        text: `The lock on stake 7xKT...A9fQ was shortened to 2 October 2026. ${secondKeyStolen}`,
        ...accountsButton,
      });
    });

    it('a new second key: it may be stolen; the accounts page, since only that key can change the lock now', () => {
      expect(formatAlert(lockMoved(T, K2), lockedNow)).toEqual({
        text: `The second key of stake 7xKT...A9fQ changed to ${short(K2)}. ${secondKeyStolen}`,
        ...accountsButton,
      });
    });

    it('a new second key and a new end at once (F7): the accounts page', () => {
      expect(formatAlert(lockMoved(T + DAY, K2), { ...lockedNow, lockUntil: T + DAY })).toEqual({
        text: `The lock on stake 7xKT...A9fQ was extended to 13 April 2027. Its second key is now ${short(K2)}. ${secondKeyStolen}`,
        ...accountsButton,
      });
    });

    it('warns that a removed lock leaves the main key alone in control, and says to protect it again with a new key', () => {
      expect(formatAlert(lockMoved(0n), { ...lockedNow, lockUntil: 0n })).toEqual({
        text:
          'The lock on stake 7xKT...A9fQ was removed. Only the second key can do this. ' +
          'If this was not you, your second key may be stolen. The main key alone can now withdraw this SOL. ' +
          'If you did not remove it, protect this stake again now with your main key and a new second key.',
        ...accountsButton,
      });
    });

    it('a removal delivered only after a later pass saw a new lock: no advice to protect again', () => {
      // Removed on purpose (the F3 fallback) or not, the stake is locked again by the time the alert goes out.
      expect(formatAlert(lockMoved(0n), { ...lockedNow, lockUntil: T })).toEqual({
        text:
          'The lock on stake 7xKT...A9fQ was removed. Only the second key can do this. ' +
          'If this was not you, your second key may be stolen. The main key alone can now withdraw this SOL.',
        ...accountsButton,
      });
    });

    it('a new lock after the old one ended: the main key could set it, so the main key may be stolen', () => {
      const ended = snapshotOf(change({ lockup: { unixTimestamp: NOW - DAY, epoch: 0n, custodian: K } }), 1n, CHECKED_AT);
      const [event] = diffSnapshots(ended, locked, context());
      if (event === undefined) throw new Error('no event');
      expect(formatAlert(event, lockedNow)).toEqual({
        text: 'The lock on stake 7xKT...A9fQ was extended to 12 April 2027. If this was not you, your main key may be stolen.',
        ...accountsButton,
      });
    });

    it('the removal advice stays plain text in the UI vocabulary and links to the site', () => {
      const alert = formatAlert(lockMoved(T + 30n * DAY), { ...lockedNow, lockUntil: T + 30n * DAY });
      expect(alert.text).not.toMatch(/custodian|withdrawer|staker|<|>|\*|_|`|\[/i);
      expect(alert.path).toMatch(/^\/extend\/[1-9A-HJ-NP-Za-km-z]+$/);
    });
  });

  it('reports the amount that left the stake', () => {
    const event = alertFor(change({ lamports: 3_001_666_240n }));
    expect(formatAlert(event, lockedNow).text).toMatch(/^2 SOL left stake 7xKT\.\.\.A9fQ; 3\.00166624 SOL remains\. /);
  });

  it('expired: asks to protect again and gives the date', () => {
    const event = alertFor(locked, context(T));
    expect(formatAlert(event, { ...lockedNow, now: T })).toEqual({
      text:
        'The lock on stake 7xKT...A9fQ ended on 12 April 2027. ' +
        'The main key alone can now withdraw this SOL. Protect it again to keep it safe.',
      buttonLabel: 'Protect again',
      path: `/app?address=${A}`,
    });
  });

  it('every event type has a plain-text alert in the UI vocabulary', () => {
    const next = change({
      lamports: 1_666_240n,
      staker: X,
      withdrawer: X,
      lockup: { unixTimestamp: T, epoch: 0n, custodian: K2 },
      delegation: { voter: V2, stake: 5_000_000_000n, activationEpoch: EPOCH, deactivationEpoch: EPOCH },
    });
    const events = [...diffSnapshots(previous, next, context(T)), ...diffSnapshots(previous, null, context())];
    expect(new Set(types(events))).toEqual(new Set(MONITOR_EVENT_TYPES));
    for (const event of events) {
      const alert = formatAlert(event, lockedNow);
      expect(alert.text.length).toBeGreaterThan(20);
      expect(alert.text).not.toMatch(/custodian|withdrawer|staker|<|>/i);
      expect(alert.buttonLabel).not.toBe('');
      expect(alert.path).toMatch(/^\/(rescue|app)\?address=[1-9A-HJ-NP-Za-km-z]+$/);
    }
  });
});

describe('reminders', () => {
  it('thresholds: the smallest of 30, 14, 7, 3, 1 days that the time left fits in', () => {
    expect(REMINDER_DAYS).toEqual([30, 14, 7, 3, 1]);
    expect(reminderDue(T, T - 31n * DAY, null)).toBeNull();
    expect(reminderDue(T, T - 30n * DAY, null)).toBe(30);
    expect(reminderDue(T, T - 29n * DAY, null)).toBe(30);
    expect(reminderDue(T, T - 14n * DAY, null)).toBe(14);
    expect(reminderDue(T, T - 6n * DAY - DAY / 2n, null)).toBe(7);
    expect(reminderDue(T, T - 3n * DAY, null)).toBe(3);
    expect(reminderDue(T, T - 18n * 3_600n, null)).toBe(1);
    expect(reminderDue(T, T, null)).toBeNull();
    expect(reminderDue(T, T + DAY, null)).toBeNull();
  });

  it('each threshold fires once', () => {
    let last: number | null = null;
    const sent: number[] = [];
    for (let day = 40n; day >= 0n; day -= 1n) {
      const due = reminderDue(T, T - day * DAY + 6n * 3_600n, last); // daily pass at 06:00 UTC
      if (due !== null) {
        sent.push(due);
        last = due;
      }
    }
    expect(sent).toEqual([30, 14, 7, 3, 1]);
  });

  it('starts over after the lock is extended, without resetting the stored value', () => {
    expect(reminderDue(T + 20n * DAY, T - 2n * DAY, 3)).toBe(30);
    expect(reminderDue(T, T - 2n * DAY, 3)).toBeNull();
  });

  it('reminder text and the extend link for the second key', () => {
    expect(formatReminder({ stakeAccount: STAKE, lockUntil: T, now: T - 7n * DAY + 6n * 3_600n })).toEqual({
      text:
        'The lock on stake 7xKT...A9fQ ends on 12 April 2027 (in 7 days). ' +
        'After that the main key alone can withdraw this SOL. Your second key can extend the lock.',
      buttonLabel: 'Extend lock',
      path: `/extend/${STAKE}`,
    });
    expect(formatReminder({ stakeAccount: STAKE, lockUntil: T, now: T - 3_600n }).text).toContain('(within a day)');
    expect(formatReminder({ stakeAccount: STAKE, lockUntil: T, now: T })).toMatchObject({
      text: expect.stringContaining('ended on 12 April 2027') as unknown,
      path: '/app',
    });
  });

  it('reminders stay in the UI vocabulary', () => {
    for (const days of REMINDER_DAYS) {
      const { text } = formatReminder({ stakeAccount: STAKE, lockUntil: T, now: T - BigInt(days) * DAY });
      expect(text).toContain(days === 1 ? '(within a day)' : `(in ${String(days)} days)`);
      expect(text).not.toMatch(/custodian|withdrawer/i);
    }
  });
});
