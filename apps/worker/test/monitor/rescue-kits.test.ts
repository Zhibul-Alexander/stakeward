// One-tap rescue kits in the monitor (D118): a pass that records a STAKER_CHANGED sends the account's ready kit in the
// same pass (at most MONITOR_LIMITS.maxKitSends, the rest next pass), never on a DEACTIVATED alone; in the chat bound
// to a ready kit, the alarming alerts of its account carry the "Rescue now" callback button, other chats the link.
import type { Address } from '@solana/kit';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeBase64 } from '../../src/base64.ts';
import { MONITOR_LIMITS } from '../../src/monitor/config.ts';
import { kitSignature } from '../../src/rescue-kits.ts';
import { key, LOCK_UNTIL, signedRescueKit, type StakeAccountSpec } from '../transactions.ts';
import { createHarness, type Harness } from './harness.ts';

const MAIN = key(1);
const SECOND = key(2);
const THIEF = key(3);
const STAKE = key(10);
const CHAT = '5550001';
const SITE = 'https://stakeward.test';
const SPEC: StakeAccountSpec = { state: 'delegated', staker: MAIN, withdrawer: MAIN, custodian: SECOND, unixTimestamp: LOCK_UNTIL };

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * `accounts` watched at 01:00 UTC (no daily stage in the way), each with a ready kit; MAIN's chat linked, and bound to
 * the kits with `bound`.
 */
async function withKits(
  accounts: readonly Address[] = [STAKE],
  bound = false,
): Promise<{ h: Harness; txs: Map<Address, Uint8Array> }> {
  const h = createHarness();
  h.at('2026-10-05T01:00:00Z');
  for (const account of accounts) h.chain.putStake(account, SPEC);
  await h.seedWatched(accounts);
  await h.linkChat(MAIN, CHAT);
  const txs = new Map<Address, Uint8Array>();
  for (const account of accounts) {
    const kit = await signedRescueKit(account);
    txs.set(account, kit.bytes);
    await env.DB.prepare(
      `INSERT INTO rescue_kits (stake_account, tx, main_key, new_wallet, nonce_account, nonce_value, created_at, status, chat_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 'ready', ?7)`,
    )
      .bind(account, encodeBase64(kit.bytes), MAIN, kit.newWallet.address, kit.nonceAccount, kit.nonceValue, bound ? CHAT : null)
      .run();
  }
  return { h, txs };
}

async function kits(): Promise<{ stake_account: string; status: string; sent_at: number | null; signature: string | null }[]> {
  const { results } = await env.DB.prepare('SELECT stake_account, status, sent_at, signature FROM rescue_kits ORDER BY stake_account').all<{
    stake_account: string;
    status: string;
    sent_at: number | null;
    signature: string | null;
  }>();
  return results;
}

function sends(h: Harness) {
  return h.chain.callsOf('sendTransaction');
}

describe('monitor: rescue kit auto-send', () => {
  it('a STAKER_CHANGED sends the ready kit in the same pass, with preflight, and marks it sent', async () => {
    const { h, txs } = await withKits([STAKE], true);
    h.chain.putStake(STAKE, { ...SPEC, staker: THIEF });
    h.advance(120_000);
    const report = await h.pass();

    expect(report).toMatchObject({ outcome: 'ok', events: 1, kitSends: 1, kitsSent: 1, kitsStale: 0 });
    const tx = encodeBase64(txs.get(STAKE) ?? new Uint8Array());
    expect(sends(h).map((c) => c.params)).toEqual([
      [tx, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed' }],
    ]);
    const signature = kitSignature(txs.get(STAKE) ?? new Uint8Array());
    expect(await kits()).toEqual([{ stake_account: STAKE, status: 'sent', sent_at: h.clock.ms, signature }]);
    expect(h.logs.filter((l) => l.msg === 'rescue kit auto-send')).toEqual([
      { msg: 'rescue kit auto-send', stakeAccount: STAKE, outcome: 'sent', signature },
    ]);
    expect(JSON.stringify(h.logs)).not.toContain(CHAT);
    expect((await h.readMeta()).kit_queue).toBe('[]');

    // The kit was sent before the alert went out: no "Rescue now", the usual button.
    expect(h.telegram.delivered(CHAT).map((m) => m.button?.label)).toEqual(['Open Rescue']);

    // Nothing more to send on the next passes.
    h.advance(120_000);
    expect(await h.pass()).toMatchObject({ kitSends: 0 });
    expect(sends(h)).toHaveLength(1);
  });

  it('a DEACTIVATED alone sends nothing: the kit stays ready; the bound chat gets "Rescue now", another chat the link', async () => {
    const { h } = await withKits([STAKE], true);
    const otherChat = '5550002';
    await h.linkChat(SECOND, otherChat);
    h.chain.putStake(STAKE, { ...SPEC, deactivationEpoch: 951n });
    h.advance(120_000);
    expect(await h.pass()).toMatchObject({ outcome: 'ok', events: 1, kitSends: 0 });
    expect(sends(h)).toEqual([]);
    expect(await kits()).toEqual([expect.objectContaining({ status: 'ready' })]);
    expect(h.telegram.delivered(CHAT).map((m) => m.button)).toEqual([{ label: 'Rescue now', callbackData: `rk:${STAKE}` }]);
    expect(h.telegram.delivered(otherChat).map((m) => m.button)).toEqual([
      { label: 'Open Rescue', url: `${SITE}/rescue?address=${MAIN}` },
    ]);
  });

  it('a ready kit not bound to any chat changes no button', async () => {
    const { h } = await withKits([STAKE], false);
    h.chain.putStake(STAKE, { ...SPEC, deactivationEpoch: 951n });
    h.advance(120_000);
    await h.pass();
    expect(h.telegram.delivered(CHAT).map((m) => m.button)).toEqual([{ label: 'Open Rescue', url: `${SITE}/rescue?address=${MAIN}` }]);
  });

  it('delegation and balance alerts carry it too, and a message with another account takes the kit account', async () => {
    const other = key(11);
    const { h } = await withKits([STAKE], true);
    h.chain.putStake(other, SPEC);
    await h.seedWatched([other]);
    h.chain.putStake(STAKE, { ...SPEC, voter: key(43) }, 9_000_000_000n);
    h.chain.putStake(other, { ...SPEC, voter: key(43) });
    h.advance(120_000);
    expect(await h.pass()).toMatchObject({ outcome: 'ok', kitSends: 0 });
    const [message] = h.telegram.delivered(CHAT);
    expect(message?.text).toContain('was moved from validator');
    expect(message?.text).toContain('left stake');
    expect(message?.button).toEqual({ label: 'Rescue now', callbackData: `rk:${STAKE}` });
  });

  it('a lock or main key change keeps the link button even in the bound chat', async () => {
    const { h } = await withKits([STAKE], true);
    h.chain.putStake(STAKE, { ...SPEC, unixTimestamp: LOCK_UNTIL + 86_400n });
    h.advance(120_000);
    await h.pass();
    const [message] = h.telegram.delivered(CHAT);
    expect(message?.button?.callbackData).toBeUndefined();
    expect(message?.button?.url).toMatch(/^https:\/\/stakeward\.test\//);
  });

  it("auto mode 'any' sends on a DEACTIVATED too (D120); 'staker' does not", async () => {
    const other = key(11);
    const { h } = await withKits([STAKE, other]);
    await env.DB.prepare("UPDATE rescue_kits SET auto_mode = 'any' WHERE stake_account = ?1").bind(STAKE).run();
    h.chain.putStake(STAKE, { ...SPEC, deactivationEpoch: 951n });
    h.chain.putStake(other, { ...SPEC, deactivationEpoch: 951n });
    h.advance(120_000);
    expect(await h.pass()).toMatchObject({ outcome: 'ok', events: 2, kitSends: 1, kitsSent: 1 });
    expect(await kits()).toEqual([
      expect.objectContaining({ stake_account: STAKE, status: 'sent' }),
      expect.objectContaining({ stake_account: other, status: 'ready' }),
    ]);
    // The 'staker' kit left the queue: its mode does not take a DEACTIVATED.
    expect((await h.readMeta()).kit_queue).toBe('[]');
  });

  it("auto mode 'any' sends on a delegation or balance change", async () => {
    const { h } = await withKits([STAKE]);
    await env.DB.prepare("UPDATE rescue_kits SET auto_mode = 'any'").run();
    h.chain.putStake(STAKE, SPEC, 9_000_000_000n);
    h.advance(120_000);
    expect(await h.pass()).toMatchObject({ outcome: 'ok', kitSends: 1, kitsSent: 1 });
  });

  it("auto mode 'off' never sends, not even on a STAKER_CHANGED; the kit stays ready", async () => {
    const { h } = await withKits([STAKE]);
    await env.DB.prepare("UPDATE rescue_kits SET auto_mode = 'off'").run();
    h.chain.putStake(STAKE, { ...SPEC, staker: THIEF });
    h.advance(120_000);
    expect(await h.pass()).toMatchObject({ outcome: 'ok', events: 1, kitSends: 0 });
    expect(sends(h)).toEqual([]);
    expect(await kits()).toEqual([expect.objectContaining({ status: 'ready' })]);
    expect((await h.readMeta()).kit_queue).toBe('[]');
  });

  it('a queue stored by D118 (bare addresses) reads as STAKER_CHANGED entries', async () => {
    const { h } = await withKits([STAKE]);
    await h.setMeta({ kit_queue: JSON.stringify([STAKE, 'not an address']) });
    h.advance(120_000);
    expect(await h.pass()).toMatchObject({ outcome: 'ok', events: 0, kitSends: 1, kitsSent: 1 });
  });

  it('a nonce that moved on marks the kit stale; an RPC failure keeps it queued for the next pass', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { h } = await withKits();
    h.chain.failNext('sendTransaction', [503]);
    h.chain.putStake(STAKE, { ...SPEC, staker: THIEF });
    h.advance(120_000);
    expect(await h.pass()).toMatchObject({ outcome: 'ok', kitSends: 1, kitsSent: 0 });
    expect(await kits()).toEqual([expect.objectContaining({ status: 'ready' })]);
    expect(JSON.parse((await h.readMeta()).kit_queue ?? '[]')).toEqual([{ a: STAKE, t: 'staker' }]);

    h.chain.sendReply = () => ({
      error: { code: -32002, message: 'Transaction simulation failed: Blockhash not found', data: { err: 'BlockhashNotFound' } },
    });
    h.advance(120_000);
    expect(await h.pass()).toMatchObject({ outcome: 'ok', events: 0, kitSends: 1, kitsStale: 1 });
    expect(await kits()).toEqual([expect.objectContaining({ status: 'stale', sent_at: null, signature: null })]);
    expect((await h.readMeta()).kit_queue).toBe('[]');
    expect(sends(h)).toHaveLength(2);
  });

  it('a node that refuses the kit for another reason leaves it ready and out of the queue', async () => {
    const { h } = await withKits();
    h.chain.sendReply = () => ({
      error: { code: -32002, message: 'Transaction simulation failed', data: { err: { InstructionError: [1, { Custom: 3 }] } } },
    });
    h.chain.putStake(STAKE, { ...SPEC, staker: THIEF });
    h.advance(120_000);
    expect(await h.pass()).toMatchObject({ kitSends: 1, kitsSent: 0, kitsStale: 0 });
    expect(await kits()).toEqual([expect.objectContaining({ status: 'ready' })]);
    expect((await h.readMeta()).kit_queue).toBe('[]');
  });

  it(`at most ${String(MONITOR_LIMITS.maxKitSends)} sends a pass; the rest go on the next pass`, async () => {
    const accounts = Array.from({ length: MONITOR_LIMITS.maxKitSends + 1 }, (_, i) => key(10 + i));
    const { h } = await withKits(accounts);
    for (const account of accounts) h.chain.putStake(account, { ...SPEC, staker: THIEF });
    h.advance(120_000);
    expect(await h.pass()).toMatchObject({ outcome: 'ok', kitSends: MONITOR_LIMITS.maxKitSends, kitsSent: MONITOR_LIMITS.maxKitSends });
    expect((await kits()).filter((k) => k.status === 'sent')).toHaveLength(MONITOR_LIMITS.maxKitSends);

    h.advance(120_000);
    expect(await h.pass()).toMatchObject({ outcome: 'ok', events: 0, kitSends: 1, kitsSent: 1 });
    expect((await kits()).map((k) => k.status)).toEqual(accounts.map(() => 'sent'));
    expect(h.db.journal.filter((e) => e.name === 'KITS_READY_FOR')).toHaveLength(2);
  });

  it('an account without a kit costs one statement and leaves the queue', async () => {
    const h = createHarness();
    h.at('2026-10-05T01:00:00Z');
    h.chain.putStake(STAKE, SPEC);
    await h.seedWatched([STAKE]);
    h.chain.putStake(STAKE, { ...SPEC, staker: THIEF });
    h.advance(120_000);
    expect(await h.pass()).toMatchObject({ outcome: 'ok', events: 1, kitSends: 0 });
    expect(h.db.journal.filter((e) => e.name === 'KITS_READY_FOR')).toHaveLength(1);
    expect(sends(h)).toEqual([]);
    expect((await h.readMeta()).kit_queue).toBe('[]');
  });
});
