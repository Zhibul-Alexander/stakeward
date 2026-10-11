import { address } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { fetchWatchedAccounts, parseWatchedAccounts } from './accounts.ts';

const WALLET = address('B1agBSrGRgub2jXMJEozYkRLRzFc9HLd5hHjSrCtuXu8');
const STAKE = address('AYA9kYsn7XVDTPARBfAuASypyyDGFJw1Xds2vHgW9DfW');

const BODY = {
  wallet: WALLET,
  now: '2026-10-10T12:00:00.000Z',
  lastMonitorRunAt: '2026-10-10T11:58:00.000Z',
  accounts: [
    {
      address: STAKE,
      roles: ['main'],
      lockUntil: '1807488000',
      lock: 'in-force',
      daysLeft: 183,
      lamports: '1250500000000',
      state: 'delegated',
      lastChangeAt: '2026-10-10T11:00:00.000Z',
    },
  ],
  events: [{ stakeAccount: STAKE, type: 'DEACTIVATED', details: { deactivationEpoch: '951' }, slot: '1', detectedAt: '2026-10-10T11:00:00.000Z' }],
};

const answer = (status: number, body: unknown) => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('fetchWatchedAccounts', () => {
  it('reads accounts and events, amounts and times as values', async () => {
    expect(await fetchWatchedAccounts(WALLET, { fetch: answer(200, BODY) })).toEqual({
      accounts: [
        { address: STAKE, roles: ['main'], lockUntil: 1_807_488_000n, lock: 'in-force', daysLeft: 183, lamports: 1_250_500_000_000n, state: 'delegated' },
      ],
      events: [{ stakeAccount: STAKE, type: 'DEACTIVATED', detectedAt: new Date('2026-10-10T11:00:00.000Z') }],
    });
  });

  it('asks the worker on its own origin for exactly this wallet', async () => {
    const urls: string[] = [];
    await fetchWatchedAccounts(WALLET, {
      fetch: (input) => {
        urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
        return answer(200, BODY)();
      },
    });
    expect(urls).toEqual([`/api/accounts?wallet=${WALLET}`]);
  });

  it('rejects another status', async () => {
    await expect(fetchWatchedAccounts(WALLET, { fetch: answer(429, { error: 'rate-limited' }) })).rejects.toThrow(/HTTP 429/);
  });
});

describe('parseWatchedAccounts', () => {
  it.each([
    ['no accounts list', { events: [] }],
    ['an account that is not an address', { ...BODY, accounts: [{ ...BODY.accounts[0], address: 'x' }] }],
    ['an unknown lock word', { ...BODY, accounts: [{ ...BODY.accounts[0], lock: 'maybe' }] }],
    ['lamports as a number', { ...BODY, accounts: [{ ...BODY.accounts[0], lamports: 5 }] }],
    ['an event type with markup', { ...BODY, events: [{ ...BODY.events[0], type: '<b>' }] }],
    ['an event without a time', { ...BODY, events: [{ ...BODY.events[0], detectedAt: 'soon' }] }],
  ])('refuses %s', (_name, body) => {
    expect(() => parseWatchedAccounts(body)).toThrow(/Malformed/);
  });
});
