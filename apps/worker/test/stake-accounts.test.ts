import { stakeAccountsFromJson, STAKE_PROGRAM_ADDRESS, U64_MAX, type StakeAccountsJson } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import {
  pairAccountsRequest,
  parseJsonExactLamports,
  parseProgramAccountItems,
  programAccountsRequest,
} from '../src/stake-accounts.ts';
import { fakeUpstream, freshIp, testApp, type UpstreamCall } from './fakes.ts';
import { b64, key, stakeAccountData, type StakeAccountSpec } from './transactions.ts';

type Item = { pubkey: string; account: Record<string, unknown> };

function item(pubkey: string, spec: StakeAccountSpec, extra: { lamports?: string; owner?: string; data?: Uint8Array } = {}): Item {
  return {
    pubkey,
    account: {
      data: [b64(extra.data ?? stakeAccountData(spec)), 'base64'],
      executable: false,
      lamports: extra.lamports ?? '10000000000',
      owner: extra.owner ?? STAKE_PROGRAM_ADDRESS,
      rentEpoch: '18446744073709551615',
      space: 200,
    },
  };
}

/**
 * A getProgramAccounts answer as raw JSON text. Lamports and rentEpoch are written as bare JSON numbers from strings,
 * so values above 2^53 reach the worker exactly as an RPC node sends them.
 */
function gpaAnswer(id: unknown, slot: number, items: readonly Item[]): Response {
  const text = JSON.stringify({ jsonrpc: '2.0', id, result: { context: { slot }, value: items } }).replace(
    /"(lamports|rentEpoch)":"([0-9]+)"/g,
    '"$1":$2',
  );
  return new Response(text, { headers: { 'Content-Type': 'application/json' } });
}

/** Unique per test: the edge cache is shared by every test in the run. */
let next = 100;
function freshAddress() {
  next += 1;
  return key(next);
}

describe('GET /api/stake-accounts: query validation', () => {
  const valid = key(77);
  it.each([
    ['no parameter', ''],
    ['both parameters', `?withdrawer=${valid}&custodian=${valid}`],
    ['the same parameter twice', `?withdrawer=${valid}&withdrawer=${valid}`],
    ['an unknown parameter', `?staker=${valid}`],
    ['an extra parameter (cache buster)', `?withdrawer=${valid}&t=1`],
    ['an empty address', '?withdrawer='],
    ['an invalid address', '?withdrawer=not-an-address'],
    ['a 31-byte address', `?custodian=${'1'.repeat(31)}`],
  ])('rejects %s with 400 and never calls upstream', async (_case, search) => {
    const upstream = fakeUpstream(() => {
      throw new Error('unexpected upstream call');
    });
    const res = await testApp(upstream).request(`/api/stake-accounts${search}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid-query' });
    expect(upstream.calls).toHaveLength(0);
  });
});

describe('GET /api/stake-accounts: lookup and decoding', () => {
  it('asks getProgramAccounts with dataSize 200 and memcmp at 44 for a withdrawer, 92 for a custodian', async () => {
    const target = freshAddress();
    for (const [role, offset] of [
      ['withdrawer', 44],
      ['custodian', 92],
    ] as const) {
      const upstream = fakeUpstream((c) => gpaAnswer(c.json.id, 5, []));
      const res = await testApp(upstream).request(`/api/stake-accounts?${role}=${target}`);
      expect(res.status).toBe(200);
      expect(upstream.calls).toHaveLength(1);
      expect(upstream.calls[0]?.json).toEqual(programAccountsRequest(role, target));
      expect(upstream.calls[0]?.json.params).toEqual([
        'Stake11111111111111111111111111111111111111',
        {
          encoding: 'base64',
          commitment: 'confirmed',
          withContext: true,
          filters: [{ dataSize: 200 }, { memcmp: { offset, bytes: target, encoding: 'base58' } }],
        },
      ]);
    }
  });

  it('decodes stake accounts into the shared JSON shape, skipping garbage and non-matching items', async () => {
    const withdrawer = freshAddress();
    const custodian = key(60);
    const delegated = key(61);
    const initialized = key(62);
    const upstream = fakeUpstream((c) =>
      gpaAnswer(c.json.id, 452_560_000, [
        // Above 2^53 lamports: must arrive exactly.
        item(delegated, { state: 'delegated', staker: withdrawer, withdrawer, unixTimestamp: 1_807_574_400n, custodian, voter: key(63) }, { lamports: '9007199254740993' }),
        item(initialized, { staker: key(64), withdrawer }),
        // Not a stake account owner.
        item(key(65), { staker: withdrawer, withdrawer }, { owner: key(1) }),
        // Wrong size.
        item(key(66), { staker: withdrawer, withdrawer }, { data: new Uint8Array(199) }),
        // Uninitialized state.
        item(key(67), { staker: withdrawer, withdrawer }, { data: new Uint8Array(200) }),
        // Does not match the filter (a lying or buggy upstream).
        item(key(68), { staker: key(2), withdrawer: key(2) }),
        // Malformed items.
        { pubkey: 'nope', account: {} },
        { pubkey: key(69), account: { data: ['%%%%', 'base64'], lamports: '1', owner: STAKE_PROGRAM_ADDRESS } },
        { pubkey: key(70), account: { data: [b64(stakeAccountData({ staker: withdrawer, withdrawer })), 'base58'], lamports: '1', owner: STAKE_PROGRAM_ADDRESS } },
        // A duplicate of an accepted item.
        item(initialized, { staker: key(64), withdrawer }),
      ] as Item[]),
    );
    const res = await testApp(upstream).request(`/api/stake-accounts?withdrawer=${withdrawer}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/^application\/json/);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json<StakeAccountsJson>();
    const expected: StakeAccountsJson = {
      slot: '452560000',
      accounts: [
        {
          address: delegated,
          lamports: '9007199254740993',
          kind: 'delegated',
          rentExemptReserve: '2282880',
          staker: withdrawer,
          withdrawer,
          lockup: { unixTimestamp: '1807574400', epoch: '0', custodian },
          delegation: { voter: key(63), stake: '5000000000', activationEpoch: '800', deactivationEpoch: U64_MAX.toString() },
        },
        {
          address: initialized,
          lamports: '10000000000',
          kind: 'initialized',
          rentExemptReserve: '2282880',
          staker: key(64),
          withdrawer,
          lockup: { unixTimestamp: '0', epoch: '0', custodian: key(0) },
          delegation: null,
        },
      ].sort((a, b) => (a.address < b.address ? -1 : 1)) as StakeAccountsJson['accounts'],
    };
    expect(body).toEqual(expected);

    // The site parses it back with core.
    const parsed = stakeAccountsFromJson(body);
    expect(parsed.slot).toBe(452_560_000n);
    expect(parsed.accounts.find((a) => a.address === delegated)?.lamports).toBe(9_007_199_254_740_993n);
    expect(parsed.accounts.find((a) => a.address === delegated)?.delegation?.deactivationEpoch).toBe(U64_MAX);
  });

  it('lists the accounts a custodian holds the lock for', async () => {
    const custodian = freshAddress();
    const withdrawer = key(80);
    const upstream = fakeUpstream((c) =>
      gpaAnswer(c.json.id, 9, [
        item(key(81), { staker: withdrawer, withdrawer, unixTimestamp: 1_807_574_400n, custodian }),
        item(key(82), { staker: withdrawer, withdrawer, unixTimestamp: 1_807_574_400n, custodian: key(83) }),
      ]),
    );
    const res = await testApp(upstream).request(`/api/stake-accounts?custodian=${custodian}`);
    const body = await res.json<StakeAccountsJson>();
    expect(body.accounts.map((a) => a.address)).toEqual([key(81)]);
  });

  it('answers 502 when the upstream returns a JSON-RPC error or an unexpected shape', async () => {
    for (const answer of [
      { jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'invalid params' } },
      { jsonrpc: '2.0', id: 1, result: [] },
      'not json',
    ]) {
      const upstream = fakeUpstream(() => new Response(typeof answer === 'string' ? answer : JSON.stringify(answer)));
      const res = await testApp(upstream).request(`/api/stake-accounts?withdrawer=${freshAddress()}`);
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ error: 'upstream-error' });
    }
  });

  it('answers 502 when the upstream is down and 504 when it times out (reads are retried)', async () => {
    const down = fakeUpstream(() => new Response('', { status: 503 }));
    const res = await testApp(down).request(`/api/stake-accounts?withdrawer=${freshAddress()}`);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'upstream-unavailable' });
    expect(down.calls).toHaveLength(3);

    const hanging = fakeUpstream(() => 'hang');
    const slow = await testApp(hanging, { timeoutMs: 30 }).request(`/api/stake-accounts?withdrawer=${freshAddress()}`);
    expect(slow.status).toBe(504);
    expect(await slow.json()).toMatchObject({ error: 'upstream-timeout' });
  });
});

describe('GET /api/stake-accounts: 30 s edge cache', () => {
  it('serves the same query from the cache without asking upstream again, for any client', async () => {
    const withdrawer = freshAddress();
    const upstream = fakeUpstream((c: UpstreamCall) =>
      gpaAnswer(c.json.id, 10, [item(key(90), { staker: withdrawer, withdrawer })]),
    );
    const first = await testApp(upstream).request(`/api/stake-accounts?withdrawer=${withdrawer}`);
    const second = await testApp(upstream, { ip: freshIp() }).request(`/api/stake-accounts?withdrawer=${withdrawer}`);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.text()).toBe(await first.text());
    expect(second.headers.get('Cache-Control')).toBe('no-store');
    expect(upstream.calls).toHaveLength(1);

    // Another role for the same address is another query.
    await testApp(upstream).request(`/api/stake-accounts?custodian=${withdrawer}`);
    expect(upstream.calls).toHaveLength(2);
  });

  it('stores entries for 30 seconds under the normalised query', async () => {
    const withdrawer = freshAddress();
    const upstream = fakeUpstream((c) => gpaAnswer(c.json.id, 11, []));
    await testApp(upstream).request(`/api/stake-accounts?withdrawer=${withdrawer}`);
    const entry = await caches.default.match(`https://stakeward.test/api/stake-accounts?withdrawer=${withdrawer}`);
    expect(entry?.headers.get('Cache-Control')).toBe('public, max-age=30');
    expect(await entry?.json()).toEqual({ slot: '11', accounts: [] });
  });

  it('does not cache failures', async () => {
    const withdrawer = freshAddress();
    let fail = true;
    const upstream = fakeUpstream((c) => (fail ? new Response('', { status: 500 }) : gpaAnswer(c.json.id, 12, [])));
    expect((await testApp(upstream).request(`/api/stake-accounts?withdrawer=${withdrawer}`)).status).toBe(502);
    fail = false;
    expect((await testApp(upstream).request(`/api/stake-accounts?withdrawer=${withdrawer}`)).status).toBe(200);
  });
});

describe('core stakeAccountsFromJson (shared JSON shape)', () => {
  const good: StakeAccountsJson = {
    slot: '1',
    accounts: [
      {
        address: key(1),
        lamports: '18446744073709551615',
        kind: 'initialized',
        rentExemptReserve: '0',
        staker: key(2),
        withdrawer: key(3),
        lockup: { unixTimestamp: '-9223372036854775808', epoch: '0', custodian: key(4) },
        delegation: null,
      },
    ],
  };

  it('round-trips the extremes of u64 and i64', () => {
    const parsed = stakeAccountsFromJson(good);
    expect(parsed.accounts[0]?.lamports).toBe(U64_MAX);
    expect(parsed.accounts[0]?.lockup.unixTimestamp).toBe(-(2n ** 63n));
  });

  it.each([
    ['slot as a number', { ...good, slot: 1 }],
    ['an extra top-level field', { ...good, extra: 1 }],
    ['lamports above u64', { ...good, accounts: [{ ...good.accounts[0], lamports: '18446744073709551616' }] }],
    ['a leading zero', { ...good, accounts: [{ ...good.accounts[0], lamports: '01' }] }],
    ['a negative u64', { ...good, accounts: [{ ...good.accounts[0], rentExemptReserve: '-1' }] }],
    ['a bad address', { ...good, accounts: [{ ...good.accounts[0], staker: 'x' }] }],
    ['delegation on an initialized account', { ...good, accounts: [{ ...good.accounts[0], delegation: { voter: key(5), stake: '1', activationEpoch: '1', deactivationEpoch: '1' } }] }],
    ['a delegated account without delegation', { ...good, accounts: [{ ...good.accounts[0], kind: 'delegated' }] }],
    ['an unknown kind', { ...good, accounts: [{ ...good.accounts[0], kind: 'rewards-pool' }] }],
  ])('rejects %s', (_case, json) => {
    expect(() => stakeAccountsFromJson(json)).toThrow(expect.objectContaining({ name: 'InvalidStakeAccountsJsonError' }));
  });
});

describe('getProgramAccounts helpers for the monitor', () => {
  it('pairAccountsRequest: dataSize 200, withdrawer at 44 and custodian at 92', () => {
    expect(pairAccountsRequest(key(1), key(2))).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'getProgramAccounts',
      params: [
        'Stake11111111111111111111111111111111111111',
        {
          encoding: 'base64',
          commitment: 'confirmed',
          withContext: true,
          filters: [
            { dataSize: 200 },
            { memcmp: { offset: 44, bytes: key(1), encoding: 'base58' } },
            { memcmp: { offset: 92, bytes: key(2), encoding: 'base58' } },
          ],
        },
      ],
    });
  });

  it('parseJsonExactLamports: lamports as exact bigints, everything else as JSON.parse; throws on non-JSON', () => {
    expect(parseJsonExactLamports('{"lamports":9007199254740993,"slot":5,"a":{"lamports":1}}')).toEqual({
      lamports: 9_007_199_254_740_993n,
      slot: 5,
      a: { lamports: 1n },
    });
    expect(parseJsonExactLamports('{"lamports":1.5}')).toEqual({ lamports: 1.5 });
    expect(() => parseJsonExactLamports('{')).toThrow(SyntaxError);
  });

  it('parseProgramAccountItems: the slot and the well-formed stake items in answer order, undecoded', async () => {
    const spec = { staker: key(1), withdrawer: key(1) };
    const answer = gpaAnswer(1, 77, [
      item(key(72), spec, { lamports: '9007199254740993' }),
      item(key(71), spec, { owner: key(1) }),
      { pubkey: 'nope', account: {} },
      item(key(71), spec, { data: new Uint8Array(199) }),
    ] as Item[]);
    expect(parseProgramAccountItems(await answer.text())).toEqual({
      slot: 77,
      items: [
        { pubkey: key(72), dataBase64: b64(stakeAccountData(spec)), lamports: 9_007_199_254_740_993n },
        // Size and contents are the decoder's business.
        { pubkey: key(71), dataBase64: b64(new Uint8Array(199)), lamports: 10_000_000_000n },
      ],
    });
  });

  it('parseProgramAccountItems: null for a JSON-RPC error or another shape', () => {
    expect(parseProgramAccountItems('not json')).toBeNull();
    expect(parseProgramAccountItems(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32010, message: 'x' } }))).toBeNull();
    expect(parseProgramAccountItems(JSON.stringify({ jsonrpc: '2.0', id: 1, result: [] }))).toBeNull();
  });
});
