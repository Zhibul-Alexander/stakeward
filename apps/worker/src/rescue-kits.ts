import { getBase58Decoder, type Address } from '@solana/kit';
import {
  checkRescueKit,
  decodeStakeAccount,
  isLockupInForce,
  readNonceAccount,
  shortAddress,
  SYSVAR_CLOCK_ADDRESS,
  ZERO_ADDRESS,
  type RawAccount,
  type RescueKit,
} from '@stakeward/core';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import * as z from 'zod';
import { isAddressText } from './address.ts';
import { decodeBase64, encodeBase64 } from './base64.ts';
import { botUsernameOf } from './monitor/config.ts';
import { readChunk, type ChunkRead, type RawItem } from './monitor/read.ts';
import { SQL } from './monitor/store.ts';
import { describeIssue, MAX_TRANSACTION_BASE64 } from './rpc-params.ts';
import { telegramStartUrl } from './telegram/link.ts';
import { isRecord } from './stake-accounts.ts';
import { callUpstream, type UpstreamEndpoints, type UpstreamOptions } from './upstream.ts';
import type { AppEnv } from './app.ts';

/**
 * One-tap rescue kits (DECISIONS.md D118): the worker keeps the F4 rescue of a stake account, signed in advance by the
 * main key, the second key and the new wallet on the new wallet's own durable nonce, and sends it when the account is
 * under attack. This is the one exception to CLAUDE.md section 2.6 ("the worker does not store transactions"): the
 * kit can only move both authorities to the owner's new wallet (the lock stays), so the bytes are no secret, and a
 * hacked worker can at worst send the owner's own rescue early or not at all.
 *
 * - POST /api/rescue-kits { transaction }: core checkRescueKit, then ONE chain read of [Clock, stake account, nonce
 *   account] (the lock and the keys as the kit says, the nonce ready with the kit's value), the account watched, and
 *   a simulation with signature checks. Stored as `ready`; a new kit replaces the account's kit.
 *   The answer carries a one-time bot link, `/start kit-<token>` (only its SHA-256 is stored): the chat that uses it is
 *   bound to the kit, follows the main key's alerts, and gets a "Rescue now" callback button under the alarming alerts
 *   of that account (monitor/deliver.ts). A tap sends the kit (rescueFromButton) from that chat only. There is no
 *   public send route: anyone could fire someone's rescue with it.
 * - GET /api/rescue-kits?account=: the status, never the bytes, the token or the chat.
 * - The monitor sends a ready kit by itself after a STAKER_CHANGED (monitor/pass.ts autoSendKits).
 *
 * `sent` means an RPC node took the transaction, not that it landed: the monitor sees the new authorities on the
 * chain like any other change.
 */

/** Largest body: a 1232-byte transaction is 1644 base64 characters, plus the JSON around it. */
export const MAX_RESCUE_KIT_BODY_BYTES = 2048;

/**
 * Events whose alert carries "Rescue now" in the chat bound to the account's ready kit. Not LOCKUP_CHANGED or
 * WITHDRAWER_CHANGED: the main key alone cannot do either while the lock holds, and the kit cannot undo them.
 */
export const RESCUE_KIT_EVENTS: ReadonlySet<string> = new Set([
  'DEACTIVATED',
  'STAKER_CHANGED',
  'DELEGATION_CHANGED',
  'BALANCE_DECREASED',
]);

/** Prefix of the bot start parameter that binds a chat to a kit: `kit-<token>`. */
export const KIT_START_PREFIX = 'kit-';

/** A start parameter that may be a kit token: Telegram allows 1 to 64 of [A-Za-z0-9_-]. */
const KIT_START = /^kit-([A-Za-z0-9_-]{1,60})$/;

/** A tap on "Rescue now" sends at most once within this (KIT_CLAIM): a double tap, or Telegram retrying the update. */
export const KIT_BUTTON_COOLDOWN_MS = 30_000;

/** The callback data of an account's "Rescue now" button: `rk:<stake account>` (at most 47 of Telegram's 64 bytes). */
export function rescueKitCallbackData(stakeAccount: Address): string {
  return `rk:${stakeAccount}`;
}

/** The stake account of `rk:<stake account>`, else null. */
export function parseRescueKitCallback(data: string): Address | null {
  if (!data.startsWith('rk:')) return null;
  const account = data.slice(3);
  return isAddressText(account) && account !== ZERO_ADDRESS ? account : null;
}

/** The token of a `kit-<token>` start parameter, else null. */
export function kitStartToken(arg: string): string | null {
  return KIT_START.exec(arg)?.[1] ?? null;
}

/** A new one-time token: 16 random bytes, base64url without padding (22 characters). */
export function newKitToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return encodeBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** SHA-256 of a token, hex: what rescue_kits.link_token_hash holds. */
export async function kitTokenHash(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Kit statuses as stored (migration 0005); `none` is an account without a kit. */
export type RescueKitStatus = 'none' | 'ready' | 'sent' | 'stale';

const stakeAccountText = z
  .string()
  .refine(isAddressText, 'Expected a base58 address')
  .refine((a) => a !== ZERO_ADDRESS, 'The all-zero address is not a stake account');

export const rescueKitBody = z.strictObject({
  transaction: z
    .string()
    .min(1)
    .max(MAX_TRANSACTION_BASE64)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Expected a base64 transaction'),
});

const accountQuery = z.strictObject({ account: stakeAccountText });

export type RescueKitStatusJson = {
  stakeAccount: Address;
  status: RescueKitStatus;
  newWallet: Address | null;
  signature: string | null;
  /** When the worker sent it, unix ms. */
  sentAt: number | null;
  /** A Telegram chat used the kit's bot link. */
  telegramLinked: boolean;
};

type ChainRefusal =
  | 'not-stake-account'
  | 'wrong-main-key'
  | 'lock-not-in-force'
  | 'wrong-second-key'
  | 'nonce-mismatch';

/**
 * The chain as a kit needs it, from `read` = [Clock, stake account, nonce account]: a stake account whose main key and
 * second key are the kit's, its lock in force by the cluster clock of the same read, and the nonce account ready,
 * held by the new wallet, with the value the kit was signed on. Null when all holds.
 */
export function chainRefusal(kit: RescueKit, read: ChunkRead): { code: ChainRefusal; message: string } | null {
  const [stakeItem = null, nonceItem = null] = read.items;
  const stake = stakeItem === null ? null : decodeStakeAccount(rawOf(kit.stakeAccount, stakeItem));
  if (stake === null || !stake.ok) {
    return { code: 'not-stake-account', message: 'The account is not a stake account' };
  }
  const { account } = stake;
  if (account.withdrawer !== kit.mainKey) {
    return { code: 'wrong-main-key', message: 'The main key of the account is not the one that signed the kit' };
  }
  if (!isLockupInForce(account.lockup, read.clock)) {
    return { code: 'lock-not-in-force', message: 'The lock of the account is not in force' };
  }
  if (account.lockup.custodian !== kit.secondKey) {
    return { code: 'wrong-second-key', message: 'The second key of the account is not the one that signed the kit' };
  }
  const nonce = readNonceAccount(nonceItem === null ? null : rawOf(kit.nonceAccount, nonceItem), kit.newWallet);
  if (nonce.kind !== 'ready' || nonce.value !== kit.nonceValue) {
    return { code: 'nonce-mismatch', message: 'The nonce account does not hold the value the kit was signed on' };
  }
  return null;
}

function rawOf(address: Address, item: RawItem): RawAccount {
  // parseMultipleAccounts accepts canonical base64 only, which always decodes.
  const data = decodeBase64(item.dataBase64) ?? new Uint8Array();
  return { address, data, lamports: item.lamports, owner: item.owner };
}

/** What a send of a kit came to. */
export type KitSendOutcome =
  /** A node took it (or already had it): `signature` is the kit's own, the fee payer's. */
  | { kind: 'sent'; signature: string }
  /** The nonce moved on or is gone: the kit can never land. */
  | { kind: 'stale' }
  /** The node refused it for another reason (preflight failed); the kit stays ready. */
  | { kind: 'refused' }
  /** No usable answer. */
  | { kind: 'upstream'; reason: 'timeout' | 'unavailable' | 'malformed' };

/** The transaction signature of wire bytes: the first signature, the fee payer's (a kit has 3, so one length byte). */
export function kitSignature(bytes: Uint8Array): string {
  return getBase58Decoder().decode(bytes.subarray(1, 65));
}

/**
 * sendTransaction of a stored kit, with preflight, one attempt on the primary (callUpstream 'send'). A node answers
 * an advanced or missing nonce with BlockhashNotFound, or with an error of instruction 0 (AdvanceNonceAccount):
 * `stale`. AlreadyProcessed is the kit already on the chain: `sent`.
 */
export async function sendKit(
  txBase64: string,
  deps: { endpoints: UpstreamEndpoints; options: UpstreamOptions },
): Promise<KitSendOutcome> {
  const bytes = decodeBase64(txBase64);
  if (bytes === null) return { kind: 'stale' };
  const payload = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'sendTransaction',
    params: [txBase64, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed' }],
  });
  const result = await callUpstream(deps.endpoints, payload, 'send', deps.options);
  if (!result.ok) return { kind: 'upstream', reason: result.reason === 'timeout' ? 'timeout' : 'unavailable' };
  const json = parseJson(result.body);
  if (!isRecord(json)) return { kind: 'upstream', reason: 'malformed' };
  if (typeof json.result === 'string') return { kind: 'sent', signature: kitSignature(bytes) };
  if (!isRecord(json.error)) return { kind: 'upstream', reason: 'malformed' };
  const transactionError = isRecord(json.error.data) ? json.error.data.err : undefined;
  const message = typeof json.error.message === 'string' ? json.error.message : '';
  if (transactionError === 'AlreadyProcessed' || /already been processed/i.test(message)) {
    return { kind: 'sent', signature: kitSignature(bytes) };
  }
  if (isStaleError(transactionError, message)) return { kind: 'stale' };
  return { kind: 'refused' };
}

function isStaleError(transactionError: unknown, message: string): boolean {
  if (transactionError === 'BlockhashNotFound' || /blockhash not found/i.test(message)) return true;
  if (!isRecord(transactionError) || !Array.isArray(transactionError.InstructionError)) return false;
  return transactionError.InstructionError[0] === 0;
}

/** simulateTransaction with signature checks and the kit's own nonce (no blockhash replaced). */
async function simulateKit(
  txBase64: string,
  deps: { endpoints: UpstreamEndpoints; options: UpstreamOptions },
): Promise<'ok' | 'failed' | { reason: 'timeout' | 'unavailable' | 'malformed' }> {
  const payload = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'simulateTransaction',
    params: [txBase64, { encoding: 'base64', sigVerify: true, commitment: 'confirmed' }],
  });
  const result = await callUpstream(deps.endpoints, payload, 'read', deps.options);
  if (!result.ok) return { reason: result.reason === 'timeout' ? 'timeout' : 'unavailable' };
  const json = parseJson(result.body);
  if (!isRecord(json)) return { reason: 'malformed' };
  // A node refuses a transaction it cannot even simulate (bad signatures, a missing account) as a JSON-RPC error.
  if (isRecord(json.error)) return 'failed';
  if (!isRecord(json.result) || !isRecord(json.result.value) || !('err' in json.result.value)) {
    return { reason: 'malformed' };
  }
  return json.result.value.err === null ? 'ok' : 'failed';
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function refuse(c: Context<AppEnv>, status: ContentfulStatusCode, error: string, message: string): Response {
  console.log(JSON.stringify({ msg: 'rescue kit refused', error }));
  return c.json({ error, message }, status, { 'Cache-Control': 'no-store' });
}

function upstreamFailure(c: Context<AppEnv>, reason: 'timeout' | 'unavailable' | 'malformed'): Response {
  switch (reason) {
    case 'timeout':
      return refuse(c, 504, 'upstream-timeout', 'The RPC node did not answer in time');
    case 'unavailable':
      return refuse(c, 502, 'upstream-unavailable', 'The RPC node is unavailable');
    case 'malformed':
      return refuse(c, 502, 'upstream-error', 'The RPC node returned an error');
  }
}

/** POST /api/rescue-kits { transaction }: checks a kit against its bytes and the chain, then stores it (`ready`). */
export function createRescueKitHandler(upstreamOptions: UpstreamOptions, now: () => number) {
  return async (c: Context<AppEnv>): Promise<Response> => {
    const contentType = c.req.header('Content-Type') ?? '';
    if (!/^application\/json\s*(;|$)/i.test(contentType)) {
      return refuse(c, 415, 'unsupported-media-type', 'Content-Type must be application/json');
    }
    let body: unknown;
    try {
      body = JSON.parse(await c.req.text());
    } catch {
      return refuse(c, 400, 'invalid-body', 'Body is not JSON');
    }
    const parsed = rescueKitBody.safeParse(body);
    if (!parsed.success) return refuse(c, 400, 'invalid-body', describeIssue(parsed.error, 'body'));
    const bytes = decodeBase64(parsed.data.transaction);
    if (bytes === null) return refuse(c, 400, 'invalid-body', 'body.transaction: Expected canonical base64');

    const checked = await checkRescueKit(bytes);
    if (!checked.ok) return refuse(c, 400, checked.code, checked.message);
    const { kit } = checked;

    // The client takes the account under watch first (POST /api/watch): the alarm that makes a kit sendable comes
    // from the monitor. Checked before the chain read, which costs RPC credits.
    const db = c.env.DB;
    const watched = await db.prepare(SQL.WATCHED_LIVE).bind(kit.stakeAccount).first();
    if (watched === null) return refuse(c, 409, 'not-watched', 'The stake account is not watched');

    if (c.env.RPC_URL === '') return refuse(c, 503, 'upstream-unavailable', 'RPC is not configured');
    const deps = { endpoints: { primary: c.env.RPC_URL, fallback: c.env.RPC_FALLBACK_URL }, options: upstreamOptions };
    const chunk = await readChunk([SYSVAR_CLOCK_ADDRESS, kit.stakeAccount, kit.nonceAccount], deps);
    if (!chunk.ok) return upstreamFailure(c, chunk.reason);
    const refusal = chainRefusal(kit, chunk.read);
    if (refusal !== null) return refuse(c, 409, refusal.code, refusal.message);

    // The canonical base64 of the checked bytes, as the RPC proxy sends them.
    const tx = parsed.data.transaction;
    const simulated = await simulateKit(tx, deps);
    if (simulated === 'failed') return refuse(c, 409, 'simulation-failed', 'The rescue fails in simulation');
    if (simulated !== 'ok') return upstreamFailure(c, simulated.reason);

    const token = newKitToken();
    const stored = await db
      .prepare(SQL.KIT_UPSERT)
      .bind(kit.stakeAccount, tx, kit.mainKey, kit.newWallet, kit.nonceAccount, kit.nonceValue, now(), await kitTokenHash(token))
      .run();
    if (stored.meta.changes === 0) return refuse(c, 409, 'not-watched', 'The stake account is not watched');
    console.log(JSON.stringify({ msg: 'rescue kit stored' }));
    const telegramStart = `${KIT_START_PREFIX}${token}`;
    const bot = botUsernameOf(c.env);
    const answer = {
      stakeAccount: kit.stakeAccount,
      newWallet: kit.newWallet,
      nonceAccount: kit.nonceAccount,
      status: 'ready',
      telegramStart,
      telegramUrl: bot === null ? null : telegramStartUrl(bot, telegramStart),
    };
    return c.json(answer, 200, { 'Cache-Control': 'no-store' });
  };
}

type KitStatusRow = {
  status: string;
  new_wallet: Address;
  signature: string | null;
  sent_at: number | null;
  linked: number;
};

/** GET /api/rescue-kits?account=<stake account>: the kit's status and whether a Telegram chat is bound to it. */
export function rescueKitStatusHandler() {
  return async (c: Context<AppEnv>): Promise<Response> => {
    const entries = [...new URL(c.req.url).searchParams.entries()];
    const parsed = accountQuery.safeParse(Object.fromEntries(entries));
    if (!parsed.success || entries.length !== 1) {
      return c.json({ error: 'invalid-query', message: 'Pass exactly one account=<stake account>' }, 400);
    }
    const stakeAccount = parsed.data.account;
    const row = await c.env.DB.prepare(SQL.KIT_STATUS).bind(stakeAccount).first<KitStatusRow>();
    const status = statusOf(row?.status);
    const body: RescueKitStatusJson =
      row === null || status === 'none'
        ? { stakeAccount, status: 'none', newWallet: null, signature: null, sentAt: null, telegramLinked: false }
        : {
            stakeAccount,
            status,
            newWallet: row.new_wallet,
            signature: row.signature,
            sentAt: row.sent_at,
            telegramLinked: row.linked === 1,
          };
    return c.json(body);
  };
}

function statusOf(value: string | undefined): RescueKitStatus {
  return value === 'ready' || value === 'sent' || value === 'stale' ? value : 'none';
}

/** What a tap on "Rescue now" comes to: the callback answer (a toast) and, after a send, a message to the chat. */
export type ButtonResult = {
  answer: string;
  message: { text: string; button: { label: string; path: string } | null } | null;
};

/**
 * A tap on "Rescue now" (`rk:<stake account>`) in `chatId` (telegram/webhook.ts; the secret-token check ran before).
 * Only the chat bound to the kit, a ready kit, and one send per KIT_BUTTON_COOLDOWN_MS (KIT_CLAIM); then sendKit and
 * the outcome stored like the monitor's. No alarm is needed: the bound chat is the owner's (it used the one-time link).
 */
export async function rescueFromButton(
  env: Env,
  deps: { upstream: UpstreamOptions; now: () => number },
  chatId: string,
  stakeAccount: Address,
): Promise<ButtonResult> {
  const db = env.DB;
  const nowMs = deps.now();
  const claimed = await db
    .prepare(SQL.KIT_CLAIM)
    .bind(stakeAccount, chatId, nowMs, KIT_BUTTON_COOLDOWN_MS)
    .first<{ tx: string; main_key: Address; new_wallet: Address }>();
  if (claimed === null) {
    const row = await db.prepare(SQL.KIT_OF_CHAT).bind(stakeAccount, chatId).first<{ status: string }>();
    const answer =
      row === null
        ? 'Not linked to this chat.'
        : row.status === 'sent'
          ? 'This rescue was already sent.'
          : row.status === 'stale'
            ? 'This rescue can no longer be sent.'
            : 'Already sending. Wait a moment.';
    return { answer, message: null };
  }
  if (env.RPC_URL === '') return { answer: 'The network is unavailable. Try again in a minute.', message: null };
  const outcome = await sendKit(claimed.tx, {
    endpoints: { primary: env.RPC_URL, fallback: env.RPC_FALLBACK_URL },
    options: deps.upstream,
  });
  console.log(JSON.stringify({ msg: 'rescue kit send', trigger: 'button', outcome: outcome.kind }));
  if (outcome.kind === 'sent' || outcome.kind === 'stale') {
    const settlement = kitSettlement(stakeAccount, claimed.tx, outcome, deps.now());
    await db.prepare(SQL.KIT_SETTLE).bind(JSON.stringify([settlement])).run();
  }
  const openRescue = { label: 'Open Rescue', path: `/rescue?address=${claimed.main_key}` };
  switch (outcome.kind) {
    case 'sent':
      return {
        answer: 'Rescue sent.',
        message: {
          text: `Rescue sent: stake ${shortAddress(stakeAccount)} now belongs to your new wallet ${shortAddress(claimed.new_wallet)}.`,
          button: { label: 'Open Stakeward', path: `/rescue-kit/${stakeAccount}` },
        },
      };
    case 'stale':
      return {
        answer: 'This rescue can no longer be sent.',
        message: {
          text: 'This rescue can no longer be sent: the new wallet used its signing account. Open Rescue.',
          button: openRescue,
        },
      };
    case 'refused':
      return {
        answer: 'The network refused the rescue.',
        message: { text: 'The network refused this rescue. Open Rescue to rescue this stake by hand.', button: openRescue },
      };
    case 'upstream':
      return { answer: 'The network did not answer. Try again in a minute.', message: null };
  }
}

/** A KIT_SETTLE entry for a send that came to `sent` or `stale`. */
export function kitSettlement(
  stakeAccount: Address,
  tx: string,
  outcome: Extract<KitSendOutcome, { kind: 'sent' | 'stale' }>,
  nowMs: number,
): { a: Address; tx: string; status: 'sent' | 'stale'; sig: string | null; at: number | null } {
  return outcome.kind === 'sent'
    ? { a: stakeAccount, tx, status: 'sent', sig: outcome.signature, at: nowMs }
    : { a: stakeAccount, tx, status: 'stale', sig: null, at: null };
}
