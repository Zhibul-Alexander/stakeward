// The site talks to /api/rpc with @solana/kit's RPC client. Every allowed method, called the way kit serialises it
// (string ids, default commitment injected, bigints as JSON numbers), must pass the proxy's validation.
import {
  createSolanaRpc,
  getBase58Decoder,
  isSolanaError,
  SOLANA_ERROR__JSON_RPC__INVALID_PARAMS,
  SOLANA_ERROR__JSON_RPC__METHOD_NOT_FOUND,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_TRANSACTION_SIGNATURE_VERIFICATION_FAILURE,
  type Base64EncodedWireTransaction,
  type Signature,
} from '@solana/kit';
import { translateError } from '@stakeward/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeUpstream, ORIGIN, rpcResponse, testApp, type UpstreamCall } from './fakes.ts';
import { b64, corruptFirstSignature, key, signedProtect, signedSystemTransfer, unsignedProtect } from './transactions.ts';

const RESULTS: Record<string, unknown> = {
  getLatestBlockhash: { context: { slot: 1 }, value: { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 9 } },
  getAccountInfo: { context: { slot: 1 }, value: null },
  getMultipleAccounts: { context: { slot: 1 }, value: [null] },
  getBalance: { context: { slot: 1 }, value: 5 },
  getEpochInfo: { absoluteSlot: 1, blockHeight: 1, epoch: 1, slotIndex: 1, slotsInEpoch: 432000, transactionCount: 1 },
  getMinimumBalanceForRentExemption: 2282880,
  getSignatureStatuses: { context: { slot: 1 }, value: [null] },
  simulateTransaction: { context: { slot: 1 }, value: { err: null, logs: [], unitsConsumed: 1 } },
  sendTransaction: '1111111111111111111111111111111111111111111111111111111111111111',
};

afterEach(() => {
  vi.restoreAllMocks();
});

function kitClient() {
  const upstream = fakeUpstream((c: UpstreamCall) => rpcResponse(c.json.id, RESULTS[c.json.method]));
  const app = testApp(upstream);
  vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(app.request(new URL(input instanceof Request ? input.url : String(input)).pathname, init)),
  );
  return { rpc: createSolanaRpc(`${ORIGIN}/api/rpc`), upstream };
}

describe('kit RPC client through /api/rpc', () => {
  it('every allowed method passes as kit sends it', async () => {
    const { rpc, upstream } = kitClient();
    const address = key(9);
    const signature = getBase58Decoder().decode(new Uint8Array(64).fill(3)) as Signature;
    const unsigned = b64((await unsignedProtect()).bytes) as Base64EncodedWireTransaction;
    const signed = b64((await signedProtect()).bytes) as Base64EncodedWireTransaction;

    await rpc.getLatestBlockhash().send();
    await rpc.getAccountInfo(address, { encoding: 'base64' }).send();
    await rpc.getAccountInfo(address, { encoding: 'base64', dataSlice: { offset: 0, length: 0 }, minContextSlot: 5n }).send();
    await rpc.getMultipleAccounts([address], { encoding: 'base64' }).send();
    await rpc.getBalance(address).send();
    await rpc.getEpochInfo().send();
    await rpc.getMinimumBalanceForRentExemption(200n).send();
    await rpc.getSignatureStatuses([signature]).send();
    await rpc.getSignatureStatuses([signature], { searchTransactionHistory: false }).send();
    await rpc.simulateTransaction(unsigned, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true }).send();
    await rpc.sendTransaction(signed, { encoding: 'base64', skipPreflight: false, maxRetries: 0n }).send();

    expect(upstream.calls.map((c) => c.json.method)).toEqual([
      'getLatestBlockhash',
      'getAccountInfo',
      'getAccountInfo',
      'getMultipleAccounts',
      'getBalance',
      'getEpochInfo',
      'getMinimumBalanceForRentExemption',
      'getSignatureStatuses',
      'getSignatureStatuses',
      'simulateTransaction',
      'sendTransaction',
    ]);
    // kit injects its default commitment; the proxy keeps it.
    expect(upstream.calls[0]?.json.params).toEqual([{ commitment: 'confirmed' }]);
    expect(upstream.calls[10]?.json.params).toEqual([signed, { encoding: 'base64', skipPreflight: false, maxRetries: 0, preflightCommitment: 'confirmed' }]);
  });

  it('refusals reach kit as typed SolanaErrors (not a TypeError) that core can translate', async () => {
    const { rpc } = kitClient();
    const unsigned = b64((await unsignedProtect()).bytes) as Base64EncodedWireTransaction;
    const missing = await rpc.sendTransaction(unsigned, { encoding: 'base64' }).send().catch((error: unknown) => error);
    expect(isSolanaError(missing, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_TRANSACTION_SIGNATURE_VERIFICATION_FAILURE)).toBe(true);
    expect(missing).toMatchObject({ context: { check: 'signatures', code: 'missing-signatures' } });
    expect(translateError(missing).code).toBe('missing-signature');

    const corrupt = b64(corruptFirstSignature((await signedProtect()).bytes)) as Base64EncodedWireTransaction;
    const forged = await rpc.sendTransaction(corrupt, { encoding: 'base64' }).send().catch((error: unknown) => error);
    expect(isSolanaError(forged, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_TRANSACTION_SIGNATURE_VERIFICATION_FAILURE)).toBe(true);
    expect(translateError(forged).code).toBe('invalid-signature');

    const transfer = b64(await signedSystemTransfer()) as Base64EncodedWireTransaction;
    const refused = await rpc.simulateTransaction(transfer, { encoding: 'base64' }).send().catch((error: unknown) => error);
    expect(isSolanaError(refused, SOLANA_ERROR__JSON_RPC__INVALID_PARAMS)).toBe(true);
    expect(refused).toMatchObject({ context: { __serverMessage: 'Transaction rejected by inspector: unknown-instruction' } });
    expect(translateError(refused)).toMatchObject({
      code: 'rejected-by-inspector',
      title: 'Stakeward refused to send this transaction: it is not in the format Stakeward builds. Nothing was sent; start again.',
    });

    const method = await rpc.getBlockHeight().send().catch((error: unknown) => error);
    expect(isSolanaError(method, SOLANA_ERROR__JSON_RPC__METHOD_NOT_FOUND)).toBe(true);
  });
});
