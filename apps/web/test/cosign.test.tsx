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
  type SignatureBytes,
} from '@solana/kit';
import {
  buildTransaction,
  cosignFragment,
  deriveNonceAccountAddress,
  encodeBase64Url,
  formatSol,
  formatUtcDate,
  inspectTransaction,
  NONCE_ACCOUNT_SEED,
  NONCE_ACCOUNT_SIZE,
  networkFeeFor,
  SYSTEM_PROGRAM_ADDRESS,
  type NonceLifetime,
  type TransactionAction,
} from '@stakeward/core';
import { craft, craftV0, editMessage, instructionsOf, key, lighthouseInstruction } from '@stakeward/core/test/craft';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { createTestWalletPort, type TestWalletPort } from '@stakeward/core/test/test-wallet-port';
import { waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
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

      // What the link asks, before anything else: who sent it, the amount, and the main key that receives, in full,
      // in a warning callout (a normal withdrawal is not red: red is kept for "Do not sign").
      const title = `Approve a withdrawal of ${formatSol(lamports)} to the Main key`;
      const ask = (await view.findByText(title, undefined, WAIT)).closest<HTMLElement>('[data-slot="cosign-ask"]') as HTMLElement;
      expect(ask).toHaveAttribute('data-kind', 'withdraw');
      expect(within(ask).getByRole('heading', { level: 2, name: en.components.tx.kind.withdraw })).toBeInTheDocument();
      expect(ask).toHaveTextContent('From: Main key');
      const check = ask.querySelector<HTMLElement>('[data-slot="cosign-check"]') as HTMLElement;
      expect(check).toHaveAttribute('data-tone', 'warning');
      expect(within(check).getByText(w.A.address)).toBeInTheDocument();
      // The second key is often the owner's own, on another device, in another browser or in the wallet app's own
      // browser: the owner who started the withdrawal can say so truthfully. The warning about a thief's link stays first.
      expect(check).toHaveTextContent(
        'Check before you signA thief with the Main key would send exactly this request.Sign only if you started it, or the owner confirmed it by voice or in person.',
      );
      expect(document.querySelector('[data-slot="stop-panel"]')).toBeNull();

      // The key this link needs is asked for by its exact account.
      await connectAndContinue(user, 'Second key', 'Second Wallet', view);
      const summary = await summaryShown();
      expect(summary).toHaveAttribute('data-kind', 'withdraw');
      expect(summarySigners(summary)).toEqual(['main', 'second']);
      // The seed phrase line once, in the summary's guarantees (not again in the page header); no intro line under
      // the summary's title (the request above says what it is); no signing order for the one signer left (the
      // summary's "Who signs" names it).
      expect(view.getAllByText('Stakeward never asks for your seed phrase.')).toHaveLength(1);
      expect(within(summary).getByText('Stakeward never asks for your seed phrase.')).toBeInTheDocument();
      expect(within(summary).queryByText(en.components.tx.intro)).not.toBeInTheDocument();
      expect(view.queryByRole('list', { name: 'Signatures' })).not.toBeInTheDocument();
      // From the bytes: the whole balance as read, to the main key in full. (A withdrawal's summary has no lock row;
      // the rescue on /cosign in rescue.test.tsx shows the lock as the chain has it now.)
      expect(within(summary).getByText(`${formatSol(lamports)} leaves the stake account`)).toBeInTheDocument();
      expect(within(summary).getAllByText(w.A.address).length).toBeGreaterThan(0);

      // The box gates the signature: pressing Sign first says so and asks no wallet.
      const signButton = await view.findByRole('button', { name: 'Sign in Second Wallet as Second key' }, WAIT);
      expect(signButton).toHaveAttribute('aria-disabled', 'true');
      await user.click(signButton);
      expect(await view.findByText('Tick the box above to continue.')).toBeInTheDocument();
      const box = view.getByRole('checkbox', {
        name: 'I started this withdrawal, or the owner confirmed it by voice or in person',
      });
      // Right above the button: links may be old. A withdrawal carries no freeze risk: the request says what to check.
      expect(view.getByText(en.cosign.stale)).toBeInTheDocument();
      expect(document.querySelector('[data-risk]')).toBeNull();
      expect(box).toHaveFocus();
      expect(second.requests).toHaveLength(0);
      await user.click(box);
      await user.click(view.getByRole('button', { name: 'Sign in Second Wallet as Second key' }));

      await view.findByRole('heading', { name: 'Signed and sent' }, WAIT);
      // Done: no filled button, one way back.
      expect(view.getByRole('link', { name: en.common.backHome })).toHaveAttribute('data-variant', 'ghost');
      expect(document.querySelectorAll('[data-slot="button"][data-variant="primary"]')).toHaveLength(0);
      expect(w.testChain.account(w.S)).toBeNull();
      expect(w.testChain.balance(w.A.address)).toBe(balanceBefore + lamports - networkFeeFor(2));
      expect(second.requests).toHaveLength(1);
      expect(w.chain.count('send')).toBe(1);
    },
    SCENARIO_TIMEOUT,
  );
});

describe('/cosign: what a protect link asks of the second key (UX rule 6)', () => {
  it(
    'names the lock end, what the owner then needs from this wallet and that it cannot take their SOL, before anything is asked; the freeze risk stands right above Sign',
    async () => {
      const w = await world();
      const second = await createTestWalletPort({ name: 'Second Wallet', signers: [w.K] });
      const open = await w.testChain.createStakeAccount({ staker: w.A.address, withdrawer: w.A.address });
      const action: TransactionAction = { kind: 'protect', stakeAccount: open, mainKey: w.A.address, secondKey: w.K.address, lockUntil: T };
      const { bytes } = buildTransaction(action, { feePayer: w.A.address, lifetime: nonceOf(w.testChain, w.nonceA, w.A.address) });
      const { user, view } = renderCosignPage(w.chain, fragmentOf(await sign(bytes, [w.A])), [second]);

      const date = formatUtcDate(T) ?? '';
      const ask = await waitFor(() => {
        const found = document.querySelector<HTMLElement>('[data-slot="cosign-ask"][data-kind="protect"]');
        expect(found).not.toBeNull();
        return found as HTMLElement;
      }, WAIT);
      // The page's lead says who asks; the request names the sender, the ask with its date and three short lines.
      expect(view.getByText(en.cosign.intro)).toBeInTheDocument();
      expect(ask).toHaveTextContent('From: Main key');
      expect(ask).toHaveTextContent(
        `Become the Second key for this stake until ${date}Until then, the owner needs your signature to withdraw or move this stake.If you lose this wallet, the owner waits until ${date}.Your wallet cannot take their SOL.`,
      );
      expect(second.requests).toHaveLength(0);
      // Once the chain is read, the request says how much the stake account holds.
      const lamports = w.testChain.account(open)?.lamports ?? 0n;
      await within(ask).findByText(`This stake account holds ${formatSol(lamports)}.`, undefined, WAIT);

      // The wallet is connected from the request's own slot, the step's one filled button; then Sign, with the
      // freeze risk and the old-link note directly above it.
      const slot = await view.findByRole('group', { name: 'Second key' }, WAIT);
      expect(within(slot).getByRole('button', { name: 'Connect a wallet as Second key' })).toHaveAttribute('data-variant', 'primary');
      await connectAndContinue(user, 'Second key', 'Second Wallet', view);
      const signButton = await view.findByRole('button', { name: 'Sign in Second Wallet as Second key' }, WAIT);
      const risk = document.querySelector('[data-risk="second-key-can-freeze"]') as HTMLElement;
      expect(risk).toHaveAttribute('data-variant', 'inline');
      const stale = view.getByText(en.cosign.stale);
      expect(risk.compareDocumentPosition(stale) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(stale.compareDocumentPosition(signButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const summary = await summaryShown();
      expect(summary.compareDocumentPosition(risk) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(document.querySelectorAll('[data-slot="button"][data-variant="primary"]')).toHaveLength(1);
      expect(second.requests).toHaveLength(0);
    },
    SCENARIO_TIMEOUT,
  );
});

/**
 * Inputs that are not a link Stakeward makes, and the screen /cosign shows for each (DW7-3). `detail`: the inspector's
 * own words, under Details of a "Do not sign" screen (UX rule 8).
 */
type BadCase = { name: string; fragment: () => Promise<string>; expected: () => Promise<string>; detail?: string };

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
  const problem = (name: keyof typeof en.cosign.problem, amount?: bigint) => () =>
    Promise.resolve(amount === undefined ? en.cosign.problem[name] : en.cosign.problem[name].replace('{amount}', formatSol(amount)));
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
    // A real link cut off by a messenger or a copy: the bytes that are left are no whole transaction. The page says the
    // link is broken and asks for the whole link; it never calls the owner's own link hostile.
    ...(
      [
        ['all but its last byte', (length: number) => length - 1],
        ['half of it', (length: number) => Math.floor(length / 2)],
        ['its first 10 bytes', () => 10],
      ] as const
    ).map(([left, keep]) => ({
      name: `a link cut off to ${left}`,
      fragment: async () => {
        const bytes = await sign(built(protect(), A.address, nonceA), [A]);
        return fragmentOf(bytes.slice(0, keep(bytes.length)));
      },
      expected: broken,
    })),
    // Altered bytes that still read as a whole transaction were made, not cut: "do not sign", never "broken".
    {
      name: 'a protect whose stake instruction has one byte more data, signed by the main key',
      fragment: async () => {
        const instructions = instructionsOf(built(protect(), A.address, nonceA));
        const tampered = instructions.map((ix, i) =>
          i === instructions.length - 1 ? { ...ix, data: Uint8Array.from([...(ix.data ?? []), 0]) } : ix,
        );
        return fragment(craft(tampered, A.address, nonceA.nonceValue), [A]);
      },
      expected: rejected('malformed'),
      detail: 'Instruction 4: instruction data is not canonically encoded',
    },
    {
      name: 'a protect signed by the main key, with one signature slot fewer than its signers',
      fragment: async () => {
        const { messageBytes } = getTransactionDecoder().decode(await sign(built(protect(), A.address, nonceA), [A]));
        const signatures: Record<Address, SignatureBytes | null> = { [A.address]: null };
        return fragmentOf(new Uint8Array(getTransactionEncoder().encode({ messageBytes, signatures })));
      },
      expected: rejected('malformed'),
    },
    {
      name: 'a protect that lists an account twice',
      fragment: () =>
        fragment(
          editMessage(built(protect(), A.address, nonceA), (message) => {
            const last = message.staticAccounts.length - 1;
            return { ...message, staticAccounts: message.staticAccounts.map((a, i) => (i === last ? S : a)) };
          }),
        ),
      expected: rejected('malformed'),
      detail: 'The message lists an account twice',
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
      expected: problem('foreign-recipient', 1_000_000_000n),
    },
    {
      name: 'a protect signed by both keys, not sent',
      fragment: () => fragment(built(protect(), A.address, nonceA), [A, K]),
      expected: problem('nothing-to-sign'),
    },
  ];

  it.each(cases)('$name', async ({ fragment: make, expected, detail }) => {
    const chain = new CountingChain(lite);
    const wallet = await createTestWalletPort({ name: 'Second Wallet', signers: [K], connected: true });
    const [link, text] = await Promise.all([make(), expected()]);
    const { view, unmount } = renderCosignPage(chain, link, [wallet]);
    try {
      await view.findByText(text, undefined, WAIT);
      if (text === en.cosign.bad.title) {
        // Broken, not hostile (DECISIONS.md D103): a warning that asks for the whole link, never "Do not sign".
        expect(view.getByText(text).closest('[data-slot="link-broken"]')).toHaveAttribute('data-tone', 'warning');
        expect(document.querySelector('[data-slot="stop-panel"]')).toBeNull();
      } else {
        // "Do not sign" is the first thing under the page's header, which drops its lead ("Someone sent you this link
        // to approve a change") so nothing above it reads as an invitation to sign.
        const refusal = view.getByText(text).closest('[data-slot="stop-panel"]');
        expect(refusal).toHaveTextContent(en.cosign.stop.title);
        expect(refusal?.previousElementSibling).toHaveAttribute('data-slot', 'page-header');
        expect(view.queryByText(en.cosign.intro)).not.toBeInTheDocument();
        if (detail !== undefined) expect(refusal).toHaveTextContent(detail);
      }
      expect(view.getByRole('link', { name: en.common.backHome })).toHaveAttribute('href', '/');
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
      // The outcome, not the action: "This link no longer works", why, how to get a new one and the way back.
      expect(view.getByRole('heading', { level: 2, name: en.cosign.ended.title })).toHaveFocus();
      expect(view.getByText(en.cosign.ended.body)).toBeInTheDocument();
      expect(view.getByRole('link', { name: en.common.backHome })).toHaveAttribute('href', '/');
      expect(view.queryByText(en.components.jobs.status.leftOut)).not.toBeInTheDocument();
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
    'already-locked: a protect link over a lock in force (it would move the lock\'s end) is refused; nothing is asked',
    async () => {
      const w = await world();
      const second = await createTestWalletPort({ name: 'Second Wallet', signers: [w.K], connected: true });
      // A thief with only the main key: "protect" the stake again, with its own second key K and an end two minutes
      // away. In force, the program only checks that K signs, so K's signature would end the lock almost at once.
      const action: TransactionAction = {
        kind: 'protect',
        stakeAccount: w.S,
        mainKey: w.A.address,
        secondKey: w.K.address,
        lockUntil: START_UNIX_TIMESTAMP + 120n,
      };
      const { bytes } = buildTransaction(action, { feePayer: w.A.address, lifetime: nonceOf(w.testChain, w.nonceA, w.A.address) });
      const link = await sign(bytes, [w.A]);
      const lockBefore = w.testChain.stakeAccount(w.S)?.lockup;

      const { view } = renderCosignPage(w.chain, fragmentOf(link), [second]);
      const reason = await view.findByText(
        'This stake account is already locked, and this link would change when its lock ends. Stakeward never asks for that by link.',
        undefined,
        WAIT,
      );
      // A thief's link: "Do not sign this link", with what to do, right under the header.
      const panel = reason.closest('[data-slot="stop-panel"]') as HTMLElement;
      expect(within(panel).getByRole('heading', { level: 2, name: en.cosign.stop.title })).toHaveFocus();
      expect(panel).toHaveTextContent(en.cosign.stop.whatToDo);
      expect(panel.previousElementSibling).toHaveAttribute('data-slot', 'page-header');
      // A new link would be refused the same way: the page does not ask for one.
      expect(view.queryByText(en.cosign.ended.body)).not.toBeInTheDocument();
      nothingAsked(w.chain, [second]);
      expect(w.testChain.stakeAccount(w.S)?.lockup).toEqual(lockBefore);
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
      expect(view.getByRole('link', { name: en.common.backHome })).toHaveAttribute('data-variant', 'ghost');
      nothingAsked(w.chain, [second]);
    },
    SCENARIO_TIMEOUT,
  );
});

describe('/cosign: "Do not sign" names the addresses and what to do (UX rule 8)', () => {
  it(
    'a withdrawal to a wallet that is not the Main key: both addresses in full, what to do, one way out; nothing asked',
    async () => {
      const w = await world();
      const X = key(43);
      const second = await createTestWalletPort({ name: 'Second Wallet', signers: [w.K], connected: true });
      const action: TransactionAction = {
        kind: 'withdraw',
        stakeAccount: w.S,
        mainKey: w.A.address,
        secondKey: w.K.address,
        recipient: X,
        lamports: 2_500_000_000n,
      };
      const { bytes } = buildTransaction(action, { feePayer: w.A.address, lifetime: nonceOf(w.testChain, w.nonceA, w.A.address) });
      const { view } = renderCosignPage(w.chain, fragmentOf(await sign(bytes, [w.A])), [second]);

      const title = await view.findByRole('heading', { level: 2, name: en.cosign.stop.title }, WAIT);
      const panel = title.closest('[data-slot="stop-panel"]') as HTMLElement;
      expect(panel).toHaveAttribute('data-reason', 'foreign-recipient');
      expect(panel).toHaveAttribute('data-size', 'lg');
      expect(panel).toHaveTextContent("It sends 2.5 SOL to a wallet that is not this stake's Main key. Stakeward never does that.");
      const [goesTo, mainKey] = [...panel.querySelectorAll('dt')].map((term) => term.parentElement as HTMLElement);
      expect(goesTo).toHaveTextContent(`${en.cosign.stop.goesTo}${X}`);
      expect(mainKey).toHaveTextContent(`${en.cosign.stop.mainKey}${w.A.address}`);
      expect(panel).toHaveTextContent(en.cosign.stop.whatToDo);
      expect(within(panel).getByRole('link', { name: en.common.backHome })).toHaveAttribute('data-variant', 'outline');
      // Red only here, nothing else to do on the page: no filled button, no request, no summary.
      expect(document.querySelectorAll('[data-slot="button"][data-variant="primary"], [data-slot="button"][data-variant="danger"]')).toHaveLength(0);
      expect(document.querySelector('[data-slot="cosign-ask"]')).toBeNull();
      nothingAsked(w.chain, [second]);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'a browser that cannot check signatures: a warning to open the link in a current browser, not "Do not sign"',
    async () => {
      const w = await world();
      const second = await createTestWalletPort({ name: 'Second Wallet', signers: [w.K], connected: true });
      const link = await withdrawLink(w);
      // Web Crypto without Ed25519, as in an old browser: the inspector cannot check the main key's signature.
      const importKey = vi
        .spyOn(crypto.subtle, 'importKey')
        .mockRejectedValue(new DOMException('Ed25519 is not supported', 'NotSupportedError'));
      try {
        const { view } = renderCosignPage(w.chain, fragmentOf(link), [second]);
        const title = await view.findByRole('heading', { level: 2, name: en.cosign.unverifiable.title }, WAIT);
        const alert = title.closest('[data-slot="link-unverifiable"]') as HTMLElement;
        expect(alert).toHaveAttribute('data-tone', 'warning');
        expect(alert).toHaveTextContent(en.components.tx.rejected['verification-unavailable']);
        expect(within(alert).getByText(en.common.details)).toBeInTheDocument();
        expect(within(alert).getByRole('link', { name: en.common.backHome })).toHaveAttribute('href', '/');
        expect(document.querySelector('[data-slot="stop-panel"]')).toBeNull();
        expect(document.querySelector('[data-slot="signing-panel"]')).toBeNull();
        nothingAsked(w.chain, [second]);
      } finally {
        importKey.mockRestore();
      }
    },
    SCENARIO_TIMEOUT,
  );
});

describe('/cosign: the key that signs here is the one the link still needs', () => {
  it(
    'a rescue link signed by the new wallet and the second key: the Main key signs here and the stake moves',
    async () => {
      const w = await world();
      const D = await w.testChain.fundedKey();
      const nonceD = await createNonce(w.testChain, D);
      const main = await createTestWalletPort({ name: 'Main Wallet', signers: [w.A] });
      const rescue: TransactionAction = { kind: 'rescue', stakeAccount: w.S, mainKey: w.A.address, secondKey: w.K.address, newWallet: D.address };
      const { bytes } = buildTransaction(rescue, { feePayer: D.address, lifetime: nonceOf(w.testChain, nonceD, D.address) });
      const { user, view } = renderCosignPage(w.chain, fragmentOf(await sign(bytes, [D, w.K])), [main]);

      const ask = (await view.findByText(en.cosign.ask.rescue.title, undefined, WAIT)).closest('[data-slot="cosign-ask"]') as HTMLElement;
      expect(ask).toHaveTextContent('From: New wallet');
      expect(within(ask.querySelector('[data-slot="cosign-check"]') as HTMLElement).getByText(D.address)).toBeInTheDocument();
      // The Main key's own slot, asked for by its exact account.
      const slot = await view.findByRole('group', { name: 'Main key' }, WAIT);
      expect(within(slot).getByRole('button', { name: 'Connect a wallet as Main key' })).toHaveAttribute('data-variant', 'primary');
      await connectAndContinue(user, 'Main key', 'Main Wallet', view);
      await user.click(await view.findByRole('checkbox', { name: en.cosign.confirm.rescue }, WAIT));
      await click(user, 'Sign in Main Wallet as Main key', view);

      await view.findByRole('heading', { name: en.cosign.done.title }, WAIT);
      expect(w.testChain.stakeAccount(w.S)?.withdrawer).toBe(D.address);
      expect(w.testChain.stakeAccount(w.S)?.staker).toBe(D.address);
      expect(main.requests).toHaveLength(1);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    "the sender's fee payer is short: says it is the sender's key that needs SOL; Try again reads again",
    async () => {
      const w = await world();
      const second = await createTestWalletPort({ name: 'Second Wallet', signers: [w.K], connected: true });
      const link = await withdrawLink(w);
      // The network reports the sender's main key empty (a sweeper took its SOL after it signed).
      let empty = true;
      const inner = w.chain.getBalance.bind(w.chain);
      w.chain.getBalance = (address: Address) => (empty && address === w.A.address ? Promise.resolve(0n) : inner(address));
      const { user, view } = renderCosignPage(w.chain, fragmentOf(link), [second]);

      await view.findByText(
        "The sender's Main key has 0 SOL, too little for the network fee. Ask the sender to add a little SOL, then press Try again.",
        undefined,
        WAIT,
      );
      expect(view.getAllByText(w.A.address).length).toBeGreaterThan(0);
      expect(view.queryByText(/^Your Main key has/)).not.toBeInTheDocument();
      expect(second.requests).toHaveLength(0);

      empty = false;
      await click(user, en.common.tryAgain, view);
      await summaryShown();
      expect(view.queryByText(/^The sender's Main key has/)).not.toBeInTheDocument();
      expect(w.chain.count('send')).toBe(0);
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
