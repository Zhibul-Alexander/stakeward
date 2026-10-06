import { getBase58Decoder } from '@solana/kit';
import { buildTransaction } from '@stakeward/core';
import { craft, instructionsOf } from '@stakeward/core/test/craft';
import { describe, expect, it } from 'vitest';
import { errorOf, fakeUpstream, rpcResponse, testApp, type UpstreamCall } from './fakes.ts';
import {
  b64,
  BLOCKHASH,
  corruptFirstSignature,
  key,
  signedChangeSecondKey,
  signedProtect,
  signedSystemTransfer,
  unsignedChangeSecondKey,
  unsignedProtect,
} from './transactions.ts';

const ADDRESS = key(5);
const SIGNATURE = getBase58Decoder().decode(new Uint8Array(64).fill(7));

/** An upstream that must never be reached. */
function unreachable() {
  return fakeUpstream(() => {
    throw new Error('the request should not reach the upstream RPC');
  });
}

/** `bytes` with its last byte (the end of the last instruction's data) set to `value`; the length stays. */
function withLastDataByte(bytes: Uint8Array, value: number): Uint8Array {
  const copy = bytes.slice();
  copy[copy.length - 1] = value;
  return copy;
}

function call(method: string, params?: unknown[], id: unknown = 'req-1') {
  return params === undefined ? { jsonrpc: '2.0', id, method } : { jsonrpc: '2.0', id, method, params };
}

describe('POST /api/rpc: allowed methods and params', () => {
  it.each([
    ['getLatestBlockhash', []],
    ['getLatestBlockhash', [{ commitment: 'confirmed' }]],
    ['getAccountInfo', [ADDRESS, { encoding: 'base64', commitment: 'confirmed' }]],
    ['getAccountInfo', [ADDRESS, { encoding: 'base64', dataSlice: { offset: 0, length: 0 }, minContextSlot: 5 }]],
    ['getMultipleAccounts', [Array.from({ length: 100 }, (_, i) => key(i)), { encoding: 'base64' }]],
    ['getBalance', [ADDRESS]],
    ['getBalance', [ADDRESS, { commitment: 'finalized', minContextSlot: 1 }]],
    ['getEpochInfo', []],
    ['getEpochInfo', [{ commitment: 'processed' }]],
    ['getMinimumBalanceForRentExemption', [200]],
    ['getMinimumBalanceForRentExemption', [80, { commitment: 'confirmed' }]],
    ['getSignatureStatuses', [Array.from({ length: 256 }, () => SIGNATURE)]],
    ['getSignatureStatuses', [[SIGNATURE], { searchTransactionHistory: false }]],
  ])('forwards %s %j unchanged and returns the upstream answer as it is', async (method, params) => {
    const answer = `{"jsonrpc":"2.0","id":"req-1","result":{"context":{"slot":1},"value":18446744073709551615}}`;
    const upstream = fakeUpstream(() => new Response(answer, { headers: { 'Content-Type': 'application/json' } }));
    const res = await testApp(upstream).rpc(call(method, params));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(answer);
    expect(upstream.calls).toHaveLength(1);
    expect(upstream.calls[0]?.endpoint).toBe('primary');
    expect(upstream.calls[0]?.json).toEqual(call(method, params));
  });

  it('accepts a request without params for methods whose params are all optional, and numeric ids', async () => {
    const upstream = fakeUpstream((c) => rpcResponse(c.json.id, { blockhash: BLOCKHASH, lastValidBlockHeight: 10 }));
    const res = await testApp(upstream).rpc(call('getLatestBlockhash', undefined, 7));
    expect(res.status).toBe(200);
    expect(upstream.calls[0]?.json).toEqual({ jsonrpc: '2.0', id: 7, method: 'getLatestBlockhash', params: [] });
  });

  it.each([
    'getProgramAccounts',
    'requestAirdrop',
    'getTransaction',
    'getBlockHeight',
    'getHealth',
    'constructor',
    '__proto__',
    'toString',
  ])('rejects %s with -32601 and never calls upstream', async (method) => {
    const upstream = unreachable();
    const res = await testApp(upstream).rpc(call(method, []));
    expect(res.status).toBe(200);
    const body = await res.json<{ id: unknown; error: { code: number; message: string } }>();
    expect(body.id).toBe('req-1');
    expect(body.error.code).toBe(-32601);
    expect(body.error.message).toBe(`Method not allowed: ${method}`);
    expect(upstream.calls).toHaveLength(0);
  });

  const badParams: [string, string, unknown][] = [
    ['getLatestBlockhash', 'unknown config key', [{ commitment: 'confirmed', extra: 1 }]],
    ['getLatestBlockhash', 'bad commitment', [{ commitment: 'recent' }]],
    ['getLatestBlockhash', 'extra positional param', [{}, {}]],
    ['getLatestBlockhash', 'params not an array', { commitment: 'confirmed' }],
    ['getAccountInfo', 'missing config (base58 default)', [ADDRESS]],
    ['getAccountInfo', 'base58 encoding', [ADDRESS, { encoding: 'base58' }]],
    ['getAccountInfo', 'jsonParsed encoding', [ADDRESS, { encoding: 'jsonParsed' }]],
    ['getAccountInfo', 'not an address', ['not-an-address', { encoding: 'base64' }]],
    ['getAccountInfo', '31-byte address', ['1111111111111111111111111111111', { encoding: 'base64' }]],
    ['getAccountInfo', 'address as number', [42, { encoding: 'base64' }]],
    ['getAccountInfo', 'dataSlice with extra key', [ADDRESS, { encoding: 'base64', dataSlice: { offset: 0, length: 1, x: 1 } }]],
    ['getAccountInfo', 'negative dataSlice', [ADDRESS, { encoding: 'base64', dataSlice: { offset: -1, length: 1 } }]],
    ['getAccountInfo', 'fractional minContextSlot', [ADDRESS, { encoding: 'base64', minContextSlot: 1.5 }]],
    ['getAccountInfo', 'minContextSlot as string', [ADDRESS, { encoding: 'base64', minContextSlot: '5' }]],
    ['getMultipleAccounts', '101 keys', [Array.from({ length: 101 }, (_, i) => key(i % 200)), { encoding: 'base64' }]],
    ['getMultipleAccounts', 'no keys', [[], { encoding: 'base64' }]],
    ['getMultipleAccounts', 'keys not an array', [ADDRESS, { encoding: 'base64' }]],
    ['getMultipleAccounts', 'unknown config key', [[ADDRESS], { encoding: 'base64', filters: [] }]],
    ['getBalance', 'missing address', []],
    ['getBalance', 'unknown config key', [ADDRESS, { encoding: 'base64' }]],
    ['getEpochInfo', 'unknown config key', [{ dataSlice: { offset: 0, length: 0 } }]],
    ['getMinimumBalanceForRentExemption', 'size as string', ['200']],
    ['getMinimumBalanceForRentExemption', 'negative size', [-1]],
    ['getMinimumBalanceForRentExemption', 'size over 10 MiB', [10 * 1024 * 1024 + 1]],
    ['getMinimumBalanceForRentExemption', 'minContextSlot not allowed', [200, { minContextSlot: 1 }]],
    ['getSignatureStatuses', '257 signatures', [Array.from({ length: 257 }, () => SIGNATURE)]],
    ['getSignatureStatuses', 'not a signature', [['abc']]],
    ['getSignatureStatuses', 'searchTransactionHistory true', [[SIGNATURE], { searchTransactionHistory: true }]],
    ['getSignatureStatuses', 'unknown config key', [[SIGNATURE], { commitment: 'confirmed' }]],
    ['simulateTransaction', 'missing config', ['AAAA']],
    ['simulateTransaction', 'base58 encoding', ['AAAA', { encoding: 'base58' }]],
    ['simulateTransaction', 'not base64', ['not base64!', { encoding: 'base64' }]],
    ['simulateTransaction', 'longer than a packet', ['A'.repeat(1648), { encoding: 'base64' }]],
    ['simulateTransaction', 'accounts config', ['AAAA', { encoding: 'base64', accounts: { addresses: [], encoding: 'base64' } }]],
    ['simulateTransaction', 'innerInstructions config', ['AAAA', { encoding: 'base64', innerInstructions: true }]],
    ['simulateTransaction', 'sigVerify and replaceRecentBlockhash', ['AAAA', { encoding: 'base64', sigVerify: true, replaceRecentBlockhash: true }]],
    ['simulateTransaction', 'non-canonical base64', ['AAB=', { encoding: 'base64' }]],
    ['sendTransaction', 'missing config', ['AAAA']],
    ['sendTransaction', 'unknown config key', ['AAAA', { encoding: 'base64', sigVerify: false }]],
    ['sendTransaction', 'maxRetries too large', ['AAAA', { encoding: 'base64', maxRetries: 101 }]],
    ['sendTransaction', 'skipPreflight not boolean', ['AAAA', { encoding: 'base64', skipPreflight: 'yes' }]],
    ['sendTransaction', 'transaction as array', [[1, 2, 3], { encoding: 'base64' }]],
  ];

  it.each(badParams)('%s: rejects %s with -32602 and never calls upstream', async (method, _case, params) => {
    const upstream = unreachable();
    const res = await testApp(upstream).rpc({ jsonrpc: '2.0', id: 3, method, params });
    expect(res.status).toBe(200);
    const body = await res.json<{ id: unknown; error: { code: number; message: string } }>();
    expect(body.id).toBe(3);
    expect(body.error.code).toBe(-32602);
    expect(body.error.message).toMatch(/^params/);
    expect(upstream.calls).toHaveLength(0);
  });
});

describe('POST /api/rpc: request envelope', () => {
  it('rejects a batch with -32600', async () => {
    const upstream = unreachable();
    const res = await testApp(upstream).rpc([call('getEpochInfo', []), call('getEpochInfo', [], 'req-2')]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Batch requests are not supported' },
    });
    expect(upstream.calls).toHaveLength(0);
  });

  it('rejects text that is not JSON with -32700', async () => {
    const res = await testApp(unreachable()).rpc('{"jsonrpc":"2.0",');
    expect(res.status).toBe(200);
    expect((await errorOf(res)).code).toBe(-32700);
  });

  it.each([
    ['not an object', 'null'],
    ['a string', '"getEpochInfo"'],
    ['missing jsonrpc', JSON.stringify({ id: 1, method: 'getEpochInfo', params: [] })],
    ['jsonrpc 1.0', JSON.stringify({ jsonrpc: '1.0', id: 1, method: 'getEpochInfo', params: [] })],
    ['missing id (notification)', JSON.stringify({ jsonrpc: '2.0', method: 'getEpochInfo', params: [] })],
    ['null id', JSON.stringify({ jsonrpc: '2.0', id: null, method: 'getEpochInfo', params: [] })],
    ['object id', JSON.stringify({ jsonrpc: '2.0', id: {}, method: 'getEpochInfo', params: [] })],
    ['fractional id', JSON.stringify({ jsonrpc: '2.0', id: 1.5, method: 'getEpochInfo', params: [] })],
    ['very long id', JSON.stringify({ jsonrpc: '2.0', id: 'x'.repeat(65), method: 'getEpochInfo', params: [] })],
    ['method not a string', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 5, params: [] })],
    ['extra key', JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getEpochInfo', params: [], extra: true })],
  ])('rejects %s with -32600', async (_case, text) => {
    const upstream = unreachable();
    const res = await testApp(upstream).rpc(text);
    expect(res.status).toBe(200);
    expect((await errorOf(res)).code).toBe(-32600);
    expect(upstream.calls).toHaveLength(0);
  });

  it('answers an invalid request with its id when the id itself is valid', async () => {
    const res = await testApp(unreachable()).rpc({ jsonrpc: '2.0', id: 'abc', method: 'getEpochInfo', extra: 1 });
    expect((await res.json<{ id: unknown }>()).id).toBe('abc');
  });

  it('rejects a body that is not declared as JSON with HTTP 415', async () => {
    const upstream = unreachable();
    const res = await testApp(upstream).rpc(call('getEpochInfo', []), { headers: { 'Content-Type': 'text/plain' } });
    expect(res.status).toBe(415);
    expect((await errorOf(res)).code).toBe(-32600);
    expect(upstream.calls).toHaveLength(0);
  });

  it('accepts application/json with a charset, as kit sends it', async () => {
    const upstream = fakeUpstream((c) => rpcResponse(c.json.id, { epoch: 1 }));
    const res = await testApp(upstream).rpc(call('getEpochInfo', []), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
    expect(res.status).toBe(200);
    expect(upstream.calls).toHaveLength(1);
  });

  it('GET /api/rpc is not a route', async () => {
    const res = await testApp(unreachable()).request('/api/rpc');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/rpc: transactions go through the inspector', () => {
  it('simulateTransaction: forwards an unsigned protect transaction with the inspected bytes and the config', async () => {
    const { bytes } = await unsignedProtect();
    const upstream = fakeUpstream((c) => rpcResponse(c.json.id, { context: { slot: 1 }, value: { err: null, logs: [] } }));
    const config = { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' };
    const res = await testApp(upstream).rpc(call('simulateTransaction', [b64(bytes), config]));
    expect(res.status).toBe(200);
    expect(upstream.calls).toHaveLength(1);
    expect(upstream.calls[0]?.json).toEqual(call('simulateTransaction', [b64(bytes), config]));
  });

  it('sendTransaction: forwards a fully signed protect transaction exactly, in one attempt', async () => {
    const { bytes } = await signedProtect();
    const answer = '{"jsonrpc":"2.0","id":"req-1","result":"4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi"}';
    const upstream = fakeUpstream(() => new Response(answer, { headers: { 'Content-Type': 'application/json' } }));
    const config = { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0 };
    const res = await testApp(upstream).rpc(call('sendTransaction', [b64(bytes), config]));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(answer);
    expect(upstream.calls).toHaveLength(1);
    const sent = upstream.calls[0] as UpstreamCall;
    expect(sent.json.params[0]).toBe(b64(bytes));
    expect(sent.json).toEqual(call('sendTransaction', [b64(bytes), config]));
  });

  it('rejects a System transfer with -32602 (inspector: unknown-instruction)', async () => {
    const transfer = await signedSystemTransfer();
    for (const method of ['simulateTransaction', 'sendTransaction']) {
      const upstream = unreachable();
      const res = await testApp(upstream).rpc(call(method, [b64(transfer), { encoding: 'base64' }]));
      expect(res.status).toBe(200);
      const error = await errorOf(res);
      expect(error.code).toBe(-32602);
      expect(error.message).toBe('Transaction rejected by inspector: unknown-instruction');
      expect(error.data).toMatchObject({ check: 'inspector', code: 'unknown-instruction' });
      expect(upstream.calls).toHaveLength(0);
    }
  });

  it.each([
    ['three zero bytes', 'AAAA'],
    ['random bytes', b64(crypto.getRandomValues(new Uint8Array(300)))],
    ['a lone signature count', 'AQ=='],
  ])('rejects garbage (%s) with -32602 (inspector: malformed)', async (_case, encoded) => {
    const upstream = unreachable();
    const res = await testApp(upstream).rpc(call('simulateTransaction', [encoded, { encoding: 'base64' }]));
    const error = await errorOf(res);
    expect(error.code).toBe(-32602);
    expect(error.data).toMatchObject({ check: 'inspector', code: 'malformed' });
    expect(upstream.calls).toHaveLength(0);
  });

  it('rejects trailing bytes after a valid transaction', async () => {
    const { bytes } = await unsignedProtect();
    const padded = new Uint8Array([...bytes, 0]);
    const res = await testApp(unreachable()).rpc(call('simulateTransaction', [b64(padded), { encoding: 'base64' }]));
    expect((await errorOf(res)).data).toMatchObject({ check: 'inspector', code: 'malformed' });
  });

  it('sendTransaction rejects an unsigned transaction with -32003: missing signatures of both keys', async () => {
    const { bytes, mainKey, secondKey } = await unsignedProtect();
    const upstream = unreachable();
    const res = await testApp(upstream).rpc(call('sendTransaction', [b64(bytes), { encoding: 'base64' }]));
    const error = await errorOf(res);
    expect(error.code).toBe(-32003);
    expect(error.message).toBe('Transaction rejected: missing-signatures');
    expect(error.data).toMatchObject({ check: 'signatures', code: 'missing-signatures' });
    expect(error.data?.signers).toEqual([mainKey.address, secondKey.address]);
    expect(upstream.calls).toHaveLength(0);
  });

  it('sendTransaction rejects a transaction only the main key signed', async () => {
    const { bytes, mainKey, secondKey } = await unsignedProtect();
    const [partly] = await mainKey.signTransactions([bytes]);
    const res = await testApp(unreachable()).rpc(call('sendTransaction', [b64(partly ?? bytes), { encoding: 'base64' }]));
    const error = await errorOf(res);
    expect(error.code).toBe(-32003);
    expect(error.data).toMatchObject({ check: 'signatures', code: 'missing-signatures', signers: [secondKey.address] });
  });

  it('simulateTransaction accepts a partly signed transaction (the second key signs later)', async () => {
    const { bytes, mainKey } = await unsignedProtect();
    const [partly] = await mainKey.signTransactions([bytes]);
    const upstream = fakeUpstream((c) => rpcResponse(c.json.id, { context: { slot: 1 }, value: { err: null } }));
    const res = await testApp(upstream).rpc(call('simulateTransaction', [b64(partly ?? bytes), { encoding: 'base64' }]));
    expect(res.status).toBe(200);
    expect(upstream.calls).toHaveLength(1);
  });

  it('rejects a signature that does not verify with -32003, on simulate and on send', async () => {
    const { bytes } = await signedProtect();
    const corrupt = corruptFirstSignature(bytes);
    for (const method of ['simulateTransaction', 'sendTransaction']) {
      const upstream = unreachable();
      const res = await testApp(upstream).rpc(call(method, [b64(corrupt), { encoding: 'base64' }]));
      const error = await errorOf(res);
      expect(error.code).toBe(-32003);
      expect(error.data).toMatchObject({ check: 'inspector', code: 'invalid-signature' });
      expect(upstream.calls).toHaveLength(0);
    }
  });

  it('a change of second key (F7): simulate forwards the unsigned bytes, send forwards the signed bytes exactly', async () => {
    const unsigned = await unsignedChangeSecondKey();
    const simulateUpstream = fakeUpstream((c) => rpcResponse(c.json.id, { context: { slot: 1 }, value: { err: null } }));
    const simulateConfig = { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true };
    const simulated = await testApp(simulateUpstream).rpc(call('simulateTransaction', [b64(unsigned.bytes), simulateConfig]));
    expect(simulated.status).toBe(200);
    expect(simulateUpstream.calls[0]?.json).toEqual(call('simulateTransaction', [b64(unsigned.bytes), simulateConfig]));

    const { bytes } = await signedChangeSecondKey();
    const answer = '{"jsonrpc":"2.0","id":"req-1","result":"4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi"}';
    const sendUpstream = fakeUpstream(() => new Response(answer, { headers: { 'Content-Type': 'application/json' } }));
    const sent = await testApp(sendUpstream).rpc(call('sendTransaction', [b64(bytes), { encoding: 'base64' }]));
    expect(await sent.text()).toBe(answer);
    expect(sendUpstream.calls).toHaveLength(1);
    expect(sendUpstream.calls[0]?.json.params[0]).toBe(b64(bytes));
  });

  it('a change of second key that is malformed, or paid by the old second key, never reaches upstream', async () => {
    const { bytes, secondKey, newSecondKey, stakeAccount } = await signedChangeSecondKey();
    // The change's instructions as the main key would pay them (the new key a read-only signer), then compiled with
    // the old second key as fee payer: the builder never makes that, so neither does the inspector.
    const byMainKey = buildTransaction(
      { kind: 'change-second-key', stakeAccount, secondKey: secondKey.address, newSecondKey: newSecondKey.address },
      { feePayer: key(9), lifetime: { kind: 'blockhash', blockhash: BLOCKHASH, lastValidBlockHeight: 1000n } },
    );
    const cases: [string, Uint8Array, string][] = [
      ['a trailing byte', new Uint8Array([...bytes, 0]), 'malformed'],
      ['a lock end of option tag 2 (decodes as None, not canonical)', withLastDataByte(bytes, 2), 'malformed'],
      ['paid by the old second key', craft(instructionsOf(byMainKey.bytes), secondKey.address, BLOCKHASH), 'unknown-instruction'],
    ];
    for (const [name, transaction, code] of cases) {
      for (const method of ['simulateTransaction', 'sendTransaction']) {
        const upstream = unreachable();
        const res = await testApp(upstream).rpc(call(method, [b64(transaction), { encoding: 'base64' }]));
        const error = await errorOf(res);
        expect(error.code, `${name} on ${method}`).toBe(-32602);
        expect(error.message, `${name} on ${method}`).toBe(`Transaction rejected by inspector: ${code}`);
        expect(upstream.calls).toHaveLength(0);
      }
    }
  });

  it('passes an upstream JSON-RPC error (e.g. preflight failure) through unchanged', async () => {
    const { bytes } = await signedProtect();
    const answer = JSON.stringify({
      jsonrpc: '2.0',
      id: 'req-1',
      error: { code: -32002, message: 'Transaction simulation failed', data: { err: { InstructionError: [2, { Custom: 1 }] } } },
    });
    const upstream = fakeUpstream(() => new Response(answer, { headers: { 'Content-Type': 'application/json' } }));
    const res = await testApp(upstream).rpc(call('sendTransaction', [b64(bytes), { encoding: 'base64' }]));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(answer);
  });
});
