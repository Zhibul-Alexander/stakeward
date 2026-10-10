// One-tap rescue kits (D118): POST /api/rescue-kits checks a kit against its bytes, the chain (one read with the Clock
// first) and a simulation before it stores it, and hands out a one-time bot link; GET tells its status, never its
// bytes; the bot binds a chat with /start kit-<token>, and only that chat's "Rescue now" button sends the kit.
import type { Address } from '@solana/kit';
import { STAKE_PROGRAM_ADDRESS, SYSTEM_PROGRAM_ADDRESS, SYSVAR_CLOCK_ADDRESS, SYSVAR_PROGRAM_ADDRESS } from '@stakeward/core';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeBase64 } from '../src/base64.ts';
import { KIT_BUTTON_COOLDOWN_MS, kitSignature, kitTokenHash, MAX_RESCUE_KIT_BODY_BYTES } from '../src/rescue-kits.ts';
import { TELEGRAM_WEBHOOK_PATH } from '../src/telegram/webhook.ts';
import { fakeUpstream, multipleAccountsAnswer, rpcResponse, testApp, type AccountJson, type Outcome, type UpstreamCall } from './fakes.ts';
import {
  clockData,
  key,
  nonceAccountData,
  signedProtect,
  signedRescueKit,
  signedSystemTransfer,
  stakeAccountData,
  type RescueKitSetup,
  type StakeAccountSpec,
} from './transactions.ts';

const DAY_S = 86_400n;
const STAKE = key(9);
const NOW_MS = Date.UTC(2026, 9, 10, 12);
const CLOCK_UNIX = BigInt(NOW_MS / 1000);
const SLOT = 5000;

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  // Every refusal and store is logged as one line.
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

type Chain = {
  accounts: Map<Address, AccountJson>;
  /** simulateTransaction's value.err (null: success), or a whole response. */
  simulate: unknown;
  send: (call: UpstreamCall) => Outcome;
  multiple: ((call: UpstreamCall) => Outcome) | null;
};

/** The chain a kit expects: the stake account locked by the kit's keys, the nonce ready with the kit's value. */
function chainFor(kit: RescueKitSetup, spec: Partial<StakeAccountSpec> = {}, nonceValue: string = kit.nonceValue): Chain {
  const stake = stakeAccountData({
    state: 'delegated',
    staker: kit.mainKey.address,
    withdrawer: kit.mainKey.address,
    custodian: kit.secondKey.address,
    unixTimestamp: CLOCK_UNIX + 100n * DAY_S,
    ...spec,
  });
  return {
    accounts: new Map<Address, AccountJson>([
      [SYSVAR_CLOCK_ADDRESS, { data: clockData(BigInt(SLOT), 950n, CLOCK_UNIX), lamports: 1n, owner: SYSVAR_PROGRAM_ADDRESS }],
      [kit.stakeAccount, { data: stake, lamports: 5_000_000_000n, owner: STAKE_PROGRAM_ADDRESS }],
      [kit.nonceAccount, { data: nonceAccountData(kit.newWallet.address, nonceValue), lamports: 1_447_680n, owner: SYSTEM_PROGRAM_ADDRESS }],
    ]),
    simulate: null,
    send: (call) => rpcResponse(call.json.id, 'sig'),
    multiple: null,
  };
}

function upstreamOf(chain: Chain) {
  return fakeUpstream((call) => {
    // answerCallbackQuery to the Bot API: the only call off the RPC hosts.
    if (call.endpoint === 'other') return Response.json({ ok: true, result: true });
    switch (call.json.method) {
      case 'getMultipleAccounts': {
        if (chain.multiple !== null) return chain.multiple(call);
        const [keys] = call.json.params as [Address[]];
        return multipleAccountsAnswer(call.json.id, SLOT, keys.map((k) => chain.accounts.get(k) ?? null));
      }
      case 'simulateTransaction':
        return rpcResponse(call.json.id, { context: { slot: SLOT }, value: { err: chain.simulate, logs: [] } });
      case 'sendTransaction':
        return chain.send(call);
      default:
        throw new Error(`unexpected ${call.json.method}`);
    }
  });
}

/** The worker clock; a test may move it (the button's cooldown). */
const clock = { ms: NOW_MS };
const now = () => clock.ms;

beforeEach(() => {
  clock.ms = NOW_MS;
});

async function watch(stakeAccount: Address, state = 'delegated'): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO accounts (stake_account, withdrawer, staker, custodian, lock_until, lamports, state, slot, checked_at, created_at)
     VALUES (?1, ?2, ?2, ?3, 0, '1', ?4, 1, 1, 1)`,
  )
    .bind(stakeAccount, key(1), key(2), state)
    .run();
}

type KitRow = {
  stake_account: string;
  tx: string;
  main_key: string;
  new_wallet: string;
  nonce_account: string;
  nonce_value: string;
  created_at: number;
  status: string;
  sent_at: number | null;
  signature: string | null;
  link_token_hash: string | null;
  chat_id: string | null;
  attempted_at: number | null;
};

async function kitRows(): Promise<KitRow[]> {
  return (await env.DB.prepare('SELECT * FROM rescue_kits ORDER BY stake_account').all<KitRow>()).results;
}

async function storeKit(kit: RescueKitSetup, status = 'ready', chatId: string | null = null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO rescue_kits (stake_account, tx, main_key, new_wallet, nonce_account, nonce_value, created_at, status, chat_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  )
    .bind(
      kit.stakeAccount,
      encodeBase64(kit.bytes),
      kit.mainKey.address,
      kit.newWallet.address,
      kit.nonceAccount,
      kit.nonceValue,
      NOW_MS,
      status,
      chatId,
    )
    .run();
}

function postKit(app: ReturnType<typeof testApp>, body: unknown, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return app.request('/api/rescue-kits', {
    method: 'POST',
    ...init,
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/rescue-kits', () => {
  it('stores a valid kit of a watched account after one chain read and a simulation with signature checks', async () => {
    const kit = await signedRescueKit(STAKE);
    await watch(STAKE);
    const upstream = upstreamOf(chainFor(kit));
    const res = await postKit(testApp(upstream, { now }), { transaction: encodeBase64(kit.bytes) });

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json<Record<string, unknown>>();
    const start = String(body.telegramStart);
    expect(start).toMatch(/^kit-[A-Za-z0-9_-]{22}$/);
    expect(body).toEqual({
      stakeAccount: STAKE,
      newWallet: kit.newWallet.address,
      nonceAccount: kit.nonceAccount,
      status: 'ready',
      telegramStart: start,
      telegramUrl: `https://t.me/stakeward_test_bot?start=${start}`,
    });
    expect(upstream.calls.map((c) => c.json.method)).toEqual(['getMultipleAccounts', 'simulateTransaction']);
    expect(upstream.calls[0]?.json.params[0]).toEqual([SYSVAR_CLOCK_ADDRESS, STAKE, kit.nonceAccount]);
    expect(upstream.calls[1]?.json.params).toEqual([
      encodeBase64(kit.bytes),
      { encoding: 'base64', sigVerify: true, commitment: 'confirmed' },
    ]);
    expect(await kitRows()).toEqual([
      {
        stake_account: STAKE,
        tx: encodeBase64(kit.bytes),
        main_key: kit.mainKey.address,
        new_wallet: kit.newWallet.address,
        nonce_account: kit.nonceAccount,
        nonce_value: kit.nonceValue,
        created_at: NOW_MS,
        status: 'ready',
        sent_at: null,
        signature: null,
        // Only the hash of the token: the answer above is the one place the token itself ever was.
        link_token_hash: await kitTokenHash(start.slice('kit-'.length)),
        chat_id: null,
        attempted_at: null,
      },
    ]);
    expect(JSON.stringify(await kitRows())).not.toContain(start.slice('kit-'.length));
  });

  it('telegramUrl is null while the bot is not configured; telegramStart is still there', async () => {
    const kit = await signedRescueKit(STAKE);
    await watch(STAKE);
    const app = testApp(upstreamOf(chainFor(kit)), { now, env: { TELEGRAM_BOT_USERNAME: '' } });
    const body = await (await postKit(app, { transaction: encodeBase64(kit.bytes) })).json<Record<string, unknown>>();
    expect(body).toMatchObject({ telegramUrl: null, telegramStart: expect.stringMatching(/^kit-/) as unknown });
  });

  it('a new kit signed by the main key and the second key replaces the stored one, whatever its status', async () => {
    const first = await signedRescueKit(STAKE);
    await watch(STAKE);
    await storeKit(first, 'sent', '777');
    await env.DB.prepare("UPDATE rescue_kits SET sent_at = 1, signature = 'x', link_token_hash = 'old', attempted_at = 1").run();
    const second = await signedRescueKit(STAKE, { keys: { mainKey: first.mainKey, secondKey: first.secondKey } });
    const res = await postKit(testApp(upstreamOf(chainFor(second)), { now }), { transaction: encodeBase64(second.bytes) });
    expect(res.status).toBe(200);
    expect(await kitRows()).toEqual([
      expect.objectContaining({
        tx: encodeBase64(second.bytes),
        new_wallet: second.newWallet.address,
        status: 'ready',
        sent_at: null,
        signature: null,
        attempted_at: null,
        // A new token, and the chat the old one bound is let go.
        chat_id: null,
      }),
    ]);
    expect((await kitRows())[0]?.link_token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses what the inspector or the kit check refuses, before any chain read', async () => {
    const noUpstream = fakeUpstream(() => {
      throw new Error('unexpected upstream call');
    });
    const app = testApp(noUpstream, { now });
    await watch(STAKE);
    const unsigned = await signedRescueKit(STAKE, { sign: ['newWallet', 'mainKey'] });
    const cases: [Uint8Array, string][] = [
      [await signedSystemTransfer(), 'not-stakeward'],
      [(await signedProtect()).bytes, 'not-rescue'],
      [unsigned.bytes, 'signatures'],
    ];
    for (const [bytes, code] of cases) {
      const res = await postKit(app, { transaction: encodeBase64(bytes) });
      expect(res.status, code).toBe(400);
      expect(await res.json(), code).toMatchObject({ error: code });
    }
    expect(noUpstream.calls).toEqual([]);
    expect(await kitRows()).toEqual([]);
  });

  it('refuses an account that is not watched, or closed, before any chain read', async () => {
    const kit = await signedRescueKit(STAKE);
    const upstream = upstreamOf(chainFor(kit));
    const app = testApp(upstream, { now });
    const res = await postKit(app, { transaction: encodeBase64(kit.bytes) });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'not-watched' });

    await watch(STAKE, 'closed');
    const closed = await postKit(app, { transaction: encodeBase64(kit.bytes) });
    expect(closed.status).toBe(409);
    expect(await closed.json()).toMatchObject({ error: 'not-watched' });
    expect(upstream.calls).toEqual([]);
    expect(await kitRows()).toEqual([]);
  });

  it('refuses a kit the chain does not match: lock, keys, nonce; nothing is simulated or stored', async () => {
    const kit = await signedRescueKit(STAKE);
    await watch(STAKE);
    const other = key(77);
    const cases: [string, Chain][] = [
      ['lock-not-in-force', chainFor(kit, { unixTimestamp: CLOCK_UNIX })],
      ['wrong-second-key', chainFor(kit, { custodian: other })],
      ['wrong-main-key', chainFor(kit, { withdrawer: other })],
      ['nonce-mismatch', chainFor(kit, {}, 'GfVcyD4kkTrj4bKc7WA9sZCin9JDbdT4Zkd3EittNR1W')],
    ];
    const noStake = chainFor(kit);
    noStake.accounts.delete(STAKE);
    cases.push(['not-stake-account', noStake]);
    const noNonce = chainFor(kit);
    noNonce.accounts.delete(kit.nonceAccount);
    cases.push(['nonce-mismatch', noNonce]);
    const otherAuthority = chainFor(kit);
    otherAuthority.accounts.set(kit.nonceAccount, {
      data: nonceAccountData(other, kit.nonceValue),
      lamports: 1_447_680n,
      owner: SYSTEM_PROGRAM_ADDRESS,
    });
    cases.push(['nonce-mismatch', otherAuthority]);

    for (const [code, chain] of cases) {
      const upstream = upstreamOf(chain);
      const res = await postKit(testApp(upstream, { now }), { transaction: encodeBase64(kit.bytes) });
      expect(res.status, code).toBe(409);
      expect(await res.json(), code).toMatchObject({ error: code });
      expect(upstream.calls.map((c) => c.json.method), code).toEqual(['getMultipleAccounts']);
    }
    expect(await kitRows()).toEqual([]);
  });

  it('refuses a kit that fails in simulation, as an error result or a JSON-RPC error', async () => {
    const kit = await signedRescueKit(STAKE);
    await watch(STAKE);
    const failing = chainFor(kit);
    failing.simulate = { InstructionError: [1, { Custom: 0 }] };
    const res = await postKit(testApp(upstreamOf(failing), { now }), { transaction: encodeBase64(kit.bytes) });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'simulation-failed' });

    const refusing = fakeUpstream((call) =>
      call.json.method === 'simulateTransaction'
        ? new Response(JSON.stringify({ jsonrpc: '2.0', id: call.json.id, error: { code: -32003, message: 'bad sig' } }))
        : multipleAccountsAnswer(call.json.id, SLOT, (call.json.params[0] as Address[]).map((k) => chainFor(kit).accounts.get(k) ?? null)),
    );
    const refused = await postKit(testApp(refusing, { now }), { transaction: encodeBase64(kit.bytes) });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: 'simulation-failed' });
    expect(await kitRows()).toEqual([]);
  });

  it('maps upstream failures like /api/watch and stores nothing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const kit = await signedRescueKit(STAKE);
    await watch(STAKE);
    const cases: [number, string, (chain: Chain) => void][] = [
      [502, 'upstream-unavailable', (chain) => (chain.multiple = () => new Response('down', { status: 503 }))],
      [504, 'upstream-timeout', (chain) => (chain.multiple = () => 'hang')],
      [502, 'upstream-error', (chain) => (chain.multiple = (call) => rpcResponse(call.json.id, { value: [] }))],
      [502, 'upstream-error', (chain) => (chain.simulate = undefined)],
    ];
    for (const [status, error, change] of cases) {
      const chain = chainFor(kit);
      change(chain);
      const res = await postKit(testApp(upstreamOf(chain), { now, timeoutMs: 20 }), { transaction: encodeBase64(kit.bytes) });
      expect(res.status, error).toBe(status);
      expect(await res.json(), error).toMatchObject({ error });
    }
    expect(await kitRows()).toEqual([]);
  });

  it('checks the request: JSON content type, a strict body, canonical base64, the size limit', async () => {
    const app = testApp(fakeUpstream(() => new Response()), { now });
    const kit = await signedRescueKit(STAKE);
    const tx = encodeBase64(kit.bytes);
    const res415 = await postKit(app, { transaction: tx }, { headers: { 'Content-Type': 'text/plain' } });
    expect(res415.status).toBe(415);
    const cases: unknown[] = ['not json', {}, { transaction: tx, extra: 1 }, { transaction: 5 }, { transaction: 'AB==' }];
    for (const body of cases) {
      const res = await postKit(app, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid-body' });
    }
    const big = await postKit(app, { transaction: 'A'.repeat(MAX_RESCUE_KIT_BODY_BYTES) });
    expect(big.status).toBe(413);
  });
});

describe('GET /api/rescue-kits', () => {
  const get = (app: ReturnType<typeof testApp>, query: string) => app.request(`/api/rescue-kits${query}`);
  const noUpstream = () =>
    fakeUpstream(() => {
      throw new Error('unexpected upstream call');
    });

  it('none without a kit', async () => {
    const res = await get(testApp(noUpstream(), { now }), `?account=${STAKE}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({
      stakeAccount: STAKE,
      status: 'none',
      newWallet: null,
      signature: null,
      sentAt: null,
      telegramLinked: false,
    });
  });

  it('the status and whether a chat is bound; never the bytes, the token hash or the chat', async () => {
    const kit = await signedRescueKit(STAKE);
    await watch(STAKE);
    await storeKit(kit);
    await env.DB.prepare("UPDATE rescue_kits SET link_token_hash = 'abcdef0123'").run();
    const app = testApp(noUpstream(), { now });
    const status = async () => {
      const res = await get(app, `?account=${STAKE}`);
      const text = await res.text();
      for (const secret of [encodeBase64(kit.bytes), 'abcdef0123', '4242424242']) expect(text).not.toContain(secret);
      return JSON.parse(text) as Record<string, unknown>;
    };
    expect(await status()).toEqual({
      stakeAccount: STAKE,
      status: 'ready',
      newWallet: kit.newWallet.address,
      signature: null,
      sentAt: null,
      telegramLinked: false,
    });
    await env.DB.prepare("UPDATE rescue_kits SET chat_id = '4242424242', link_token_hash = NULL").run();
    expect(await status()).toMatchObject({ status: 'ready', telegramLinked: true });

    await env.DB.prepare("UPDATE rescue_kits SET status = 'sent', sent_at = ?1, signature = 'sig1'").bind(NOW_MS).run();
    expect(await status()).toEqual({
      stakeAccount: STAKE,
      status: 'sent',
      newWallet: kit.newWallet.address,
      signature: 'sig1',
      sentAt: NOW_MS,
      telegramLinked: true,
    });
    await env.DB.prepare("UPDATE rescue_kits SET status = 'stale'").run();
    expect(await status()).toMatchObject({ status: 'stale' });
  });

  it('refuses a query that is not exactly one account', async () => {
    const app = testApp(noUpstream(), { now });
    for (const query of ['', '?account=bad', `?account=${STAKE}&x=1`, `?account=${'1'.repeat(32)}`]) {
      const res = await get(app, query);
      expect(res.status, query).toBe(400);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    }
  });

  it('there is no public send route', async () => {
    const res = await testApp(noUpstream(), { now }).request(`/api/rescue-kits/${STAKE}/send`, { method: 'POST' });
    expect(res.status).toBe(404);
  });
});

/** A chat id of its own per call: the per-chat rate limit of the webhook is shared by the whole run. */
function freshChat(): number {
  const [n = 0] = crypto.getRandomValues(new Uint32Array(1));
  return 2_000_000_000 + (n % 1_000_000_000);
}

let updateId = 0;

function webhook(app: ReturnType<typeof testApp>, update: Record<string, unknown>) {
  updateId += 1;
  return app.request(TELEGRAM_WEBHOOK_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'test-webhook-secret' },
    body: JSON.stringify({ update_id: updateId, ...update }),
  });
}

function command(app: ReturnType<typeof testApp>, chatId: number, text: string) {
  const chat = { id: chatId, type: 'private', first_name: 'Ann' };
  return webhook(app, { message: { message_id: updateId, date: 1_790_000_000, chat, text } });
}

function tap(app: ReturnType<typeof testApp>, chatId: number, data: string) {
  return webhook(app, {
    callback_query: {
      id: `cb-${String(updateId)}`,
      from: { id: chatId, is_bot: false, first_name: 'Ann' },
      chat_instance: '1',
      message: { message_id: 7, date: 1_790_000_000, chat: { id: chatId, type: 'private' } },
      data,
    },
  });
}

async function alertLinks(): Promise<{ wallet: string; chat_id: string }[]> {
  return (await env.DB.prepare('SELECT wallet, chat_id FROM alert_links ORDER BY chat_id, wallet').all<{ wallet: string; chat_id: string }>())
    .results;
}

describe('the bot link: /start kit-<token>', () => {
  it('binds the chat once, follows the main key, and /stop lets go of both', async () => {
    const kit = await signedRescueKit(STAKE);
    await watch(STAKE);
    const app = testApp(upstreamOf(chainFor(kit)), { now });
    const { telegramStart } = await (await postKit(app, { transaction: encodeBase64(kit.bytes) })).json<{ telegramStart: string }>();
    const chat = freshChat();

    const linked = await (await command(app, chat, `/start ${telegramStart}`)).json<{ method: string; chat_id: string; text: string }>();
    expect(linked).toMatchObject({ method: 'sendMessage', chat_id: String(chat) });
    expect(linked.text).toMatch(/^One-tap rescue is linked for stake \S+\.\.\.\S+\. If Stakeward sees a change you did not make, press Rescue now under the alert\./);
    expect(linked.text).toContain(`Alerts are on for ${kit.mainKey.address}.`);
    expect(await kitRows()).toEqual([expect.objectContaining({ chat_id: String(chat), link_token_hash: null })]);
    expect(await alertLinks()).toEqual([{ wallet: kit.mainKey.address, chat_id: String(chat) }]);

    // One-time: the same link in another chat (or again) binds nothing.
    const other = freshChat();
    const used = await (await command(app, other, `/start ${telegramStart}`)).json<{ text: string }>();
    expect(used.text).toBe('This link was already used or is not valid.');
    const unknown = await (await command(app, other, '/start kit-AAAAAAAAAAAAAAAAAAAAAA')).json<{ text: string }>();
    expect(unknown.text).toBe('This link was already used or is not valid.');
    expect(await kitRows()).toEqual([expect.objectContaining({ chat_id: String(chat) })]);
    expect(await alertLinks()).toEqual([{ wallet: kit.mainKey.address, chat_id: String(chat) }]);

    // A malformed kit parameter is not a token and not an address.
    const malformed = await (await command(app, other, '/start kit-')).json<{ text: string }>();
    expect(malformed.text).toMatch(/^That is not a wallet address/);

    const stop = await command(app, chat, '/stop');
    expect(stop.status).toBe(200);
    expect(await kitRows()).toEqual([expect.objectContaining({ chat_id: null, status: 'ready' })]);
    expect(await alertLinks()).toEqual([]);
  });

  it('a blocked bot lets go of the kit too', async () => {
    const kit = await signedRescueKit(STAKE);
    const chat = freshChat();
    await watch(STAKE);
    await storeKit(kit, 'ready', String(chat));
    const app = testApp(upstreamOf(chainFor(kit)), { now });
    const res = await webhook(app, {
      my_chat_member: {
        chat: { id: chat, type: 'private' },
        from: { id: chat, is_bot: false, first_name: 'Ann' },
        date: 1_790_000_000,
        old_chat_member: { user: { id: 1, is_bot: true, first_name: 'Stakeward' }, status: 'member' },
        new_chat_member: { user: { id: 1, is_bot: true, first_name: 'Stakeward' }, status: 'kicked' },
      },
    });
    expect(res.status).toBe(200);
    expect(await kitRows()).toEqual([expect.objectContaining({ chat_id: null })]);
  });
});

type BotAnswer = {
  method: string;
  chat_id?: string;
  callback_query_id?: string;
  text?: string;
  reply_markup?: { inline_keyboard: { text: string; url?: string; callback_data?: string }[][] };
};

describe('the "Rescue now" button: callback rk:<stake account>', () => {
  async function bound(): Promise<{ kit: RescueKitSetup; chat: number; chain: Chain; upstream: ReturnType<typeof upstreamOf> }> {
    const kit = await signedRescueKit(STAKE);
    const chat = freshChat();
    await watch(STAKE);
    await storeKit(kit, 'ready', String(chat));
    const chain = chainFor(kit);
    return { kit, chat, chain, upstream: upstreamOf(chain) };
  }
  const sendCalls = (upstream: ReturnType<typeof upstreamOf>) => upstream.calls.filter((c) => c.json.method === 'sendTransaction');
  const toasts = (upstream: ReturnType<typeof upstreamOf>) =>
    upstream.calls.filter((c) => c.endpoint === 'other').map((c) => (c.json as unknown as { text: string }).text);

  it('from the bound chat: sends the kit with preflight, marks it sent and says so, with a button to the site', async () => {
    const { kit, chat, upstream } = await bound();
    const app = testApp(upstream, { now });
    const res = await tap(app, chat, `rk:${STAKE}`);
    expect(res.status).toBe(200);
    const body = await res.json<BotAnswer>();
    expect(body).toEqual({
      method: 'sendMessage',
      chat_id: String(chat),
      text: expect.stringMatching(/^Rescue sent: stake \S+ now belongs to your new wallet \S+\.$/) as unknown,
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: 'Open Stakeward', url: `https://stakeward.test/rescue-kit/${STAKE}` }]] },
    });
    expect(sendCalls(upstream).map((c) => c.json.params)).toEqual([
      [encodeBase64(kit.bytes), { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed' }],
    ]);
    expect(toasts(upstream)).toEqual(['Rescue sent.']);
    expect(await kitRows()).toEqual([
      expect.objectContaining({ status: 'sent', sent_at: NOW_MS, signature: kitSignature(kit.bytes), attempted_at: NOW_MS }),
    ]);

    // Sent: a second tap sends nothing.
    clock.ms += KIT_BUTTON_COOLDOWN_MS;
    const again = await (await tap(app, chat, `rk:${STAKE}`)).json<BotAnswer>();
    expect(again).toEqual({ method: 'answerCallbackQuery', callback_query_id: expect.any(String) as unknown, text: 'This rescue was already sent.' });
    expect(sendCalls(upstream)).toHaveLength(1);
  });

  it('from another chat, or for an account without a kit: "Not linked to this chat.", nothing sent', async () => {
    const { upstream } = await bound();
    const app = testApp(upstream, { now });
    const other = await (await tap(app, freshChat(), `rk:${STAKE}`)).json<BotAnswer>();
    expect(other).toMatchObject({ method: 'answerCallbackQuery', text: 'Not linked to this chat.' });
    const noKit = await (await tap(app, freshChat(), `rk:${key(10)}`)).json<BotAnswer>();
    expect(noKit).toMatchObject({ method: 'answerCallbackQuery', text: 'Not linked to this chat.' });
    const garbage = await (await tap(app, freshChat(), 'xx')).json<BotAnswer>();
    expect(garbage).toEqual({ method: 'answerCallbackQuery', callback_query_id: expect.any(String) as unknown });
    expect(sendCalls(upstream)).toEqual([]);
    expect(await kitRows()).toEqual([expect.objectContaining({ status: 'ready', attempted_at: null })]);
  });

  it('a nonce that moved on (BlockhashNotFound or instruction 0) marks the kit stale and points to Rescue', async () => {
    for (const err of ['BlockhashNotFound', { InstructionError: [0, 'InvalidArgument'] }]) {
      await env.DB.prepare('DELETE FROM rescue_kits').run();
      await env.DB.prepare('DELETE FROM accounts').run();
      const { kit, chat, chain, upstream } = await bound();
      chain.send = (call) =>
        Response.json({ jsonrpc: '2.0', id: call.json.id, error: { code: -32002, message: 'Transaction simulation failed', data: { err } } });
      const body = await (await tap(testApp(upstream, { now }), chat, `rk:${STAKE}`)).json<BotAnswer>();
      expect(body).toMatchObject({
        method: 'sendMessage',
        text: 'This rescue can no longer be sent: the new wallet used its signing account. Open Rescue.',
        reply_markup: { inline_keyboard: [[{ text: 'Open Rescue', url: `https://stakeward.test/rescue?address=${kit.mainKey.address}` }]] },
      });
      expect(toasts(upstream)).toEqual(['This rescue can no longer be sent.']);
      expect(await kitRows()).toEqual([expect.objectContaining({ status: 'stale', sent_at: null, signature: null })]);
    }
  });

  it('AlreadyProcessed counts as sent', async () => {
    const { kit, chat, chain, upstream } = await bound();
    chain.send = (call) =>
      Response.json({
        jsonrpc: '2.0',
        id: call.json.id,
        error: { code: -32002, message: 'This transaction has already been processed', data: { err: 'AlreadyProcessed' } },
      });
    const body = await (await tap(testApp(upstream, { now }), chat, `rk:${STAKE}`)).json<BotAnswer>();
    expect(body.text).toMatch(/^Rescue sent/);
    expect(await kitRows()).toEqual([expect.objectContaining({ status: 'sent', signature: kitSignature(kit.bytes) })]);
  });

  it('another refusal leaves the kit ready; taps within the cooldown send once; no answer from the node is a toast', async () => {
    const { chat, chain, upstream } = await bound();
    const app = testApp(upstream, { now });
    chain.send = (call) =>
      Response.json({
        jsonrpc: '2.0',
        id: call.json.id,
        error: { code: -32002, message: 'Transaction simulation failed', data: { err: { InstructionError: [1, { Custom: 3 }] } } },
      });
    const refused = await (await tap(app, chat, `rk:${STAKE}`)).json<BotAnswer>();
    expect(refused).toMatchObject({ method: 'sendMessage', text: 'The network refused this rescue. Open Rescue to rescue this stake by hand.' });
    expect(await kitRows()).toEqual([expect.objectContaining({ status: 'ready' })]);

    clock.ms += KIT_BUTTON_COOLDOWN_MS - 1;
    const early = await (await tap(app, chat, `rk:${STAKE}`)).json<BotAnswer>();
    expect(early).toMatchObject({ method: 'answerCallbackQuery', text: 'Already sending. Wait a moment.' });
    expect(sendCalls(upstream)).toHaveLength(1);

    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    clock.ms += 1;
    chain.send = () => new Response('down', { status: 503 });
    const down = await (await tap(app, chat, `rk:${STAKE}`)).json<BotAnswer>();
    expect(down).toMatchObject({ method: 'answerCallbackQuery', text: 'The network did not answer. Try again in a minute.' });
    expect(sendCalls(upstream)).toHaveLength(2);
    expect(await kitRows()).toEqual([expect.objectContaining({ status: 'ready' })]);
  });
});
