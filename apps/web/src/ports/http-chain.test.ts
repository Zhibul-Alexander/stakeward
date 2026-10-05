import {
  blockhash,
  generateKeyPairSigner,
  getAddressDecoder,
  getBase64Decoder,
  getBase64Encoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  type Address,
  type KeyPairSigner,
  type Signature,
} from '@solana/kit';
import { buildTransaction, STAKE_PROGRAM_ADDRESS, SYSVAR_CLOCK_ADDRESS, translateError } from '@stakeward/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { HttpChain } from './http-chain.ts';

/** A JSON-RPC body, an HTTP response, or an Error that fetch throws (no answer from the worker). */
type RpcAnswer = { result: unknown } | { error: unknown } | Response | Error;
type Call = { url: string; method: string; params: unknown[] };

/** JSON with bigints written as plain integers, like an RPC node. */
function stringify(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => (typeof item === 'bigint' ? `__big__${item.toString()}` : item)).replace(
    /"__big__(-?\d+)"/g,
    '$1',
  );
}

function fakeServer(answer: (call: Call) => RpcAnswer) {
  const calls: Call[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const request = init?.method === 'GET' ? { method: 'GET', params: [] } : (JSON.parse(init?.body as string) as Call);
    const call = { url, method: request.method, params: request.params };
    calls.push(call);
    const out = answer(call);
    if (out instanceof Error) return Promise.reject(out);
    if (out instanceof Response) return Promise.resolve(out);
    return Promise.resolve(new Response(stringify({ jsonrpc: '2.0', id: 1, ...out })));
  };
  return { calls, chain: new HttpChain({ fetch, sleep: () => Promise.resolve() }) };
}

const key = (n: number): Address => getAddressDecoder().decode(new Uint8Array(32).fill(n));
const LIFETIME = {
  kind: 'blockhash',
  blockhash: blockhash('EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N'),
  lastValidBlockHeight: 150n,
} as const;
const CONTEXT = { apiVersion: '4.3.0', slot: 452_000_000n };

describe('HttpChain', () => {
  let A: KeyPairSigner;
  let K: KeyPairSigner;
  let signed: Uint8Array;
  let signature: Signature;

  beforeAll(async () => {
    [A, K] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    const built = buildTransaction(
      { kind: 'withdraw', stakeAccount: key(9), mainKey: A.address, secondKey: K.address, recipient: A.address, lamports: 5n },
      { feePayer: A.address, lifetime: LIFETIME },
    );
    const transaction = await partiallySignTransaction([A.keyPair, K.keyPair], getTransactionDecoder().decode(built.bytes));
    signed = new Uint8Array(getTransactionEncoder().encode(transaction));
    signature = getSignatureFromTransaction(transaction);
  });

  it('getAccounts: getMultipleAccounts in base64, exact lamports above 2^53, null for a missing account', async () => {
    const data = Uint8Array.from({ length: 200 }, (_, i) => i % 256);
    const { calls, chain } = fakeServer(() => ({
      result: {
        context: CONTEXT,
        value: [
          {
            data: [getBase64Decoder().decode(data), 'base64'],
            executable: false,
            lamports: 9_007_199_254_740_993n,
            owner: STAKE_PROGRAM_ADDRESS,
            rentEpoch: 18_446_744_073_709_551_615n,
            space: 200n,
          },
          null,
        ],
      },
    }));
    const result = await chain.getAccounts([key(1), key(2)]);
    expect(calls).toEqual([
      {
        url: '/api/rpc',
        method: 'getMultipleAccounts',
        params: [[key(1), key(2)], { encoding: 'base64', commitment: 'confirmed' }],
      },
    ]);
    expect(result.slot).toBe(CONTEXT.slot);
    expect(result.accounts[0]).toEqual({ address: key(1), data, lamports: 9_007_199_254_740_993n, owner: STAKE_PROGRAM_ADDRESS });
    expect(result.accounts[1]).toBeNull();
  });

  it('getAccounts: more than 100 addresses take several calls; the lowest slot is reported', async () => {
    const addresses = Array.from({ length: 150 }, (_, i) => key(i + 1));
    let slot = 10n;
    const { calls, chain } = fakeServer(({ params }) => {
      const asked = params[0] as unknown[];
      slot -= 1n;
      return { result: { context: { slot }, value: asked.map(() => null) } };
    });
    const result = await chain.getAccounts(addresses);
    expect(calls.map(({ params }) => (params[0] as unknown[]).length)).toEqual([100, 50]);
    expect(result.accounts).toHaveLength(150);
    expect(result.slot).toBe(8n);
  });

  it('getClock: reads and decodes the Clock sysvar', async () => {
    const bytes = new Uint8Array(40);
    const view = new DataView(bytes.buffer);
    view.setBigUint64(0, 452_000_123n, true);
    view.setBigInt64(8, 1_790_000_000n, true);
    view.setBigUint64(16, 1_047n, true);
    view.setBigUint64(24, 1_048n, true);
    view.setBigInt64(32, 1_790_812_800n, true);
    const { calls, chain } = fakeServer(() => ({
      result: {
        context: CONTEXT,
        value: { data: [getBase64Decoder().decode(bytes), 'base64'], executable: false, lamports: 1n, owner: key(5), space: 40n },
      },
    }));
    expect(await chain.getClock()).toEqual({ slot: 452_000_123n, epoch: 1_047n, unixTimestamp: 1_790_812_800n });
    expect(calls[0]).toMatchObject({
      method: 'getAccountInfo',
      params: [SYSVAR_CLOCK_ADDRESS, { encoding: 'base64', commitment: 'confirmed' }],
    });
  });

  it('blockhash, block height (getEpochInfo), balance and rent use the allowed methods and shapes', async () => {
    const { calls, chain } = fakeServer(({ method }) => {
      switch (method) {
        case 'getLatestBlockhash':
          return { result: { context: CONTEXT, value: { blockhash: LIFETIME.blockhash, lastValidBlockHeight: 300_000_150n } } };
        case 'getEpochInfo':
          return {
            result: { absoluteSlot: 1n, blockHeight: 300_000_000n, epoch: 1047n, slotIndex: 1n, slotsInEpoch: 432_000n, transactionCount: null },
          };
        case 'getBalance':
          return { result: { context: CONTEXT, value: 650_240n } };
        default:
          return { result: 1_666_240n };
      }
    });
    expect(await chain.getLatestBlockhash()).toEqual({ blockhash: LIFETIME.blockhash, lastValidBlockHeight: 300_000_150n });
    expect(await chain.getBlockHeight()).toBe(300_000_000n);
    expect(await chain.getBalance(A.address)).toBe(650_240n);
    expect(await chain.getMinimumBalanceForRentExemption(200)).toBe(1_666_240n);
    expect(calls.map(({ method, params }) => [method, params])).toEqual([
      ['getLatestBlockhash', [{ commitment: 'confirmed' }]],
      ['getEpochInfo', [{ commitment: 'confirmed' }]],
      ['getBalance', [A.address, { commitment: 'confirmed' }]],
      ['getMinimumBalanceForRentExemption', [200]],
    ]);
  });

  it('getEpochInfo: epoch, slot index, slots per epoch and block height from one call; malformed answers throw', async () => {
    const good = { absoluteSlot: 452_000_123n, blockHeight: 300_000_000n, epoch: 1047n, slotIndex: 123n, slotsInEpoch: 432_000n, transactionCount: null };
    const { calls, chain } = fakeServer(() => ({ result: good }));
    expect(await chain.getEpochInfo()).toEqual({ epoch: 1047n, slotIndex: 123n, slotsInEpoch: 432_000n, blockHeight: 300_000_000n });
    expect(await chain.getBlockHeight()).toBe(300_000_000n);
    expect(calls.map(({ method, params }) => [method, params])).toEqual([
      ['getEpochInfo', [{ commitment: 'confirmed' }]],
      ['getEpochInfo', [{ commitment: 'confirmed' }]],
    ]);

    const malformed: unknown[] = [
      null,
      'epoch',
      { ...good, epoch: '1047' },
      { ...good, slotIndex: undefined },
      { ...good, slotsInEpoch: 0n },
      { ...good, slotIndex: 432_000n },
      { ...good, slotIndex: -1n },
      { ...good, blockHeight: 1.5 },
    ];
    for (const result of malformed) {
      const bad = fakeServer(() => ({ result }));
      await expect(bad.chain.getEpochInfo(), stringify(result)).rejects.toThrow(/Malformed RPC response: getEpochInfo/);
    }
    const noHeight = fakeServer(() => ({ result: { ...good, blockHeight: null } }));
    await expect(noHeight.chain.getBlockHeight()).rejects.toThrow(/Malformed RPC response: getEpochInfo/);
  });

  it('simulate: base64, no signature check; a program error comes back as data translateError reads', async () => {
    let fail = false;
    const { calls, chain } = fakeServer(() => ({
      result: {
        context: CONTEXT,
        value: {
          err: fail ? { InstructionError: [2, { Custom: 1 }] } : null,
          logs: ['Program log: hi'],
          unitsConsumed: 8_652n,
          accounts: null,
        },
      },
    }));
    expect(await chain.simulate(signed)).toEqual({ ok: true, logs: ['Program log: hi'], unitsConsumed: 8_652n });
    expect(calls[0]?.params).toEqual([getBase64Decoder().decode(signed), { encoding: 'base64', sigVerify: false, commitment: 'confirmed' }]);
    fail = true;
    const result = await chain.simulate(signed);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(translateError(result.error, { transaction: signed }).code).toBe('lockup-in-force');
  });

  it('send: base64 with preflight, answers the transaction id', async () => {
    const { calls, chain } = fakeServer(() => ({ result: signature }));
    expect(await chain.send(signed)).toBe(signature);
    expect(calls[0]?.params).toEqual([getBase64Decoder().decode(signed), { encoding: 'base64', preflightCommitment: 'confirmed' }]);
    expect(getBase64Encoder().encode(calls[0]?.params[0] as string)).toEqual(signed);
  });

  it('send: a preflight failure rejects with the error translateError reads', async () => {
    const { chain } = fakeServer(() => ({
      error: {
        code: -32002,
        message: 'Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1',
        data: { err: { InstructionError: [2, { Custom: 1 }] }, logs: [], accounts: null, unitsConsumed: 6_640 },
      },
    }));
    const error: unknown = await chain.send(signed).catch((e: unknown) => e);
    expect(translateError(error, { transaction: signed }).code).toBe('lockup-in-force');
  });

  it('send: resends the SAME bytes when the worker did not answer; AlreadyProcessed means it is in', async () => {
    const answers: (() => RpcAnswer)[] = [
      () => new TypeError('Failed to fetch'),
      () => ({ error: { code: -32002, message: 'Transaction simulation failed: This transaction has already been processed', data: { err: 'AlreadyProcessed', logs: [] } } }),
    ];
    const { calls, chain } = fakeServer(() => (answers.shift() ?? (() => ({ result: null })))());
    expect(await chain.send(signed)).toBe(signature);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.params).toEqual(calls[0]?.params);
  });

  it('send: an attempt that got no answer may still land, so any later failure is uncertain (a network failure)', async () => {
    const rateLimited = new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32005, message: 'Too many requests' } }), {
      status: 429,
    });
    const expired = {
      error: { code: -32002, message: 'Transaction simulation failed: Blockhash not found', data: { err: 'BlockhashNotFound', logs: [] } },
    };
    for (const [later, code] of [
      [rateLimited, 'rate-limited'],
      [expired, 'blockhash-expired'],
    ] as const) {
      const answers: (() => RpcAnswer)[] = [() => new TypeError('Failed to fetch'), () => later];
      const { calls, chain } = fakeServer((call) =>
        call.method === 'sendTransaction' ? (answers.shift() ?? (() => ({ result: null })))() : { result: { context: CONTEXT, value: [null] } },
      );
      const error: unknown = await chain.send(signed).catch((e: unknown) => e);
      // The same bytes again after the lost answer, then one status read (still in flight: null).
      expect(calls.map((call) => call.method), code).toEqual(['sendTransaction', 'sendTransaction', 'getSignatureStatuses']);
      expect(error, code).toMatchObject({ name: 'SendOutcomeUnknownError' });
      expect(translateError(error, { transaction: signed }).code, code).toBe('network');
      // What the retry got stays readable for Details.
      expect(translateError((error as { answer: unknown }).answer, { transaction: signed }).code).toBe(code);
    }
    // Without a lost attempt, a rate limit stays definite (the worker refused before forwarding anything).
    const once = fakeServer((call) =>
      call.method === 'sendTransaction'
        ? new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32005, message: 'Too many requests' } }), { status: 429 })
        : { result: { context: CONTEXT, value: [null] } },
    );
    expect(translateError(await once.chain.send(signed).catch((e: unknown) => e)).code).toBe('rate-limited');
  });

  it("does not retry the worker's own answers: an upstream failure (502/504), a rate limit, a refusal", async () => {
    const answers: [RpcAnswer, string][] = [
      [new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'Upstream RPC unavailable' } }), { status: 502 }), 'network'],
      [new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'Upstream RPC timed out' } }), { status: 504 }), 'network'],
      [new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32005, message: 'Too many requests' } }), { status: 429 }), 'rate-limited'],
      [
        { error: { code: -32602, message: 'Transaction rejected by inspector: bad-layout', data: { check: 'inspector', code: 'bad-layout', message: 'x' } } },
        'rejected-by-inspector',
      ],
      [
        { error: { code: -32003, message: 'Transaction rejected: missing-signatures', data: { check: 'signatures', code: 'missing-signatures', signers: [K.address], message: 'x' } } },
        'missing-signature',
      ],
      [
        { error: { code: -32003, message: 'Transaction rejected by inspector: invalid-signature', data: { check: 'inspector', code: 'invalid-signature', message: 'x' } } },
        'invalid-signature',
      ],
    ];
    for (const [answer, code] of answers) {
      const { calls, chain } = fakeServer(() => answer);
      const error: unknown = await chain.send(signed).catch((e: unknown) => e);
      // One send, then one status read (did an earlier attempt land?), neither retried.
      expect(calls.map((call) => call.method), code).toEqual(['sendTransaction', 'getSignatureStatuses']);
      expect(translateError(error, { transaction: signed }).code).toBe(code);
    }
    const reads = fakeServer(() => new Response('', { status: 502 }));
    await expect(reads.chain.getBlockHeight()).rejects.toMatchObject({ context: { statusCode: 502 } });
    expect(reads.calls).toHaveLength(1);
    const search = fakeServer(() => new Response(JSON.stringify({ error: 'rate-limited', message: 'Too many requests' }), { status: 429 }));
    const limited: unknown = await search.chain.findStakeAccounts({ withdrawer: A.address }).catch((e: unknown) => e);
    expect(search.calls).toHaveLength(1);
    expect(translateError(limited).code).toBe('rate-limited');
  });

  it('send: a failed send rejects with its own error unless the cluster knows the signature', async () => {
    const preflight = {
      error: {
        code: -32002,
        message: 'Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1',
        data: { err: { InstructionError: [2, { Custom: 1 }] }, logs: [], accounts: null, unitsConsumed: 0n },
      },
    };
    const unknown = fakeServer((call) =>
      call.method === 'sendTransaction' ? preflight : { result: { context: CONTEXT, value: [null] } },
    );
    const error: unknown = await unknown.chain.send(signed).catch((e: unknown) => e);
    expect(translateError(error, { transaction: signed }).code).toBe('lockup-in-force');
    const known = fakeServer((call) =>
      call.method === 'sendTransaction'
        ? preflight
        : { result: { context: CONTEXT, value: [{ slot: 1n, confirmations: null, err: null, confirmationStatus: 'confirmed' }] } },
    );
    expect(await known.chain.send(signed)).toBe(getSignatureFromTransaction(getTransactionDecoder().decode(signed)));
  });

  it('send: refuses bytes without the fee payer signature before calling the network', async () => {
    const { calls, chain } = fakeServer(() => ({ result: null }));
    const unsigned = buildTransaction(
      { kind: 'withdraw', stakeAccount: key(9), mainKey: A.address, secondKey: null, recipient: A.address, lamports: 5n },
      { feePayer: A.address, lifetime: LIFETIME },
    ).bytes;
    const error: unknown = await chain.send(unsigned).catch((e: unknown) => e);
    expect(translateError(error).code).toBe('missing-signature');
    expect(calls).toEqual([]);
  });

  it('send: an answer with another signature is an error', async () => {
    const { chain } = fakeServer(() => ({ result: '1111111111111111111111111111111111111111111111111111111111111111' }));
    await expect(chain.send(signed)).rejects.toThrow(/answered/);
  });

  it('getSignatureStatuses: null when unknown, the error when it failed', async () => {
    const { calls, chain } = fakeServer(() => ({
      result: {
        context: CONTEXT,
        value: [
          null,
          { slot: 5n, confirmations: null, err: null, confirmationStatus: 'finalized', status: { Ok: null } },
          { slot: 6n, confirmations: 1n, err: { InstructionError: [2, { Custom: 1 }] }, confirmationStatus: 'confirmed' },
        ],
      },
    }));
    const statuses = await chain.getSignatureStatuses([signature, signature, signature]);
    expect(calls[0]).toMatchObject({ method: 'getSignatureStatuses', params: [[signature, signature, signature]] });
    expect(statuses[0]).toBeNull();
    expect(statuses[1]).toEqual({ slot: 5n, confirmationStatus: 'finalized', error: null });
    expect(statuses[2]?.confirmationStatus).toBe('confirmed');
    expect(translateError(statuses[2]?.error, { transaction: signed }).code).toBe('lockup-in-force');
  });

  it('findStakeAccounts: GET /api/stake-accounts (core StakeAccountsJson), other accounts dropped', async () => {
    const withdrawer = A.address;
    const account = (address: Address, owner: Address) => ({
      address,
      lamports: '9007199254740993',
      kind: 'delegated',
      rentExemptReserve: '2282880',
      staker: owner,
      withdrawer: owner,
      lockup: { unixTimestamp: '1825545600', epoch: '0', custodian: K.address },
      delegation: { voter: key(3), stake: '1000000000', activationEpoch: '628', deactivationEpoch: '18446744073709551615' },
    });
    const { calls, chain } = fakeServer(
      () => new Response(JSON.stringify({ slot: '452000000', accounts: [account(key(1), withdrawer), account(key(2), key(4))] })),
    );
    const result = await chain.findStakeAccounts({ withdrawer });
    expect(calls[0]).toMatchObject({ url: `/api/stake-accounts?withdrawer=${withdrawer}`, method: 'GET' });
    expect(result.slot).toBe(452_000_000n);
    expect(result.accounts).toEqual([
      {
        address: key(1),
        lamports: 9_007_199_254_740_993n,
        kind: 'delegated',
        rentExemptReserve: 2_282_880n,
        staker: withdrawer,
        withdrawer,
        lockup: { unixTimestamp: 1_825_545_600n, epoch: 0n, custodian: K.address },
        delegation: { voter: key(3), stake: 1_000_000_000n, activationEpoch: 628n, deactivationEpoch: 18_446_744_073_709_551_615n },
      },
    ]);

    const byCustodian = fakeServer(() => new Response(JSON.stringify({ slot: '1', accounts: [] })));
    await byCustodian.chain.findStakeAccounts({ custodian: K.address });
    expect(byCustodian.calls[0]?.url).toBe(`/api/stake-accounts?custodian=${K.address}`);
  });

  it('findStakeAccounts: a malformed body is an error, never a partial list', async () => {
    const bad = [
      { slot: '1' },
      { slot: '1', accounts: [{ address: 'not an address' }] },
      { slot: '-1', accounts: [] },
      { slot: '1', accounts: [{ address: key(1), kind: 'delegated', delegation: null }] },
    ];
    for (const body of bad) {
      const { chain } = fakeServer(() => new Response(JSON.stringify(body)));
      await expect(chain.findStakeAccounts({ withdrawer: A.address })).rejects.toMatchObject({
        name: 'InvalidStakeAccountsJsonError',
      });
    }
  });

  it('a malformed RPC answer is an error', async () => {
    const { chain } = fakeServer(() => ({ result: { context: CONTEXT, value: [null] } }));
    await expect(chain.getAccounts([key(1), key(2)])).rejects.toThrow(/Malformed/);
    const wrongOwner = fakeServer(() => ({
      result: { context: CONTEXT, value: [{ data: ['', 'base58'], lamports: 1n, owner: key(1) }] },
    }));
    await expect(wrongOwner.chain.getAccounts([key(1)])).rejects.toThrow(/base64/);
  });
});
