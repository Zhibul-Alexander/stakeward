// POST /api/telegram/webhook (step 5 spec section 8): the secret before anything else, a 64 KiB body limit, loose
// parsing with 200 {} on garbage, a rate limit per chat, my_chat_member, and the commands with the reply in the
// response body. "/start links, /stop unlinks" of the step 5 "Done when".
import type { Address } from '@solana/kit';
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_LINK_WRITES_PER_CHAT_PER_DAY } from '../../src/telegram/texts.ts';
import { MAX_LINK_WRITES_PER_DAY, MAX_TELEGRAM_UPDATE_BYTES, parseCommand } from '../../src/telegram/webhook.ts';
import { fakeUpstream, SECURITY_HEADERS, securityHeadersOf, testApp } from '../fakes.ts';
import { countingDb, type CountingDb } from '../monitor/harness.ts';
import { key } from '../transactions.ts';

const NOW = Date.UTC(2026, 9, 5, 12);
const SECRET = 'test-webhook-secret';
const BOT = 'stakeward_test_bot';
const ORIGIN = 'https://stakeward.test';
const WALLET = key(1);
const ZERO = '11111111111111111111111111111111';

let nextChat = 0;
/** A distinct chat id per call site: the per-chat rate limit is shared by every test of the run. */
function freshChat(group = false): number {
  nextChat += 1;
  const random = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  const id = 1_000_000 + (random % 1_000_000_000) * 100 + nextChat;
  return group ? -1_000_000_000_000 - id : id;
}

type Bot = { db: CountingDb; send: (update: unknown, init?: { secret?: string | null }) => Response | Promise<Response> };

/** The app with a counting D1 and a test clock; `send` posts an update with the right secret unless told otherwise. */
function bot(options: { env?: Partial<Env>; now?: () => number } = {}): Bot {
  const db = countingDb(env.DB);
  const app = testApp(
    fakeUpstream(() => {
      throw new Error('the webhook never calls the RPC');
    }),
    { now: options.now ?? (() => NOW), env: { DB: db, ...options.env } },
  );
  const send = (update: unknown, init: { secret?: string | null } = {}) => {
    const secret = init.secret === undefined ? SECRET : init.secret;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret !== null) headers['X-Telegram-Bot-Api-Secret-Token'] = secret;
    return app.request('/api/telegram/webhook', {
      method: 'POST',
      headers,
      body: typeof update === 'string' ? update : JSON.stringify(update),
    });
  };
  return { db, send };
}

let updateId = 0;
function message(chatId: number, text: string | undefined, type = chatId < 0 ? 'supergroup' : 'private') {
  updateId += 1;
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_790_000_000,
      from: { id: Math.abs(chatId), is_bot: false, first_name: 'Ann' },
      chat: { id: chatId, type, ...(type === 'private' ? { first_name: 'Ann' } : { title: 'Stake team' }) },
      ...(text === undefined ? {} : { text, entities: [{ type: 'bot_command', offset: 0, length: 6 }] }),
    },
  };
}

function memberUpdate(chatId: number, status: string) {
  updateId += 1;
  return {
    update_id: updateId,
    my_chat_member: {
      chat: { id: chatId, type: 'private', first_name: 'Ann' },
      from: { id: chatId, is_bot: false, first_name: 'Ann' },
      date: 1_790_000_000,
      old_chat_member: { user: { id: 1, is_bot: true, first_name: 'Stakeward' }, status: 'member' },
      new_chat_member: { user: { id: 1, is_bot: true, first_name: 'Stakeward' }, status },
    },
  };
}

type Reply = { method: string; chat_id: string; text: string; link_preview_options: { is_disabled: boolean } };

async function replyOf(res: Response): Promise<Reply> {
  expect(res.status).toBe(200);
  expect(res.headers.get('Content-Type')).toMatch(/^application\/json/);
  const body = await res.json<Reply>();
  expect(Object.keys(body).sort()).toEqual(['chat_id', 'link_preview_options', 'method', 'text']);
  expect(body.method).toBe('sendMessage');
  expect(body.link_preview_options).toEqual({ is_disabled: true });
  return body;
}

async function expectNoReply(res: Response): Promise<void> {
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({});
}

async function links(): Promise<{ wallet: string; chat_id: string; created_at: number; last_event_id: number }[]> {
  const { results } = await env.DB.prepare(
    'SELECT wallet, chat_id, created_at, last_event_id FROM alert_links ORDER BY chat_id, wallet',
  ).all<{ wallet: string; chat_id: string; created_at: number; last_event_id: number }>();
  return results;
}

async function addLink(wallet: Address, chatId: number, createdAt = NOW - 1000): Promise<void> {
  await env.DB.prepare('INSERT INTO alert_links (wallet, chat_id, created_at, last_event_id) VALUES (?1, ?2, ?3, 0)')
    .bind(wallet, String(chatId), createdAt)
    .run();
}

let eventSlot = 1000;
async function addEvents(count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    eventSlot += 1;
    await env.DB.prepare(
      "INSERT INTO events (stake_account, type, details_json, slot, detected_at) VALUES (?1, 'DEACTIVATED', '{}', ?2, ?3)",
    )
      .bind(key(50), eventSlot, NOW)
      .run();
  }
}

/** A watched account whose main key is `main` and second key `second`. */
async function addAccount(stake: Address, main: Address, second: Address, state = 'delegated'): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO accounts (stake_account, withdrawer, staker, custodian, lock_until, lamports, state, slot, checked_at, created_at)
     VALUES (?1, ?2, ?2, ?3, 1807574400, '10000000000', ?4, 1, ?5, ?5)`,
  )
    .bind(stake, main, second, state, NOW)
    .run();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the secret comes first', () => {
  it.each([
    ['no header', null],
    ['a wrong secret', 'wrong'],
    ['a longer secret', `${SECRET}x`],
    ['an empty header', ''],
  ])('%s: 401 without reading the body or touching D1', async (_name, secret) => {
    const b = bot();
    const res = await b.send(message(freshChat(), `/start ${WALLET}`), { secret });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(securityHeadersOf(res)).toEqual(SECURITY_HEADERS);
    expect(b.db.stats.statements).toBe(0);
    expect(await links()).toEqual([]);
  });

  it('a request without the secret is refused before its body is read', async () => {
    const db = countingDb(env.DB);
    const app = testApp(fakeUpstream(() => new Response()), { env: { DB: db } });
    /** POST with a streamed body that counts how often it is read. */
    const post = async (secret: string) => {
      const counter = { pulls: 0 };
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            counter.pulls += 1;
            controller.enqueue(new TextEncoder().encode(JSON.stringify(message(freshChat(), '/stop'))));
            controller.close();
          },
        },
        { highWaterMark: 0 },
      );
      const res = await app.request('/api/telegram/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
        body,
        // @ts-expect-error -- `duplex` is required by fetch for stream bodies but missing from RequestInit here.
        duplex: 'half',
      });
      return { res, pulls: counter.pulls };
    };
    const refused = await post('wrong');
    expect(refused.res.status).toBe(401);
    expect(refused.pulls).toBe(0);
    expect(db.stats.statements).toBe(0);
    // The control: with the secret the same kind of body is read and handled.
    const handled = await post(SECRET);
    expect(handled.pulls).toBeGreaterThan(0);
    expect((await replyOf(handled.res)).text).toMatch(/^Alerts are off/);
  });

  it('503 while TELEGRAM_WEBHOOK_SECRET is empty, whatever the header says', async () => {
    const b = bot({ env: { TELEGRAM_WEBHOOK_SECRET: '' } });
    for (const secret of ['', SECRET, null]) {
      const res = await b.send(message(freshChat(), `/start ${WALLET}`), { secret });
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ error: 'telegram-not-configured' });
      expect(securityHeadersOf(res)).toEqual(SECURITY_HEADERS);
    }
    expect(b.db.stats.statements).toBe(0);
  });
});

describe('/start <address> links the wallet to the chat', () => {
  it('creates the link from the newest event on and replies in the response body', async () => {
    await addEvents(3);
    await addAccount(key(10), WALLET, key(2));
    await addAccount(key(11), key(3), WALLET);
    await addAccount(key(12), WALLET, key(2), 'closed');
    const chat = freshChat();
    const res = await bot().send(message(chat, `/start ${WALLET}`));
    expect(securityHeadersOf(res)).toEqual(SECURITY_HEADERS);
    const reply = await replyOf(res);
    expect(reply.chat_id).toBe(String(chat));
    expect(reply.text).toBe(
      `Alerts are on for ${WALLET}. Stakeward watches 2 of its stake accounts. You will get a message here when one ` +
        'of them changes, and before a lock ends. /status lists the wallets of this chat, /stop turns all alerts off. ' +
        `Alerts only link to ${ORIGIN}. Stakeward never asks for your seed phrase.`,
    );
    const maxId = await env.DB.prepare('SELECT MAX(id) AS id FROM events').first<{ id: number }>();
    expect(await links()).toEqual([{ wallet: WALLET, chat_id: String(chat), created_at: NOW, last_event_id: maxId?.id }]);
    expect(maxId?.id).toBe(3);
  });

  it('starts at 0 when there is no event yet, and says how to get the wallet watched', async () => {
    const chat = freshChat();
    const reply = await replyOf(await bot().send(message(chat, `/start ${WALLET}`)));
    expect(reply.text).toContain('Stakeward watches 0 of its stake accounts.');
    expect(reply.text).toContain(
      `\n\nNo stake account of this wallet is watched yet. Protect one at ${ORIGIN}/app?address=${WALLET} and it is ` +
        'watched from then on.',
    );
    expect((await links())[0]).toMatchObject({ chat_id: String(chat), last_event_id: 0 });
  });

  it('is idempotent: a second /start keeps the one link and its progress', async () => {
    const chat = freshChat();
    await addEvents(2);
    await replyOf(await bot().send(message(chat, `/start ${WALLET}`)));
    await addEvents(1);
    const again = await replyOf(await bot({ now: () => NOW + 60_000 }).send(message(chat, `/start ${WALLET}`)));
    expect(again.text).toMatch(/^Alerts are on for /);
    expect(await links()).toEqual([{ wallet: WALLET, chat_id: String(chat), created_at: NOW, last_event_id: 2 }]);
  });

  it('works in a group as /start@<our bot>, and ignores a command for another bot', async () => {
    const group = freshChat(true);
    const reply = await replyOf(await bot().send(message(group, `/start@${BOT} ${WALLET}`)));
    expect(reply.chat_id).toBe(String(group));
    expect(reply.text).toMatch(/^Alerts are on for /);
    // Case does not matter in a username.
    await replyOf(await bot().send(message(group, `/start@${BOT.toUpperCase()} ${key(2)}`)));
    expect((await links()).map((l) => l.wallet).sort()).toEqual([WALLET, key(2)].sort());

    const b = bot();
    await expectNoReply(await b.send(message(group, `/start@OtherBot ${key(3)}`)));
    await expectNoReply(await b.send(message(group, '/stop@OtherBot')));
    await expectNoReply(await b.send(message(group, 'hello everyone')));
    expect(await links()).toHaveLength(2);
    expect(b.db.stats.statements).toBe(0);
  });

  it.each([
    ['not an address', '/start hello'],
    ['too short', '/start 1111'],
    ['the all-zero address', `/start ${ZERO}`],
    ['an address with a bad character', `/start ${WALLET.slice(0, -1)}0`],
  ])('%s: help with no link', async (_name, text) => {
    const b = bot();
    const reply = await replyOf(await b.send(message(freshChat(), text)));
    expect(reply.text).toBe(
      'That is not a wallet address. Send /start followed by a wallet address, or open ' +
        `${ORIGIN}/app and press Get alerts in Telegram. /status lists the wallets of this chat, /stop turns all ` +
        'alerts off. Stakeward never asks for your seed phrase.',
    );
    expect(await links()).toEqual([]);
    expect(b.db.stats.statements).toBe(0);
  });

  it('refuses the 21st wallet of a chat: 20 links stay', async () => {
    const chat = freshChat();
    for (let i = 0; i < 20; i++) await addLink(key(100 + i), chat);
    const reply = await replyOf(await bot().send(message(chat, `/start ${WALLET}`)));
    expect(reply.text).toBe(
      'This chat already follows 20 wallets, the most allowed. Send /stop to remove them all, then add the ones you need.',
    );
    expect(await links()).toHaveLength(20);
    // A wallet the chat already follows is still confirmed, and another chat is not limited.
    expect((await replyOf(await bot().send(message(chat, `/start ${key(100)}`)))).text).toMatch(/^Alerts are on for /);
    await replyOf(await bot().send(message(freshChat(), `/start ${WALLET}`)));
    expect(await links()).toHaveLength(21);
  });
});

describe('the daily budget of link writes (the D1 write quota is shared by dev and prod)', () => {
  const today = new Date(NOW).toISOString().slice(0, 10);
  const linkWrites = async () =>
    JSON.parse((await env.DB.prepare("SELECT value FROM meta WHERE key = 'link_writes'").first<{ value: string }>())?.value ?? 'null') as unknown;
  const setLinkWrites = async (n: number, chats: Record<string, number> = {}) => {
    await env.DB.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('link_writes', ?1)")
      .bind(JSON.stringify({ day: today, n, chats }))
      .run();
  };
  const CHAT_BUDGET_TEXT =
    `This chat has added ${String(MAX_LINK_WRITES_PER_CHAT_PER_DAY)} alert links today, the most allowed. Try again ` +
    'after 00:00 UTC; the alerts you already have keep coming.';

  it('only a /start that adds a link counts; a /start and /stop churn counts each link it adds', async () => {
    const chat = freshChat();
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < 5; i++) await replyOf(await bot().send(message(chat, `/start ${key(100 + i)}`)));
      // Again for a wallet the chat already follows: confirmed, not counted.
      await replyOf(await bot().send(message(chat, `/start ${key(100)}`)));
      await replyOf(await bot().send(message(chat, '/stop')));
    }
    expect(await linkWrites()).toMatchObject({ day: today, n: 10, chats: { [String(chat)]: 10 } });
  });

  it('a refused /start counts nothing: the 21st wallet of a chat', async () => {
    const chat = freshChat();
    for (let i = 0; i < 20; i++) await addLink(key(100 + i), chat);
    const b = bot();
    expect((await replyOf(await b.send(message(chat, `/start ${WALLET}`)))).text).toMatch(/^This chat already follows 20 wallets/);
    expect(b.db.journal.map((e) => e.name)).toEqual(['LINK_STATE']);
    expect(await linkWrites()).toBeNull();
  });

  it('a wallet the chat already follows is confirmed past every budget, without a write', async () => {
    const chat = freshChat();
    await addLink(WALLET, chat);
    await setLinkWrites(MAX_LINK_WRITES_PER_DAY, { [String(chat)]: MAX_LINK_WRITES_PER_CHAT_PER_DAY });
    const b = bot();
    expect((await replyOf(await b.send(message(chat, `/start ${WALLET}`)))).text).toMatch(/^Alerts are on for /);
    expect(b.db.journal.map((e) => e.name)).toEqual(['LINK_STATE']);
    expect(await linkWrites()).toEqual({ day: today, n: MAX_LINK_WRITES_PER_DAY, chats: { [String(chat)]: MAX_LINK_WRITES_PER_CHAT_PER_DAY } });
  });

  it(`a chat adds at most ${String(MAX_LINK_WRITES_PER_CHAT_PER_DAY)} links a day; other chats still link; the next UTC day it links again`, async () => {
    const chat = freshChat();
    await setLinkWrites(10, { [String(chat)]: MAX_LINK_WRITES_PER_CHAT_PER_DAY - 1 });
    await replyOf(await bot().send(message(chat, `/start ${WALLET}`)));
    expect(await links()).toHaveLength(1);
    expect(await linkWrites()).toMatchObject({ n: 11, chats: { [String(chat)]: MAX_LINK_WRITES_PER_CHAT_PER_DAY } });

    const full = bot();
    expect((await replyOf(await full.send(message(chat, `/start ${key(5)}`)))).text).toBe(CHAT_BUDGET_TEXT);
    expect(full.db.journal.map((e) => e.name)).toEqual(['LINK_STATE']);
    expect(await links()).toHaveLength(1);
    // /stop still works, and the count stays: churn does not reopen the budget.
    await replyOf(await full.send(message(chat, '/stop')));
    expect((await replyOf(await full.send(message(chat, `/start ${WALLET}`)))).text).toBe(CHAT_BUDGET_TEXT);
    expect(await links()).toEqual([]);

    const other = freshChat();
    expect((await replyOf(await bot().send(message(other, `/start ${key(5)}`)))).text).toMatch(/^Alerts are on for /);
    expect(await linkWrites()).toMatchObject({ n: 12, chats: { [String(chat)]: MAX_LINK_WRITES_PER_CHAT_PER_DAY, [String(other)]: 1 } });

    const tomorrow = bot({ now: () => NOW + 86_400_000 });
    expect((await replyOf(await tomorrow.send(message(chat, `/start ${key(5)}`)))).text).toMatch(/^Alerts are on for /);
    expect(await linkWrites()).toMatchObject({
      day: new Date(NOW + 86_400_000).toISOString().slice(0, 10),
      n: 1,
      chats: { [String(chat)]: 1 },
    });
  });

  it('past the budget /start writes nothing and says so; /status and /stop still work; the next UTC day it links again', async () => {
    await setLinkWrites(MAX_LINK_WRITES_PER_DAY - 1);
    const chat = freshChat();
    await replyOf(await bot().send(message(chat, `/start ${WALLET}`)));
    expect(await links()).toHaveLength(1);
    expect(await linkWrites()).toMatchObject({ day: today, n: MAX_LINK_WRITES_PER_DAY });

    const full = bot();
    const reply = await replyOf(await full.send(message(chat, `/start ${key(5)}`)));
    expect(reply.text).toBe(
      'Stakeward has added as many alert links today as it allows. Try again after 00:00 UTC; the alerts you already ' +
        'have keep coming.',
    );
    expect(full.db.journal.map((e) => e.name)).toEqual(['LINK_STATE']);
    expect(await links()).toHaveLength(1);
    expect((await replyOf(await full.send(message(chat, '/status')))).text).toMatch(/^This chat gets alerts for:/);

    const tomorrow = bot({ now: () => NOW + 86_400_000 });
    expect((await replyOf(await tomorrow.send(message(chat, `/start ${key(5)}`)))).text).toMatch(/^Alerts are on for /);
    expect(await links()).toHaveLength(2);
    expect(await linkWrites()).toMatchObject({ day: new Date(NOW + 86_400_000).toISOString().slice(0, 10), n: 1 });
    await replyOf(await tomorrow.send(message(chat, '/stop')));
    expect(await links()).toEqual([]);
  });
});

describe('/status, /stop, /help and other text', () => {
  it('/status lists the wallets of the chat with their watched accounts and the last check', async () => {
    const chat = freshChat();
    await addAccount(key(10), WALLET, key(7));
    await addAccount(key(11), key(3), WALLET);
    await addAccount(key(12), key(2), key(4));
    await addLink(WALLET, chat, NOW - 2000);
    await addLink(key(2), chat, NOW - 1000);
    await addLink(key(5), chat, NOW - 500);
    await addLink(key(6), freshChat());

    const before = await replyOf(await bot().send(message(chat, '/status')));
    expect(before.text).toBe(
      [
        'This chat gets alerts for:',
        `${WALLET}: 2 stake accounts watched`,
        `${key(2)}: 1 stake account watched`,
        `${key(5)}: 0 stake accounts watched`,
        'The monitor has not run yet.',
      ].join('\n'),
    );

    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('last_pass_at', ?1)").bind(String(NOW - 185_000)).run();
    const after = await replyOf(await bot().send(message(chat, '/status')));
    expect(after.text.split('\n').at(-1)).toBe('Last check: 3 min ago.');
  });

  it('/status without links', async () => {
    const reply = await replyOf(await bot().send(message(freshChat(), '/status')));
    expect(reply.text).toBe('This chat gets no alerts. Send /start followed by a wallet address.');
  });

  it("/stop deletes this chat's links only", async () => {
    const chat = freshChat();
    const other = freshChat();
    await addLink(WALLET, chat);
    await addLink(key(2), chat);
    await addLink(WALLET, other);
    const reply = await replyOf(await bot().send(message(chat, '/stop')));
    expect(reply.text).toBe(
      'Alerts are off. This chat no longer follows any wallet, and Stakeward no longer keeps its id. Send /start ' +
        'followed by a wallet address to turn them on again.',
    );
    expect(await links()).toEqual([{ wallet: WALLET, chat_id: String(other), created_at: NOW - 1000, last_event_id: 0 }]);
    // Idempotent.
    await replyOf(await bot().send(message(chat, '/stop')));
    expect(await links()).toHaveLength(1);
  });

  it('/help, /start without an address and any other private text get the help, without D1', async () => {
    const help =
      `Send /start followed by a wallet address, or open ${ORIGIN}/app and press Get alerts in Telegram. ` +
      '/status lists the wallets of this chat, /stop turns all alerts off. Stakeward never asks for your seed phrase.';
    const b = bot();
    for (const text of ['/help', '/start', '/start   ', 'hi', `/start ${WALLET} extra`, '/startnow', undefined]) {
      const reply = await replyOf(await b.send(message(freshChat(), text)));
      expect(reply.text, String(text)).toBe(help);
    }
    expect(b.db.stats.statements).toBe(0);
  });

  it('names the site without a link while SITE_ORIGIN is not configured', async () => {
    const b = bot({ env: { SITE_ORIGIN: '' } });
    const help = await replyOf(await b.send(message(freshChat(), '/help')));
    expect(help.text).toContain('or open the Stakeward site and press Get alerts in Telegram.');
    const start = await replyOf(await b.send(message(freshChat(), `/start ${WALLET}`)));
    expect(start.text).toContain('Alerts only link to the Stakeward site.');
    expect(start.text).toContain('Protect one at the Stakeward site and it is watched from then on.');
  });
});

describe('my_chat_member', () => {
  it.each(['kicked', 'left'])('%s forgets the chat at once, with no reply', async (status) => {
    const chat = freshChat();
    const other = freshChat();
    await addLink(WALLET, chat);
    await addLink(key(2), chat);
    await addLink(WALLET, other);
    await expectNoReply(await bot().send(memberUpdate(chat, status)));
    expect((await links()).map((l) => l.chat_id)).toEqual([String(other)]);
  });

  it('any other status changes nothing', async () => {
    const chat = freshChat();
    await addLink(WALLET, chat);
    const b = bot();
    for (const status of ['member', 'administrator', 'restricted']) await expectNoReply(await b.send(memberUpdate(chat, status)));
    expect(await links()).toHaveLength(1);
    expect(b.db.stats.statements).toBe(0);
  });
});

describe('garbage, size and rate limits', () => {
  it.each([
    ['not JSON', 'not json'],
    ['an array', '[]'],
    ['no update_id', JSON.stringify({ message: message(1, '/stop').message })],
    ['a chat id that is not an integer', JSON.stringify({ update_id: 1, message: { chat: { id: '42', type: 'private' }, text: '/stop' } })],
    ['a chat id over 2^53', '{"update_id":1,"message":{"chat":{"id":9007199254740993,"type":"private"},"text":"/stop"}}'],
    ['text over 4096 characters', JSON.stringify(message(1, `/stop ${'x'.repeat(4096)}`))],
    ['an update without a chat', JSON.stringify({ update_id: 1, edited_message: { chat: { id: 1, type: 'private' } } })],
    ['an empty body', ''],
  ])('%s: 200 {} without D1', async (_name, body) => {
    const b = bot();
    await expectNoReply(await b.send(body));
    expect(b.db.stats.statements).toBe(0);
  });

  it(`a body over ${String(MAX_TELEGRAM_UPDATE_BYTES)} bytes: 200 {} so Telegram does not resend it, nothing written`, async () => {
    const chat = freshChat();
    await addLink(WALLET, chat);
    const b = bot();
    const update = JSON.stringify(message(chat, '/stop'));
    const atLimit = update.padEnd(MAX_TELEGRAM_UPDATE_BYTES, ' ');
    await expectNoReply(await b.send(`${atLimit} `));
    expect(b.db.stats.statements).toBe(0);
    expect(await links()).toHaveLength(1);
    // Exactly at the limit the update is handled.
    await replyOf(await b.send(atLimit));
    expect(await links()).toEqual([]);
  });

  it('20 updates per chat in 60 s; then silence without D1, other chats unaffected', async () => {
    const chat = freshChat();
    await addLink(WALLET, chat);
    const b = bot();
    for (let i = 0; i < 20; i++) await replyOf(await b.send(message(chat, '/status')));
    const statements = b.db.stats.statements;
    await expectNoReply(await b.send(message(chat, '/status')));
    await expectNoReply(await b.send(memberUpdate(chat, 'kicked')));
    expect(b.db.stats.statements).toBe(statements);
    expect(await links()).toHaveLength(1);
    await replyOf(await b.send(message(freshChat(), '/status')));
  });

  it('a D1 failure is 500, so Telegram retries the update', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await env.DB.exec('DROP TABLE alert_links');
    const chat = freshChat();
    for (const update of [message(chat, `/start ${WALLET}`), message(chat, '/status'), message(chat, '/stop'), memberUpdate(chat, 'kicked')]) {
      const res = await bot().send(update);
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Internal error' });
      expect(securityHeadersOf(res)).toEqual(SECURITY_HEADERS);
    }
    expect(error).toHaveBeenCalledTimes(4);
  });
});

describe('logs', () => {
  it('only the kind of each update: never the chat id, the wallet, the secret or the text', async () => {
    const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const spies = methods.map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    const chat = freshChat();
    const b = bot();
    await b.send(message(chat, `/start ${WALLET}`));
    await b.send(message(chat, '/status'));
    await b.send(message(chat, 'my seed phrase is'));
    await b.send(message(chat, '/stop'));
    await b.send(memberUpdate(chat, 'kicked'));
    await b.send('garbage');
    await b.send(message(chat, '/status'), { secret: 'wrong' });
    await env.DB.exec('DROP TABLE alert_links');
    await b.send(message(chat, `/start ${WALLET}`));

    const lines = spies.flatMap((spy) => spy.mock.calls.map((args) => args.map(String).join(' ')));
    const kinds = lines.filter((line) => line.includes('telegram update')).map((line) => (JSON.parse(line) as { kind: string }).kind);
    expect(kinds).toEqual(['start', 'status', 'help', 'stop', 'member', 'ignored', 'start']);
    const logged = lines.join('\n');
    for (const secret of [String(chat), WALLET, SECRET, 'seed phrase', 'Ann']) expect(logged).not.toContain(secret);
  });
});

describe('parseCommand', () => {
  it.each([
    ['/start', { command: 'start', arg: null }],
    [`/start ${WALLET}`, { command: 'start', arg: WALLET }],
    [`  /start   ${WALLET}  `, { command: 'start', arg: WALLET }],
    [`/start@${BOT} ${WALLET}`, { command: 'start', arg: WALLET }],
    [`/start@STAKEWARD_TEST_BOT`, { command: 'start', arg: null }],
    ['/status', { command: 'status', arg: null }],
    ['/stop', { command: 'stop', arg: null }],
    ['/help', { command: 'help', arg: null }],
    ['/status anything', { command: 'status', arg: 'anything' }],
  ])('%s', (text, expected) => {
    expect(parseCommand(text, BOT)).toEqual(expected);
  });

  it.each([
    'start',
    '/Start',
    '/startx',
    '/start a b',
    '/start@OtherBot',
    '/start@OtherBot x',
    '/start@sh x',
    '/settings',
    'hello /stop',
    '',
  ])('%s is not a command for us', (text) => {
    expect(parseCommand(text, BOT)).toBeNull();
  });

  it('an @suffix is never ours while our username is not configured', () => {
    expect(parseCommand(`/stop@${BOT}`, null)).toBeNull();
    expect(parseCommand('/stop', null)).toEqual({ command: 'stop', arg: null });
  });
});
