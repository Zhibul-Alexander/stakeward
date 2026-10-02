// translateError on the shapes RPC, kit and wallets produce, built with kit's own converters where they exist.
// Real errors from LiteSVM, fetch and a kit RPC client are in test/errors.svm.test.ts.
import {
  assertIsFullySignedTransaction,
  blockhash,
  getAddressDecoder,
  getSolanaErrorFromInstructionError,
  getSolanaErrorFromJsonRpcError,
  getSolanaErrorFromTransactionError,
  getTransactionDecoder,
  SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED,
  SOLANA_ERROR__INVALID_NONCE,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  SolanaError,
  type Address,
  type Nonce,
} from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { expectedFeePayer, type BlockhashLifetime, type NonceLifetime, type TransactionAction } from './actions.ts';
import { buildTransaction } from './builders.ts';
import {
  ERROR_CODES,
  INSPECTOR_REFUSAL_PREFIX,
  SIGNATURE_REFUSAL_PREFIX,
  translateError,
  type ErrorCode,
} from './errors.ts';

const key = (n: number): Address => getAddressDecoder().decode(new Uint8Array(32).fill(n));
const STAKE = key(1);
const A = key(2);
const K = key(3);
const D = key(4);
const NONCE_ACCOUNT = key(5);
/** 2027-04-12T00:00:00Z */
const T = 1_807_488_000n;

const blockhashLifetime: BlockhashLifetime = {
  kind: 'blockhash',
  blockhash: blockhash('9Kd6GKoyBdH1LD2Nz2tBVmXcmzN6bKMaV3RqY6kGKiGa'),
  lastValidBlockHeight: 100n,
};
const nonceLifetime: NonceLifetime = {
  kind: 'nonce',
  nonceAccount: NONCE_ACCOUNT,
  nonceAuthority: D,
  nonceValue: '9Kd6GKoyBdH1LD2Nz2tBVmXcmzN6bKMaV3RqY6kGKiGa' as Nonce,
};

function build(action: TransactionAction, lifetime: BlockhashLifetime | NonceLifetime = blockhashLifetime): Uint8Array {
  return buildTransaction(action, { feePayer: expectedFeePayer(action), lifetime }).bytes;
}

// Instruction indexes: [CU limit, CU price, stake...] on a blockhash; [AdvanceNonce, CU limit, CU price, stake...] on a nonce.
const withdraw = build({ kind: 'withdraw', stakeAccount: STAKE, mainKey: A, secondKey: null, recipient: A, lamports: 1n });
const rescue = build({ kind: 'rescue', stakeAccount: STAKE, mainKey: A, secondKey: K, newWallet: D });
const rescueOnNonce = build({ kind: 'rescue', stakeAccount: STAKE, mainKey: A, secondKey: K, newWallet: D }, nonceLifetime);
const nonceSetup = build({ kind: 'nonce-setup', nonceAccount: NONCE_ACCOUNT, nonceAuthority: D, seed: 'stakeward-nonce', lamports: 1_056_640n });

/** The `err` of getSignatureStatuses / simulateTransaction after kit's RPC layer: numbers are bigint. */
const custom = (index: bigint, code: bigint) => ({ InstructionError: [index, { Custom: code }] });

function code(error: unknown, transaction?: Uint8Array): ErrorCode {
  return translateError(error, transaction === undefined ? {} : { transaction }).code;
}

describe('stake program errors (custom codes, attributed through the transaction)', () => {
  it('LockupInForce names the lock end in UTC', () => {
    expect(translateError(custom(2n, 1n), { transaction: withdraw, lockUntil: T })).toEqual({
      code: 'lockup-in-force',
      title: 'Locked until 12 April 2027: your second key must co-sign.',
      detail: '{"InstructionError":["2",{"Custom":"1"}]}',
    });
  });

  it('LockupInForce without a known lock end', () => {
    expect(translateError(custom(2n, 1n), { transaction: withdraw }).title).toBe(
      'This stake is locked: your second key must co-sign.',
    );
    expect(translateError(custom(2n, 1n), { transaction: withdraw, lockUntil: 0n }).title).toBe(
      'This stake is locked: your second key must co-sign.',
    );
  });

  it.each([
    [7n, 'custodian-missing'],
    [8n, 'custodian-signature-missing'],
    [6n, 'merge-mismatch'],
    [2n, 'already-deactivated'],
    [3n, 'too-soon-to-redelegate'],
    [12n, 'insufficient-delegation'],
    [9n, 'unknown'],
  ] as const)('stake error %s -> %s', (stakeCode, expected) => {
    expect(code(custom(3n, stakeCode), rescue)).toBe(expected);
  });

  it('the same code from the System program is not a stake error (7 = NonceBlockhashNotExpired)', () => {
    expect(code(custom(4n, 7n), rescueOnNonce)).toBe('custodian-missing'); // stake instruction at index 4
    const system = translateError(custom(0n, 7n), { transaction: rescueOnNonce }); // AdvanceNonceAccount
    expect(system.code).toBe('unknown');
    expect(system.title).toMatch(/Wait a few seconds/);
  });

  it('System errors: not enough SOL to create the nonce account, nonce value moved on', () => {
    expect(translateError(custom(2n, 1n), { transaction: nonceSetup })).toMatchObject({
      code: 'insufficient-funds',
      title: expect.stringMatching(/paying the network fee/) as unknown,
    });
    expect(code(custom(0n, 8n), rescueOnNonce)).toBe('nonce-advanced');
  });

  it('a custom code is never guessed without the transaction or for another program', () => {
    expect(code(custom(2n, 1n))).toBe('unknown');
    expect(code(custom(1n, 1n), withdraw)).toBe('unknown'); // Compute Budget
    expect(code(custom(9n, 1n), withdraw)).toBe('unknown'); // no such instruction
    expect(code(custom(2n, 1n), new Uint8Array([1, 2, 3]))).toBe('unknown'); // not a transaction
  });

  it('accepts the SolanaError kit makes from the same error', () => {
    expect(code(getSolanaErrorFromInstructionError(2, { Custom: 1 }), withdraw)).toBe('lockup-in-force');
    expect(code(getSolanaErrorFromTransactionError(custom(3n, 7n)), rescue)).toBe('custodian-missing');
  });
});

describe('RPC preflight failure (-32002)', () => {
  const preflight = getSolanaErrorFromJsonRpcError({
    code: -32002n,
    message: 'Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1',
    data: {
      accounts: null,
      err: custom(2n, 1n),
      logs: [
        'Program Stake11111111111111111111111111111111111111 invoke [1]',
        'Program log: ERROR: Custom program error: 0x1',
        'Program Stake11111111111111111111111111111111111111 failed: custom program error: 0x1',
      ],
      unitsConsumed: 6_640n,
    },
  });

  it('is translated through its cause, with the logs in the details', () => {
    const result = translateError(preflight, { transaction: withdraw, lockUntil: T });
    expect(result.code).toBe('lockup-in-force');
    expect(result.detail).toContain('Program log: ERROR: Custom program error: 0x1');
    expect(result.detail).toMatch(/Caused by SolanaError/);
  });

  it('BlockhashNotFound in preflight', () => {
    const error = getSolanaErrorFromJsonRpcError({ code: -32002, message: 'x', data: { err: 'BlockhashNotFound', logs: [] } });
    expect(code(error, withdraw)).toBe('blockhash-expired');
    expect(code(error, rescueOnNonce)).toBe('nonce-advanced');
  });
});

describe('runtime errors', () => {
  it.each([
    ['BlockhashNotFound on a blockhash transaction', 'BlockhashNotFound', withdraw, 'blockhash-expired'],
    ['BlockhashNotFound on a nonce transaction', 'BlockhashNotFound', rescueOnNonce, 'nonce-advanced'],
    ['BlockhashNotFound without the transaction', 'BlockhashNotFound', undefined, 'blockhash-expired'],
    ['AlreadyProcessed', 'AlreadyProcessed', withdraw, 'already-processed'],
    ['InsufficientFundsForFee', 'InsufficientFundsForFee', withdraw, 'insufficient-funds'],
    ['AccountNotFound (fee payer never funded)', 'AccountNotFound', withdraw, 'insufficient-funds'],
    ['InsufficientFundsForRent', { InsufficientFundsForRent: { account_index: 0n } }, withdraw, 'insufficient-funds'],
    ['MissingRequiredSignature', { InstructionError: [2n, 'MissingRequiredSignature'] }, withdraw, 'missing-signature'],
    ['InsufficientFunds (stake not free yet)', { InstructionError: [2n, 'InsufficientFunds'] }, withdraw, 'insufficient-funds'],
    ['an instruction error kit does not know', { InstructionError: [2n, 'SomethingNew'] }, withdraw, 'unknown'],
  ] as const)('%s', (_name, error, transaction, expected) => {
    expect(code(error, transaction)).toBe(expected);
  });

  it('separates a stake balance problem from an empty fee payer', () => {
    expect(translateError({ InstructionError: [2n, 'InsufficientFunds'] }).title).toMatch(/free SOL in this stake/);
    expect(translateError('InsufficientFundsForFee').title).toMatch(/paying the network fee/);
  });

  it('kit errors from building, signing and confirming', () => {
    let missing: unknown;
    try {
      assertIsFullySignedTransaction(getTransactionDecoder().decode(withdraw));
    } catch (error) {
      missing = error;
    }
    expect(code(missing)).toBe('missing-signature');
    expect(code(new SolanaError(SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED, { currentBlockHeight: 10n, lastValidBlockHeight: 5n }))).toBe(
      'blockhash-expired',
    );
    expect(code(new SolanaError(SOLANA_ERROR__INVALID_NONCE, { actualNonceValue: 'a', expectedNonceValue: 'b' }))).toBe(
      'nonce-advanced',
    );
  });

  it('RPC node trouble reads as a network problem', () => {
    expect(code(getSolanaErrorFromJsonRpcError({ code: -32005, message: 'Node is unhealthy', data: {} }))).toBe('network');
    expect(code(getSolanaErrorFromJsonRpcError({ code: -32603, message: 'Internal error' }))).toBe('network');
    expect(code(getSolanaErrorFromJsonRpcError({ code: -32602, message: 'Invalid params' }))).toBe('unknown');
  });
});

// The worker's refusals on POST /api/rpc (apps/worker/src/rpc.ts) as the site's transport throws them: kit's
// getSolanaErrorFromJsonRpcError over the JSON-RPC error body, or kit's HTTP error for a non-2xx status.
describe('refusals of the worker', () => {
  const rpcError = (code: number, message: string, data?: object) =>
    getSolanaErrorFromJsonRpcError(data === undefined ? { code, message } : { code, message, data });
  const httpError = (statusCode: number) =>
    new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, { headers: undefined as never, message: '', statusCode });

  it('the inspector refusing the bytes (-32602 with the inspector code in the message)', () => {
    for (const inspectorCode of ['unknown-program', 'bad-layout', 'malformed', 'bad-lighthouse-tail']) {
      const error = rpcError(-32602, `${INSPECTOR_REFUSAL_PREFIX}${inspectorCode}`, {
        check: 'inspector',
        code: inspectorCode,
        message: 'details',
      });
      expect(translateError(error)).toMatchObject({
        code: 'rejected-by-inspector',
        title: 'Stakeward refused to send this transaction: it is not in the format Stakeward builds. Nothing was sent; start again.',
      });
      expect(translateError(error).detail).toContain(inspectorCode);
    }
    // Other invalid parameters are not the inspector.
    expect(code(rpcError(-32602, 'params[0]: Expected canonical base64'))).toBe('unknown');
  });

  it('signature refusals (-32003): a bad signature, or one missing before sending', () => {
    const inspector = rpcError(-32003, `${INSPECTOR_REFUSAL_PREFIX}invalid-signature`, {
      check: 'inspector',
      code: 'invalid-signature',
      message: 'The signature of X does not match the message',
    });
    expect(translateError(inspector)).toMatchObject({
      code: 'invalid-signature',
      title: 'A signature does not match this transaction. Start signing again from the first wallet.',
    });
    const signatures = (signatureCode: string) =>
      rpcError(-32003, `${SIGNATURE_REFUSAL_PREFIX}${signatureCode}`, {
        check: 'signatures',
        code: signatureCode,
        signers: [K],
        message: 'details',
      });
    expect(code(signatures('missing-signatures'))).toBe('missing-signature');
    expect(code(signatures('invalid-signatures'))).toBe('invalid-signature');
    expect(code(signatures('malformed'))).toBe('rejected-by-inspector');
    expect(code(signatures('verification-unavailable'))).toBe('unknown');
    // A node's own -32003 (no data) and the runtime's SignatureFailure.
    expect(code(rpcError(-32003, 'Transaction signature verification failure'))).toBe('invalid-signature');
    expect(code('SignatureFailure')).toBe('invalid-signature');
  });

  it('HTTP 429 is a rate limit; 408 and 5xx (the worker could not reach the RPC) are the network', () => {
    expect(translateError(httpError(429))).toMatchObject({
      code: 'rate-limited',
      title: 'Too many requests. Wait a minute and try again.',
    });
    for (const status of [408, 500, 502, 503, 504]) expect(code(httpError(status)), String(status)).toBe('network');
    for (const status of [400, 403, 404, 413, 415]) expect(code(httpError(status)), String(status)).toBe('unknown');
  });

  it('-32005 in a body stays a node problem: the 429 of the worker is read from the HTTP status', () => {
    // The worker answers 429 with -32005 in the body; the site's transport throws the HTTP error, not the body.
    expect(code(rpcError(-32005, 'Too many requests', {}))).toBe('network');
  });
});

describe('ERROR_CODES', () => {
  it('lists every code once, and translateError never returns another', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    const samples: unknown[] = [
      'BlockhashNotFound',
      'SignatureFailure',
      new TypeError('Failed to fetch'),
      { code: 4001 },
      new Error('x'),
      null,
    ];
    for (const sample of samples) expect(ERROR_CODES).toContain(code(sample));
  });
});

describe('wallet rejections', () => {
  const walletAdapterError = Object.assign(new Error('User rejected the request.'), { name: 'WalletSignTransactionError' });
  it.each([
    ['Phantom / EIP-1193 code 4001', { code: 4001, message: 'User rejected the request.' }],
    ['an Error with code 4001', Object.assign(new Error('Something'), { code: 4001 })],
    ['WalletSignTransactionError', walletAdapterError],
    ['a wrapper whose inner error has 4001', Object.assign(new Error('Unexpected error'), { error: { code: 4001 } })],
    ['a cause with 4001', new Error('Signing failed', { cause: { code: 4001, message: 'x' } })],
    ['message: declined', new Error('User declined the transaction')],
    ['message: cancelled', new Error('Request cancelled by user')],
    ['message: denied', new Error('Approval Denied')],
    ['a plain string', 'User rejected'],
  ])('%s', (_name, error) => {
    expect(translateError(error)).toMatchObject({
      code: 'wallet-rejected',
      title: 'The request was declined in the wallet. Nothing was sent; you can try again.',
    });
  });

  it('another numeric wallet code is not a user rejection (Phantom -32003 "Transaction rejected")', () => {
    expect(code({ code: -32003, message: 'Transaction rejected' })).toBe('unknown');
  });
});

describe('network failures', () => {
  it.each([
    ['Node / undici', new TypeError('fetch failed')],
    ['Chrome', new TypeError('Failed to fetch')],
    ['Firefox', new TypeError('NetworkError when attempting to fetch resource.')],
    ['Safari', new TypeError('Load failed')],
    ['abort', Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })],
    ['timeout', Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' })],
  ])('%s', (_name, error) => {
    expect(code(error)).toBe('network');
  });

  it('an unrelated TypeError is not a network failure', () => {
    expect(code(new TypeError('x is not a function'))).toBe('unknown');
  });
});

describe('never throws', () => {
  const circular: Record<string, unknown> = { a: 1 };
  circular['self'] = circular;
  const hostile = new Proxy(
    {},
    {
      get() {
        throw new Error('boom');
      },
      has() {
        throw new Error('boom');
      },
      ownKeys() {
        throw new Error('boom');
      },
      getPrototypeOf() {
        throw new Error('boom');
      },
    },
  );
  const looping = new Error('outer');
  (looping as { cause?: unknown }).cause = looping;

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 42],
    ['a symbol', Symbol('s')],
    ['an object without prototype', Object.create(null) as unknown],
    ['a circular object', circular],
    ['a hostile proxy', hostile],
    ['an error that is its own cause', looping],
    ['a malformed InstructionError', { InstructionError: 'garbage' }],
    ['a malformed rent error', { InsufficientFundsForRent: null }],
    ['an unknown string', 'something odd happened'],
  ])('%s -> unknown with a text detail', (_name, error) => {
    const result = translateError(error, { transaction: new Uint8Array([0xff]) });
    expect(result.code).toBe('unknown');
    expect(result.title).toBe('Something went wrong. Refresh to see the current state, then try again.');
    expect(typeof result.detail).toBe('string');
  });

  it('keeps the original text and its causes for Details', () => {
    const error = new Error('Signing failed', { cause: new TypeError('fetch failed') });
    const result = translateError(error);
    expect(result.code).toBe('network');
    expect(result.detail).toBe('Error: Signing failed\nCaused by TypeError: fetch failed');
  });
});
