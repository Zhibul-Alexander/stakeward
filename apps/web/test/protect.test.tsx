// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import {
  generateKeyPairSigner,
  getCompiledTransactionMessageDecoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  SolanaError,
  type Address,
  type KeyPairSigner,
} from '@solana/kit';
import { deriveNonceAccountAddress, formatUtcDate, lockupEnd, shortAddress, ZERO_ADDRESS } from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { createTestWalletPort, type TestWalletPort } from '@stakeward/core/test/test-wallet-port';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { protectPlan, refusalText } from '@/pages/protect/plan';
import { ProtectPage } from '@/pages/ProtectPage';
import {
  createProtectedAccountMemory,
  createSecondKeyMemory,
  createSlotStore,
  PortsProvider,
  StaticWalletRegistry,
  type Ports,
} from '@/ports';
import en from '@/i18n/en.json';
import { createFakeApi, type FakeApi } from './support/fake-api.ts';
import { connectAndContinue, renderCosignPage } from './support/stake-pages.tsx';

// The protect wizard (F1) end to end on the real stake program: LiteSvmChain answers like HttpChain, test wallets sign
// like Wallet Standard wallets (and misbehave on request), the fake API answers POST /api/watch from the same chain.

const TIMEOUT = 60_000;
const WAIT = { timeout: 20_000 };
const DAY = 86_400n;
/** The default period from LiteSVM's clock: what the wizard locks to. */
const T = lockupEnd(START_UNIX_TIMESTAMP, '6-months', 'devnet');

type World = { testChain: TestChain; chain: LiteSvmChain; A: KeyPairSigner; K: KeyPairSigner };

async function world(): Promise<World> {
  const testChain = await TestChain.create();
  const [A, K] = await Promise.all([testChain.fundedKey(), generateKeyPairSigner()]);
  return { testChain, chain: new LiteSvmChain(testChain), A, K };
}

/** S1 delegated, S2 only initialized; both with staker = main key = A and no lock. */
async function twoAccounts(w: World): Promise<{ S1: Address; S2: Address }> {
  const vote = await w.testChain.createVoteAccount();
  const S1 = await w.testChain.createStakeAccount({
    staker: w.A.address,
    withdrawer: w.A.address,
    delegateTo: { voteAccount: vote, stakerKey: w.A },
  });
  const S2 = await w.testChain.createStakeAccount({ staker: w.A.address, withdrawer: w.A.address });
  return { S1, S2 };
}

async function twoWallets(w: World): Promise<[TestWalletPort, TestWalletPort]> {
  return Promise.all([
    createTestWalletPort({ name: 'Main Wallet', signers: [w.A] }),
    createTestWalletPort({ name: 'Second Wallet', signers: [w.K] }),
  ]);
}

type Page = { ports: Ports; api: FakeApi; location: ReturnType<typeof memoryLocation>; user: UserEvent };

function renderProtect(w: World, accounts: readonly Address[], wallets: readonly TestWalletPort[]): Page {
  const api = createFakeApi(w.chain);
  const ports: Ports = {
    chain: w.chain,
    wallets: new StaticWalletRegistry(wallets),
    slots: createSlotStore(null),
    secondKeys: createSecondKeyMemory(null),
    protectedAccounts: createProtectedAccountMemory(null),
    api,
  };
  const query = new URLSearchParams(accounts.map((account) => ['account', account])).toString();
  const location = memoryLocation({ path: query === '' ? '/protect' : `/protect?${query}`, record: true });
  const user = userEvent.setup();
  // StrictMode as in main.tsx: effects run twice, and the wizard must still ask each wallet once.
  render(
    <StrictMode>
      <Router hook={location.hook} searchHook={location.searchHook}>
        <PortsProvider ports={ports}>
          <ProtectPage signing={{ pollIntervalMs: 1, rereadDelayMs: 1, link: { firstPollMs: 1, maxPollMs: 1 } }} />
        </PortsProvider>
      </Router>
    </StrictMode>,
  );
  return { ports, api, location, user };
}

async function connect(user: UserEvent, role: 'Main key' | 'Second key', walletName: string) {
  const slot = screen.getByRole('group', { name: role });
  await user.click(within(slot).getByRole('button', { name: `Connect a wallet as ${role}` }));
  await user.click(within(slot).getByRole('button', { name: walletName }));
  await waitFor(() => {
    expect(within(screen.getByRole('group', { name: role })).getByText('Connected')).toBeInTheDocument();
  });
}

const continueButton = () => screen.getByRole('button', { name: 'Continue' });
const selectBox = (account: Address) => screen.getByRole('checkbox', { name: `Protect stake account ${shortAddress(account)}` });

async function click(user: UserEvent, name: string) {
  await user.click(await screen.findByRole('button', { name }, WAIT));
}

/** Main key, Continue, second key, the seed phrase box, Continue, the default period, Continue: the signing step. */
async function toSigning(page: Page, wallets: { main: string; second: string } = { main: 'Main Wallet', second: 'Second Wallet' }) {
  const { user } = page;
  await connect(user, 'Main key', wallets.main);
  await screen.findAllByRole('checkbox', { name: /^Protect stake account / }, WAIT);
  await user.click(continueButton());
  await screen.findByRole('heading', { name: 'Connect your second key' });
  await connect(user, 'Second key', wallets.second);
  await user.click(screen.getByRole('checkbox', { name: 'My second key comes from a different seed phrase' }));
  await user.click(continueButton());
  await screen.findByRole('heading', { name: 'How long should the lock hold?' });
  await screen.findByText(`Locked until ${formatUtcDate(T) ?? ''}`, undefined, WAIT);
  await user.click(continueButton());
  await screen.findByRole('heading', { name: 'Review and sign' });
}

const finished = (title: string) => screen.findByRole('heading', { name: title }, WAIT);

function lockOf(w: World, account: Address) {
  return w.testChain.stakeAccount(account)?.lockup;
}

const NO_LOCK = { unixTimestamp: 0n, epoch: 0n, custodian: ZERO_ADDRESS };

function signaturesOf(transactions: readonly Uint8Array[]) {
  return transactions.map((bytes) => getSignatureFromTransaction(getTransactionDecoder().decode(bytes)));
}

function blockhashOf(bytes: Uint8Array): string {
  return getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(bytes).messageBytes).lifetimeToken;
}

describe('/protect: protect stake accounts with a second key (F1)', () => {
  it(
    'DW1: protects two accounts end to end, from the link selection to Protected',
    async () => {
      const w = await world();
      const { S1, S2 } = await twoAccounts(w);
      const [main, second] = await twoWallets(w);
      const page = renderProtect(w, [S1, S2], [main, second]);
      const { user, ports, api } = page;

      // Before the main key: the link's accounts are named, nothing is read.
      expect(screen.getByText('From your link: 2 stake accounts. Connect their main key to continue.')).toBeInTheDocument();
      await connect(user, 'Main key', 'Main Wallet');
      await waitFor(() => {
        expect(selectBox(S1)).toBeChecked();
      }, WAIT);
      expect(selectBox(S2)).toBeChecked();
      expect(screen.getByText('2 stake accounts selected')).toBeInTheDocument();
      await user.click(continueButton());

      await screen.findByRole('heading', { name: 'Connect your second key' });
      await connect(user, 'Second key', 'Second Wallet');
      await user.click(screen.getByRole('checkbox', { name: 'My second key comes from a different seed phrase' }));
      await user.click(continueButton());

      await screen.findByRole('heading', { name: 'How long should the lock hold?' });
      expect(screen.getByRole('radio', { name: '6 months (recommended)' })).toBeChecked();
      await screen.findByText(`Locked until ${formatUtcDate(T) ?? ''}`, undefined, WAIT);
      await user.click(continueButton());

      // One summary for both transactions, each stake account in full.
      await screen.findByRole('button', { name: 'Sign 2 transactions in Main Wallet as Main key' }, WAIT);
      const summaries = document.querySelectorAll('[data-slot="transaction-summary"]');
      expect(summaries).toHaveLength(1);
      const summary = summaries[0] as HTMLElement;
      expect(summary).toHaveAttribute('data-kind', 'protect');
      expect(within(summary).getByText(S1)).toBeInTheDocument();
      expect(within(summary).getByText(S2)).toBeInTheDocument();

      await click(user, 'Sign 2 transactions in Main Wallet as Main key');
      await click(user, 'Sign 2 transactions in Second Wallet as Second key');
      await finished('2 stake accounts are protected');

      // The chain holds the lock (CLAUDE.md section 12): T and the second key on both.
      const lock = { unixTimestamp: T, epoch: 0n, custodian: w.K.address };
      expect(lockOf(w, S1)).toEqual(lock);
      expect(lockOf(w, S2)).toEqual(lock);
      // One wallet request per key for both transactions.
      expect(main.requests).toHaveLength(1);
      expect(main.requests[0]?.transactions).toHaveLength(2);
      expect(second.requests).toHaveLength(1);
      expect(second.requests[0]?.transactions).toHaveLength(2);

      const rows = within(screen.getByRole('region', { name: 'Protected' })).getAllByRole('article');
      expect(rows.map((row) => row.getAttribute('data-status'))).toEqual(['protected', 'protected']);

      // Written only now that the chain shows the locks (step 4 spec 4.6).
      expect(ports.secondKeys.getSnapshot()).toContain(w.K.address);
      expect([...ports.protectedAccounts.getSnapshot()].sort()).toEqual([S1, S2].sort());
      await waitFor(() => {
        expect(api.calls).toEqual([[S1, S2]]);
      });
      await screen.findByText('Monitoring is on: Stakeward checks these stake accounts every few minutes.');

      const telegram = screen.getByRole('link', { name: /Open the Stakeward bot in Telegram/ });
      expect(telegram).toHaveAttribute('href', `/api/telegram/link?wallet=${w.A.address}`);
      expect(telegram).toHaveAttribute('target', '_blank');
      expect(telegram).toHaveAttribute('rel', 'noopener noreferrer');
      expect(telegram).toHaveAccessibleName('Open the Stakeward bot in Telegram (opens in a new tab)');

      for (const account of [S1, S2]) {
        const links = screen.getAllByRole('link', { name: `Recovery card for ${shortAddress(account)}` });
        expect(links.length).toBeGreaterThan(0);
        for (const link of links) expect(link).toHaveAttribute('href', `/recovery/${account}`);
      }
      expect(screen.getByRole('link', { name: 'Back to your accounts' })).toHaveAttribute('href', `/app?address=${w.A.address}`);
    },
    TIMEOUT,
  );

  it(
    'DW2: the wallet declined: nothing is sent, Try again asks the same wallet with the same bytes',
    async () => {
      const w = await world();
      const { S1, S2 } = await twoAccounts(w);
      const [main, second] = await twoWallets(w);
      const page = renderProtect(w, [S1, S2], [main, second]);
      second.once({ reject: true });
      await toSigning(page);
      await click(page.user, 'Sign 2 transactions in Main Wallet as Main key');
      await click(page.user, 'Sign 2 transactions in Second Wallet as Second key');

      await screen.findByText('The request was declined in the wallet. Nothing was sent; you can try again.', undefined, WAIT);
      expect(lockOf(w, S1)).toEqual(NO_LOCK);
      expect(lockOf(w, S2)).toEqual(NO_LOCK);
      expect(await w.chain.getSignatureStatuses(signaturesOf(main.responses[0] ?? []))).toEqual([null, null]);

      await page.user.click(screen.getByRole('button', { name: 'Try again' }));
      await finished('2 stake accounts are protected');
      expect(second.requests).toHaveLength(2);
      expect(main.requests).toHaveLength(1);
      expect(second.requests[1]?.transactions).toEqual(second.requests[0]?.transactions);
    },
    TIMEOUT,
  );

  it(
    'DW3a: the wallet changed the message: the round stops before anything is sent; Start again protects',
    async () => {
      const w = await world();
      const { S1, S2 } = await twoAccounts(w);
      const [main, second] = await twoWallets(w);
      const page = renderProtect(w, [S1, S2], [main, second]);
      main.once({ modifyMessage: true });
      await toSigning(page);
      await click(page.user, 'Sign 2 transactions in Main Wallet as Main key');

      await screen.findByText('The wallet changed the transaction. Nothing was sent.', undefined, WAIT);
      expect(second.requests).toHaveLength(0);
      expect(lockOf(w, S1)).toEqual(NO_LOCK);
      expect(lockOf(w, S2)).toEqual(NO_LOCK);
      expect(page.api.calls).toEqual([]);

      await page.user.click(screen.getByRole('button', { name: 'Start again' }));
      await click(page.user, 'Sign 2 transactions in Main Wallet as Main key');
      await click(page.user, 'Sign 2 transactions in Second Wallet as Second key');
      await finished('2 stake accounts are protected');
      expect(main.requests).toHaveLength(2);
      expect(lockOf(w, S1)?.custodian).toBe(w.K.address);
    },
    TIMEOUT,
  );

  it(
    'DW3b: a tail added after another signature: Start again with that wallet signing first',
    async () => {
      const w = await world();
      const { S1, S2 } = await twoAccounts(w);
      const [main, second] = await twoWallets(w);
      const page = renderProtect(w, [S1, S2], [main, second]);
      second.once({ lighthouseTail: true });
      await toSigning(page);
      await click(page.user, 'Sign 2 transactions in Main Wallet as Main key');
      await click(page.user, 'Sign 2 transactions in Second Wallet as Second key');

      await screen.findByText(
        'The wallet added its own checks after another wallet had signed, which breaks that signature. Nothing was sent.',
        undefined,
        WAIT,
      );
      await page.user.click(screen.getByRole('button', { name: 'Start again with Second Wallet signing first' }));
      // Now the second key signs first, then the main key.
      await click(page.user, 'Sign 2 transactions in Second Wallet as Second key');
      await click(page.user, 'Sign 2 transactions in Main Wallet as Main key');
      await finished('2 stake accounts are protected');

      const [unsignedForSecond] = second.requests[1]?.transactions ?? [];
      const [signedBySecond] = main.requests[1]?.transactions ?? [];
      expect(unsignedForSecond && getTransactionDecoder().decode(unsignedForSecond).signatures[w.A.address]).toBeNull();
      expect(signedBySecond && getTransactionDecoder().decode(signedBySecond).signatures[w.K.address]).not.toBeNull();
      expect(lockOf(w, S2)?.custodian).toBe(w.K.address);
    },
    TIMEOUT,
  );

  it(
    'DW4: the blockhash expired between the signatures: Sign again rebuilds and both keys sign once more',
    async () => {
      const w = await world();
      const { S1, S2 } = await twoAccounts(w);
      const [main, second] = await twoWallets(w);
      const page = renderProtect(w, [S1, S2], [main, second]);
      await toSigning(page);
      await click(page.user, 'Sign 2 transactions in Main Wallet as Main key');
      await screen.findByRole('button', { name: 'Sign 2 transactions in Second Wallet as Second key' }, WAIT);
      w.chain.expireBlockhash();
      await click(page.user, 'Sign 2 transactions in Second Wallet as Second key');

      await screen.findByText('The transaction expired before every wallet signed', undefined, WAIT);
      expect(second.requests).toHaveLength(0);
      await page.user.click(screen.getByRole('button', { name: 'Sign again' }));
      await click(page.user, 'Sign 2 transactions in Main Wallet as Main key');
      await click(page.user, 'Sign 2 transactions in Second Wallet as Second key');
      await finished('2 stake accounts are protected');

      expect(main.requests).toHaveLength(2);
      const first = main.requests[0]?.transactions ?? [];
      const landed = second.responses[0] ?? [];
      expect(landed).toHaveLength(2);
      // The landed transactions carry the new blockhash; the first round's never reached the chain.
      for (const bytes of landed) expect(blockhashOf(bytes)).not.toBe(blockhashOf(first[0] ?? new Uint8Array()));
      const statuses = await w.chain.getSignatureStatuses(signaturesOf(landed));
      expect(statuses.every((status) => status !== null && status.error === null)).toBe(true);
      expect(await w.chain.getSignatureStatuses(signaturesOf(main.responses[0] ?? []))).toEqual([null, null]);
    },
    TIMEOUT,
  );

  it(
    'DW5: only one of two transactions landed: the other is retried alone and monitoring covers each once',
    async () => {
      const w = await world();
      const { S1, S2 } = await twoAccounts(w);
      const [main, second] = await twoWallets(w);
      const page = renderProtect(w, [S1, S2], [main, second]);
      await toSigning(page);
      await click(page.user, 'Sign 2 transactions in Main Wallet as Main key');
      await screen.findByRole('button', { name: 'Sign 2 transactions in Second Wallet as Second key' }, WAIT);
      // The worker's rate limit refuses the first send (S1): definite, never forwarded.
      w.chain.failNext(
        'send',
        new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, { headers: new Headers(), message: 'Too Many Requests', statusCode: 429 }),
      );
      await click(page.user, 'Sign 2 transactions in Second Wallet as Second key');
      await finished('1 of 2 stake accounts are protected');

      const protectedRegion = screen.getByRole('region', { name: 'Protected' });
      expect(within(protectedRegion).getByRole('article', { name: `Stake account ${shortAddress(S2)}` })).toBeInTheDocument();
      expect(within(protectedRegion).queryByRole('article', { name: `Stake account ${shortAddress(S1)}` })).toBeNull();
      const notYet = within(screen.getByRole('list', { name: 'Not protected yet' })).getAllByRole('listitem');
      expect(notYet).toHaveLength(1);
      const s1Item = notYet[0] as HTMLElement;
      expect(s1Item).toHaveAttribute('data-status', 'failed');
      expect(within(s1Item).getByText('Too many requests. Wait a minute and try again.')).toBeInTheDocument();
      expect(within(s1Item).getByText('Details')).toBeInTheDocument();
      expect(within(s1Item).getByRole('button', { name: `Copy address ${shortAddress(S1)}` })).toBeInTheDocument();

      expect(lockOf(w, S1)).toEqual(NO_LOCK);
      await waitFor(() => {
        expect(page.api.calls).toEqual([[S2]]);
      });
      expect(page.ports.protectedAccounts.getSnapshot()).toEqual([S2]);

      await page.user.click(screen.getByRole('button', { name: 'Try again for 1 stake account' }));
      await click(page.user, 'Sign in Main Wallet as Main key');
      await click(page.user, 'Sign in Second Wallet as Second key');
      await finished('2 stake accounts are protected');

      expect(main.requests).toHaveLength(2);
      expect(main.requests[1]?.transactions).toHaveLength(1);
      expect(second.requests).toHaveLength(2);
      expect(second.requests[1]?.transactions).toHaveLength(1);
      expect(lockOf(w, S1)?.custodian).toBe(w.K.address);
      await waitFor(() => {
        expect(page.api.calls).toEqual([[S2], [S1]]);
      });
      expect([...page.ports.protectedAccounts.getSnapshot()].sort()).toEqual([S1, S2].sort());
      expect(within(screen.getByRole('region', { name: 'Protected' })).getAllByRole('article')).toHaveLength(2);
    },
    TIMEOUT,
  );
});

describe('/protect: one stake account at a time', () => {
  it(
    'stopping in round 2 shows and records what round 1 protected; nothing claims that nothing was sent',
    async () => {
      const w = await world();
      const { S1, S2 } = await twoAccounts(w);
      const [main, second] = await twoWallets(w);
      const page = renderProtect(w, [S1, S2], [main, second]);
      main.once({ fail: Object.assign(new Error('Main Wallet signs one transaction per request'), { name: 'WalletBatchUnsupportedError' }) });
      await toSigning(page);
      await click(page.user, 'Sign 2 transactions in Main Wallet as Main key');
      await click(page.user, 'Sign one stake account at a time');
      await click(page.user, 'Sign in Main Wallet as Main key');
      await click(page.user, 'Sign in Second Wallet as Second key');

      // Round 1 landed; round 2 says so and offers no way back that would drop it.
      await screen.findByText('Round 2 of 2', undefined, WAIT);
      await screen.findByRole('button', { name: 'Sign in Main Wallet as Main key' }, WAIT);
      expect(lockOf(w, S1)?.custodian).toBe(w.K.address);
      expect(screen.getByText(/^An earlier round already sent the transaction for 1 stake account\./)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();

      second.once({ reject: true });
      await click(page.user, 'Sign in Main Wallet as Main key');
      await click(page.user, 'Sign in Second Wallet as Second key');
      await screen.findByText('This round was not sent', undefined, WAIT);
      expect(screen.queryByText('Nothing was sent')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Stop and go back. Nothing was sent.' })).toBeNull();

      await page.user.click(screen.getByRole('button', { name: 'Stop here and see the result' }));
      await finished('1 of 2 stake accounts are protected');
      expect(within(screen.getByRole('region', { name: 'Protected' })).getByRole('article', { name: `Stake account ${shortAddress(S1)}` })).toBeInTheDocument();
      const notYet = within(screen.getByRole('list', { name: 'Not protected yet' })).getAllByRole('listitem');
      expect(notYet.map((item) => item.getAttribute('data-status'))).toEqual(['not-sent']);
      // The lock round 1 put on the chain is remembered and watched (step 4 spec 4.6).
      expect(page.ports.secondKeys.getSnapshot()).toEqual([w.K.address]);
      expect(page.ports.protectedAccounts.getSnapshot()).toEqual([S1]);
      await waitFor(() => {
        expect(page.api.calls).toEqual([[S1]]);
      });
      expect(lockOf(w, S2)).toEqual(NO_LOCK);

      await page.user.click(screen.getByRole('button', { name: 'Try again for 1 stake account' }));
      await click(page.user, 'Sign in Main Wallet as Main key');
      await click(page.user, 'Sign in Second Wallet as Second key');
      await finished('2 stake accounts are protected');
      expect(lockOf(w, S2)?.custodian).toBe(w.K.address);
      await waitFor(() => {
        expect(page.api.calls).toEqual([[S1], [S2]]);
      });
    },
    TIMEOUT,
  );
});

describe('/protect by link (step 7 spec 10.1)', () => {
  it(
    'P-L1: the second key\'s address is pasted, it signs from the link on another device; this page reaches Protected',
    async () => {
      const w = await world();
      const S = await w.testChain.createStakeAccount({ staker: w.A.address, withdrawer: w.A.address });
      const main = await createTestWalletPort({ name: 'Main Wallet', signers: [w.A] });
      // This browser never holds the second key.
      const page = renderProtect(w, [S], [main]);
      const { user, api } = page;
      const nonceA = await deriveNonceAccountAddress(w.A.address);

      await connect(user, 'Main key', 'Main Wallet');
      await waitFor(() => {
        expect(selectBox(S)).toBeChecked();
      }, WAIT);
      await user.click(continueButton());
      await screen.findByRole('heading', { name: 'Connect your second key' });
      await user.click(
        within(screen.getByRole('radiogroup', { name: 'Where does your Second key sign?' })).getByRole('radio', {
          name: 'On another device, by link',
        }),
      );
      // By link there is no slot to connect: the address is pasted, and the one-browser notes do not apply.
      expect(screen.queryByRole('group', { name: 'Second key' })).toBeNull();
      expect(screen.queryByText(en.protect.second.oneBrowser)).toBeNull();
      const field = screen.getByRole('textbox', { name: en.protect.second.linkAddress });
      await user.click(continueButton());
      expect(await screen.findByText(en.components.addressField.empty)).toBeInTheDocument();
      await user.type(field, 'not-an-address');
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getAllByText(en.components.addressField.invalid).length).toBeGreaterThan(0);
      await user.clear(field);
      // The second-key rules still apply to the typed address: the main key itself is refused.
      await user.click(field);
      await user.paste(w.A.address);
      expect(await screen.findByText(/This is your main key\./)).toBeInTheDocument();
      await user.clear(field);
      await user.click(field);
      await user.paste(` ${w.K.address} `);
      expect(field).not.toHaveAttribute('aria-invalid');
      await user.click(screen.getByRole('checkbox', { name: 'My second key comes from a different seed phrase' }));
      await user.click(continueButton());
      await screen.findByRole('heading', { name: 'How long should the lock hold?' });
      await screen.findByText(`Locked until ${formatUtcDate(T) ?? ''}`, undefined, WAIT);
      await user.click(continueButton());

      // Review and sign: the main key's link-signing account first, then the lock on that nonce.
      await screen.findByRole('heading', { name: 'Review and sign' });
      expect(screen.getByText(en.protect.sign.linkOne)).toBeInTheDocument();
      await click(user, en.nonce.setup.action);
      await click(user, 'Sign in Main Wallet as Main key');
      await waitFor(() => {
        expect(document.querySelector('[data-slot="transaction-summary"][data-kind="protect"]')).not.toBeNull();
      }, WAIT);
      expect(w.testChain.account(nonceA)).not.toBeNull();
      await click(user, 'Sign in Main Wallet as Main key');
      const card = await waitFor(() => {
        const found = document.querySelector<HTMLElement>('[data-slot="link-card"]');
        expect(found).not.toBeNull();
        return found as HTMLElement;
      }, WAIT);
      const url = within(card).getByLabelText<HTMLInputElement>(en.signing.link.url).value;
      expect(lockOf(w, S)).toEqual(NO_LOCK);

      // The other device: /cosign with only the second key's wallet.
      const second = await createTestWalletPort({ name: 'Second Wallet', signers: [w.K] });
      const other = renderCosignPage(w.chain, new URL(url).hash, [second]);
      await other.view.findByText(en.cosign.ask.protect, undefined, WAIT);
      await connectAndContinue(other.user, 'Second key', 'Second Wallet', other.view);
      await other.user.click(await other.view.findByRole('button', { name: 'Sign in Second Wallet as Second key' }, WAIT));
      await other.view.findByRole('heading', { name: en.cosign.done.title }, WAIT);
      other.unmount();

      // This page moves on by itself and records what the chain shows (step 4 spec 4.6).
      await finished('Your stake account is protected');
      expect(lockOf(w, S)).toEqual({ unixTimestamp: T, epoch: 0n, custodian: w.K.address });
      expect(main.requests).toHaveLength(2);
      expect(second.requests).toHaveLength(1);
      expect(page.ports.secondKeys.getSnapshot()).toEqual([w.K.address]);
      await waitFor(() => {
        expect(api.calls).toEqual([[S]]);
      });

      // Close the link-signing account: the deposit goes back to the main key.
      w.chain.expireBlockhash();
      const deposit = w.testChain.balance(nonceA);
      const balanceBefore = w.testChain.balance(w.A.address);
      await click(user, en.nonce.close.action);
      await click(user, 'Sign in Main Wallet as Main key');
      await screen.findByText('Closed. The deposit went back to your Main key.', undefined, WAIT);
      expect(w.testChain.account(nonceA)).toBeNull();
      expect(w.testChain.balance(w.A.address)).toBe(balanceBefore + deposit - 5_600n);
    },
    TIMEOUT,
  );
});

describe('/protect Done: uncertain outcomes', () => {
  it(
    'Stop waiting leaves the transactions uncertain; Check again reads the chain, then remembers and watches what landed',
    async () => {
      const w = await world();
      const { S1, S2 } = await twoAccounts(w);
      const [main, second] = await twoWallets(w);
      const page = renderProtect(w, [S1, S2], [main, second]);
      await toSigning(page);
      // Sent, but the network has not executed them yet.
      w.chain.holdTransactions();
      await click(page.user, 'Sign 2 transactions in Main Wallet as Main key');
      await click(page.user, 'Sign 2 transactions in Second Wallet as Second key');
      await screen.findByText('Waiting for the network to confirm. This usually takes a few seconds, at most 2 minutes.', undefined, WAIT);
      await page.user.click(screen.getByRole('button', { name: 'Stop waiting' }));

      await finished('No stake account was protected');
      const items = within(screen.getByRole('list', { name: 'Not protected yet' })).getAllByRole('listitem');
      expect(items.map((item) => item.getAttribute('data-status'))).toEqual(['unknown', 'unknown']);
      expect(within(items[0] as HTMLElement).getByText('You stopped waiting. It may still go through: check again.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Try again for/ })).toBeNull();
      // Nothing is written while the chain does not show the lock.
      expect(page.api.calls).toEqual([]);
      expect(page.ports.protectedAccounts.getSnapshot()).toEqual([]);
      expect(page.ports.secondKeys.getSnapshot()).toEqual([]);

      w.chain.landHeld();
      await page.user.click(screen.getByRole('button', { name: 'Check again' }));
      await finished('2 stake accounts are protected');
      expect(lockOf(w, S1)?.custodian).toBe(w.K.address);
      await waitFor(() => {
        expect(page.api.calls).toEqual([[S1, S2]]);
      });
      expect([...page.ports.protectedAccounts.getSnapshot()].sort()).toEqual([S1, S2].sort());
      expect(page.ports.secondKeys.getSnapshot()).toEqual([w.K.address]);
      expect(main.requests).toHaveLength(1);
      expect(second.requests).toHaveLength(1);
    },
    TIMEOUT,
  );
});

describe('/protect step gates', () => {
  it(
    'names link accounts before the main key; leaves out other keys’ accounts; locks held by others cannot be chosen; the seed box is required; devnet offers 6 periods',
    async () => {
      const w = await world();
      const other = await w.testChain.fundedKey();
      const stranger = (await generateKeyPairSigner()).address;
      const S1 = await w.testChain.createStakeAccount({ staker: w.A.address, withdrawer: w.A.address });
      const theirs = await w.testChain.createStakeAccount({ staker: other.address, withdrawer: other.address });
      const locked = await w.testChain.createStakeAccount({
        staker: w.A.address,
        withdrawer: w.A.address,
        lockup: { unixTimestamp: START_UNIX_TIMESTAMP + 100n * DAY, epoch: 0n, custodian: stranger },
      });
      const [main, second] = await twoWallets(w);
      const { user } = renderProtect(w, [S1, theirs, locked], [main, second]);

      expect(screen.getByText('From your link: 3 stake accounts. Connect their main key to continue.')).toBeInTheDocument();
      // Continue without the main key says what is missing and moves focus there.
      await user.click(continueButton());
      const needMain = screen.getByText('Connect your main key to continue.');
      expect(continueButton()).toHaveAccessibleDescription('Connect your main key to continue.');
      expect(needMain.closest('[data-slot="step-blockers"]')).toHaveFocus();

      await connect(user, 'Main key', 'Main Wallet');
      await waitFor(() => {
        expect(selectBox(S1)).toBeChecked();
      }, WAIT);
      // Another key's lock: shown, not selectable.
      expect(selectBox(locked)).toBeDisabled();
      expect(selectBox(locked)).not.toBeChecked();
      expect(screen.getByText('Locked by another key. Only that key can change this lock.')).toBeInTheDocument();
      // The link named an account this main key cannot withdraw (DECISIONS.md D36).
      expect(screen.queryByRole('checkbox', { name: `Protect stake account ${shortAddress(theirs)}` })).toBeNull();
      const outside = document.querySelector('[data-slot="left-out"]') as HTMLElement;
      expect(within(outside).getByText(/Left out: the connected main key cannot withdraw/)).toBeInTheDocument();
      expect(within(outside).getByText(shortAddress(theirs))).toBeInTheDocument();
      expect(screen.getByText('1 stake account selected')).toBeInTheDocument();

      await user.click(continueButton());
      await screen.findByRole('heading', { name: 'Connect your second key' });
      expect(screen.getByRole('heading', { name: 'Connect your second key' })).toHaveFocus();
      await connect(user, 'Second key', 'Second Wallet');
      await user.click(continueButton());
      expect(screen.getByText('Confirm that your second key comes from a different seed phrase.')).toBeInTheDocument();
      expect(continueButton()).toHaveAccessibleDescription('Confirm that your second key comes from a different seed phrase.');
      expect(screen.getByRole('heading', { name: 'Connect your second key' })).toBeInTheDocument();

      await user.click(screen.getByRole('checkbox', { name: 'My second key comes from a different seed phrase' }));
      expect(screen.queryByText('Confirm that your second key comes from a different seed phrase.')).toBeNull();
      await user.click(continueButton());
      await screen.findByRole('heading', { name: 'How long should the lock hold?' });
      expect(screen.getAllByRole('radio')).toHaveLength(6);
      expect(screen.getByRole('radio', { name: '10 minutes (devnet test)' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: '1 hour (devnet test)' })).toBeInTheDocument();

      // Back keeps what was entered.
      await user.click(screen.getByRole('radio', { name: '12 months' }));
      await user.click(screen.getByRole('button', { name: 'Back' }));
      expect(screen.getByRole('checkbox', { name: 'My second key comes from a different seed phrase' })).toBeChecked();
      await user.click(continueButton());
      expect(await screen.findByRole('radio', { name: '12 months' })).toBeChecked();
    },
    TIMEOUT,
  );

  it(
    'a second key that manages staking of a chosen account blocks Continue; Leave it out removes it from the URL',
    async () => {
      const w = await world();
      const S1 = await w.testChain.createStakeAccount({ staker: w.A.address, withdrawer: w.A.address });
      const S3 = await w.testChain.createStakeAccount({ staker: w.K.address, withdrawer: w.A.address });
      const [main, second] = await twoWallets(w);
      const { user, location } = renderProtect(w, [S1, S3], [main, second]);

      await connect(user, 'Main key', 'Main Wallet');
      await waitFor(() => {
        expect(selectBox(S3)).toBeChecked();
      }, WAIT);
      await user.click(continueButton());
      await screen.findByRole('heading', { name: 'Connect your second key' });
      await connect(user, 'Second key', 'Second Wallet');
      expect(
        screen.getByText(
          `This wallet manages staking for stake account ${shortAddress(S3)}. Choose another wallet as your second key, or leave that stake account out.`,
        ),
      ).toBeInTheDocument();
      await user.click(screen.getByRole('checkbox', { name: 'My second key comes from a different seed phrase' }));
      await user.click(continueButton());
      expect(
        screen.getByText('This second key cannot lock every chosen stake account. Choose another second key, or leave those stake accounts out.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Connect your second key' })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: `Leave ${shortAddress(S3)} out` }));
      expect(location.history.at(-1)).toBe(`/protect?account=${S1}`);
      expect(screen.queryByText(/This wallet manages staking/)).toBeNull();
      await user.click(continueButton());
      await screen.findByRole('heading', { name: 'How long should the lock hold?' });
    },
    TIMEOUT,
  );

  it(
    'leaving out the only chosen account: Continue says none is left and goes no further; nothing is signed',
    async () => {
      const w = await world();
      const S3 = await w.testChain.createStakeAccount({ staker: w.K.address, withdrawer: w.A.address });
      const [main, second] = await twoWallets(w);
      const { user, location, api } = renderProtect(w, [S3], [main, second]);

      await connect(user, 'Main key', 'Main Wallet');
      await waitFor(() => {
        expect(selectBox(S3)).toBeChecked();
      }, WAIT);
      await user.click(continueButton());
      await screen.findByRole('heading', { name: 'Connect your second key' });
      await connect(user, 'Second key', 'Second Wallet');
      await user.click(screen.getByRole('checkbox', { name: 'My second key comes from a different seed phrase' }));
      await user.click(screen.getByRole('button', { name: `Leave ${shortAddress(S3)} out` }));
      expect(location.history.at(-1)).toBe('/protect');

      await user.click(continueButton());
      const noneLeft = 'No stake account is left to protect. Go back and choose at least one.';
      expect(screen.getByText(noneLeft)).toBeInTheDocument();
      expect(continueButton()).toHaveAccessibleDescription(noneLeft);
      expect(screen.getByRole('heading', { name: 'Connect your second key' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'How long should the lock hold?' })).toBeNull();
      expect(main.requests).toHaveLength(0);
      expect(second.requests).toHaveLength(0);
      expect(api.calls).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    `more than ${String(10)} accounts in one run: Continue asks to choose fewer`,
    async () => {
      const w = await world();
      const accounts: Address[] = [];
      for (let i = 0; i < 11; i += 1) {
        accounts.push(await w.testChain.createStakeAccount({ staker: w.A.address, withdrawer: w.A.address }));
      }
      const [main, second] = await twoWallets(w);
      const { user } = renderProtect(w, accounts, [main, second]);
      await connect(user, 'Main key', 'Main Wallet');
      await waitFor(() => {
        expect(screen.getAllByRole('checkbox', { name: /^Protect stake account / }).filter((box) => box.getAttribute('aria-checked') === 'true')).toHaveLength(11);
      }, WAIT);
      expect(screen.getByText('11 stake accounts selected')).toBeInTheDocument();
      await user.click(continueButton());
      expect(
        screen.getByText('Choose up to 10 stake accounts at a time. Protect these first, then come back for the rest.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Choose the stake accounts to protect' })).toBeInTheDocument();

      // Unticking one is enough.
      await user.click(selectBox(accounts[10] as Address));
      expect(screen.queryByText(/Choose up to 10 stake accounts/)).toBeNull();
      await user.click(continueButton());
      await screen.findByRole('heading', { name: 'Connect your second key' });
    },
    TIMEOUT,
  );

  it(
    'one wallet holds both keys: switching accounts between the signatures, without a wallet request',
    async () => {
      const w = await world();
      const { S1, S2 } = await twoAccounts(w);
      const both = await createTestWalletPort({ name: 'Both Wallet', signers: [w.A, w.K] });
      const page = renderProtect(w, [S1, S2], [both]);
      const { user } = page;

      await connect(user, 'Main key', 'Both Wallet');
      await screen.findAllByRole('checkbox', { name: /^Protect stake account / }, WAIT);
      await user.click(continueButton());
      await screen.findByRole('heading', { name: 'Connect your second key' });
      await connect(user, 'Second key', 'Both Wallet');
      expect(page.ports.slots.getSnapshot().second?.address).toBe(w.K.address);
      expect(screen.getByText(/^Both keys are in Both Wallet\./)).toBeInTheDocument();
      await user.click(screen.getByRole('checkbox', { name: 'My second key comes from a different seed phrase' }));
      await user.click(continueButton());
      await screen.findByText(`Locked until ${formatUtcDate(T) ?? ''}`, undefined, WAIT);
      await user.click(continueButton());

      await click(user, 'Sign 2 transactions in Both Wallet as Main key');
      await screen.findByRole('button', { name: 'Sign 2 transactions in Both Wallet as Second key' }, WAIT);
      expect(
        screen.getByText('Both Wallet holds more than one of your keys. Switch Both Wallet to the account of your Second key, then sign.'),
      ).toBeInTheDocument();

      // The user forgot to switch: the wallet offers the main account only. No request reaches the wallet.
      both.setExposedAccounts([w.A.address]);
      await click(user, 'Sign 2 transactions in Both Wallet as Second key');
      await screen.findByText('Both Wallet does not offer this account right now:', undefined, WAIT);
      expect(screen.getByText('Switch to your second account in the wallet, then press Continue.')).toBeInTheDocument();
      expect(both.requests).toHaveLength(1);

      both.setExposedAccounts([w.K.address]);
      await user.click(screen.getByRole('button', { name: 'Continue' }));
      await finished('2 stake accounts are protected');
      expect(both.requests).toHaveLength(2);
      expect(both.requests[1]?.address).toBe(w.K.address);
      expect(lockOf(w, S1)?.custodian).toBe(w.K.address);
      expect(lockOf(w, S2)?.custodian).toBe(w.K.address);
    },
    TIMEOUT,
  );
});

describe('protectPlan reads every account fresh and decides it', () => {
  it(
    'refuses what it cannot lock, reports a lock already there as done and builds the rest',
    async () => {
      const w = await world();
      const other = await w.testChain.fundedKey();
      const stranger = (await generateKeyPairSigner()).address;
      const A = w.A.address;
      const K = w.K.address;
      const lock = (custodian: Address, unixTimestamp: bigint) => ({ unixTimestamp, epoch: 0n, custodian });
      const open = await w.testChain.createStakeAccount({ staker: A, withdrawer: A });
      const theirs = await w.testChain.createStakeAccount({ staker: other.address, withdrawer: other.address });
      const byOther = await w.testChain.createStakeAccount({ staker: A, withdrawer: A, lockup: lock(stranger, T) });
      const otherDate = await w.testChain.createStakeAccount({ staker: A, withdrawer: A, lockup: lock(K, T + DAY) });
      const already = await w.testChain.createStakeAccount({ staker: A, withdrawer: A, lockup: lock(K, T) });
      const managed = await w.testChain.createStakeAccount({ staker: K, withdrawer: A });
      const ownLock = await w.testChain.createStakeAccount({ staker: A, withdrawer: A, lockup: lock(A, T + DAY) });
      const missing = (await generateKeyPairSigner()).address;

      const ids = [missing, A, theirs, byOther, otherDate, already, managed, open, ownLock];
      const { clock, jobs } = await protectPlan({ mainKey: A, secondKey: K, lockUntil: T }).prepare(w.chain, ids);
      expect(clock.unixTimestamp).toBe(START_UNIX_TIMESTAMP);
      const kinds = ids.map((id) => {
        const job = jobs[id];
        return job?.kind === 'refused' ? job.reason : job?.kind;
      });
      expect(kinds).toEqual([
        'not-found',
        'not-stake-account',
        'not-main-key',
        'locked-by-other',
        'already-protected',
        'done',
        'second-key-rule',
        'build',
        // A lock the main key holds itself protects nothing; the main key signs as its holder (D14).
        'build',
      ]);
      expect(jobs[open]).toEqual({
        kind: 'build',
        action: { kind: 'protect', stakeAccount: open, mainKey: A, secondKey: K, lockUntil: T },
        feePayer: A,
        before: w.testChain.stakeAccount(open),
      });

      // A lock end within a minute of the cluster clock is refused.
      const soon = await protectPlan({ mainKey: A, secondKey: K, lockUntil: START_UNIX_TIMESTAMP + 60n }).prepare(w.chain, [open]);
      expect(soon.jobs[open]).toMatchObject({ kind: 'refused', reason: 'lock-end-passed' });

      // By link (step 7 spec 10.1): the same decisions, on the main key's nonce, the second key signing remotely.
      const live = protectPlan({ mainKey: A, secondKey: K, lockUntil: T });
      expect(live.nonce).toBeUndefined();
      expect(live.remote).toBeUndefined();
      const nonceAccount = (await generateKeyPairSigner()).address;
      const linked = protectPlan({ mainKey: A, secondKey: K, lockUntil: T, link: { nonceAccount } });
      expect(linked.nonce).toEqual({ nonceAccount, nonceAuthority: A });
      expect(linked.remote).toEqual([K]);
      expect((await linked.prepare(w.chain, ids)).jobs).toEqual(jobs);
    },
    TIMEOUT,
  );

  it('says each refusal in plain words, and an unknown one as an unknown error', () => {
    expect(refusalText('lock-end-passed')).toBe('The chosen lock end is too close or has passed. Choose the lock period again.');
    expect(refusalText('not-main-key')).toBe('The connected main key can no longer withdraw this stake account.');
    expect(refusalText('something-else')).toBe('Something went wrong. Refresh to see the current state, then try again.');
  });
});
