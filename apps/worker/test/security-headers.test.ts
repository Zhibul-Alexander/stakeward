import { STAKE_PROGRAM_ADDRESS, SYSVAR_CLOCK_ADDRESS, SYSVAR_PROGRAM_ADDRESS } from '@stakeward/core';
import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { MAX_WATCH_BODY_BYTES } from '../src/watch.ts';
import { fakeUpstream, freshIp, multipleAccountsAnswer, SECURITY_HEADERS, securityHeadersOf, testApp } from './fakes.ts';
import { clockData, key, stakeAccountData } from './transactions.ts';

/** Parses the `/*` block of a Workers Static Assets `_headers` file into name -> value. */
function parseHeadersFile(text: string): Map<string, string> {
  const headers = new Map<string, string>();
  let inAllPaths = false;
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      inAllPaths = line.trim() === '/*';
      continue;
    }
    if (!inAllPaths) continue;
    const colon = line.indexOf(':');
    headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return headers;
}

describe('static _headers and API headers', () => {
  it('apps/web/public/_headers sets the same values that /api responses get', async () => {
    const fileHeaders = parseHeadersFile(env.TEST_STATIC_HEADERS_FILE);
    expect([...fileHeaders.keys()].sort()).toEqual([
      'content-security-policy',
      'cross-origin-opener-policy',
      'referrer-policy',
      'strict-transport-security',
      'x-content-type-options',
    ]);
    // The pages need it, not the JSON: a page that opened Stakeward with window.open must not be able to swap the
    // tab for a copy after the user checked the address bar (reverse tabnabbing). Opener-free links and the wallet
    // extensions (Wallet Standard) do not depend on it.
    expect(fileHeaders.get('cross-origin-opener-policy')).toBe('same-origin');

    const res = await exports.default.fetch('https://stakeward.test/api/health');
    for (const [name, value] of fileHeaders) {
      expect(res.headers.get(name), name).toBe(value);
    }
  });
});

describe('the step 5 routes through the deployed entry point carry the section 11 headers', () => {
  it('health (503 and 200), accounts, stats, the Telegram link and the webhook', async () => {
    // `manual`: a Fetcher follows redirects by default, and the link answers 302 to t.me.
    const get = (path: string) =>
      exports.default.fetch(`https://stakeward.test${path}`, {
        headers: { 'CF-Connecting-IP': freshIp() },
        redirect: 'manual',
      });
    const unhealthy = await get('/api/health');
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('last_pass_at', ?1)").bind(String(Date.now())).run();
    const responses = [
      unhealthy,
      await get('/api/health'),
      await get(`/api/accounts?wallet=${key(1)}`),
      await get('/api/stats'),
      await get(`/api/telegram/link?wallet=${key(1)}`),
      await exports.default.fetch('https://stakeward.test/api/telegram/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': env.TELEGRAM_WEBHOOK_SECRET },
        body: JSON.stringify({ update_id: 1, message: { chat: { id: 4343, type: 'private' }, text: '/help' } }),
      }),
      await exports.default.fetch('https://stakeward.test/api/telegram/webhook', { method: 'POST', body: '{}' }),
    ];
    expect(responses.map((r) => r.status)).toEqual([503, 200, 200, 200, 302, 200, 401]);
    for (const res of responses) expect(securityHeadersOf(res)).toEqual(SECURITY_HEADERS);
  });
});

describe('POST /api/watch responses carry the section 11 headers', () => {
  it('watched, rejected, bad requests, upstream failures and the deployed entry point', async () => {
    const stake = key(10);
    const clockUnix = BigInt(Math.floor(Date.now() / 1000));
    const clock = { data: clockData(5000n, 950n, clockUnix), lamports: 1n, owner: SYSVAR_PROGRAM_ADDRESS };
    const locked = {
      data: stakeAccountData({ staker: key(1), withdrawer: key(1), custodian: key(2), unixTimestamp: clockUnix + 86_400n }),
      lamports: 10_000_000_000n,
      owner: STAKE_PROGRAM_ADDRESS,
    };
    const answer = (account: typeof locked | null) =>
      fakeUpstream((call) => {
        expect(call.json.params[0]).toEqual([SYSVAR_CLOCK_ADDRESS, stake]);
        return multipleAccountsAnswer(call.json.id, 5000, [clock, account]);
      });
    const body = { accounts: [stake] };
    const responses = [
      await testApp(answer(locked)).watch(body),
      await testApp(answer(null)).watch(body),
      await testApp(answer(null)).watch({ accounts: [] }),
      await testApp(answer(null)).watch(body, { headers: { 'Content-Type': 'text/plain' } }),
      await testApp(answer(null)).watch(' '.repeat(MAX_WATCH_BODY_BYTES + 1)),
      await testApp(fakeUpstream(() => new Response('', { status: 503 }))).watch(body),
      await testApp(fakeUpstream(() => 'hang'), { timeoutMs: 20 }).watch(body),
      await testApp(answer(null), { rpcUrl: '' }).watch(body),
      await exports.default.fetch('https://stakeward.test/api/watch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': freshIp() },
        body: '{}',
      }),
    ];
    expect(responses.map((r) => r.status)).toEqual([200, 200, 400, 415, 413, 502, 504, 503, 400]);
    for (const res of responses) expect(securityHeadersOf(res)).toEqual(SECURITY_HEADERS);
  });
});
