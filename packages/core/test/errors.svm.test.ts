// translateError on real failures: LiteSVM with the mainnet stake program v5.1.0 (converted by
// getSolanaErrorFromLiteSvmFailure, as the product's LiteSvmChain will), errors kit throws while sending, and real
// fetch / abort / HTTP failures through a kit RPC client. Synthetic RPC and wallet shapes are in src/errors.test.ts.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { getSolanaErrorFromLiteSvmFailure } from '@solana/kit-plugin-litesvm';
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type SolanaError,
} from '@solana/kit';
import {
  getAuthorizeCheckedInstruction,
  getAuthorizeInstruction,
  getMergeInstruction,
  getSetLockupInstruction,
  getWithdrawInstruction,
  StakeAuthorize,
} from '@solana-program/stake';
import { getAdvanceNonceAccountInstruction } from '@solana-program/system';
import { FailedTransactionMetadata } from 'litesvm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildTransaction,
  deriveNonceAccountAddress,
  expectedFeePayer,
  NONCE_ACCOUNT_SEED,
  NONCE_ACCOUNT_SIZE,
  SYSVAR_CLOCK_ADDRESS,
  toLegacyLayout,
  translateError,
  type Lifetime,
  type StakeIx,
  type TransactionAction,
} from '../src/index.ts';
import { TestChain } from './svm.ts';

const DAY = 86_400n;

let chain: TestChain;
let A: KeyPairSigner; // main key
let K: KeyPairSigner; // second key
let D: KeyPairSigner; // new wallet, nonce authority
let X: KeyPairSigner; // thief

beforeEach(async () => {
  chain = await TestChain.create();
  [A, K, D, X] = await Promise.all([chain.fundedKey(), chain.fundedKey(), chain.fundedKey(), chain.fundedKey()]);
});

function build(action: TransactionAction, lifetime: Lifetime = chain.blockhashLifetime(), feePayer?: Address): Uint8Array {
  return buildTransaction(action, { feePayer: feePayer ?? expectedFeePayer(action), lifetime }).bytes;
}

/** A legacy message with exactly `instructions`, for instructions the product never builds. */
function message(instructions: Instruction[], feePayer: Address, lifetime = chain.blockhashLifetime()): Uint8Array {
  const compiled = compileTransaction(
    pipe(
      createTransactionMessage({ version: 'legacy' }),
      (m) => setTransactionMessageFeePayer(feePayer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
    ),
  );
  return new Uint8Array(getTransactionEncoder().encode(compiled));
}

/** Signs and sends without the harness's error mapping: the SolanaError the product's LiteSvmChain would see. */
async function failure(bytes: Uint8Array, signers: readonly KeyPairSigner[]): Promise<SolanaError> {
  const signed = await partiallySignTransaction(
    signers.map((s) => s.keyPair),
    getTransactionDecoder().decode(bytes),
  );
  const result = chain.svm.sendTransaction(signed);
  if (!(result instanceof FailedTransactionMetadata)) throw new Error('expected the transaction to fail');
  return getSolanaErrorFromLiteSvmFailure(result);
}

async function lockedAccount(days = 30n): Promise<{ stakeAccount: Address; lockUntil: bigint }> {
  const lockUntil = chain.clock().unixTimestamp + days * DAY;
  const stakeAccount = await chain.createStakeAccount({
    staker: A.address,
    withdrawer: A.address,
    lockup: { unixTimestamp: lockUntil, epoch: 0n, custodian: K.address },
  });
  return { stakeAccount, lockUntil };
}

async function nonceAccount(): Promise<Address> {
  const address = await deriveNonceAccountAddress(D.address);
  const setup = build({
    kind: 'nonce-setup',
    nonceAccount: address,
    nonceAuthority: D.address,
    seed: NONCE_ACCOUNT_SEED,
    lamports: chain.svm.minimumBalanceForRentExemption(BigInt(NONCE_ACCOUNT_SIZE)),
  });
  const result = await chain.send(setup, [D]);
  if (!result.ok) throw new Error(`nonce setup failed: ${JSON.stringify(result.error)}`);
  return address;
}

describe('stake program errors from LiteSVM', () => {
  it('LockupInForce: the main key alone withdraws from a locked account', async () => {
    const { stakeAccount, lockUntil } = await lockedAccount();
    const bytes = build({ kind: 'withdraw', stakeAccount, mainKey: A.address, secondKey: null, recipient: A.address, lamports: 1n });
    const error = await failure(bytes, [A]);
    expect(translateError(error, { transaction: bytes, lockUntil })).toMatchObject({
      code: 'lockup-in-force',
      title: 'Locked until 31 October 2026: your second key must co-sign.', // test chain starts 1 October 2026
    });
  });

  it('CustodianMissing: a new main key without the second key (stake error 7)', async () => {
    const { stakeAccount } = await lockedAccount();
    const bytes = message(
      [
        getAuthorizeCheckedInstruction({
          stake: stakeAccount,
          authority: createNoopSigner(A.address),
          newAuthority: createNoopSigner(X.address),
          stakeAuthorize: StakeAuthorize.Withdrawer,
        }),
      ],
      X.address,
    );
    const error = await failure(bytes, [A, X]);
    expect(translateError(error, { transaction: bytes }).code).toBe('custodian-missing');
    expect(translateError(error, {}).code).toBe('unknown'); // the program is not known without the transaction
  });

  it('custom code 7 from the System program is not CustodianMissing (NonceBlockhashNotExpired)', async () => {
    const nonce = await nonceAccount();
    // Advance the nonce under the blockhash it was just set from: the System program refuses with its error 7.
    const latest = { kind: 'blockhash' as const, blockhash: chain.svm.latestBlockhash(), lastValidBlockHeight: 0n };
    const bytes = message(
      [getAdvanceNonceAccountInstruction({ nonceAccount: nonce, nonceAuthority: createNoopSigner(D.address) })],
      D.address,
      latest,
    );
    const error = await failure(bytes, [D]);
    expect(error.context).toMatchObject({ code: 7, index: 0 });
    const result = translateError(error, { transaction: bytes });
    expect(result.code).toBe('unknown');
    expect(result.title).toMatch(/Wait a few seconds/);
  });

  it('MissingRequiredSignature: the main key tries to change a lock that is in force', async () => {
    const { stakeAccount, lockUntil } = await lockedAccount();
    const bytes = build({ kind: 'extend', stakeAccount, secondKey: A.address, lockUntil: lockUntil + DAY });
    expect(translateError(await failure(bytes, [A]), { transaction: bytes }).code).toBe('missing-signature');
  });

  it('MergeMismatch: merging an unlocked account into a locked one', async () => {
    const { stakeAccount } = await lockedAccount();
    const source = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address });
    const bytes = message(
      [getMergeInstruction({ destinationStake: stakeAccount, sourceStake: source, stakeAuthority: createNoopSigner(A.address) })],
      A.address,
    );
    expect(translateError(await failure(bytes, [A]), { transaction: bytes }).code).toBe('merge-mismatch');
  });

  it('InsufficientFunds: withdrawing more than the account holds', async () => {
    const stakeAccount = await chain.createStakeAccount({ staker: A.address, withdrawer: A.address });
    const lamports = chain.balance(stakeAccount) + 1n;
    const bytes = build({ kind: 'withdraw', stakeAccount, mainKey: A.address, secondKey: null, recipient: A.address, lamports });
    expect(translateError(await failure(bytes, [A]), { transaction: bytes })).toMatchObject({
      code: 'insufficient-funds',
      title: expect.stringMatching(/free SOL in this stake/) as unknown,
    });
  });

  it('a fee payer that never held SOL', async () => {
    const { stakeAccount } = await lockedAccount();
    const empty = await chain.fundedKey(0n);
    const bytes = build({ kind: 'extend', stakeAccount, secondKey: K.address, lockUntil: chain.clock().unixTimestamp + 90n * DAY }, undefined, empty.address);
    expect(translateError(await failure(bytes, [empty, K]), { transaction: bytes })).toMatchObject({
      code: 'insufficient-funds',
      title: expect.stringMatching(/paying the network fee/) as unknown,
    });
  });
});

// The SwissBorg vector (SECURITY-CHECK П7): a hidden, unchecked Authorize(Withdrawer -> X). Stakeward never builds it
// (the inspector refuses it), but a phishing site or a hacked staking API can; the lock must refuse it on the chain.
// Both account layouts: the generated one (no sysvar) and the legacy one with Clock at index 1, as older SDKs build it.
describe('an unchecked Authorize(Withdrawer) on a locked account', () => {
  const layouts: [string, (instruction: StakeIx) => StakeIx][] = [
    ['generated layout', (instruction) => instruction],
    ['legacy layout (Clock at index 1)', (instruction) => toLegacyLayout(instruction, { at: 1, sysvars: [SYSVAR_CLOCK_ADDRESS] })],
  ];

  it.each(layouts)('%s: signed by the main key alone -> CustodianMissing, nothing changes', async (_name, layout) => {
    const { stakeAccount } = await lockedAccount();
    const before = chain.stakeAccount(stakeAccount);
    const authorize = layout(
      getAuthorizeInstruction({
        stake: stakeAccount,
        authority: createNoopSigner(A.address),
        arg0: X.address,
        arg1: StakeAuthorize.Withdrawer,
      }),
    );
    const bytes = message([authorize], A.address);
    expect(translateError(await failure(bytes, [A]), { transaction: bytes }).code).toBe('custodian-missing');
    expect(chain.stakeAccount(stakeAccount)).toEqual(before);
  });

  it.each(layouts)('%s: with a wrong key signing as the lock key -> LockupInForce, nothing changes', async (_name, layout) => {
    const { stakeAccount } = await lockedAccount();
    const before = chain.stakeAccount(stakeAccount);
    const authorize = layout(
      getAuthorizeInstruction({
        stake: stakeAccount,
        authority: createNoopSigner(A.address),
        lockupAuthority: createNoopSigner(X.address),
        arg0: X.address,
        arg1: StakeAuthorize.Withdrawer,
      }),
    );
    const bytes = message([authorize], A.address);
    expect(translateError(await failure(bytes, [A, X]), { transaction: bytes }).code).toBe('lockup-in-force');
    expect(chain.stakeAccount(stakeAccount)).toEqual(before);
  });
});

// "The second key alone cannot take the stake" (SECURITY-CHECK П9, CLAUDE.md section 1): K is only the lock's key. It
// can move the lock, or hand it to another key, but withdrawing and changing the main key always need the main key.
describe('what the second key alone cannot do', () => {
  it('withdraw: the second key signing as both the withdraw key and the lock key -> MissingRequiredSignature', async () => {
    const { stakeAccount } = await lockedAccount();
    const balance = chain.balance(stakeAccount);
    const withdraw = getWithdrawInstruction({
      stake: stakeAccount,
      recipient: K.address,
      withdrawAuthority: createNoopSigner(K.address),
      lockupAuthority: createNoopSigner(K.address),
      args: 1n,
    });
    const bytes = message([withdraw], K.address);
    expect(translateError(await failure(bytes, [K]), { transaction: bytes }).code).toBe('missing-signature');
    expect(chain.balance(stakeAccount)).toBe(balance);
  });

  it('change the main key: AuthorizeChecked(Withdrawer -> X) signed by the second key and X -> MissingRequiredSignature', async () => {
    const { stakeAccount } = await lockedAccount();
    const before = chain.stakeAccount(stakeAccount);
    const authorize = getAuthorizeCheckedInstruction({
      stake: stakeAccount,
      authority: createNoopSigner(K.address),
      newAuthority: createNoopSigner(X.address),
      lockupAuthority: createNoopSigner(K.address),
      stakeAuthorize: StakeAuthorize.Withdrawer,
    });
    const bytes = message([authorize], K.address);
    expect(translateError(await failure(bytes, [K, X]), { transaction: bytes }).code).toBe('missing-signature');
    expect(chain.stakeAccount(stakeAccount)).toEqual(before);
  });

  it('after the second key hands the lock to X, a withdrawal signed by the main key and the old second key -> LockupInForce', async () => {
    const { stakeAccount, lockUntil } = await lockedAccount();
    // The second key alone may hand its lock to another key (a stolen second key does exactly this).
    const handOver = getSetLockupInstruction({
      stake: stakeAccount,
      authority: createNoopSigner(K.address),
      unixTimestamp: null,
      epoch: null,
      custodian: X.address,
    });
    expect((await chain.send(message([handOver], K.address), [K])).ok).toBe(true);
    expect(chain.stakeAccount(stakeAccount)?.lockup).toEqual({ unixTimestamp: lockUntil, epoch: 0n, custodian: X.address });

    const balance = chain.balance(stakeAccount);
    const bytes = build({ kind: 'withdraw', stakeAccount, mainKey: A.address, secondKey: K.address, recipient: A.address, lamports: 1n });
    expect(translateError(await failure(bytes, [A, K]), { transaction: bytes, lockUntil }).code).toBe('lockup-in-force');
    expect(chain.balance(stakeAccount)).toBe(balance);
    expect(chain.stakeAccount(stakeAccount)?.withdrawer).toBe(A.address);
  });
});

describe('lifetime errors from LiteSVM', () => {
  it('BlockhashNotFound on a blockhash transaction: expired', async () => {
    const { stakeAccount } = await lockedAccount();
    const bytes = build({ kind: 'extend', stakeAccount, secondKey: K.address, lockUntil: chain.clock().unixTimestamp + 90n * DAY });
    chain.svm.expireBlockhash();
    expect(translateError(await failure(bytes, [K]), { transaction: bytes }).code).toBe('blockhash-expired');
  });

  it('BlockhashNotFound on a nonce transaction whose nonce moved on: the link is dead', async () => {
    const { stakeAccount } = await lockedAccount();
    const nonce = await nonceAccount();
    const lifetime: Lifetime = {
      kind: 'nonce',
      nonceAccount: nonce,
      nonceAuthority: D.address,
      nonceValue: chain.nonceValue(nonce),
    };
    const extend = (days: bigint) =>
      build(
        { kind: 'extend', stakeAccount, secondKey: K.address, lockUntil: chain.clock().unixTimestamp + days * DAY },
        lifetime,
        D.address,
      );
    const first = extend(60n);
    const second = extend(90n); // signed by the same keys for the same nonce value, e.g. a second link
    expect((await chain.send(first, [D, K])).ok).toBe(true);

    chain.svm.expireBlockhash();
    const error = await failure(second, [D, K]);
    expect(translateError(error, { transaction: second }).code).toBe('nonce-advanced');
    expect(translateError(error, {}).code).toBe('blockhash-expired');
  });

  it('AlreadyProcessed: the same signed bytes twice', async () => {
    const { stakeAccount } = await lockedAccount();
    const bytes = build({ kind: 'extend', stakeAccount, secondKey: K.address, lockUntil: chain.clock().unixTimestamp + 90n * DAY });
    expect((await chain.send(bytes, [K])).ok).toBe(true);
    expect(translateError(await failure(bytes, [K]), { transaction: bytes }).code).toBe('already-processed');
  });

  it('a transaction sent without every signature: kit throws before sending', async () => {
    const { stakeAccount } = await lockedAccount();
    const bytes = build({ kind: 'withdraw', stakeAccount, mainKey: A.address, secondKey: K.address, recipient: A.address, lamports: 1n });
    const partial = await partiallySignTransaction([A.keyPair], getTransactionDecoder().decode(bytes));
    let thrown: unknown;
    try {
      chain.svm.sendTransaction(partial);
    } catch (error) {
      thrown = error;
    }
    expect(translateError(thrown, { transaction: bytes }).code).toBe('missing-signature');
  });
});

describe('network failures through fetch and a kit RPC client', () => {
  it('connection refused', async () => {
    const thrown: unknown = await createSolanaRpc('http://127.0.0.1:1')
      .getEpochInfo()
      .send()
      .catch((error: unknown) => error);
    expect(translateError(thrown).code).toBe('network');
  });

  it('abort and timeout', async () => {
    const aborted: unknown = AbortSignal.abort().reason;
    expect(translateError(aborted).code).toBe('network');
    const signal = AbortSignal.timeout(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(translateError(signal.reason).code).toBe('network');
  });

  it('HTTP 429 from the RPC proxy', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(429, { 'content-type': 'text/plain' }).end('Too Many Requests');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const thrown: unknown = await createSolanaRpc(`http://127.0.0.1:${String(port)}`)
        .getEpochInfo()
        .send()
        .catch((error: unknown) => error);
      const result = translateError(thrown);
      expect(result.code).toBe('rate-limited');
      expect(result.title).toBe('Too many requests. Wait a minute and try again.');
      expect(result.detail).toMatch(/429/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
