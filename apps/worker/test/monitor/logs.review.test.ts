// Review: the monitor never writes a chat id, the bot token, RPC_URL or a Telegram API URL to the console (step 5 spec
// section 12.3; CLAUDE.md section 8: chat ids are never logged). Passes with sends, a 403, a fetch error that quotes
// the URL and the chat, a refused token, an RPC retry and an exception whose message quotes all of them, through
// the production logger.
import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { monitorDepsFromEnv } from '../../src/monitor/pass.ts';
import { PRIMARY_URL } from '../fakes.ts';
import type { StakeAccountSpec } from '../transactions.ts';
import { key, LOCK_UNTIL } from '../transactions.ts';
import { ADMIN_CHAT, createHarness, testEnv } from './harness.ts';

const MAIN = key(1);
const SECOND = key(2);
const STAKE = key(10);
const SPEC: StakeAccountSpec = { state: 'delegated', staker: MAIN, withdrawer: MAIN, custodian: SECOND, unixTimestamp: LOCK_UNTIL };
const CHAT_SENT = '-1001234567890';
const CHAT_BLOCKED = '424242424';
const CHAT_FETCH_ERROR = '313131313';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('monitor logs', () => {
  it('no chat id, token, RPC_URL or api.telegram.org/bot in any console output', async () => {
    const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const spies = methods.map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    const output = () => spies.flatMap((spy) => spy.mock.calls.map((args) => args.map(String).join(' '))).join('\n');

    const h = createHarness();
    h.deps.log = monitorDepsFromEnv(testEnv()).log;
    const routed = h.deps.fetch;
    // A fetch failure whose message quotes the URL (with the token) and the chat id.
    h.deps.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const body = typeof init?.body === 'string' ? init.body : '';
      if (body.includes(CHAT_FETCH_ERROR)) throw new TypeError(`fetch ${url} failed for chat ${CHAT_FETCH_ERROR}`);
      return routed(input, init);
    };

    h.at('2026-10-05T01:00:00Z');
    h.chain.putStake(STAKE, SPEC);
    await h.seedWatched([STAKE]);
    await h.linkChat(MAIN, CHAT_SENT);
    await h.linkChat(MAIN, CHAT_BLOCKED);
    await h.linkChat(SECOND, CHAT_FETCH_ERROR);
    h.telegram.replyTo(CHAT_BLOCKED, 403);

    // Sends, a 403, a fetch error, and an RPC attempt that fails first.
    h.chain.putStake(STAKE, { ...SPEC, deactivationEpoch: 951n });
    h.chain.failNext('getMultipleAccounts', [503]);
    h.at('2026-10-05T01:02:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'ok', messages: 1, blockedChats: 1, retrySends: 1 });

    // An exception in the delivery commit whose message quotes the secrets: the pass fails, the admin is alerted.
    h.chain.putStake(STAKE, { ...SPEC, deactivationEpoch: 951n, staker: key(3) });
    h.db.failWhen = (entry) => {
      if (entry.name !== 'LINK_PROGRESS') return false;
      throw new Error(`D1_ERROR: chat ${CHAT_SENT} token ${env.TELEGRAM_BOT_TOKEN} rpc ${PRIMARY_URL}`);
    };
    h.at('2026-10-05T01:04:00Z');
    await expect(h.pass()).rejects.toThrow(/D1_ERROR/);
    expect(h.adminMessages()).toHaveLength(1);
    h.db.failWhen = null;

    // Telegram refuses the token.
    h.chain.putStake(STAKE, { ...SPEC, deactivationEpoch: 951n, staker: key(4) });
    h.telegram.replyAlways('*', 401);
    h.at('2026-10-05T01:06:00Z');
    expect(await h.pass()).toMatchObject({ outcome: 'telegram-config' });

    const logged = output();
    expect(logged).toContain('monitor pass');
    expect(logged).toContain('monitor pass failed');
    expect(logged).toContain('upstream rpc attempt failed');
    expect(logged).toContain('telegram rejected the bot token or the site origin is invalid');
    const token = env.TELEGRAM_BOT_TOKEN;
    expect(token).not.toBe('');
    for (const secret of [
      CHAT_SENT,
      CHAT_BLOCKED,
      CHAT_FETCH_ERROR,
      ADMIN_CHAT,
      token,
      token.split(':')[1] ?? token,
      PRIMARY_URL,
      new URL(PRIMARY_URL).host,
      'api-key',
      'api.telegram.org/bot',
    ]) {
      expect(logged).not.toContain(secret);
    }
  });
});
