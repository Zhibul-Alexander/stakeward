// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { generateKeyPairSigner, type Address, type KeyPairSigner } from '@solana/kit';
import { deriveNonceAccountAddress, formatSol, inspectTransaction, missingSignatures, parseCosignFragment } from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { createTestWalletPort, type TestWalletPort } from '@stakeward/core/test/test-wallet-port';
import { waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import type { SigningTestOptions } from '@/signing/create';
import { CountingChain } from './support/counting-chain.ts';
import {
  click,
  connectAndContinue,
  lastSignature,
  renderCosignPage,
  renderStakePage,
  SCENARIO_TIMEOUT,
  WAIT,
  type CosignRoot,
  type StakePage,
} from './support/stake-pages.tsx';

// Signing by link on /withdraw/:account (step 7 spec 10.2, test L1), both ends on the real stake program: the first
// device holds only the main key; it sets up its link-signing account, signs the withdrawal on that durable nonce and
// shows the link. A second React root, the other device with only the second key, opens /cosign from that link, adds
// the last signature and sends it. The first device finds the landing by itself (or on Check again), or the link is
// cancelled by closing the nonce account.

const DAY = 86_400n;
const T = START_UNIX_TIMESTAMP + 30n * DAY;
/** Two signatures plus the fixed priority fee (core networkFeeFor(2)). */
const FEE_TWO_SIGNERS = 10_600n;

type World = { testChain: TestChain; chain: LiteSvmChain; A: KeyPairSigner; K: KeyPairSigner; S: Address; nonceA: Address };

async function world(): Promise<World> {
  const testChain = await TestChain.create();
  const [A, K] = await Promise.all([testChain.fundedKey(), generateKeyPairSigner()]);
  // Not staked, main key A, locked by the second key K until T.
  const S = await testChain.createStakeAccount({
    staker: A.address,
    withdrawer: A.address,
    lockup: { unixTimestamp: T, epoch: 0n, custodian: K.address },
  });
  return { testChain, chain: new LiteSvmChain(testChain), A, K, S, nonceA: await deriveNonceAccountAddress(A.address) };
}

const mainWallet = (w: World) => createTestWalletPort({ name: 'Main Wallet', signers: [w.A] });
const secondWallet = (w: World) => createTestWalletPort({ name: 'Second Wallet', signers: [w.K] });

/**
 * The first device, from the stage block to the link: the second key signs by link, the main key sets up its
 * link-signing account (one request), then signs the withdrawal on it (one more). Returns the link's URL.
 */
async function openLink(w: World, page: StakePage): Promise<string> {
  const { user, view } = page;
  const lamports = w.testChain.account(w.S)?.lamports ?? 0n;
  await view.findByRole('heading', { name: `Withdraw ${formatSol(lamports)} to your main key` }, WAIT);
  const where = view.getByRole('radiogroup', { name: 'Where does your Second key sign?' });
  await user.click(within(where).getByRole('radio', { name: 'On another device, by link' }));
  // The phone note stays, now with the link as one more way (UX rule 10).
  expect(view.getByText(en.withdraw.desktop)).toBeInTheDocument();
  await click(user, 'Review and sign', view);

  // The link-signing account first: the main key creates it, nothing else is built before it exists.
  await view.findByRole('heading', { name: en.nonce.setup.title }, WAIT);
  expect(document.querySelector('[data-slot="transaction-summary"][data-kind="withdraw"]')).toBeNull();
  await click(user, en.nonce.setup.action, view);
  await connectAndContinue(user, 'Main key', 'Main Wallet', view);
  await click(user, 'Sign in Main Wallet as Main key', view);

  // Then the withdrawal on that nonce: the main key signs here, the second key is never asked here.
  await waitFor(() => {
    expect(document.querySelector('[data-slot="transaction-summary"][data-kind="withdraw"]')).not.toBeNull();
  }, WAIT);
  expect(w.testChain.account(w.nonceA)).not.toBeNull();
  await click(user, 'Sign in Main Wallet as Main key', view);
  const card = await waitFor(() => {
    const found = document.querySelector<HTMLElement>('[data-slot="link-card"]');
    expect(found).not.toBeNull();
    return found as HTMLElement;
  }, WAIT);
  return within(card).getByLabelText<HTMLInputElement>(en.signing.link.url).value;
}

/** What the link carries: the withdrawal on the main key's nonce, signed by the main key (the fee payer) only. */
async function expectLinkBytes(w: World, url: string, main: TestWalletPort) {
  const bytes = parseCosignFragment(new URL(url).hash);
  if (bytes === null) throw new Error(`not a signing link: ${url}`);
  const inspected = await inspectTransaction(bytes);
  if (!inspected.ok) throw new Error(inspected.error.message);
  const { summary } = inspected;
  expect(summary.action).toMatchObject({ kind: 'withdraw', stakeAccount: w.S, recipient: w.A.address, secondKey: w.K.address });
  expect(summary.feePayer).toBe(w.A.address);
  expect(summary.lifetime).toMatchObject({ kind: 'nonce', nonceAccount: w.nonceA, nonceAuthority: w.A.address });
  expect(summary.presentSignatures).toEqual([w.A.address]);
  expect(missingSignatures(summary)).toEqual([w.K.address]);
  // The id the first device waits on is the fee payer's signature, shown with the link.
  const id = lastSignature(main);
  const card = document.querySelector<HTMLElement>('[data-slot="link-card"]') as HTMLElement;
  expect(within(card).getByRole('link', { name: /on Solana Explorer/ })).toHaveAttribute('href', expect.stringContaining(`/tx/${id}`));
}

/** The other device: /cosign from the link with only the second key; it ticks the box, signs and sends. */
async function cosign(w: World, url: string, second: TestWalletPort): Promise<CosignRoot> {
  const root = renderCosignPage(w.chain, new URL(url).hash, [second]);
  await root.view.findByText(en.cosign.ask.withdraw, undefined, WAIT);
  await connectAndContinue(root.user, 'Second key', 'Second Wallet', root.view);
  await root.user.click(await root.view.findByRole('checkbox', { name: en.cosign.confirm.withdraw }, WAIT));
  await click(root.user, 'Sign in Second Wallet as Second key', root.view);
  await root.view.findByRole('heading', { name: en.cosign.done.title }, WAIT);
  return root;
}

/** The first device's Done screen for the withdrawal of `lamports`. */
const withdrawn = (page: StakePage, lamports: bigint) =>
  page.view.findByRole('heading', { name: `${formatSol(lamports)} went to your main key` }, WAIT);

describe('signing by link: /withdraw on the first device, /cosign on the second (L1)', () => {
  it(
    'L1: the main key signs here, the second key from the link on another device; the first device sees Done by itself',
    async () => {
      const w = await world();
      const [main, second] = await Promise.all([mainWallet(w), secondWallet(w)]);
      const lamports = w.testChain.account(w.S)?.lamports ?? 0n;
      // The first device's browser never holds the second key.
      const page = renderStakePage(w.chain, `/withdraw/${w.S}`, [main]);

      const url = await openLink(w, page);
      await expectLinkBytes(w, url, main);
      const balanceBefore = w.testChain.balance(w.A.address);

      const other = await cosign(w, url, second);
      await withdrawn(page, lamports);
      other.unmount();

      expect(w.testChain.account(w.S)).toBeNull();
      expect(w.testChain.balance(w.A.address)).toBe(balanceBefore + lamports - FEE_TWO_SIGNERS);
      expect(main.requests).toHaveLength(2);
      expect(second.requests).toHaveLength(1);
      // Done after signing by link: the link-signing account can be closed, its deposit comes back.
      // The card reads the link-signing account itself once it mounts: wait for it.
      expect(await page.view.findByRole('heading', { name: en.nonce.close.title }, WAIT)).toBeInTheDocument();
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'L1 forgotten status: the network no longer reports the transaction; the stake account itself shows it landed',
    async () => {
      const w = await world();
      const [main, second] = await Promise.all([mainWallet(w), secondWallet(w)]);
      const lamports = w.testChain.account(w.S)?.lamports ?? 0n;
      // The first device waits long between checks, so the other device lands before it polls.
      const waiting: SigningTestOptions = { pollIntervalMs: 1, rereadDelayMs: 1, link: { firstPollMs: 600_000, maxPollMs: 600_000 } };
      const page = renderStakePage(w.chain, `/withdraw/${w.S}`, [main], {}, waiting);

      const url = await openLink(w, page);
      const other = await cosign(w, url, second);
      other.unmount();
      const id = lastSignature(main);
      w.chain.forgetSignatureStatuses();
      expect(await w.chain.getSignatureStatuses([id])).toEqual([null]);
      // The first device has not checked yet: it still shows the open link.
      expect(document.querySelector('[data-slot="signing-panel"][data-phase="link"]')).not.toBeNull();

      // Back on the first device's tab: it checks at once (not after its pause) and reads the account, now closed.
      const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      try {
        document.dispatchEvent(new Event('visibilitychange'));
        await withdrawn(page, lamports);
      } finally {
        visibility.mockRestore();
      }
      expect(w.testChain.account(w.S)).toBeNull();
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'L1 cancel: closing the link-signing account ends the link; nothing changed, and the old link is refused unasked',
    async () => {
      const w = await world();
      const [main, second] = await Promise.all([mainWallet(w), secondWallet(w)]);
      const before = w.testChain.stakeAccount(w.S);
      const page = renderStakePage(w.chain, `/withdraw/${w.S}`, [main]);

      const url = await openLink(w, page);
      const deposit = w.testChain.balance(w.nonceA);
      const balanceBefore = w.testChain.balance(w.A.address);
      // A close needs a newer blockhash than the one the nonce holds (on a cluster time moves on by itself).
      w.chain.expireBlockhash();
      const card = document.querySelector<HTMLElement>('[data-slot="link-card"]') as HTMLElement;
      await click(page.user, en.signing.link.cancelAction, within(card));
      await click(page.user, 'Sign in Main Wallet as Main key', page.view);

      // The first device: the link stopped working, nothing changed.
      await page.view.findByText(en.components.jobs.linkExpired, undefined, WAIT);
      expect(w.testChain.account(w.nonceA)).toBeNull();
      expect(w.testChain.balance(w.A.address)).toBe(balanceBefore + deposit - 5_600n);
      expect(w.testChain.stakeAccount(w.S)).toEqual(before);
      expect(main.requests).toHaveLength(3);

      // The other device opens the old link: refused before any wallet, simulation or send.
      const counting = new CountingChain(w.chain);
      const other = renderCosignPage(counting, new URL(url).hash, [second]);
      await other.view.findByText(en.cosign.refused['link-used'], undefined, WAIT);
      expect(counting.count('simulate')).toBe(0);
      expect(counting.count('send')).toBe(0);
      expect(second.requests).toHaveLength(0);
      expect(w.testChain.stakeAccount(w.S)).toEqual(before);
      other.unmount();
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'L1 stop waiting: the outcome stays open (the link still works); after the other device sends, Check again finds it',
    async () => {
      const w = await world();
      const [main, second] = await Promise.all([mainWallet(w), secondWallet(w)]);
      const lamports = w.testChain.account(w.S)?.lamports ?? 0n;
      const page = renderStakePage(w.chain, `/withdraw/${w.S}`, [main]);

      const url = await openLink(w, page);
      await click(page.user, en.signing.link.stopWaiting, page.view);
      await page.view.findByText(en.components.jobs.unknown['link-open'], undefined, WAIT);
      // The link-signing account can still be closed from here, which would cancel the link.
      // The card reads the link-signing account itself once it mounts: wait for it.
      expect(await page.view.findByRole('heading', { name: en.nonce.close.title }, WAIT)).toBeInTheDocument();

      const other = await cosign(w, url, second);
      other.unmount();
      expect(w.testChain.account(w.S)).toBeNull();
      // The first device stopped polling: it learns of the landing only when asked.
      expect(page.view.getByText(en.components.jobs.unknown['link-open'])).toBeInTheDocument();
      await click(page.user, en.common.checkAgain, page.view);
      await withdrawn(page, lamports);
      expect(second.requests).toHaveLength(1);
    },
    SCENARIO_TIMEOUT,
  );
});
