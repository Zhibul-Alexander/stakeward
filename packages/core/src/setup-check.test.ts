import { getAddressDecoder, type Address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { ZERO_ADDRESS } from './constants.ts';
import type { StakeAccount } from './decode.ts';
import { setupCheck, type SetupCheckId, type SetupCheckInput } from './setup-check.ts';

const key = (n: number): Address => getAddressDecoder().decode(new Uint8Array(32).fill(n));
const DAY = 86_400n;
const NOW = 1_800_000_000n;
const clock = { unixTimestamp: NOW, epoch: 1_000n };
const A = key(1);
const K = key(2);
const OTHER = key(3);
const SERVICE = key(4);

let next = 50;
function stake(options: { lockUntil?: bigint; custodian?: Address; staker?: Address; withdrawer?: Address; sol?: bigint; epoch?: bigint } = {}): StakeAccount {
  next += 1;
  return {
    address: key(next),
    lamports: (options.sol ?? 10n) * 1_000_000_000n,
    kind: 'initialized',
    rentExemptReserve: 2_282_880n,
    staker: options.staker ?? A,
    withdrawer: options.withdrawer ?? A,
    lockup: { unixTimestamp: options.lockUntil ?? 0n, epoch: options.epoch ?? 0n, custodian: options.custodian ?? ZERO_ADDRESS },
    delegation: null,
  };
}
const locked = (days: bigint, extra: Parameters<typeof stake>[0] = {}) => stake({ lockUntil: NOW + days * DAY, custodian: K, ...extra });

function run(accounts: StakeAccount[], extra: Partial<SetupCheckInput> = {}) {
  return setupCheck({ mainKey: A, accounts, clock, knownSecondKeys: [K], rescueKits: {}, ...extra });
}
const byId = (result: ReturnType<typeof run>, id: SetupCheckId) => {
  const found = result.items.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`no check ${id}`);
  return found;
};

describe('setupCheck', () => {
  it('always lists the seven checks in a fixed order', () => {
    expect(run([]).items.map((entry) => entry.id)).toEqual([
      'locked',
      'not-ending',
      'second-key',
      'alerts',
      'rescue-kit',
      'staker',
      'recovery-card',
    ]);
  });

  it('with no stake account everything is not applicable and nothing is scored', () => {
    const result = run([]);
    expect(result.items.every((entry) => entry.status === 'not-applicable')).toBe(true);
    expect([result.passed, result.total, result.accountCount, result.lamports]).toEqual([0, 0, 0, 0n]);
  });

  it('passes a fully set up stake; alerts stay unknown and the card is a reminder', () => {
    const a = locked(200n);
    const b = locked(100n, { sol: 5n });
    const result = run([a, b], { rescueKits: { [a.address]: 'ready', [b.address]: 'ready' } });
    expect(result.items.map((entry) => [entry.id, entry.status])).toEqual([
      ['locked', 'pass'],
      ['not-ending', 'pass'],
      ['second-key', 'pass'],
      ['alerts', 'unknown'],
      ['rescue-kit', 'pass'],
      ['staker', 'pass'],
      ['recovery-card', 'info'],
    ]);
    expect([result.passed, result.total]).toEqual([5, 5]);
    expect(byId(result, 'recovery-card').findings.map((f) => f.reason)).toEqual(['card', 'card']);
    expect([result.accountCount, result.lockedCount, result.lamports, result.lockedLamports]).toEqual([2, 2, 15_000_000_000n, 15_000_000_000n]);
  });

  it('fails "locked" for every account without a lock, an ended one, or one the main key holds itself', () => {
    const open = stake();
    const ended = stake({ lockUntil: NOW, custodian: K });
    const self = stake({ lockUntil: NOW + 100n * DAY, custodian: A });
    const good = locked(100n);
    const result = run([open, ended, self, good]);
    const check = byId(result, 'locked');
    expect(check.status).toBe('fail');
    expect(check.findings.map((f) => f.account).sort()).toEqual([open.address, ended.address, self.address].sort());
    expect(check.findings.every((f) => f.reason === 'no-lock')).toBe(true);
    // The self-held lock breaks the second-key rule too.
    expect(byId(result, 'second-key').findings).toEqual([{ account: self.address, reason: 'main-key' }]);
    // Only the real lock is in the locked totals; every lock in force has its end.
    expect(result.lockedCount).toBe(1);
    expect(result.lockEnds).toEqual({ [self.address]: NOW + 100n * DAY, [good.address]: NOW + 100n * DAY });
  });

  it('flags a lock that ends within 30 days, never one that has 30 days left exactly or one its epoch holds', () => {
    const soon = locked(29n);
    const exactly = locked(30n);
    const epochHeld = stake({ lockUntil: NOW + DAY, custodian: K, epoch: 1_001n });
    const check = byId(run([soon, exactly, epochHeld]), 'not-ending');
    expect(check.status).toBe('fail');
    expect(check.findings).toEqual([{ account: soon.address, reason: 'ends-soon' }]);
  });

  it('"not-ending" and "rescue-kit" are not applicable without a lock', () => {
    const result = run([stake()]);
    expect(byId(result, 'not-ending').status).toBe('not-applicable');
    expect(byId(result, 'rescue-kit').status).toBe('not-applicable');
    expect(byId(result, 'second-key').status).toBe('not-applicable');
    expect(byId(result, 'recovery-card').status).toBe('not-applicable');
    expect([result.passed, result.total]).toEqual([1, 2]);
  });

  describe('second key', () => {
    it('fails a lock held by a key this browser does not know, once it knows one (D102)', () => {
      const other = stake({ lockUntil: NOW + 100n * DAY, custodian: OTHER });
      const check = byId(run([other, locked(100n)]), 'second-key');
      expect(check.status).toBe('fail');
      expect(check.findings).toEqual([{ account: other.address, reason: 'locked-by-other' }]);
    });

    it('is unknown, not failed, while this browser knows no second key (a new device)', () => {
      const a = locked(100n);
      const check = byId(run([a], { knownSecondKeys: [] }), 'second-key');
      expect(check.status).toBe('unknown');
      expect(check.findings).toEqual([{ account: a.address, reason: 'second-key-not-known' }]);
    });

    it('fails a second key that is the stake key or the stake account itself', () => {
      const asStaker = stake({ lockUntil: NOW + 100n * DAY, custodian: SERVICE, staker: SERVICE });
      const self = stake({ lockUntil: NOW + 100n * DAY });
      const asAccount = { ...self, lockup: { ...self.lockup, custodian: self.address } };
      const zero = stake({ lockUntil: NOW + 100n * DAY, custodian: ZERO_ADDRESS });
      const check = byId(run([asStaker, asAccount, zero], { knownSecondKeys: [SERVICE] }), 'second-key');
      expect(check.status).toBe('fail');
      expect(Object.fromEntries(check.findings.map((f) => [f.account, f.reason]))).toEqual({
        [asStaker.address]: 'staker',
        [asAccount.address]: 'stake-account',
        [zero.address]: 'zero-key',
      });
    });

    it('a failing account wins over an unknown one', () => {
      const asStaker = stake({ lockUntil: NOW + 100n * DAY, custodian: SERVICE, staker: SERVICE });
      const check = byId(run([asStaker, locked(100n)], { knownSecondKeys: [] }), 'second-key');
      expect(check.status).toBe('fail');
      expect(check.findings.map((f) => f.reason)).toEqual(['staker', 'second-key-not-known']);
    });
  });

  describe('alerts', () => {
    it('is unknown and unscored by default: the site cannot know (D125)', () => {
      const result = run([locked(100n)]);
      expect(byId(result, 'alerts').status).toBe('unknown');
      expect(result.total).toBe(4);
    });

    it('counts when the caller knows', () => {
      expect(byId(run([locked(100n)], { alerts: 'linked' }), 'alerts').status).toBe('pass');
      const result = run([locked(100n)], { alerts: 'not-linked' });
      expect(byId(result, 'alerts').status).toBe('fail');
      expect(result.total).toBe(5);
    });
  });

  describe('rescue kit', () => {
    it('is optional and lists locked accounts without a ready kit, then those not read', () => {
      const ready = locked(100n);
      const missing = locked(100n);
      const unread = locked(100n);
      const check = byId(run([ready, missing, unread, stake()], { rescueKits: { [ready.address]: 'ready', [missing.address]: 'missing' } }), 'rescue-kit');
      expect(check.optional).toBe(true);
      expect(check.status).toBe('fail');
      expect(check.findings).toEqual([
        { account: missing.address, reason: 'no-kit' },
        { account: unread.address, reason: 'kit-unknown' },
      ]);
    });

    it('is unknown while a kit could not be read and none is missing', () => {
      const a = locked(100n);
      const result = run([a]);
      expect(byId(result, 'rescue-kit').status).toBe('unknown');
      expect(result.total).toBe(4);
    });
  });

  it('flags another stake key: a changed one under a lock, a service without one', () => {
    const changed = locked(100n, { staker: OTHER });
    const service = stake({ staker: SERVICE });
    const check = byId(run([changed, service]), 'staker');
    expect(check.status).toBe('fail');
    expect(Object.fromEntries(check.findings.map((f) => [f.account, f.reason]))).toEqual({
      [changed.address]: 'staker-changed',
      [service.address]: 'managed-by-service',
    });
  });

  it('checks only the accounts of the main key, each once', () => {
    const mine = locked(100n);
    const someoneElses = stake({ withdrawer: OTHER, lockUntil: NOW + 100n * DAY, custodian: A });
    const result = run([mine, mine, someoneElses], { rescueKits: { [mine.address]: 'ready' } });
    expect(result.accountCount).toBe(1);
    expect(result.items.flatMap((entry) => entry.findings.map((f) => f.account))).toEqual([mine.address]);
  });

  it('scores pass over pass + fail of the scored checks', () => {
    const result = run([stake(), locked(10n)], { rescueKits: {} });
    // locked: fail, not-ending: fail, second-key: pass, alerts: unknown, rescue-kit: unknown, staker: pass.
    expect([result.passed, result.total]).toEqual([2, 4]);
  });

  it('is deterministic: the same input in another order gives the same result', () => {
    const a = locked(10n);
    const b = stake();
    const c = locked(100n, { staker: OTHER });
    expect(run([a, b, c])).toEqual(run([c, b, a]));
  });
});
