// Done-when of step 5: a failed send is retried, 403 removes the link (step 5 spec sections 7 and 12.2). Monitor
// passes against the fake chain, the fake Telegram and the real local D1; every chat gets every event once.
import { getAddressDecoder, type Address } from '@solana/kit';
import { formatAlert, type MonitorEventDetails } from '@stakeward/core';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TelegramReply } from './fake-telegram.ts';
import type { StakeAccountSpec } from '../transactions.ts';
import { key, LOCK_UNTIL } from '../transactions.ts';
import { ADMIN_CHAT, createHarness, type Harness } from './harness.ts';

const MAIN = key(1);
const SECOND = key(2);
const THIEF = key(3);
const NEW_MAIN = key(4);
const OTHER_SECOND = key(5);
const STAKE = key(10);
const SPEC: StakeAccountSpec = {
  state: 'delegated',
  staker: MAIN,
  withdrawer: MAIN,
  custodian: SECOND,
  unixTimestamp: LOCK_UNTIL,
  voter: key(42),
  activationEpoch: 800n,
};
const DEACTIVATED: StakeAccountSpec = { ...SPEC, deactivationEpoch: 951n };
const SITE = 'https://stakeward.test';
const [CHAT_A, CHAT_B, CHAT_C, CHAT_D] = ['100001', '100002', '100003', '100004'] as const;
const DAY_MS = 86_400_000;

afterEach(() => {
  vi.restoreAllMocks();
});

/** `stakes` of MAIN watched at 01:00 UTC (no daily pass before 06:00), and a first quiet pass at 01:02. */
async function watched(stakes: readonly Address[] = [STAKE]): Promise<Harness> {
  expect(env.SITE_ORIGIN).toBe(SITE);
  const h = createHarness();
  h.at('2026-10-05T01:00:00Z');
  for (const stake of stakes) h.chain.putStake(stake, SPEC);
  await h.seedWatched(stakes);
  h.at('2026-10-05T01:02:00Z');
  expect(await h.pass()).toMatchObject({ outcome: 'ok', events: 0 });
  return h;
}

/** The next pass, two minutes on. */
async function next(h: Harness) {
  h.advance(120_000);
  return h.pass();
}

/** The alerts of a message: after "Devnet: ", separated by a blank line. */
function alertsIn(text: string): string[] {
  expect(text.startsWith('Devnet: ')).toBe(true);
  return text.slice('Devnet: '.length).split('\n\n');
}

function alertText(event: MonitorEventDetails, stake: Address = STAKE, withdrawer: Address = MAIN): string {
  return formatAlert({ ...event, stakeAccount: stake }, { withdrawer, lockUntil: LOCK_UNTIL, now: 0n }).text;
}

const deactivatedText = (stake: Address = STAKE) =>
  alertText({ type: 'DEACTIVATED', details: { deactivationEpoch: '951' } }, stake);

/** Texts of the messages Telegram took for `chat`, in order. */
function texts(h: Harness, chat: string): string[] {
  return h.telegram.delivered(chat).map((r) => r.text);
}

// Several passes each, one with a send that waits for its timeout: room beyond the default 5 s under a parallel suite.
describe('a send that fails is retried', { timeout: 20_000 }, () => {
  for (const reply of [500, 'hang', 'network-error'] as const satisfies readonly TelegramReply[]) {
    it(`${String(reply)} on one of three chats: the others now, that one on the next pass, each once`, async () => {
      const h = await watched();
      for (const chat of [CHAT_A, CHAT_B, CHAT_C]) await h.linkChat(MAIN, chat);
      h.telegram.replyTo(CHAT_B, reply);
      h.chain.putStake(STAKE, DEACTIVATED);

      expect(await next(h)).toMatchObject({ outcome: 'ok', events: 1, messages: 2, retrySends: 1, alertsDelivered: 2 });
      expect([texts(h, CHAT_A), texts(h, CHAT_B), texts(h, CHAT_C)]).toEqual([[`Devnet: ${deactivatedText()}`], [], [`Devnet: ${deactivatedText()}`]]);
      expect((await h.readEvents())[0]?.notified_at).toBeNull();
      const marker = (await h.readMeta()).last_pass_at;
      expect(marker).toBe(String(h.clock.ms));

      expect(await next(h)).toMatchObject({ outcome: 'ok', events: 0, messages: 1, retrySends: 0, alertsDelivered: 1 });
      expect([texts(h, CHAT_A), texts(h, CHAT_B), texts(h, CHAT_C)].map((t) => t.length)).toEqual([1, 1, 1]);
      const [event] = await h.readEvents();
      expect(event?.notified_at).toBe(h.clock.ms);
      expect((await h.readLinks()).map((l) => l.last_event_id)).toEqual([event?.id, event?.id, event?.id]);
      expect((await h.readMeta()).alerts_sent).toBe('3');

      const requests = h.telegram.requests.length;
      expect(await next(h)).toMatchObject({ outcome: 'ok', pending: 0, messages: 0 });
      expect(h.telegram.requests).toHaveLength(requests);
    });
  }

  it('two failures in a row stop the sends: the chats after them wait for the next pass', async () => {
    const h = await watched();
    for (const chat of [CHAT_A, CHAT_B, CHAT_C, CHAT_D]) await h.linkChat(MAIN, chat);
    h.telegram.replyTo(CHAT_B, 500);
    h.telegram.replyTo(CHAT_C, 500);
    h.chain.putStake(STAKE, DEACTIVATED);

    expect(await next(h)).toMatchObject({ outcome: 'ok', messages: 1, retrySends: 2 });
    expect(h.telegram.requests.map((r) => r.chatId)).toEqual([CHAT_A, CHAT_B, CHAT_C]);

    expect(await next(h)).toMatchObject({ outcome: 'ok', messages: 3, retrySends: 0 });
    for (const chat of [CHAT_A, CHAT_B, CHAT_C, CHAT_D]) expect(texts(h, chat)).toEqual([`Devnet: ${deactivatedText()}`]);
    expect((await h.readEvents())[0]?.notified_at).toBe(h.clock.ms);
  });

  it('429 stops the sends until the next pass; the pass still succeeds', async () => {
    const h = await watched();
    for (const chat of [CHAT_A, CHAT_B, CHAT_C]) await h.linkChat(MAIN, chat);
    h.telegram.replyTo(CHAT_A, 429);
    h.chain.putStake(STAKE, DEACTIVATED);

    expect(await next(h)).toMatchObject({ outcome: 'ok', messages: 0 });
    expect(h.telegram.requests.map((r) => r.chatId)).toEqual([CHAT_A]);
    expect((await h.readMeta()).last_pass_at).toBe(String(h.clock.ms));

    expect(await next(h)).toMatchObject({ outcome: 'ok', messages: 3 });
    for (const chat of [CHAT_A, CHAT_B, CHAT_C]) expect(texts(h, chat)).toHaveLength(1);
  });
});

describe('messages', () => {
  it('7 events for one chat: 2 messages in 2 passes, at most 5 alerts each, the button opens Rescue on the site', async () => {
    const stakes = [10, 11, 12, 13, 14, 15, 16].map((n) => key(n)).sort();
    const h = await watched(stakes);
    await h.linkChat(MAIN, CHAT_A);
    // The first account by address loses SOL (an "Open Stakeward" alert); the others are deactivated (Rescue).
    const [first = STAKE, ...rest] = stakes;
    h.chain.putStake(first, SPEC, 9_000_000_000n);
    for (const stake of rest) h.chain.putStake(stake, DEACTIVATED);

    expect(await next(h)).toMatchObject({ events: 7, messages: 1, alertsDelivered: 5 });
    expect(await next(h)).toMatchObject({ events: 0, messages: 1, alertsDelivered: 2 });
    expect(await next(h)).toMatchObject({ pending: 0, messages: 0 });

    const messages = h.telegram.delivered(CHAT_A);
    expect(messages.map((m) => alertsIn(m.text).length)).toEqual([5, 2]);
    const balance = alertText(
      { type: 'BALANCE_DECREASED', details: { fromLamports: '10000000000', toLamports: '9000000000' } },
      first,
    );
    expect(messages.flatMap((m) => alertsIn(m.text))).toEqual([balance, ...rest.map(deactivatedText)]);
    for (const message of messages) {
      expect(message.button).toEqual({ label: 'Open Rescue', url: `${SITE}/rescue?address=${MAIN}` });
      expect(new URL(message.button?.url ?? '').origin).toBe(SITE);
      expect(message.linkPreviewDisabled).toBe(true);
    }
    expect((await h.readEvents()).every((e) => e.notified_at !== null)).toBe(true);
    expect((await h.readMeta()).alerts_sent).toBe('7');
  });

  it('the second key moved the lock date: both keys get the removal advice, the button opens the removal on the site', async () => {
    const h = await watched();
    await h.linkChat(MAIN, CHAT_A);
    await h.linkChat(SECOND, CHAT_B);
    const extended = LOCK_UNTIL + 30n * 86_400n;
    h.chain.putStake(STAKE, { ...SPEC, unixTimestamp: extended });
    expect(await next(h)).toMatchObject({ events: 1, messages: 2 });
    const text = alertText({
      type: 'LOCKUP_CHANGED',
      details: {
        changes: ['extended'],
        fromLockUntil: LOCK_UNTIL.toString(),
        toLockUntil: extended.toString(),
        fromCustodian: SECOND,
        toCustodian: SECOND,
      },
    });
    expect(text).toContain('remove the lock with it now, then protect this stake again with a new second key.');
    for (const chat of [CHAT_A, CHAT_B]) {
      const [message] = h.telegram.delivered(chat);
      expect(message?.text).toBe(`Devnet: ${text}`);
      expect(message?.button).toEqual({ label: 'Remove lock', url: `${SITE}/extend/${STAKE}?remove` });
      expect(new URL(message?.button?.url ?? '').origin).toBe(SITE);
    }
  });

  it('a removal alert and a rescue alert in one message: the button opens Rescue (D73)', async () => {
    const stakes = [key(10), key(11)].sort();
    const h = await watched(stakes);
    await h.linkChat(MAIN, CHAT_A);
    const [moved = STAKE, deactivated = STAKE] = stakes;
    h.chain.putStake(moved, { ...SPEC, unixTimestamp: LOCK_UNTIL + 86_400n });
    h.chain.putStake(deactivated, DEACTIVATED);
    expect(await next(h)).toMatchObject({ events: 2, messages: 1 });
    const [message] = h.telegram.delivered(CHAT_A);
    expect(alertsIn(message?.text ?? '')).toHaveLength(2);
    expect(alertsIn(message?.text ?? '')[0]).toContain('remove the lock with it now');
    expect(message?.button).toEqual({ label: 'Open Rescue', url: `${SITE}/rescue?address=${MAIN}` });
  });

  it('a chat that follows both keys of an account gets each alert once', async () => {
    const h = await watched();
    await h.linkChat(MAIN, CHAT_A);
    await h.linkChat(SECOND, CHAT_A);
    h.chain.putStake(STAKE, DEACTIVATED);
    expect(await next(h)).toMatchObject({ messages: 1, alertsDelivered: 1 });
    expect(texts(h, CHAT_A)).toEqual([`Devnet: ${deactivatedText()}`]);
    expect((await h.readLinks()).map((l) => l.last_event_id)).toEqual([1, 1]);
  });

  it('a link already past an event (made after it) does not get it; the event is closed', async () => {
    const h = await watched();
    h.chain.putStake(STAKE, DEACTIVATED);
    await h.linkChat(MAIN, CHAT_A, 1_000);
    expect(await next(h)).toMatchObject({ events: 1, pending: 1, messages: 0 });
    expect(h.telegram.requests).toEqual([]);
    expect((await h.readEvents())[0]?.notified_at).toBe(h.clock.ms);
  });
});

describe('recipients', () => {
  it('a new main key: the chats of the main key before and after and of the second key; the button is the first alert', async () => {
    const h = await watched();
    await h.linkChat(MAIN, CHAT_A);
    await h.linkChat(NEW_MAIN, CHAT_B);
    await h.linkChat(SECOND, CHAT_C);
    h.chain.putStake(STAKE, { ...SPEC, withdrawer: NEW_MAIN });
    expect(await next(h)).toMatchObject({ events: 1, messages: 3 });
    const text = alertText({ type: 'WITHDRAWER_CHANGED', details: { from: MAIN, to: NEW_MAIN } }, STAKE, NEW_MAIN);
    for (const chat of [CHAT_A, CHAT_B, CHAT_C]) {
      const [message] = h.telegram.delivered(chat);
      expect(message?.text).toBe(`Devnet: ${text}`);
      expect(message?.button).toEqual({ label: 'Open Stakeward', url: `${SITE}/app?address=${NEW_MAIN}` });
    }
  });

  it('a new second key and a new staker: both second keys get the lock change, the staker gets nothing', async () => {
    const h = await watched();
    await h.linkChat(MAIN, CHAT_A);
    await h.linkChat(SECOND, CHAT_B);
    await h.linkChat(OTHER_SECOND, CHAT_C);
    await h.linkChat(THIEF, CHAT_D);
    h.chain.putStake(STAKE, { ...SPEC, staker: THIEF, custodian: OTHER_SECOND });
    expect(await next(h)).toMatchObject({ events: 2, messages: 3 });

    const staker = alertText({ type: 'STAKER_CHANGED', details: { from: MAIN, to: THIEF } });
    const lockup = alertText({
      type: 'LOCKUP_CHANGED',
      details: {
        changes: ['custodian-changed'],
        fromLockUntil: LOCK_UNTIL.toString(),
        toLockUntil: LOCK_UNTIL.toString(),
        fromCustodian: SECOND,
        toCustodian: OTHER_SECOND,
      },
    });
    expect(h.telegram.delivered(CHAT_A).map((m) => [alertsIn(m.text), m.button?.label])).toEqual([[[staker, lockup], 'Open Rescue']]);
    expect(texts(h, CHAT_B)).toEqual([`Devnet: ${lockup}`]);
    expect(h.telegram.delivered(CHAT_C).map((m) => alertsIn(m.text))).toEqual([[staker, lockup]]);
    expect(texts(h, CHAT_D)).toEqual([]);
  });
});

describe('answers that end a link or a send', () => {
  it('403: every link of the chat is removed, the other chat gets its alert, the event is closed', async () => {
    const h = await watched();
    await h.linkChat(MAIN, CHAT_A);
    await h.linkChat(SECOND, CHAT_A);
    await h.linkChat(MAIN, CHAT_B);
    h.telegram.replyTo(CHAT_A, 403);
    h.chain.putStake(STAKE, DEACTIVATED);

    expect(await next(h)).toMatchObject({ outcome: 'ok', messages: 1, blockedChats: 1, alertsDelivered: 1 });
    expect(texts(h, CHAT_B)).toEqual([`Devnet: ${deactivatedText()}`]);
    expect(await h.readLinks()).toEqual([{ wallet: MAIN, chat_id: CHAT_B, last_event_id: 1 }]);
    expect((await h.readEvents())[0]?.notified_at).toBe(h.clock.ms);

    h.chain.putStake(STAKE, { ...DEACTIVATED, staker: THIEF });
    expect(await next(h)).toMatchObject({ events: 1, messages: 1 });
    expect(h.telegram.requests.filter((r) => r.chatId === CHAT_A)).toHaveLength(1);
  });

  it('400: the chat is skipped, its link kept and moved past the event, nothing sent again', async () => {
    const h = await watched();
    await h.linkChat(MAIN, CHAT_A);
    await h.linkChat(MAIN, CHAT_B);
    h.telegram.replyTo(CHAT_A, 400);
    h.chain.putStake(STAKE, DEACTIVATED);

    expect(await next(h)).toMatchObject({ outcome: 'ok', messages: 1, rejected: 1, alertsDelivered: 1 });
    expect(await h.readLinks()).toEqual([
      { wallet: MAIN, chat_id: CHAT_A, last_event_id: 1 },
      { wallet: MAIN, chat_id: CHAT_B, last_event_id: 1 },
    ]);
    expect((await h.readEvents())[0]?.notified_at).toBe(h.clock.ms);
    expect((await h.readMeta()).alerts_sent).toBe('1');

    await next(h);
    expect(h.telegram.requests.map((r) => r.chatId)).toEqual([CHAT_A, CHAT_B]);
  });

  for (const reply of [401, 404] as const) {
    it(`${String(reply)}: the sends stop, telegram-config, the marker stays; once fixed, each chat gets it once`, async () => {
      const h = await watched();
      const marker = (await h.readMeta()).last_pass_at;
      await h.linkChat(MAIN, CHAT_A);
      await h.linkChat(MAIN, CHAT_B);
      h.telegram.replyTo(CHAT_A, reply);
      h.chain.putStake(STAKE, DEACTIVATED);

      expect(await next(h)).toMatchObject({ outcome: 'telegram-config', events: 1, messages: 0 });
      expect(h.telegram.requests.map((r) => r.chatId)).toEqual([CHAT_A]);
      const meta = await h.readMeta();
      expect(meta.last_pass_at).toBe(marker);
      expect(JSON.parse(meta.pass_lease ?? '')).toMatchObject({ until: 0 });
      expect((await h.readEvents())[0]?.notified_at).toBeNull();
      expect(h.logs).toContainEqual({ level: 'error', msg: 'telegram rejected the bot token or the site origin is invalid' });
      expect(h.adminMessages()).toEqual([]);

      expect(await next(h)).toMatchObject({ outcome: 'ok', messages: 2 });
      expect((await h.readMeta()).last_pass_at).toBe(String(h.clock.ms));
      for (const chat of [CHAT_A, CHAT_B]) expect(texts(h, chat)).toHaveLength(1);
    });
  }

  it('no bot token: telegram-config without a request, the event waits', async () => {
    const h = createHarness({ env: { TELEGRAM_BOT_TOKEN: '' } });
    h.at('2026-10-05T01:00:00Z');
    h.chain.putStake(STAKE, SPEC);
    await h.seedWatched([STAKE]);
    await h.linkChat(MAIN, CHAT_A);
    h.chain.putStake(STAKE, DEACTIVATED);
    h.at('2026-10-05T01:02:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'telegram-config', events: 1, messages: 0 });
    expect(h.telegram.requests).toEqual([]);
    expect((await h.readEvents())[0]?.notified_at).toBeNull();
    expect((await h.readMeta()).last_pass_at).toBeUndefined();
  });

  it('SITE_ORIGIN not an https origin: nothing sent, telegram-config; an event nobody follows is still closed', async () => {
    const h = createHarness({ env: { SITE_ORIGIN: 'https://stakeward.test/' } });
    h.at('2026-10-05T01:00:00Z');
    const unfollowed = key(11);
    h.chain.putStake(STAKE, SPEC);
    h.chain.putStake(unfollowed, { ...SPEC, staker: NEW_MAIN, withdrawer: NEW_MAIN });
    await h.seedWatched([STAKE, unfollowed]);
    await h.linkChat(MAIN, CHAT_A);
    h.chain.putStake(STAKE, DEACTIVATED);
    h.chain.putStake(unfollowed, { ...SPEC, staker: NEW_MAIN, withdrawer: NEW_MAIN, deactivationEpoch: 951n });
    h.at('2026-10-05T01:02:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'telegram-config', events: 2, messages: 0 });
    expect(h.telegram.requests).toEqual([]);
    const notified = Object.fromEntries((await h.readEvents()).map((e) => [e.stake_account, e.notified_at]));
    expect(notified).toEqual({ [STAKE]: null, [unfollowed]: h.clock.ms });
  });
});

describe('events that are not sent', () => {
  it('an event older than 7 days is closed without a send', async () => {
    const h = await watched();
    await h.linkChat(MAIN, CHAT_A);
    h.telegram.replyAlways(CHAT_A, 500);
    h.chain.putStake(STAKE, DEACTIVATED);
    expect(await next(h)).toMatchObject({ events: 1, retrySends: 1 });
    const [event] = await h.readEvents();
    expect(event?.notified_at).toBeNull();

    h.at(new Date((event?.detected_at ?? 0) + 7 * DAY_MS - 60_000).toISOString());
    expect(await h.pass()).toMatchObject({ retrySends: 1, expiredUndelivered: 0 });
    h.at(new Date((event?.detected_at ?? 0) + 7 * DAY_MS + 60_000).toISOString());
    expect(await h.pass()).toMatchObject({ outcome: 'ok', pending: 1, messages: 0, retrySends: 0, expiredUndelivered: 1 });
    expect(h.telegram.requests).toHaveLength(2);
    expect((await h.readEvents())[0]?.notified_at).toBe(h.clock.ms);
    expect((await h.readLinks())[0]?.last_event_id).toBe(0);
  });

  it('a reminder whose lock end changed before delivery is closed without a send; the lock change is sent', async () => {
    const h = createHarness();
    h.at('2027-03-13T05:00:00Z');
    h.chain.putStake(STAKE, SPEC);
    await h.seedWatched([STAKE]);
    await h.linkChat(MAIN, CHAT_A);
    h.telegram.replyTo(CHAT_A, 500);
    h.at('2027-03-14T06:30:00Z');
    expect(await h.pass()).toMatchObject({ reminders: 1, retrySends: 1 });

    const extended = LOCK_UNTIL + 90n * 86_400n;
    h.chain.putStake(STAKE, { ...SPEC, unixTimestamp: extended });
    expect(await next(h)).toMatchObject({ events: 1, superseded: 1, messages: 1 });
    const [message] = h.telegram.delivered(CHAT_A);
    expect(alertsIn(message?.text ?? '')).toHaveLength(1);
    expect(message?.text).toMatch(/^Devnet: The lock on stake .* was extended to 12 July 2027\./);
    expect((await h.readEvents()).map((e) => [e.type, e.notified_at])).toEqual([
      ['REMINDER_30', h.clock.ms],
      ['LOCKUP_CHANGED', h.clock.ms],
    ]);
  });

  it('a reminder goes out with Extend lock and does not count in alerts_sent', async () => {
    const h = createHarness();
    h.at('2027-03-13T05:00:00Z');
    h.chain.putStake(STAKE, SPEC);
    await h.seedWatched([STAKE]);
    await h.linkChat(SECOND, CHAT_A);
    h.at('2027-03-14T06:30:00Z');
    expect(await h.pass()).toMatchObject({ reminders: 1, messages: 1, alertsDelivered: 0 });
    const [message] = h.telegram.delivered(CHAT_A);
    expect(message?.text).toMatch(/^Devnet: The lock on stake .* ends on 13 April 2027 \(in 30 days\)\./);
    expect(message?.button).toEqual({ label: 'Extend lock', url: `${SITE}/extend/${STAKE}` });
    expect((await h.readMeta()).alerts_sent).toBeUndefined();
  });
});

describe('the delivery commit', () => {
  it('lands before the rescans: a pass that fails after its sends does not send them again', async () => {
    const h = await watched();
    await h.linkChat(MAIN, CHAT_A);
    h.chain.putStake(STAKE, DEACTIVATED);
    // DEACTIVATED searches the (main key, second key) pair again in the same pass; its write fails.
    h.db.failWhen = (entry) => entry.name === 'KNOWN_LIVE';
    await expect(next(h)).rejects.toThrow(/D1_ERROR/);
    expect(texts(h, CHAT_A)).toHaveLength(1);
    expect((await h.readEvents())[0]?.notified_at).not.toBeNull();
    expect(h.adminMessages()).toHaveLength(1);

    h.db.failWhen = null;
    expect(await next(h)).toMatchObject({ outcome: 'ok', pending: 0 });
    expect(h.telegram.requests.filter((r) => r.chatId !== ADMIN_CHAT)).toHaveLength(1);
  });

  it('one batch after the sends: progress, unlinked chats, closed events and alerts_sent', async () => {
    const h = await watched();
    await h.linkChat(MAIN, CHAT_A);
    await h.linkChat(MAIN, CHAT_B);
    h.telegram.replyTo(CHAT_B, 403);
    h.chain.putStake(STAKE, DEACTIVATED);
    const from = h.db.journal.length;
    await next(h);
    const entries = h.db.journal.slice(from);
    const commit = entries.filter((e) => e.name === 'LINK_PROGRESS');
    expect(commit).toHaveLength(1);
    const batch = entries.filter((e) => e.call === commit[0]?.call).map((e) => e.name);
    expect(batch).toEqual(['LINK_PROGRESS', 'UNLINK_CHATS', 'MARK_NOTIFIED', 'PUT_META']);
    expect(entries.map((e) => e.name).indexOf('PENDING')).toBeLessThan(entries.map((e) => e.name).indexOf('LINK_PROGRESS'));
  });
});

describe('a busy chat does not hold back the others', () => {
  const BUSY = 'busy';
  const VICTIM = 'victim';
  const busyWallet = key(30);
  const victimWallet = key(31);

  /** `count` DEACTIVATED events of closed rows of `wallet` (never paged), oldest first; returns their alert texts. */
  async function seedEvents(wallet: Address, count: number, first: number, nowMs: number): Promise<string[]> {
    const texts: string[] = [];
    const statements: D1PreparedStatement[] = [];
    for (let i = first; i < first + count; i++) {
      const bytes = new Uint8Array(32).fill(0x44);
      bytes[0] = i >> 8;
      bytes[1] = i & 0xff;
      const stake = getAddressDecoder().decode(bytes);
      statements.push(
        env.DB.prepare(
          `INSERT INTO accounts (stake_account, withdrawer, staker, custodian, lock_until, lamports, state, slot, checked_at, created_at)
           VALUES (?1, ?2, ?2, ?3, CAST(?5 AS INTEGER), '1', 'closed', 1, ?4, ?4)`,
        ).bind(stake, wallet, SECOND, nowMs, LOCK_UNTIL.toString()),
        env.DB.prepare(
          `INSERT INTO events (stake_account, type, details_json, slot, detected_at) VALUES (?1, 'DEACTIVATED', '{"deactivationEpoch":"951"}', 1, ?2)`,
        ).bind(stake, nowMs),
      );
      texts.push(alertText({ type: 'DEACTIVATED', details: { deactivationEpoch: '951' } }, stake, wallet));
    }
    await env.DB.batch(statements);
    return texts;
  }

  it('150 events of one chat, then one of another chat: the other chat gets it on the second pass', async () => {
    const h = createHarness();
    h.at('2026-10-05T01:00:00Z');
    const busyTexts = await seedEvents(busyWallet, 150, 0, h.clock.ms);
    const [victimText] = await seedEvents(victimWallet, 1, 150, h.clock.ms);
    await h.linkChat(busyWallet, BUSY);
    await h.linkChat(victimWallet, VICTIM);

    // The window (the 100 oldest pending) holds only the busy chat's events: its message covers all of them.
    expect(await h.pass()).toMatchObject({ outcome: 'ok', pending: 100, messages: 1, alertsDelivered: 100 });
    const [first] = h.telegram.delivered(BUSY);
    expect(alertsIn(first?.text ?? '')).toEqual([
      ...busyTexts.slice(0, 5),
      'And 95 more alerts for the wallets this chat follows. The Stakeward accounts page lists every change.',
    ]);
    expect(first?.button).toEqual({ label: 'Open Rescue', url: `${SITE}/rescue?address=${busyWallet}` });

    h.advance(120_000);
    expect(await h.pass()).toMatchObject({ outcome: 'ok', pending: 51, messages: 2 });
    expect(texts(h, VICTIM)).toEqual([`Devnet: ${victimText ?? ''}`]);

    // The busy chat gets the rest, each event once: shown, or counted in the first message's last line.
    for (let pass = 0; pass < 12; pass++) {
      h.advance(120_000);
      await h.pass();
    }
    const shown = h.telegram.delivered(BUSY).flatMap((m) => alertsIn(m.text)).filter((text) => !text.startsWith('And '));
    expect(shown).toEqual([...busyTexts.slice(0, 5), ...busyTexts.slice(100)]);
    expect((await h.readEvents()).every((e) => e.notified_at !== null)).toBe(true);
    expect((await h.readMeta()).alerts_sent).toBe('151');
  });
});
