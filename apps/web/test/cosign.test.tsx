// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import {
  AccountRole,
  generateKeyPairSigner,
  getTransactionDecoder,
  getTransactionEncoder,
  partiallySignTransaction,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type Nonce,
} from '@solana/kit';
import {
  buildTransaction,
  cosignFragment,
  deriveNonceAccountAddress,
  encodeBase64Url,
  formatSol,
  inspectTransaction,
  NONCE_ACCOUNT_SEED,
  NONCE_ACCOUNT_SIZE,
  networkFeeFor,
  SYSTEM_PROGRAM_ADDRESS,
  type NonceLifetime,
  type TransactionAction,
} from '@stakeward/core';
import { craft, craftV0, instructionsOf, key, lighthouseInstruction } from '@stakeward/core/test/craft';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { createTestWalletPort, type TestWalletPort } from '@stakeward/core/test/test-wallet-port';
import { waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import { CountingChain } from './support/counting-chain.ts';
import { click, connectAndContinue, renderCosignPage, SCENARIO_TIMEOUT, summarySigners, WAIT } from './support/stake-pages.tsx';

// /cosign (step 7 spec 8, DECISIONS.md D69) end to end on the real stake program: the first device's partly signed
// transaction travels in the link's fragment; this page reads it with the inspector and the link-format rules, checks
// the chain, adds the last signature and sends it. Refusals never reach a wallet, a simulation or a send.

const DAY = 86_400n;
const T = START_UNIX_TIMESTAMP + 30n * DAY;

type World = {
  testChain: TestChain;
  lite: LiteSvmChain;
  chain: CountingChain;
  A: KeyPairSigner;
  K: KeyPairSigner;
  S: Address;
  nonceA: Address;
};

async function world(): Promise<World> {
  const testChain = await TestChain.create();
  const lite = new LiteSvmChain(testChain);
  const [A, K] = await Promise.all([testChain.fundedKey(), generateKeyPairSigner()]);
  const S = await testChain.createStakeAccount({
    staker: A.address,
    withdrawer: A.address,
    lockup: { unixTimestamp: T, epoch: 0n, custodian: K.address },
  });
  const nonceA = await createNonce(testChain, A);
  return { testChain, lite, chain: new CountingChain(lite), A, K, S, nonceA };
}

/** `owner`'s link-signing account, made outside the page (as the first device's NonceGate leaves it). */
async function createNonce(testChain: TestChain, owner: KeyPairSigner): Promise<Address> {
  const nonceAccount = await deriveNonceAccountAddress(owner.address);
  const lamports = testChain.svm.minimumBalanceForRentExemption(BigInt(NONCE_ACCOUNT_SIZE));
  const action: TransactionAction = { kind: 'nonce-setup', nonceAccount, nonceAuthority: owner.address, seed: NONCE_ACCOUNT_SEED, lamports };
  const { bytes } = buildTransaction(action, { feePayer: owner.address, lifetime: testChain.blockhashLifetime() });
  const result = await testChain.send(bytes, [owner]);
  if (!result.ok) throw new Error(`nonce setup failed: ${JSON.stringify(result.error)}`);
  return nonceAccount;
}

function nonceOf(testChain: TestChain, nonceAccount: Address, authority: Address): NonceLifetime {
  return { kind: 'nonce', nonceAccount, nonceAuthority: authority, nonceValue: testChain.nonceValue(nonceAccount) };
}

async function sign(bytes: Uint8Array, signers: readonly KeyPairSigner[]): Promise<Uint8Array> {
  if (signers.length === 0) return bytes;
  const signed = await partiallySignTransaction(
    signers.map((signer) => signer.keyPair),
    getTransactionDecoder().decode(bytes),
  );
  return new Uint8Array(getTransactionEncoder().encode(signed));
}

/** The first device's link: the whole balance of S to A on A's nonce, signed by A (the fee payer) only. */
async function withdrawLink(w: World): Promise<Uint8Array> {
  const lamports = w.testChain.account(w.S)?.lamports ?? 0n;
  const action: TransactionAction = {
    kind: 'withdraw',
    stakeAccount: w.S,
    mainKey: w.A.address,
    secondKey: w.K.address,
    recipient: w.A.address,
    lamports,
  };
  const { bytes } = buildTransaction(action, { feePayer: w.A.address, lifetime: nonceOf(w.testChain, w.nonceA, w.A.address) });
  return sign(bytes, [w.A]);
}

const fragmentOf = (bytes: Uint8Array) => `#${cosignFragment(bytes)}`;

/** Nothing reached a wallet, a simulation or a send. */
function nothingAsked(chain: CountingChain, wallets: readonly TestWalletPort[]) {
  expect(chain.count('simulate')).toBe(0);
  expect(chain.count('send')).toBe(0);
  for (const wallet of wallets) expect(wallet.requests).toHaveLength(0);
}

/** The inspector's summary on screen (one root per test here). */
const summaryShown = () =>
  waitFor(() => {
    const found = document.querySelector<HTMLElement>('[data-slot="signing-panel"] [data-slot="transaction-summary"]');
    expect(found).not.toBeNull();
    return found as HTMLElement;
  }, WAIT);

describe('/cosign: the second device completes a link (DW7-2)', () => {
  it(
    'C1: a withdraw on the main key\'s nonce, signed there by the main key: the second key reads it, ticks the box, signs and sends',
    async () => {
      const w = await world();
      const second = await createTestWalletPort({ name: 'Second Wallet', signers: [w.K] });
      const link = await withdrawLink(w);
      const lamports = w.testChain.account(w.S)?.lamports ?? 0n;
      const balanceBefore = w.testChain.balance(w.A.address);
      const { user, view } = renderCosignPage(w.chain, fragmentOf(link), [second]);

      // What the link asks, before anything else: the main key that receives, in full.
      const ask = await view.findByText(en.cosign.ask.withdraw, undefined, WAIT);
      expect(within(ask.closest('[data-slot="cosign-ask"]') as HTMLElement).getByText(w.A.address)).toBeInTheDocument();
      expect(view.getByText('Stakeward never asks for your seed phrase.')).toBeInTheDocument();

      // The key this link needs is asked for by its exact account.
      await connectAndContinue(user, 'Second key', 'Second Wallet', view);
      const summary = await summaryShown();
      expect(summary).toHaveAttribute('data-kind', 'withdraw');
      expect(summarySigners(summary)).toEqual(['main', 'second']);
      // From the bytes: the whole balance as read, to the main key in full. (A withdrawal's summary has no lock row;
      // the rescue on /cosign in rescue.test.tsx shows the lock as the chain has it now.)
      expect(within(summary).getByText(`${formatSol(lamports)} leaves the stake account`)).toBeInTheDocument();
      expect(within(summary).getAllByText(w.A.address).length).toBeGreaterThan(0);

      // The box gates the signature: pressing Sign first says so and asks no wallet.
      const signButton = await view.findByRole('button', { name: 'Sign in Second Wallet as Second key' }, WAIT);
      expect(signButton).toHaveAttribute('aria-disabled', 'true');
      await user.click(signButton);
      expect(await view.findByText('Tick the box above to continue.')).toBeInTheDocument();
      const box = view.getByRole('checkbox', { name: en.cosign.confirm.withdraw });
      expect(box).toHaveFocus();
      expect(second.requests).toHaveLength(0);
      await user.click(box);
      await user.click(view.getByRole('button', { name: 'Sign in Second Wallet as Second key' }));

      await view.findByRole('heading', { name: 'Signed and sent' }, WAIT);
      expect(w.testChain.account(w.S)).toBeNull();
      expect(w.testChain.balance(w.A.address)).toBe(balanceBefore + lamports - networkFeeFor(2));
      expect(second.requests).toHaveLength(1);
      expect(w.chain.count('send')).toBe(1);
    },
    SCENARIO_TIMEOUT,
  );
});

/** Inputs that are not a link Stakeward makes, and the screen /cosign shows for each (DW7-3). */
type BadCase = { name: string; fragment: () => Promise<string>; expected: () => Promise<string> };

describe('/cosign refuses what Stakeward never sends (DW7-3, C2)', () => {
  let testChain: TestChain;
  let lite: LiteSvmChain;
  let A: KeyPairSigner;
  let K: KeyPairSigner;
  let X: Address;
  let S: Address;
  let S2: Address;
  let nonceA: NonceLifetime;
  let nonceK: NonceLifetime;

  beforeAll(async () => {
    testChain = await TestChain.create();
    lite = new LiteSvmChain(testChain);
    [A, K] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    X = key(42);
    S = key(11);
    S2 = key(12);
    const value = 'BZFufDqppShyDDC1njm4fMpRbfnLwrpzzwG6WGgcmsxb' as Nonce;
    nonceA = { kind: 'nonce', nonceAccount: await deriveNonceAccountAddress(A.address), nonceAuthority: A.address, nonceValue: value };
    nonceK = { kind: 'nonce', nonceAccount: await deriveNonceAccountAddress(K.address), nonceAuthority: K.address, nonceValue: value };
  });

  const protect = (): TransactionAction => ({ kind: 'protect', stakeAccount: S, mainKey: A.address, secondKey: K.address, lockUntil: T });
  const built = (action: TransactionAction, feePayer: Address, lifetime: NonceLifetime | null) =>
    buildTransaction(action, { feePayer, lifetime: lifetime ?? testChain.blockhashLifetime() }).bytes;
  const fragment = async (bytes: Uint8Array, signers: readonly KeyPairSigner[] = []) => fragmentOf(await sign(bytes, signers));
  const rejected = (code: keyof typeof en.components.tx.rejected) => () => Promise.resolve(en.components.tx.rejected[code]);
  const problem = (name: keyof typeof en.cosign.problem) => () => Promise.resolve(en.cosign.problem[name]);
  const broken = () => Promise.resolve(en.cosign.bad.title);

  /** A System transfer from A, on A's nonce: the format's prefix, then an instruction Stakeward never builds. */
  function transfer(): Instruction {
    const data = new Uint8Array(12);
    const view = new DataView(data.buffer);
    view.setUint32(0, 2, true);
    view.setBigUint64(4, 1_000_000n, true);
    return {
      programAddress: SYSTEM_PROGRAM_ADDRESS,
      accounts: [
        { address: A.address, role: AccountRole.WRITABLE_SIGNER },
        { address: X, role: AccountRole.WRITABLE },
      ],
      data,
    };
  }
  /** The nonce prefix and budget of a built protect, without its stake instruction. */
  const prefix = () => instructionsOf(built(protect(), A.address, nonceA)).slice(0, 3);
  const protectInstruction = () => instructionsOf(built(protect(), A.address, nonceA)).at(-1) as Instruction;
  const deactivate = (stakeAccount: Address) =>
    instructionsOf(built({ kind: 'deactivate', stakeAccount, staker: A.address }, A.address, nonceA)).at(-1) as Instruction;

  const cases: BadCase[] = [
    { name: 'an empty fragment', fragment: () => Promise.resolve(''), expected: broken },
    { name: 'another parameter', fragment: () => Promise.resolve('#foo=x'), expected: broken },
    { name: 'not base64url', fragment: () => Promise.resolve('#tx=@@'), expected: broken },
    { name: 'no bytes', fragment: () => Promise.resolve('#tx='), expected: broken },
    {
      name: 'more bytes than a transaction can hold',
      fragment: () => Promise.resolve(`#tx=${encodeBase64Url(new Uint8Array(1233).fill(1))}`),
      expected: broken,
    },
    {
      name: 'a System transfer with the nonce prefix, signed by its payer',
      fragment: () => fragment(craft([...prefix(), transfer()], A.address, nonceA.nonceValue), [A]),
      expected: rejected('unknown-instruction'),
    },
    {
      name: 'an instruction of a foreign program',
      fragment: () =>
        fragment(
          craft([...prefix(), { programAddress: key(9), accounts: [{ address: S, role: AccountRole.WRITABLE }], data: Uint8Array.of(1) }], A.address, nonceA.nonceValue),
        ),
      expected: rejected('unknown-program'),
    },
    {
      name: 'a v0 message with an address lookup table',
      fragment: () =>
        fragment(craftV0([...prefix(), protectInstruction()], A.address, nonceA.nonceValue, { address: key(7), addresses: [S, nonceA.nonceAccount] })),
      expected: async () => {
        const bytes = craftV0([...prefix(), protectInstruction()], A.address, nonceA.nonceValue, {
          address: key(7),
          addresses: [S, nonceA.nonceAccount],
        });
        const inspected = await inspectTransaction(bytes);
        if (inspected.ok) throw new Error('the inspector accepted a lookup table');
        expect(['unsupported-version', 'address-lookup-table']).toContain(inspected.error.code);
        return en.components.tx.rejected[inspected.error.code];
      },
    },
    {
      name: 'two Deactivates over two stake accounts',
      fragment: () => fragment(craft([...prefix(), deactivate(S), deactivate(S2)], A.address, nonceA.nonceValue)),
      expected: rejected('multiple-stake-accounts'),
    },
    {
      name: 'a Lighthouse instruction before the stake instruction',
      fragment: () => fragment(craft([...prefix(), lighthouseInstruction(), protectInstruction()], A.address, nonceA.nonceValue)),
      expected: rejected('bad-lighthouse-tail'),
    },
    {
      name: 'a protect on a recent blockhash, signed by the main key',
      fragment: () => fragment(built(protect(), A.address, null), [A]),
      expected: problem('not-nonce'),
    },
    {
      name: "an unlock on the second key's nonce, signed by the second key",
      fragment: () => fragment(built({ kind: 'unlock', stakeAccount: S, secondKey: K.address }, K.address, nonceK), [K]),
      expected: problem('not-linkable-kind'),
    },
    {
      name: "a protect on the main key's nonce, not signed",
      fragment: () => fragment(built(protect(), A.address, nonceA)),
      expected: problem('fee-payer-unsigned'),
    },
    {
      name: "a protect paid by the second key on the main key's nonce",
      fragment: () => fragment(built(protect(), K.address, nonceA)),
      expected: problem('nonce-not-fee-payer'),
    },
    {
      name: "a protect paid by the second key on its own nonce, signed by it",
      fragment: () => fragment(built(protect(), K.address, nonceK), [K]),
      expected: problem('unexpected-fee-payer'),
    },
    {
      name: 'a withdraw to another wallet, signed by the main key',
      fragment: () =>
        fragment(
          built(
            { kind: 'withdraw', stakeAccount: S, mainKey: A.address, secondKey: K.address, recipient: X, lamports: 1_000_000_000n },
            A.address,
            nonceA,
          ),
          [A],
        ),
      expected: problem('foreign-recipient'),
    },
    {
      name: 'a protect signed by both keys, not sent',
      fragment: () => fragment(built(protect(), A.address, nonceA), [A, K]),
      expected: problem('nothing-to-sign'),
    },
  ];

  it.each(cases)('$name', async ({ fragment: make, expected }) => {
    const chain = new CountingChain(lite);
    const wallet = await createTestWalletPort({ name: 'Second Wallet', signers: [K], connected: true });
    const [link, text] = await Promise.all([make(), expected()]);
    const { view, unmount } = renderCosignPage(chain, link, [wallet]);
    try {
      await view.findByText(text, undefined, WAIT);
      // Refused before any chain read: no summary to sign, no signing panel, nothing asked.
      expect(view.queryByRole('button', { name: /^Sign in / })).not.toBeInTheDocument();
      expect(document.querySelector('[data-slot="signing-panel"]')).toBeNull();
      nothingAsked(chain, [wallet]);
      expect(chain.calls).toEqual([]);
    } finally {
      unmount();
    }
  });
});

describe('/cosign checks the chain before asking (C3)', () => {
  it(
    'link-used: another transaction moved the nonce on; nothing is simulated, sent or asked',
    async () => {
      const w = await world();
      const second = await createTestWalletPort({ name: 'Second Wallet', signers: [w.K], connected: true });
      const link = await withdrawLink(w);
      // Another transaction on the same nonce lands first: an unlocked account's withdrawal by the main key alone.
      const other = await w.testChain.createStakeAccount({ staker: w.A.address, withdrawer: w.A.address });
      const otherWithdraw: TransactionAction = {
        kind: 'withdraw',
        stakeAccount: other,
        mainKey: w.A.address,
        secondKey: null,
        recipient: w.A.address,
        lamports: w.testChain.account(other)?.lamports ?? 0n,
      };
      const { bytes } = buildTransaction(otherWithdraw, { feePayer: w.A.address, lifetime: nonceOf(w.testChain, w.nonceA, w.A.address) });
      await w.lite.send(await sign(bytes, [w.A]));
      expect(w.testChain.account(other)).toBeNull();

      const { view } = renderCosignPage(w.chain, fragmentOf(link), [second]);
      await view.findByText(en.cosign.refused['link-used'], undefined, WAIT);
      expect(view.getByText(en.cosign.newLink)).toBeInTheDocument();
      nothingAsked(w.chain, [second]);
      expect(w.testChain.stakeAccount(w.S)?.lockup.custodian).toBe(w.K.address);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'stale: a rescue ran first, so the main key no longer withdraws',
    async () => {
      const w = await world();
      const second = await createTestWalletPort({ name: 'Second Wallet', signers: [w.K], connected: true });
      const link = await withdrawLink(w);
      const D = await w.testChain.fundedKey();
      const nonceD = await createNonce(w.testChain, D);
      const rescue: TransactionAction = { kind: 'rescue', stakeAccount: w.S, mainKey: w.A.address, secondKey: w.K.address, newWallet: D.address };
      const { bytes } = buildTransaction(rescue, { feePayer: D.address, lifetime: nonceOf(w.testChain, nonceD, D.address) });
      await w.lite.send(await sign(bytes, [D, w.A, w.K]));
      expect(w.testChain.stakeAccount(w.S)?.withdrawer).toBe(D.address);

      const { view } = renderCosignPage(w.chain, fragmentOf(link), [second]);
      await view.findByText(en.cosign.refused.stale, undefined, WAIT);
      nothingAsked(w.chain, [second]);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'already done: the link landed before this page opened it',
    async () => {
      const w = await world();
      const second = await createTestWalletPort({ name: 'Second Wallet', signers: [w.K], connected: true });
      const link = await withdrawLink(w);
      await w.lite.send(await sign(link, [w.K]));
      expect(w.testChain.account(w.S)).toBeNull();

      const { view } = renderCosignPage(w.chain, fragmentOf(link), [second]);
      await view.findByRole('heading', { name: en.cosign.already.title }, WAIT);
      expect(view.getByText(en.cosign.already.body)).toBeInTheDocument();
      nothingAsked(w.chain, [second]);
    },
    SCENARIO_TIMEOUT,
  );
});

describe('/cosign and a wallet that changes signed bytes (C4)', () => {
  it(
    'a Lighthouse tail added after the main key signed stops the round with the hint; nothing changes on chain',
    async () => {
      const w = await world();
      const second = await createTestWalletPort({ name: 'Second Wallet', signers: [w.K] });
      const link = await withdrawLink(w);
      const nonceBefore = w.testChain.nonceValue(w.nonceA);
      const { user, view } = renderCosignPage(w.chain, fragmentOf(link), [second]);

      await connectAndContinue(user, 'Second key', 'Second Wallet', view);
      await user.click(await view.findByRole('checkbox', { name: en.cosign.confirm.withdraw }, WAIT));
      second.once({ lighthouseTail: true });
      await click(user, 'Sign in Second Wallet as Second key', view);

      await view.findByText(en.cosign.tailHint, undefined, WAIT);
      expect(document.querySelector('[data-phase="stopped"]')).not.toBeNull();
      // The bytes arrived signed: starting with this wallet first cannot help, so it is not offered.
      expect(view.queryByRole('button', { name: /signing first/ })).not.toBeInTheDocument();
      expect(second.requests).toHaveLength(1);
      expect(w.chain.count('send')).toBe(0);
      expect(w.testChain.stakeAccount(w.S)?.lockup.custodian).toBe(w.K.address);
      expect(w.testChain.nonceValue(w.nonceA)).toBe(nonceBefore);
    },
    SCENARIO_TIMEOUT,
  );
});
