// The RPC adapter without a network: kit's real request and response handling over a scripted transport that answers
// like a public node (numbers as JSON numbers, errors in the shapes getSignatureStatuses uses).
import {
  blockhash,
  createNoopSigner,
  createSolanaRpcFromTransport,
  generateKeyPairSigner,
  getBase64Decoder,
  getI64Encoder,
  getStructEncoder,
  getU64Encoder,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  SolanaError,
  type RpcTransport,
} from '@solana/kit';
import { getTransferSolInstruction } from '@solana-program/system';
import { SYSVAR_CLOCK_ADDRESS, type BlockhashLifetime } from '@stakeward/core';
import { describe, expect, it } from 'vitest';
import { createRpcChainFromRpc } from './rpc.ts';
import { buildFormatted, signWith } from './tx.ts';

type Request = { method: string; params: unknown[] };
type Handler = (params: unknown[], call: number) => unknown;

/** A transport that answers each method with its handler (or throws what the handler throws) and logs the calls. */
function scripted(handlers: Record<string, Handler>) {
  const requests: Request[] = [];
  const transport: RpcTransport = ({ payload }) => {
    const { id, method, params } = payload as Request & { id: string };
    requests.push({ method, params });
    const handler = handlers[method];
    if (handler === undefined) return Promise.reject(new Error(`unexpected RPC method ${method}`));
    try {
      const result = handler(params, requests.filter((r) => r.method === method).length);
      return Promise.resolve({ jsonrpc: '2.0', id, result } as never);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  };
  const chain = createRpcChainFromRpc(createSolanaRpcFromTransport(transport), {
    pollIntervalMs: 1,
    resendIntervalMs: 1,
    retryDelayMs: 1,
  });
  return { chain, requests };
}

const LIFETIME: BlockhashLifetime = {
  kind: 'blockhash',
  blockhash: blockhash('11111111111111111111111111111111'),
  lastValidBlockHeight: 1_000n,
};

async function signedTransfer() {
  const payer = await generateKeyPairSigner();
  const transfer = getTransferSolInstruction({
    source: createNoopSigner(payer.address),
    destination: payer.address,
    amount: 1n,
  });
  return signWith(buildFormatted([transfer], payer.address, LIFETIME), [payer]);
}

const confirmed = (err: unknown) => ({
  context: { slot: 1 },
  value: [{ slot: 1, confirmations: null, err, confirmationStatus: 'confirmed', status: err === null ? { Ok: null } : { Err: err } }],
});
const pending = { context: { slot: 1 }, value: [null] };

describe('RPC adapter: send', () => {
  it('sends base64 without preflight and maps a stake custom error from the status', async () => {
    const { chain, requests } = scripted({
      sendTransaction: () => 'sig',
      getSignatureStatuses: (_params, call) => (call < 3 ? pending : confirmed({ InstructionError: [2, { Custom: 1 }] })),
      getBlockHeight: () => 10,
    });
    const outcome = await chain.send(await signedTransfer(), LIFETIME);
    expect(outcome).toMatchObject({ status: 'failed', error: { kind: 'custom', code: 1, index: 2 } });
    expect(requests.find((r) => r.method === 'sendTransaction')?.params[1]).toMatchObject({
      encoding: 'base64',
      skipPreflight: true,
    });
  });

  it('maps a built-in instruction error by name', async () => {
    const { chain } = scripted({
      sendTransaction: () => 'sig',
      getSignatureStatuses: () => confirmed({ InstructionError: [2, 'MissingRequiredSignature'] }),
      getBlockHeight: () => 10,
    });
    expect(await chain.send(await signedTransfer(), LIFETIME)).toMatchObject({
      status: 'failed',
      error: { kind: 'instruction', name: 'MissingRequiredSignature', index: 2 },
    });
  });

  it('retries a rate-limited request and reports success', async () => {
    const { chain, requests } = scripted({
      sendTransaction: (_params, call) => {
        if (call === 1) {
          throw new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, {
            headers: new Headers(),
            message: 'Too Many Requests',
            statusCode: 429,
          });
        }
        return 'sig';
      },
      getSignatureStatuses: () => confirmed(null),
      getBlockHeight: () => 10,
    });
    expect(await chain.send(await signedTransfer(), LIFETIME)).toMatchObject({ status: 'ok' });
    expect(requests.filter((r) => r.method === 'sendTransaction').length).toBe(2);
  });

  it('reports a transaction that never landed once the blockhash expired, after a last search of history', async () => {
    const { chain, requests } = scripted({
      sendTransaction: () => 'sig',
      getSignatureStatuses: () => pending,
      getBlockHeight: (_params, call) => (call < 3 ? 999 : 1_001),
    });
    expect(await chain.send(await signedTransfer(), LIFETIME)).toMatchObject({ status: 'dropped' });
    const last = requests.filter((r) => r.method === 'getSignatureStatuses').at(-1);
    expect(last?.params[1]).toMatchObject({ searchTransactionHistory: true });
  });
});

describe('RPC adapter: reads', () => {
  it('reads time and epoch from the Clock sysvar', async () => {
    const clock = getStructEncoder([
      ['slot', getU64Encoder()],
      ['epochStartTimestamp', getI64Encoder()],
      ['epoch', getU64Encoder()],
      ['leaderScheduleEpoch', getU64Encoder()],
      ['unixTimestamp', getI64Encoder()],
    ]).encode({ slot: 5n, epochStartTimestamp: 1n, epoch: 1172n, leaderScheduleEpoch: 1173n, unixTimestamp: 1_790_939_254n });
    const { chain, requests } = scripted({
      getAccountInfo: () => ({
        context: { slot: 1 },
        value: {
          data: [getBase64Decoder().decode(clock), 'base64'],
          executable: false,
          lamports: 1_169_280,
          owner: 'Sysvar1111111111111111111111111111111111111',
          rentEpoch: 0,
          space: 40,
        },
      }),
    });
    expect(await chain.clock()).toEqual({ unixTimestamp: 1_790_939_254n, epoch: 1172n });
    expect(requests[0]).toMatchObject({ params: [SYSVAR_CLOCK_ADDRESS, { encoding: 'base64' }] });
  });
});
