// Done-when of step 5: every reminder threshold fires exactly once (the daily pass, first after 06:00 UTC).
import { getAddressDecoder, type Address } from '@solana/kit';
import { describe, expect, it, vi } from 'vitest';
import { MONITOR_PLANS } from '../../src/monitor/config.ts';
import type { StakeAccountSpec } from '../transactions.ts';
import { key, LOCK_UNTIL } from '../transactions.ts';
import { createHarness, type Harness } from './harness.ts';

const MAIN = key(1);
const SECOND = key(2);
const STAKE = key(10);
/** T = LOCK_UNTIL = 2027-04-13T00:00:00Z. */
const T_MS = Number(LOCK_UNTIL) * 1000;
const DAY_MS = 86_400_000;
const SPEC: StakeAccountSpec = { state: 'delegated', staker: MAIN, withdrawer: MAIN, custodian: SECOND, unixTimestamp: LOCK_UNTIL };

/** `days` before the lock end `endMs` (default T) at `time` (UTC), as ISO. */
function before(days: number, time: string, endMs = T_MS): string {
  return `${new Date(endMs - days * DAY_MS).toISOString().slice(0, 10)}T${time}Z`;
}

async function watchedAt(iso: string, spec: StakeAccountSpec = SPEC): Promise<Harness> {
  const h = createHarness();
  h.at(iso);
  h.chain.putStake(STAKE, spec);
  await h.seedWatched([STAKE]);
  return h;
}

async function reminders(h: Harness) {
  return (await h.readEvents()).filter((e) => e.type.startsWith('REMINDER_')).map((e) => [e.type, e.details]);
}

describe('reminders', () => {
  // 18 passes: past the default 5 s when the whole suite runs in parallel.
  it('passes at 06:30 UTC from T-31 to T-1: each of 30, 14, 7, 3 and 1 exactly once, none twice a day', { timeout: 30_000 }, async () => {
    const h = await watchedAt(before(31, '05:00:00'));
    const expected: [number, number | null][] = [
      [31, null],
      [30, 30],
      [29, null],
      [15, null],
      [14, 14],
      [8, null],
      [7, 7],
      [3, 3],
      [1, 1],
    ];
    const seen: unknown[] = [];
    for (const [days, due] of expected) {
      h.at(before(days, '06:30:00'));
      const report = await h.pass();
      expect(report).toMatchObject({ outcome: 'ok', daily: true, reminders: due === null ? 0 : 1 });
      if (due !== null) seen.push([`REMINDER_${String(due)}`, { days: due, lockUntil: LOCK_UNTIL.toString() }]);
      expect(await reminders(h)).toEqual(seen);

      // A second pass the same day adds nothing.
      h.at(before(days, '06:32:00'));
      expect(await h.pass()).toMatchObject({ daily: false, reminders: 0 });
      expect(await reminders(h)).toEqual(seen);
    }
    expect((await h.readAccounts())[0]?.last_reminder_days).toBe(1);
    expect((await h.readMeta()).daily_day).toBe(before(1, '00:00:00').slice(0, 10));
  });

  it('nothing at 05:59 UTC, the daily pass at 06:00', async () => {
    const h = await watchedAt(before(16, '12:00:00'));
    h.at(before(14, '05:59:00'));
    expect(await h.pass()).toMatchObject({ daily: false, reminders: 0 });
    h.at(before(14, '06:00:00'));
    expect(await h.pass()).toMatchObject({ daily: true, reminders: 1 });
    expect(await reminders(h)).toEqual([['REMINDER_14', { days: 14, lockUntil: LOCK_UNTIL.toString() }]]);
  });

  it('a lock extended after the 7-day reminder starts over: the 30-day one again, for the new end', async () => {
    const h = await watchedAt(before(8, '12:00:00'));
    h.at(before(7, '06:30:00'));
    expect(await h.pass()).toMatchObject({ reminders: 1 });

    const extended = LOCK_UNTIL + 20n * 86_400n;
    h.chain.putStake(STAKE, { ...SPEC, unixTimestamp: extended });
    h.at(before(6, '06:30:00'));
    expect(await h.pass()).toMatchObject({ events: 1, reminders: 1 });
    expect(await reminders(h)).toEqual([
      ['REMINDER_7', { days: 7, lockUntil: LOCK_UNTIL.toString() }],
      ['REMINDER_30', { days: 30, lockUntil: extended.toString() }],
    ]);
  });

  it('a lock extended after the 30-day reminder: the 30-day one again, 30 days before the new end', async () => {
    const h = await watchedAt(before(31, '05:00:00'));
    h.at(before(30, '06:30:00'));
    expect(await h.pass()).toMatchObject({ reminders: 1 });

    // Extended from the reminder's button, the same day: six months more.
    const extended = LOCK_UNTIL + 180n * 86_400n;
    const extendedMs = Number(extended) * 1000;
    h.chain.putStake(STAKE, { ...SPEC, unixTimestamp: extended });
    h.at(before(30, '12:00:00'));
    expect(await h.pass()).toMatchObject({ events: 1, daily: false, reminders: 0 });
    expect((await h.readAccounts())[0]).toMatchObject({ lock_until: extended.toString(), last_reminder_days: null });

    for (const [days, due] of [
      [31, 0],
      [30, 1],
      [29, 0],
    ] as const) {
      h.at(before(days, '06:30:00', extendedMs));
      expect(await h.pass()).toMatchObject({ outcome: 'ok', daily: true, reminders: due });
    }
    expect(await reminders(h)).toEqual([
      ['REMINDER_30', { days: 30, lockUntil: LOCK_UNTIL.toString() }],
      ['REMINDER_30', { days: 30, lockUntil: extended.toString() }],
    ]);
  });

  it('protected again after the lock ended: the 1-day reminder again, before the new end', { timeout: 15_000 }, async () => {
    const h = await watchedAt(before(2, '05:00:00'));
    h.at(before(1, '06:30:00'));
    expect(await h.pass()).toMatchObject({ reminders: 1 });
    h.at(before(0, '12:00:00'));
    expect(await h.pass()).toMatchObject({ events: 1 });

    const relocked = LOCK_UNTIL + 5n * 86_400n;
    h.chain.putStake(STAKE, { ...SPEC, unixTimestamp: relocked });
    h.at(before(0, '12:02:00'));
    expect(await h.pass()).toMatchObject({ events: 1 });
    h.at(before(1, '06:30:00', Number(relocked) * 1000));
    expect(await h.pass()).toMatchObject({ daily: true, reminders: 1 });
    expect((await reminders(h)).at(-1)).toEqual(['REMINDER_1', { days: 1, lockUntil: relocked.toString() }]);
    expect((await h.readEvents()).map((e) => e.type)).toEqual(['REMINDER_1', 'EXPIRED', 'LOCKUP_CHANGED', 'REMINDER_1']);
  });

  it('a row first watched 10 days before T gets no late 14-day reminder, the 7-day one on time', async () => {
    const h = await watchedAt(before(10, '05:00:00'));
    expect((await h.readAccounts())[0]?.last_reminder_days).toBe(14);
    h.at(before(10, '06:30:00'));
    expect(await h.pass()).toMatchObject({ daily: true, reminders: 0 });
    h.at(before(7, '06:30:00'));
    expect(await h.pass()).toMatchObject({ reminders: 1 });
    expect(await reminders(h)).toEqual([['REMINDER_7', { days: 7, lockUntil: LOCK_UNTIL.toString() }]]);
  });

  it('a failed daily commit: the next pass repeats the day, the reminder comes once', async () => {
    const h = await watchedAt(before(31, '12:00:00'));
    h.db.failWhen = (entry) => entry.name === 'REMINDER_DAYS';
    h.at(before(30, '06:30:00'));
    await expect(h.pass()).rejects.toThrow(/D1_ERROR/);
    expect(await reminders(h)).toEqual([]);
    expect((await h.readMeta()).daily_day).toBeUndefined();

    h.db.failWhen = null;
    h.at(before(30, '06:32:00'));
    expect(await h.pass()).toMatchObject({ daily: true, reminders: 1 });
    h.at(before(30, '06:34:00'));
    expect(await h.pass()).toMatchObject({ daily: false, reminders: 0 });
    expect(await reminders(h)).toEqual([['REMINDER_30', { days: 30, lockUntil: LOCK_UNTIL.toString() }]]);
  });

  it('a reminder event is gated on the row version it was decided on, with the slot of that row', async () => {
    const h = await watchedAt(before(31, '05:00:00'));
    const [row] = await h.readAccounts();
    h.at(before(30, '06:30:00'));
    await h.pass();
    const [event] = (await h.readEvents()).filter((e) => e.type === 'REMINDER_30');
    expect(event?.slot).toBe(row?.slot);
  });
});

/**
 * Anyone can have locks watched (POST /api/watch, D49): their own stake accounts with their own second key, ending
 * right before the victim's lock. They must not crowd out the reminders of other users.
 */
describe('reminders: locks of others do not crowd out a due reminder', () => {
  const THIEF = key(5);
  const THIEF_SECOND = key(6);
  /** Locks of the crowd end one second before T: they sort before the victim's lock by end. */
  const CROWD_SPEC: StakeAccountSpec = {
    state: 'initialized',
    staker: THIEF,
    withdrawer: THIEF,
    custodian: THIEF_SECOND,
    unixTimestamp: LOCK_UNTIL - 1n,
  };
  const FREE_PAGE = MONITOR_PLANS.free.reminderPageRows;

  /** `count` distinct stake addresses in the order D1 sorts the TEXT column (base58 is ASCII: the same as JS). */
  function stakeAddresses(count: number): Address[] {
    return Array.from({ length: count }, (_, i) => {
      const bytes = new Uint8Array(32).fill(0x77);
      bytes[0] = i & 0xff;
      bytes[1] = i >> 8;
      return getAddressDecoder().decode(bytes);
    }).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  /** Reminder events per stake account. */
  async function remindersBy(h: Harness): Promise<Map<string, string[]>> {
    const by = new Map<string, string[]>();
    for (const event of await h.readEvents()) {
      if (!event.type.startsWith('REMINDER_')) continue;
      by.set(event.stake_account, [...(by.get(event.stake_account) ?? []), event.type]);
    }
    return by;
  }

  it('1000 locks whose reminder was already sent, ending first: the due one still comes on the first daily pass', { timeout: 60_000 }, async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // The victim, watched 2 days before T: its 3-day reminder counts as sent, the 1-day one is due tomorrow.
    const h = await watchedAt(before(2, '05:00:00'));
    expect((await h.readAccounts())[0]?.last_reminder_days).toBe(3);
    // The crowd, watched within the last day: the 1-day reminder counts as sent for every one of them.
    h.at(before(1, '05:00:00'));
    const crowd = stakeAddresses(1000);
    for (const address of crowd) h.chain.putStake(address, CROWD_SPEC);
    await h.seedWatched(crowd);

    h.at(before(1, '06:30:00'));
    expect(await h.pass()).toMatchObject({ outcome: 'ok', daily: true, reminders: 1 });
    expect(await reminders(h)).toEqual([['REMINDER_1', { days: 1, lockUntil: LOCK_UNTIL.toString() }]]);
  });

  it('1001 reminders due, more than a page: each lock gets its reminder once, the day stays open until the last', { timeout: 120_000 }, async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = createHarness();
    h.at(before(31, '05:00:00'));
    // 1001 rows due the same morning; the victim sorts last both by address and by lock end.
    const addresses = stakeAddresses(1001);
    const victim = addresses.at(-1) as Address;
    for (const address of addresses) h.chain.putStake(address, address === victim ? SPEC : CROWD_SPEC);
    await h.seedWatched(addresses);
    const victimDay = before(30, '00:00:00').slice(0, 10);

    let dailyPasses = 0;
    for (let minute = 30; ; minute += 2) {
      h.at(before(30, `06:${String(minute).padStart(2, '0')}:00`));
      const report = await h.pass();
      expect(report.outcome).toBe('ok');
      if (!report.daily) break;
      dailyPasses += 1;
      const open = dailyPasses < Math.ceil(addresses.length / FREE_PAGE);
      // The day is recorded only when its last reminders are in: a pass in between keeps the stage open.
      expect((await h.readMeta()).daily_day).toBe(open ? undefined : victimDay);
      expect(minute).toBeLessThan(60);
    }
    expect(dailyPasses).toBe(Math.ceil(addresses.length / FREE_PAGE));

    const by = await remindersBy(h);
    expect(by.get(victim)).toEqual(['REMINDER_30']);
    expect(by.size).toBe(addresses.length);
    expect([...by.values()].every((types) => types.length === 1 && types[0] === 'REMINDER_30')).toBe(true);
    // The pairs joined the rescan queue once that day, not on every pass of the open stage.
    expect(h.db.journal.filter((e) => e.name === 'DAILY_PAIRS')).toHaveLength(1);

    // Later the same day: nothing more.
    h.at(before(30, '08:00:00'));
    expect(await h.pass()).toMatchObject({ daily: false, reminders: 0 });
  });

  it('a pass that dies after a full page: the next one goes on after it, the day\'s pairs are not lost', { timeout: 60_000 }, async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const h = createHarness();
    h.at(before(31, '05:00:00'));
    const addresses = stakeAddresses(FREE_PAGE + 1);
    for (const address of addresses) h.chain.putStake(address, SPEC);
    await h.seedWatched(addresses);

    // The delivery comes after the daily stage: the page and the open stage are in, then the pass fails.
    h.db.failWhen = (entry) => entry.name === 'PENDING';
    h.at(before(30, '06:30:00'));
    await expect(h.pass()).rejects.toThrow(/D1_ERROR/);
    const meta = await h.readMeta();
    expect(meta.daily_day).toBeUndefined();
    expect(JSON.parse(meta.daily_sweep ?? '')).toEqual({ day: before(30, '00:00:00').slice(0, 10), after: addresses[FREE_PAGE - 1] });
    // The day's pairs join the queue in the rescans stage and are committed with their round at the finish: the pass
    // died before, so the round has not started.
    expect(meta.pairs_sweep).toBeUndefined();
    expect((await remindersBy(h)).size).toBe(FREE_PAGE);

    h.db.failWhen = null;
    h.at(before(30, '06:32:00'));
    expect(await h.pass()).toMatchObject({ outcome: 'ok', daily: true, reminders: 1, rescans: 1 });
    expect(JSON.parse((await h.readMeta()).pairs_sweep ?? 'null')).toEqual({ day: before(30, '00:00:00').slice(0, 10), after: null });
    expect((await h.readMeta()).daily_day).toBe(before(30, '00:00:00').slice(0, 10));
    const by = await remindersBy(h);
    expect(by.size).toBe(addresses.length);
    expect([...by.values()].every((types) => types.length === 1)).toBe(true);
    expect(h.db.journal.filter((e) => e.name === 'DAILY_PAIRS')).toHaveLength(1);
  });

  it('a stage still open at midnight goes on before 06:00; the next day starts its own at 06:00', { timeout: 60_000 }, async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = createHarness();
    h.at(before(40, '05:00:00'));
    const addresses = stakeAddresses(FREE_PAGE + 1);
    for (const address of addresses) h.chain.putStake(address, SPEC);
    await h.seedWatched(addresses);

    // The first daily pass of the day is late (23:58): it gets through one page.
    h.at(before(29, '23:58:00'));
    expect(await h.pass()).toMatchObject({ daily: true, reminders: FREE_PAGE });
    expect((await h.readMeta()).daily_day).toBeUndefined();
    // After midnight, before 06:00: the open stage goes on and ends; it records the day it started.
    h.at(before(28, '00:00:00'));
    expect(await h.pass()).toMatchObject({ daily: true, reminders: 1 });
    expect((await h.readMeta()).daily_day).toBe(before(29, '00:00:00').slice(0, 10));
    h.at(before(28, '00:02:00'));
    expect(await h.pass()).toMatchObject({ daily: false, reminders: 0 });
    // 06:00: the next day's stage, once; the 30-day reminders are not sent again.
    h.at(before(28, '06:00:00'));
    expect(await h.pass()).toMatchObject({ daily: true, reminders: 0 });
    expect((await h.readMeta()).daily_day).toBe(before(28, '00:00:00').slice(0, 10));
    const by = await remindersBy(h);
    expect(by.size).toBe(addresses.length);
    expect([...by.values()].every((types) => types.length === 1)).toBe(true);
    expect(h.db.journal.filter((e) => e.name === 'DAILY_PAIRS')).toHaveLength(2);
  });
});
