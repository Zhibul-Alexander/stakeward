// Done-when of step 5: every reminder threshold fires exactly once (the daily pass, first after 06:00 UTC).
import { describe, expect, it } from 'vitest';
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

/** `days` before T at `time` (UTC), as ISO. */
function before(days: number, time: string): string {
  return `${new Date(T_MS - days * DAY_MS).toISOString().slice(0, 10)}T${time}Z`;
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
  it('passes at 06:30 UTC from T-31 to T-1: each of 30, 14, 7, 3 and 1 exactly once, none twice a day', async () => {
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
