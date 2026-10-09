// Property test of the monitor fast path (DECISIONS.md D49). Accounts are encoded with the generated stake client,
// changed one field at a time and in 10 000 random pairs, and decoded the way the worker's full path does. Whenever
// canSkipDecode says yes, diffSnapshots on the decoded accounts finds nothing.
import { getAddressDecoder, getBase64Decoder, getBase64Encoder, type Address } from '@solana/kit';
import { getStakeStateAccountEncoder, type StakeStateV2Args } from '@solana-program/stake';
import { describe, expect, it } from 'vitest';
import {
  I64_MAX,
  STAKE_ACCOUNT_SIZE,
  STAKE_PROGRAM_ADDRESS,
  SYSTEM_PROGRAM_ADDRESS,
  U64_MAX,
  ZERO_ADDRESS,
} from './constants.ts';
import { decodeStakeAccount, type StakeAccount } from './decode.ts';
import { diffSnapshots, snapshotOf, type MonitorEvent, type MonitorEventType } from './diff.ts';
import { canSkipDecode, STAKE_DATA_BASE64_LENGTH, stakeDataFingerprint } from './fingerprint.ts';

const key = (n: number): Address => getAddressDecoder().decode(new Uint8Array(32).fill(n));
const STAKE = key(9);
const KEYS = [key(1), key(2), key(3), key(4), ZERO_ADDRESS];

const DAY = 86_400n;
/** 2026-10-01T00:00:00Z, epoch 1000; the previous pass ran two minutes earlier. */
const NOW = 1_790_812_800n;
const NOW_MS = Number(NOW) * 1000;
const PASS_MS = 120_000;
const EPOCH = 1_000n;
const I64_MIN = -I64_MAX - 1n;
const LOW_48_BITS = (1n << 48n) - 1n;

/** Every value the 200 bytes of a stake account hold, as the generated encoder takes them, plus the balance. */
type Fields = {
  kind: StakeStateV2Args['__kind'];
  rentExemptReserve: bigint;
  staker: Address;
  withdrawer: Address;
  lockUntil: bigint;
  lockupEpoch: bigint;
  custodian: Address;
  // Encoded only in the Stake state:
  voter: Address;
  stake: bigint;
  activationEpoch: bigint;
  deactivationEpoch: bigint;
  /** The deprecated f64 warmup_cooldown_rate, `reserved` in the generated client. */
  warmup: number[];
  credits: bigint;
  flags: number;
  /** Bytes 197..199 after the Stake state; the program leaves them zero, the fingerprint must not care. */
  padding: number[];
  lamports: bigint;
};

const stateEncoder = getStakeStateAccountEncoder();
const toBase64 = getBase64Decoder();
const fromBase64 = getBase64Encoder();

function encodeBytes(f: Fields): Uint8Array {
  const meta = {
    rentExemptReserve: f.rentExemptReserve,
    authorized: { staker: f.staker, withdrawer: f.withdrawer },
    lockup: { unixTimestamp: f.lockUntil, epoch: f.lockupEpoch, custodian: f.custodian },
  };
  let state: StakeStateV2Args;
  switch (f.kind) {
    case 'Initialized':
      state = { __kind: 'Initialized', fields: [meta] };
      break;
    case 'Stake':
      state = {
        __kind: 'Stake',
        fields: [
          meta,
          {
            delegation: {
              voterPubkey: f.voter,
              stake: f.stake,
              activationEpoch: f.activationEpoch,
              deactivationEpoch: f.deactivationEpoch,
              reserved: f.warmup,
            },
            creditsObserved: f.credits,
          },
          { bits: f.flags },
        ],
      };
      break;
    default:
      state = { __kind: f.kind };
  }
  const encoded = stateEncoder.encode({ state });
  const data = new Uint8Array(STAKE_ACCOUNT_SIZE);
  data.set(encoded);
  if (f.kind === 'Stake') data.set(f.padding, encoded.length);
  return data;
}

const encode = (f: Fields): string => toBase64.decode(encodeBytes(f));

/** The worker's full path: base64 to bytes, then the generated client; anything that does not decode reads as null. */
function decodeRead(dataBase64: string, lamports: bigint): StakeAccount | null {
  const result = decodeStakeAccount({
    address: STAKE,
    data: fromBase64.encode(dataBase64),
    lamports,
    owner: STAKE_PROGRAM_ADDRESS,
  });
  return result.ok ? result.account : null;
}

type Case = { prev: Fields; next: Fields; prevCheckedAt: number; checkedAt: number; epoch: bigint };

/** The fast path's answer and the full comparison's answer for the stored `prev` read again as `next`. */
function run(c: Case): { skip: boolean; events: MonitorEvent[]; samePrint: boolean } {
  const prevData = encode(c.prev);
  const nextData = encode(c.next);
  const previous = decodeRead(prevData, c.prev.lamports);
  if (previous === null) throw new Error('a stored row always decodes');
  const fingerprint = stakeDataFingerprint(prevData);
  const skip = canSkipDecode(
    { fingerprint, lamports: c.prev.lamports, lockUntil: previous.lockup.unixTimestamp, checkedAt: c.prevCheckedAt },
    { owner: STAKE_PROGRAM_ADDRESS, dataBase64: nextData, lamports: c.next.lamports },
    c.checkedAt,
  );
  const events = diffSnapshots(snapshotOf(previous, 100n, c.prevCheckedAt), decodeRead(nextData, c.next.lamports), {
    slot: 200n,
    checkedAt: c.checkedAt,
    clock: { unixTimestamp: BigInt(Math.floor(c.checkedAt / 1000)), epoch: c.epoch },
  });
  return { skip, events, samePrint: stakeDataFingerprint(nextData) === fingerprint };
}

/** Oracle: the fingerprint is the same exactly when these encoded fields are (stake: its 2 high bytes only). */
function sameFingerprintFields(a: Fields, b: Fields): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind !== 'Initialized' && a.kind !== 'Stake') return true;
  const meta =
    a.rentExemptReserve === b.rentExemptReserve &&
    a.staker === b.staker &&
    a.withdrawer === b.withdrawer &&
    a.lockUntil === b.lockUntil &&
    a.lockupEpoch === b.lockupEpoch &&
    a.custodian === b.custodian;
  if (!meta || a.kind === 'Initialized') return meta;
  return (
    a.voter === b.voter &&
    a.stake >> 48n === b.stake >> 48n &&
    a.activationEpoch === b.activationEpoch &&
    a.deactivationEpoch === b.deactivationEpoch
  );
}

/** Deterministic random numbers (mulberry32), so a failure reproduces. */
function rng(seed: number) {
  let state = seed >>> 0;
  const float = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const int = (below: number): number => Math.floor(float() * below);
  const u32 = (): bigint => BigInt(int(4_294_967_296));
  return {
    float,
    int,
    pick: <T>(items: readonly T[]): T => {
      const item = items[int(items.length)];
      if (item === undefined) throw new Error('nothing to pick');
      return item;
    },
    u64: (): bigint => (u32() << 32n) | u32(),
    bytes: (n: number): number[] => Array.from({ length: n }, () => int(256)),
  };
}
type Rng = ReturnType<typeof rng>;

/** Edge values often, so that random pairs share them and the oracle sees both answers. */
function u64(r: Rng): bigint {
  return r.pick([0n, 1n, U64_MAX, EPOCH, EPOCH + 1n, BigInt(r.int(2_000)), r.u64()]);
}

/**
 * Lock ends. None falls in (NOW - 120 s, NOW], the window of the one-field cases; NOW - 120 s itself (the previous
 * check) is on the edge that does not count.
 */
function timestamp(r: Rng): bigint {
  return r.pick([0n, -1n, I64_MAX, I64_MIN, NOW - DAY, NOW - 120n, NOW + 180n * DAY, r.u64() + I64_MIN]);
}

const address = (r: Rng): Address => (r.float() < 0.8 ? r.pick(KEYS) : getAddressDecoder().decode(new Uint8Array(r.bytes(32))));

function randomFields(r: Rng, kind: 'Initialized' | 'Stake' = r.pick(['Initialized', 'Stake'] as const)): Fields {
  return {
    kind,
    rentExemptReserve: u64(r),
    staker: address(r),
    withdrawer: address(r),
    lockUntil: timestamp(r),
    lockupEpoch: u64(r),
    custodian: address(r),
    voter: address(r),
    stake: r.u64(),
    activationEpoch: u64(r),
    deactivationEpoch: u64(r),
    warmup: r.bytes(8),
    credits: r.u64(),
    flags: r.int(256),
    padding: r.bytes(3),
    lamports: BigInt(1 + r.int(2 ** 40)),
  };
}

/** A new value from `make` that differs from `old`. */
function other<T>(old: T, make: () => T): T {
  for (;;) {
    const value = make();
    if (value !== old) return value;
  }
}

/** Flips one byte of `bytes`. */
function otherBytes(bytes: readonly number[], r: Rng): number[] {
  const copy = [...bytes];
  const at = r.int(copy.length);
  copy[at] = (copy[at] ?? 0) ^ (1 + r.int(255));
  return copy;
}

type Mutation = {
  field: string;
  /** diffSnapshots reads it (or it shares base64 characters with what it reads): the fingerprint must change. */
  inFingerprint: boolean;
  /** Encoded only in the Stake state. */
  stakeOnly: boolean;
  mutate: (f: Fields, r: Rng) => Fields;
};

const KINDS: readonly Fields['kind'][] = ['Uninitialized', 'Initialized', 'Stake', 'RewardsPool'];

const MUTATIONS: readonly Mutation[] = [
  {
    field: 'state tag',
    inFingerprint: true,
    stakeOnly: false,
    mutate: (f, r) => ({ ...f, kind: other(f.kind, () => r.pick(KINDS)) }),
  },
  {
    field: 'rent reserve',
    inFingerprint: true,
    stakeOnly: false,
    mutate: (f, r) => ({ ...f, rentExemptReserve: other(f.rentExemptReserve, () => u64(r)) }),
  },
  {
    field: 'staker',
    inFingerprint: true,
    stakeOnly: false,
    mutate: (f, r) => ({ ...f, staker: other(f.staker, () => address(r)) }),
  },
  {
    field: 'withdrawer',
    inFingerprint: true,
    stakeOnly: false,
    mutate: (f, r) => ({ ...f, withdrawer: other(f.withdrawer, () => address(r)) }),
  },
  {
    field: 'lockup timestamp',
    inFingerprint: true,
    stakeOnly: false,
    mutate: (f, r) => ({ ...f, lockUntil: other(f.lockUntil, () => timestamp(r)) }),
  },
  {
    field: 'lockup epoch',
    inFingerprint: true,
    stakeOnly: false,
    mutate: (f, r) => ({ ...f, lockupEpoch: other(f.lockupEpoch, () => u64(r)) }),
  },
  {
    field: 'custodian',
    inFingerprint: true,
    stakeOnly: false,
    mutate: (f, r) => ({ ...f, custodian: other(f.custodian, () => address(r)) }),
  },
  {
    field: 'voter',
    inFingerprint: true,
    stakeOnly: true,
    mutate: (f, r) => ({ ...f, voter: other(f.voter, () => address(r)) }),
  },
  {
    field: 'delegated stake, 2 high bytes',
    inFingerprint: true,
    stakeOnly: true,
    mutate: (f, r) => ({ ...f, stake: f.stake ^ (BigInt(1 + r.int(0xffff)) << 48n) }),
  },
  {
    field: 'activation epoch',
    inFingerprint: true,
    stakeOnly: true,
    mutate: (f, r) => ({ ...f, activationEpoch: other(f.activationEpoch, () => u64(r)) }),
  },
  {
    field: 'deactivation epoch',
    inFingerprint: true,
    stakeOnly: true,
    mutate: (f, r) => ({ ...f, deactivationEpoch: other(f.deactivationEpoch, () => u64(r)) }),
  },
  {
    field: 'delegated stake, 6 low bytes',
    inFingerprint: false,
    stakeOnly: true,
    mutate: (f, r) => ({ ...f, stake: f.stake ^ other(0n, () => r.u64() & LOW_48_BITS) }),
  },
  {
    field: 'warmup rate',
    inFingerprint: false,
    stakeOnly: true,
    mutate: (f, r) => ({ ...f, warmup: otherBytes(f.warmup, r) }),
  },
  {
    field: 'credits_observed',
    inFingerprint: false,
    stakeOnly: true,
    mutate: (f, r) => ({ ...f, credits: other(f.credits, () => r.u64()) }),
  },
  {
    field: 'stake_flags',
    inFingerprint: false,
    stakeOnly: true,
    mutate: (f, r) => ({ ...f, flags: (f.flags + 1 + r.int(255)) % 256 }),
  },
  {
    field: 'padding after the Stake state',
    inFingerprint: false,
    stakeOnly: true,
    mutate: (f, r) => ({ ...f, padding: otherBytes(f.padding, r) }),
  },
];

/** A pass two minutes after the previous one, at NOW. */
const pass = (prev: Fields, next: Fields): Case => ({
  prev,
  next,
  prevCheckedAt: NOW_MS - PASS_MS,
  checkedAt: NOW_MS,
  epoch: EPOCH,
});

describe('stakeDataFingerprint', () => {
  it('takes the 268-char base64 of a 200-byte account and keeps 232 chars', () => {
    const data = encode(randomFields(rng(1), 'Stake'));
    expect(STAKE_DATA_BASE64_LENGTH).toBe(toBase64.decode(new Uint8Array(STAKE_ACCOUNT_SIZE)).length);
    expect(data).toHaveLength(STAKE_DATA_BASE64_LENGTH);
    expect(stakeDataFingerprint(data)).toHaveLength(232);
    expect(stakeDataFingerprint(data)).toBe(data.slice(0, 208) + data.slice(216, 240));
  });

  it('is null for anything but the base64 of exactly 200 bytes', () => {
    const data = encode(randomFields(rng(2), 'Stake'));
    expect(stakeDataFingerprint('')).toBeNull();
    expect(stakeDataFingerprint(data.slice(0, -1))).toBeNull();
    expect(stakeDataFingerprint(`${data}A`)).toBeNull();
    expect(stakeDataFingerprint(data.slice(4))).toBeNull();
    // 268 chars, but 199 bytes ("==") and 201 bytes (no "="): neither decodes as a stake account.
    const bytes199 = toBase64.decode(new Uint8Array(199).fill(7));
    const bytes201 = toBase64.decode(new Uint8Array(201).fill(7));
    expect([bytes199.length, bytes201.length]).toEqual([268, 268]);
    expect(stakeDataFingerprint(bytes199)).toBeNull();
    expect(stakeDataFingerprint(bytes201)).toBeNull();
  });

  it('covers exactly bytes [0,156) and [162,180) of the account', () => {
    const r = rng(3);
    for (let round = 0; round < 20; round++) {
      const bytes = encodeBytes(randomFields(r, 'Stake'));
      const before = stakeDataFingerprint(toBase64.decode(bytes));
      const covered: number[] = [];
      for (let at = 0; at < STAKE_ACCOUNT_SIZE; at++) {
        const changed = bytes.slice();
        changed[at] = (bytes[at] ?? 0) ^ (1 + r.int(255));
        if (stakeDataFingerprint(toBase64.decode(changed)) !== before) covered.push(at);
      }
      const expected = Array.from({ length: STAKE_ACCOUNT_SIZE }, (_, at) => at).filter(
        (at) => at < 156 || (at >= 162 && at < 180),
      );
      expect(covered).toEqual(expected);
    }
  });
});

describe('canSkipDecode, one field at a time', () => {
  MUTATIONS.forEach((mutation, index) => {
    const what = mutation.inFingerprint
      ? 'changes the fingerprint: the full path runs'
      : 'keeps the fingerprint: no decode, and the comparison would find nothing';
    it(`${mutation.field} ${what}`, () => {
      const r = rng(100 + index);
      for (let i = 0; i < 100; i++) {
        const prev = randomFields(r, mutation.stakeOnly ? 'Stake' : undefined);
        const result = run(pass(prev, mutation.mutate(prev, r)));
        expect(result.samePrint).toBe(!mutation.inFingerprint);
        expect(result.skip).toBe(!mutation.inFingerprint);
        if (result.skip) expect(result.events).toEqual([]);
      }
    });
  });

  it('more lamports (epoch rewards, with new low stake bytes and credits) skips; fewer runs the full path', () => {
    const r = rng(200);
    for (let i = 0; i < 100; i++) {
      const prev = randomFields(r);
      const reward = BigInt(1 + r.int(1_000_000_000));
      const rewarded: Fields = {
        ...prev,
        lamports: prev.lamports + reward,
        stake: (prev.stake & ~LOW_48_BITS) | (r.u64() & LOW_48_BITS),
        credits: r.u64(),
      };
      expect(run(pass(prev, rewarded))).toEqual({ skip: true, events: [], samePrint: true });

      const spent = run(pass(prev, { ...prev, lamports: prev.lamports - 1n - BigInt(r.int(Number(prev.lamports) - 1)) }));
      expect(spent.skip).toBe(false);
      expect(spent.events.map((e) => e.type)).toEqual(['BALANCE_DECREASED']);
    }
  });
});

describe('canSkipDecode, lock end and preconditions', () => {
  const T = NOW + 30n * DAY;
  const T_MS = Number(T) * 1000;
  const locked: Fields = { ...randomFields(rng(300), 'Stake'), lockUntil: T, lockupEpoch: 0n, deactivationEpoch: U64_MAX };
  const at = (prevCheckedAt: number, checkedAt: number, epoch = EPOCH): Case => ({
    prev: locked,
    next: locked,
    prevCheckedAt,
    checkedAt,
    epoch,
  });

  it('runs the full path in the one pass whose interval (previous check, this check] holds the lock end', () => {
    expect(run(at(T_MS - PASS_MS, T_MS - 1))).toEqual({ skip: true, events: [], samePrint: true });
    const ending = run(at(T_MS - 1, T_MS + PASS_MS - 1));
    expect(ending.skip).toBe(false);
    expect(ending.events.map((e) => e.type)).toEqual(['EXPIRED']);
    // At exactly T the lock is over (EXPIRED in this pass); at the previous check exactly T it was counted already.
    expect(run(at(T_MS - PASS_MS, T_MS)).skip).toBe(false);
    expect(run(at(T_MS - PASS_MS, T_MS)).events.map((e) => e.type)).toEqual(['EXPIRED']);
    expect(run(at(T_MS, T_MS + PASS_MS))).toEqual({ skip: true, events: [], samePrint: true });
    // Fractional milliseconds are floored, as in diffSnapshots.
    const fractional = run(at(T_MS - 0.5, T_MS + PASS_MS));
    expect(fractional.skip).toBe(false);
    expect(fractional.events.map((e) => e.type)).toEqual(['EXPIRED']);
  });

  it('ignores the lockup epoch: a lock its epoch still holds goes to the full path, which finds nothing', () => {
    const held: Fields = { ...locked, lockupEpoch: EPOCH + 1n };
    expect(run({ ...at(T_MS - 1, T_MS + PASS_MS), prev: held, next: held })).toEqual({
      skip: false,
      events: [],
      samePrint: true,
    });
  });

  it('handles the largest lock end exactly', () => {
    const forever: Fields = { ...locked, lockUntil: I64_MAX };
    expect(run(pass(forever, forever))).toEqual({ skip: true, events: [], samePrint: true });
  });

  it('needs a stored fingerprint, an account owned by the stake program and a fingerprint of the read', () => {
    const data = encode(locked);
    const stored = { fingerprint: stakeDataFingerprint(data), lamports: locked.lamports, lockUntil: T, checkedAt: NOW_MS };
    const read = { owner: STAKE_PROGRAM_ADDRESS, dataBase64: data, lamports: locked.lamports };
    expect(canSkipDecode(stored, read, NOW_MS + PASS_MS)).toBe(true);
    expect(canSkipDecode({ ...stored, fingerprint: null }, read, NOW_MS + PASS_MS)).toBe(false);
    expect(canSkipDecode(stored, { ...read, owner: SYSTEM_PROGRAM_ADDRESS }, NOW_MS + PASS_MS)).toBe(false);
    expect(canSkipDecode(stored, { ...read, dataBase64: data.slice(0, -1) }, NOW_MS + PASS_MS)).toBe(false);
    expect(canSkipDecode(stored, { ...read, lamports: locked.lamports - 1n }, NOW_MS + PASS_MS)).toBe(false);
  });
});

describe('canSkipDecode, 10 000 random pairs', () => {
  // About 1 ms a pair: the generated encoder spends most of it on base58 addresses.
  const slow = { timeout: 60_000 };
  it('never skips a change the comparison would report, and the fingerprint follows the fields it reads', slow, () => {
    const r = rng(49);
    const failures: string[] = [];
    const seen = new Set<MonitorEventType>();
    let skipped = 0;
    for (let i = 0; i < 10_000; i++) {
      const checkedAt = NOW_MS + r.int(1_000_000_000);
      const prevCheckedAt = checkedAt - r.int(5 * PASS_MS);
      let prev = randomFields(r);
      if (r.float() < 0.25) {
        // A lock end around this pass's interval, both edges included.
        const endMs = prevCheckedAt - 1_000 + r.int(checkedAt - prevCheckedAt + 2_001);
        prev = { ...prev, lockUntil: BigInt(Math.floor(endMs / 1000)) };
      }
      let next = prev;
      for (const mutation of MUTATIONS) if (r.float() < 0.1) next = mutation.mutate(next, r);
      const lamports = [prev.lamports, prev.lamports + BigInt(1 + r.int(1_000_000)), prev.lamports - 1n];
      next = { ...next, lamports: r.pick(lamports) };
      const epoch = r.pick([prev.lockupEpoch, prev.lockupEpoch + 1n, EPOCH]);

      const result = run({ prev, next, prevCheckedAt, checkedAt, epoch });
      if (result.skip) skipped++;
      for (const event of result.events) seen.add(event.type);
      if (result.skip && result.events.length > 0) {
        failures.push(`pair ${String(i)}: skipped, but ${result.events.map((e) => e.type).join(', ')}`);
      }
      if (result.samePrint !== sameFingerprintFields(prev, next)) {
        failures.push(`pair ${String(i)}: fingerprint ${result.samePrint ? 'kept' : 'changed'} against the fields`);
      }
    }
    expect(failures).toEqual([]);
    // Not vacuous: many pairs skip, and the others reach every kind of event.
    expect(skipped).toBeGreaterThan(1_000);
    expect([...seen].sort()).toEqual([
      'ACCOUNT_CLOSED',
      'BALANCE_DECREASED',
      'DEACTIVATED',
      'DELEGATION_CHANGED',
      'EXPIRED',
      'LOCKUP_CHANGED',
      'STAKER_CHANGED',
      'WITHDRAWER_CHANGED',
    ]);
  });
});
