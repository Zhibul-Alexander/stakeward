import type { Address } from '@solana/kit';
import {
  formatAlert,
  formatReminder,
  MONITOR_EVENT_TYPES,
  ZERO_ADDRESS,
  type Alert,
  type Cluster,
  type MonitorEventDetails,
} from '@stakeward/core';
import { isAddressText } from '../address.ts';
import { siteUrl } from '../telegram/api.ts';
import { moreAlertsText } from '../telegram/texts.ts';
import type { StoredEventType } from './classify.ts';
import { MONITOR_LIMITS } from './config.ts';
import type { LinkRow, PendingRow } from './store.ts';

/**
 * Telegram delivery of the monitor pass, pure (step 5 spec section 7; DECISIONS.md D53): who gets an event, the one
 * message per chat a pass sends, and what Telegram's answers commit.
 *
 * Progress lives on the link: `alert_links.last_event_id` is the newest event id the chat has received for that
 * wallet (a new link starts at MAX(events.id)). A pass loads the oldest pending events (a prefix of all of them by
 * id), and each chat gets one message: the prefix of its own list, at most 5 alerts. When the window is full (more
 * events may wait behind it), the message covers the chat's whole list in it, the alerts past the shown ones counted
 * in a last line: otherwise one chat with more than a window of events (a validator deactivating 150 accounts, or
 * someone changing their own watched locks every pass) would keep every other chat's events out of the window. After
 * a message Telegram took (or refused for good, 400), every link of the chat moves to the message's last id. That is
 * exact: any event with a smaller id that concerns the chat and is still undelivered is in the loaded prefix, so it
 * was in the message. An event is closed (`notified_at`) once every link of its recipients is past it, or when it
 * cannot be sent at all. The only repeat: Telegram took a message and the commit after it failed (at least once).
 */

/** An `events` row waiting for delivery, with its account's keys and lock end as stored now. */
export type PendingEvent = {
  id: number;
  stakeAccount: Address;
  type: StoredEventType;
  /** Parsed details_json; null when it does not parse. */
  details: unknown;
  detectedAt: number;
  withdrawer: Address;
  custodian: Address;
  lockUntil: bigint;
};

export type Link = { wallet: Address; chatId: string; lastEventId: number };

/** A PENDING row as a PendingEvent. */
export function pendingEventOf(row: PendingRow): PendingEvent {
  return {
    id: row.id,
    stakeAccount: row.stake_account,
    type: row.type as StoredEventType,
    details: parseDetails(row.details_json),
    detectedAt: row.detected_at,
    withdrawer: row.withdrawer,
    custodian: row.custodian,
    lockUntil: BigInt(row.lock_until),
  };
}

export function linkOf(row: LinkRow): Link {
  return { wallet: row.wallet, chatId: row.chat_id, lastEventId: row.last_event_id };
}

/**
 * The wallets whose chats get `e`: the account's main key and second key as stored now; for WITHDRAWER_CHANGED also
 * the main key before and after, for LOCKUP_CHANGED the second key before and after (CLAUDE.md section 8: the main
 * key before and after the change, and the second key). Never the staker: anyone with the main key can set it. The
 * zero address and anything that is not an address are left out; no wallet twice.
 */
export function recipientsOf(e: PendingEvent): Address[] {
  const wallets: unknown[] = [e.withdrawer, e.custodian];
  const details = isRecord(e.details) ? e.details : {};
  if (e.type === 'WITHDRAWER_CHANGED') wallets.push(details.from, details.to);
  if (e.type === 'LOCKUP_CHANGED') wallets.push(details.fromCustodian, details.toCustodian);
  const unique = new Set<Address>();
  for (const wallet of wallets) {
    if (typeof wallet === 'string' && wallet !== ZERO_ADDRESS && isAddressText(wallet)) unique.add(wallet);
  }
  return [...unique];
}

/**
 * The alert text and button for `e` at `nowSec` (core formatAlert / formatReminder). Null when it is not worth
 * sending: a reminder whose lock end changed since (details.lockUntil is not the stored end) or has passed, or an
 * event whose stored details no longer format (an unknown type, a malformed row).
 */
export function alertOf(e: PendingEvent, nowSec: bigint): Alert | null {
  if (e.type.startsWith('REMINDER_')) {
    const lockUntil = isRecord(e.details) ? e.details.lockUntil : undefined;
    if (lockUntil !== e.lockUntil.toString() || e.lockUntil <= nowSec) return null;
    return formatReminder({ stakeAccount: e.stakeAccount, lockUntil: e.lockUntil, now: nowSec });
  }
  if (!(MONITOR_EVENT_TYPES as readonly string[]).includes(e.type) || !isRecord(e.details)) return null;
  // The details were written by this worker from diffSnapshots; a row that does not fit is closed, not retried forever.
  const event = { type: e.type, details: e.details, stakeAccount: e.stakeAccount } as MonitorEventDetails & {
    stakeAccount: Address;
  };
  try {
    return formatAlert(event, { withdrawer: e.withdrawer, custodian: e.custodian, lockUntil: e.lockUntil, now: nowSec });
  } catch {
    return null;
  }
}

export type PlannedMessage = {
  chatId: string;
  /** The events this message covers, by id: shown, or counted in its last line. */
  eventIds: number[];
  /** The chat's progress once the message is through: the largest of eventIds. */
  lastEventId: number;
  /** Alerts in this message that count toward meta.alerts_sent (reminders do not). */
  alertCount: number;
  text: string;
  button: { label: string; url: string };
};

export type DeliveryPlan = {
  /** One per chat, at most opts.maxMessages; none without a site origin. */
  messages: PlannedMessage[];
  /** Closed without a message: older than 7 days, not worth sending (alertOf), or no chat follows a recipient. */
  doneWithoutSend: number[];
  /** Chats with something to send in this window, before the maxMessages cut. */
  chats: number;
  /** Of doneWithoutSend: alertOf gave null. */
  superseded: number;
  /** Of doneWithoutSend: detected more than 7 days ago. */
  expired: number;
};

/**
 * The messages of this pass for `pending` (the PENDING window) and `links` (LINKS_FOR of their recipients):
 * 1. Events older than 7 days, events alertOf gives null for, and events no chat follows are closed unsent.
 * 2. A chat's list: the events, by id, that one of its links follows (a recipient wallet) and is not yet past.
 * 3. Chats by the first id of their list, then by chat id; the first `maxMessages` get one message each: the prefix
 *    of their list, at most 5 alerts and 3500 characters (the first alert always goes). With `fullWindow` the message
 *    covers the whole list: the rest is one last line (moreAlertsText).
 * 4. Text: "Devnet: " on devnet, then the alerts separated by a blank line. Button: the first covered alert that opens
 *    Rescue, else the first alert; always on `siteOrigin` (siteUrl). Without a site origin no message is planned.
 */
export function planDeliveries(
  pending: readonly PendingEvent[],
  links: readonly Link[],
  opts: { maxMessages: number; nowMs: number; siteOrigin: string | null; cluster: Cluster; fullWindow: boolean },
): DeliveryPlan {
  const nowSec = BigInt(Math.floor(opts.nowMs / 1000));
  const linksByWallet = groupLinks(links);
  const plan: DeliveryPlan = { messages: [], doneWithoutSend: [], chats: 0, superseded: 0, expired: 0 };
  const lists = new Map<string, { event: PendingEvent; alert: Alert }[]>();

  for (const event of [...pending].sort((a, b) => a.id - b.id)) {
    if (opts.nowMs - event.detectedAt > MONITOR_LIMITS.deliveryExpiryMs) {
      plan.expired += 1;
      plan.doneWithoutSend.push(event.id);
      continue;
    }
    const alert = alertOf(event, nowSec);
    if (alert === null) {
      plan.superseded += 1;
      plan.doneWithoutSend.push(event.id);
      continue;
    }
    let followed = false;
    const chats = new Set<string>();
    for (const wallet of recipientsOf(event)) {
      for (const link of linksByWallet.get(wallet) ?? []) {
        followed = true;
        if (event.id > link.lastEventId) chats.add(link.chatId);
      }
    }
    if (!followed) {
      plan.doneWithoutSend.push(event.id);
      continue;
    }
    for (const chat of chats) {
      const list = lists.get(chat);
      if (list === undefined) lists.set(chat, [{ event, alert }]);
      else list.push({ event, alert });
    }
  }

  plan.chats = lists.size;
  if (opts.siteOrigin === null) return plan;
  const origin = opts.siteOrigin;
  const ordered = [...lists].sort(
    ([chatA, listA], [chatB, listB]) => (listA[0]?.event.id ?? 0) - (listB[0]?.event.id ?? 0) || compare(chatA, chatB),
  );
  const prefix = opts.cluster === 'devnet' ? 'Devnet: ' : '';
  for (const [chatId, list] of ordered.slice(0, Math.max(0, opts.maxMessages))) {
    const items: { event: PendingEvent; alert: Alert }[] = [];
    let text = prefix;
    for (const item of list) {
      if (items.length === MONITOR_LIMITS.maxAlertsPerMessage) break;
      const next = items.length === 0 ? `${prefix}${item.alert.text}` : `${text}\n\n${item.alert.text}`;
      if (items.length > 0 && next.length > MONITOR_LIMITS.maxMessageChars) break;
      items.push(item);
      text = next;
    }
    const first = items[0];
    if (first === undefined) continue;
    const covered = opts.fullWindow ? list : items;
    if (covered.length > items.length) text = `${text}\n\n${moreAlertsText(covered.length - items.length)}`;
    const buttonAlert = covered.find((item) => isRescuePath(item.alert.path))?.alert ?? first.alert;
    const eventIds = covered.map((item) => item.event.id);
    plan.messages.push({
      chatId,
      eventIds,
      lastEventId: Math.max(...eventIds),
      alertCount: covered.filter((item) => !item.event.type.startsWith('REMINDER_')).length,
      text,
      button: { label: buttonAlert.buttonLabel, url: siteUrl(origin, buttonAlert.path) },
    });
  }
  return plan;
}

/** What one planned message came to: sendTelegramMessage's outcome, or 'not-attempted' when sending stopped first. */
export type SendResult = 'sent' | 'rejected' | 'blocked' | 'retry' | 'rate-limited' | 'config' | 'not-attempted';

/**
 * The commit of the sends (results[i] is messages[i]'s):
 * - `sent` or `rejected` (400: Telegram will never take it) move every link of the chat to the message's last id;
 * - `blocked` (403) removes every link of the chat;
 * - anything else leaves the chat where it was: the next pass sends the same events again.
 * `doneIds`: doneWithoutSend, plus each event whose recipients' links (the removed ones aside) are all past it now.
 * `alertsDelivered`: (event, chat) pairs Telegram took, reminders not counted (meta.alerts_sent, /api/stats).
 */
export function settleDeliveries(
  pending: readonly PendingEvent[],
  links: readonly Link[],
  messages: readonly PlannedMessage[],
  results: readonly SendResult[],
  doneWithoutSend: readonly number[],
): { progress: { chat: string; id: number }[]; unlinkChats: string[]; doneIds: number[]; alertsDelivered: number } {
  const progress: { chat: string; id: number }[] = [];
  const unlinkChats: string[] = [];
  const reached = new Map<string, number>();
  let alertsDelivered = 0;
  for (const [index, message] of messages.entries()) {
    const result = results[index] ?? 'not-attempted';
    if (result === 'sent' || result === 'rejected') {
      progress.push({ chat: message.chatId, id: message.lastEventId });
      reached.set(message.chatId, message.lastEventId);
    }
    if (result === 'sent') alertsDelivered += message.alertCount;
    if (result === 'blocked') unlinkChats.push(message.chatId);
  }

  const unlinked = new Set(unlinkChats);
  const closed = new Set(doneWithoutSend);
  const linksByWallet = groupLinks(links);
  const doneIds = [...doneWithoutSend];
  for (const event of pending) {
    if (closed.has(event.id)) continue;
    const delivered = recipientsOf(event).every((wallet) =>
      (linksByWallet.get(wallet) ?? []).every(
        (link) => unlinked.has(link.chatId) || Math.max(link.lastEventId, reached.get(link.chatId) ?? 0) >= event.id,
      ),
    );
    if (delivered) doneIds.push(event.id);
  }
  return { progress, unlinkChats, doneIds, alertsDelivered };
}

function groupLinks(links: readonly Link[]): Map<Address, Link[]> {
  const byWallet = new Map<Address, Link[]>();
  for (const link of links) {
    const list = byWallet.get(link.wallet);
    if (list === undefined) byWallet.set(link.wallet, [link]);
    else list.push(link);
  }
  return byWallet;
}

function parseDetails(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The rescue wizard, with or without the main key filled in (`/rescue?address=...`, core formatAlert). */
function isRescuePath(path: string): boolean {
  return path === '/rescue' || path.startsWith('/rescue?');
}
