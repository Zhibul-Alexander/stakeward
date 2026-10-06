// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { generateKeyPairSigner, type Address, type KeyPairSigner, type ReadonlyUint8Array } from '@solana/kit';
import {
  buildTransaction,
  formatSol,
  formatUtcDate,
  lockupEndForPeriod,
  networkFeeFor,
  shortAddress,
  ZERO_ADDRESS,
  type Lockup,
  type SimulationResult,
} from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { LAMPORTS_PER_SOL, START_EPOCH, START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { editMessage } from '@stakeward/core/test/craft';
import { createTestWalletPort, type TestWalletPort } from '@stakeward/core/test/test-wallet-port';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { AppPage } from '@/pages/AppPage';
import { knownSecondKeys, PortsProvider, type Ports } from '@/ports';
import { CountingChain } from './support/counting-chain.ts';
import {
  click,
  connect,
  connectAndContinue,
  lastSignature,
  renderStakePage,
  SCENARIO_TIMEOUT,
  summarySigners,
  WAIT,
} from './support/stake-pages.tsx';

// /second-key/:account (F7, live signing) end to end on the real stake program: the second key K hands the lock to a new
// second key K2 that the user connects, both sign, the lock keeps its end. K2 pays when it holds enough SOL; otherwise
// the main key pays and signs too; K never pays. Afterwards this device knows K2 as a second key and no longer K.

const SEED_CHECK = 'My new second key comes from a different seed phrase than my main key';
const NEED_NEW_KEY = 'Connect your new second key to continue.';
const NEED_SEED = 'Confirm that your new second key comes from a different seed phrase than your main key.';
const DAY = 86_400n;
/** The lock now: a protect of 6 months from the chain's start. */
const T = lockupEndForPeriod(START_UNIX_TIMESTAMP, 6);
const DATE = formatUtcDate(T) ?? '';

type World = { testChain: TestChain; chain: LiteSvmChain; A: KeyPairSigner; K: KeyPairSigner; K2: KeyPairSigner };

/** A funded main key A, a funded second key K, and a new second key K2 holding `newKeyLamports`. */
async function world(newKeyLamports: bigint): Promise<World> {
  const testChain = await TestChain.create();
  const [A, K, K2] = await Promise.all([testChain.fundedKey(), testChain.fundedKey(), generateKeyPairSigner()]);
  if (newKeyLamports > 0n) testChain.airdrop(K2.address, newKeyLamports);
  return { testChain, chain: new LiteSvmChain(testChain), A, K, K2 };
}

function stake(w: World, lockup: Lockup = { unixTimestamp: T, epoch: 0n, custodian: w.K.address }, staker?: Address): Promise<Address> {
  return w.testChain.createStakeAccount({ staker: staker ?? w.A.address, withdrawer: w.A.address, lockup });
}

const wallet = (name: string, signer: KeyPairSigner) => createTestWalletPort({ name, signers: [signer] });

const heading = (name: string | RegExp) => screen.findByRole('heading', { name }, WAIT);

async function theSummary(): Promise<HTMLElement> {
  return waitFor(() => {
    const found = document.querySelectorAll<HTMLElement>('[data-slot="transaction-summary"]');
    expect(found).toHaveLength(1);
    return found[0] as HTMLElement;
  }, WAIT);
}

/** The choose step: connect the new second key's wallet in the slot this page calls New second key. */
async function connectNewKey(user: ReturnType<typeof renderStakePage>['user'], walletName: string) {
  await heading('Connect your new second key');
  await connect(user, 'New second key', walletName);
}

describe('/second-key/:account: hand the lock to a new second key (F7)', () => {
  it(
    'S1: the new second key pays; both keys sign; the end stays; the old key is forgotten and the new one known',
    async () => {
      const w = await world(LAMPORTS_PER_SOL / 100n);
      const S = await stake(w);
      // A second account the old key still holds: after the change this device no longer counts K as a second key.
      const S2 = await stake(w);
      const [second, newKey] = await Promise.all([wallet('Second Wallet', w.K), wallet('New Key Wallet', w.K2)]);
      const { user, ports } = renderStakePage(w.chain, `/second-key/${S}`, [second, newKey]);
      ports.secondKeys.remember(w.K.address);

      await screen.findByRole('heading', { level: 1, name: 'Change the second key' }, WAIT);
      await heading('Connect your new second key');
      // Who holds the lock now, in full; the slot for the new key is named for what it is here.
      const current = document.querySelector('[data-slot="current-second-key"]') as HTMLElement;
      expect(within(current).getByText(w.K.address)).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'New second key' })).toBeInTheDocument();
      expect(screen.queryByRole('group', { name: 'New wallet' })).not.toBeInTheDocument();
      // Two wallets sign here: a phone wallet's own browser cannot (UX rule 10).
      expect(
        screen.getByText("Both second keys sign in this browser. A phone wallet's own browser offers only that wallet: use a desktop browser."),
      ).toBeInTheDocument();
      // The risks before the action, with the date (UX rule 6).
      expect(document.querySelector('[data-risk="second-key-can-freeze"]')).toHaveTextContent(
        `Whoever holds the second key can freeze this stake by moving the lock date. Keep it as safe as the main key.This change keeps the end of the lock: ${DATE}.`,
      );
      expect(document.querySelector('[data-risk="lose-second-key"]')).toHaveTextContent(DATE);

      // Continue says what is missing.
      await click(user, 'Continue');
      expect(await screen.findByText(NEED_NEW_KEY)).toBeInTheDocument();
      expect(screen.getByText(NEED_SEED)).toBeInTheDocument();

      await connectNewKey(user, 'New Key Wallet');
      const shown = document.querySelector('[data-slot="new-second-key"]') as HTMLElement;
      expect(within(shown).getByText(w.K2.address)).toBeInTheDocument();
      await user.click(screen.getByRole('checkbox', { name: SEED_CHECK }));
      await click(user, 'Continue');

      await heading('Hand the lock to your new second key');
      expect(
        screen.getByText("On a Ledger, check that the new authority it shows is your new second key's address before you approve."),
      ).toBeInTheDocument();
      await screen.findByRole('button', { name: 'Sign in New Key Wallet as New second key' }, WAIT);
      const summary = await theSummary();
      expect(summary).toHaveAttribute('data-kind', 'change-second-key');
      expect(within(summary).getByRole('heading', { name: 'Change the second key' })).toBeInTheDocument();
      // The new key pays and signs first, then the old one; no main key, and the roles say which is which.
      expect(summarySigners(summary)).toEqual(['new', 'second']);
      const newSigner = summary.querySelector('[data-signer="new"]') as HTMLElement;
      expect(within(newSigner).getByText('New second key')).toBeInTheDocument();
      expect(within(newSigner).getByText('Pays the network fee')).toBeInTheDocument();
      expect(within(summary).getByText('It cannot change when the lock ends.')).toBeInTheDocument();
      expect(screen.queryByText(/so your main key would pay and sign too/)).not.toBeInTheDocument();
      const signers = screen.getByRole('list', { name: 'Signatures' });
      expect(within(signers).getAllByRole('listitem').map((item) => item.getAttribute('data-role'))).toEqual(['new', 'second']);
      expect(within(signers).getByText('1. New second key in New Key Wallet')).toBeInTheDocument();

      const kBefore = w.testChain.balance(w.K.address);
      const k2Before = w.testChain.balance(w.K2.address);
      await click(user, 'Sign in New Key Wallet as New second key');
      await connectAndContinue(user, 'Second key', 'Second Wallet');
      await click(user, 'Sign in Second Wallet as Second key');

      await heading('Your new second key holds the lock');
      const done = document.querySelector('[data-slot="second-key-done"]') as HTMLElement;
      expect(within(done).getByText(w.K2.address)).toBeInTheDocument();
      expect(within(done).getByText(w.K.address)).toBeInTheDocument();
      expect(within(done).getByText(`The lock still ends on ${DATE}.`)).toBeInTheDocument();
      expect(within(done).getByRole('link', { name: 'Open the recovery card' })).toHaveAttribute('href', `/recovery/${S}`);
      const id = lastSignature(newKey);
      expect(within(done).getByRole('link', { name: `View ${shortAddress(id)} on Solana Explorer (opens in a new tab)` })).toHaveAttribute(
        'href',
        expect.stringContaining(`/tx/${id}`),
      );

      // The chain: K2 holds the lock, the end and epoch did not move; K2 paid, K paid nothing.
      expect(w.testChain.stakeAccount(S)?.lockup).toEqual({ unixTimestamp: T, epoch: 0n, custodian: w.K2.address });
      expect(w.testChain.balance(w.K2.address)).toBe(k2Before - networkFeeFor(2));
      expect(w.testChain.balance(w.K.address)).toBe(kBefore);
      expect(newKey.requests).toHaveLength(1);
      expect(second.requests).toHaveLength(1);

      // This device: K2 is a second key now, K is not (it may be stolen); K2 moved to the Second key slot.
      expect(ports.secondKeys.getSnapshot()).toEqual([w.K2.address]);
      const slots = ports.slots.getSnapshot();
      expect(slots.second).toEqual({ walletId: newKey.id, address: w.K2.address });
      expect(slots.new).toBeNull();
      expect(knownSecondKeys(slots, ports.wallets.getSnapshot(), ports.secondKeys.getSnapshot())).toEqual([w.K2.address]);
      // The page's own row reads the account again: Protected, with the new key.
      await waitFor(() => {
        expect(document.querySelector('article[data-slot="account-row"]')).toHaveAttribute('data-status', 'protected');
      }, WAIT);
      // Nothing else is written on this device (D37).
      expect(ports.protectedAccounts.getSnapshot()).toEqual([]);

      // /app on this device: the account is Protected with K2; the other account K still holds is no longer.
      cleanup();
      await renderApp(ports, `/app?address=${w.A.address}`);
      const row = await screen.findByRole('article', { name: `Stake account ${shortAddress(S)}` }, WAIT);
      await waitFor(() => {
        expect(row).toHaveAttribute('data-status', 'protected');
      }, WAIT);
      // Protected only because K2 is a known second key now (D35: the chain cannot say whose key holds a lock)...
      expect(w.testChain.stakeAccount(S)?.lockup.custodian).toBe(w.K2.address);
      // ...and the account the old key still holds is someone else's lock to this device, shown with that key.
      const other = screen.getByRole('article', { name: `Stake account ${shortAddress(S2)}` });
      expect(other).toHaveAttribute('data-status', 'locked-by-other');
      expect(other.querySelector('[data-slot="lock-holder"]')).toHaveTextContent(shortAddress(w.K.address));
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'S2: a new second key without SOL: the main key pays and signs first; after funding it, Check again lets the new key pay',
    async () => {
      const w = await world(0n);
      const S = await stake(w);
      const [main, second, newKey] = await Promise.all([
        wallet('Main Wallet', w.A),
        wallet('Second Wallet', w.K),
        wallet('New Key Wallet', w.K2),
      ]);
      const { user } = renderStakePage(w.chain, `/second-key/${S}`, [main, second, newKey]);
      const rent0 = await w.chain.getMinimumBalanceForRentExemption(0);

      await connectNewKey(user, 'New Key Wallet');
      await user.click(screen.getByRole('checkbox', { name: SEED_CHECK }));
      await click(user, 'Continue');
      await screen.findByText(
        `Your new second key has too little SOL for the network fee, so your main key would pay and sign too. If your main key may be stolen, do not use it: send your new second key at least ${formatSol(networkFeeFor(2) + rent0)} from another wallet, then press Check again.`,
        undefined,
        WAIT,
      );
      const summary = await theSummary();
      expect(summarySigners(summary)[0]).toBe('main');
      expect([...summarySigners(summary)].sort()).toEqual(['main', 'new', 'second']);
      expect(within(summary.querySelector('[data-signer="main"]') as HTMLElement).getByText('Pays the network fee')).toBeInTheDocument();

      // The main key pays for all three signatures; the old key pays nothing.
      const aBefore = w.testChain.balance(w.A.address);
      const kBefore = w.testChain.balance(w.K.address);
      await connectAndContinue(user, 'Main key', 'Main Wallet');
      await click(user, 'Sign in Main Wallet as Main key');
      // The other two in message order, each connected when its turn comes.
      for (let turn = 0; turn < 2; turn += 1) {
        const needsSecond = await screen
          .findByText('Connect your Second key to continue: it must sign these transactions.', undefined, { timeout: 500 })
          .then(() => true)
          .catch(() => false);
        if (needsSecond) {
          await connect(user, 'Second key', 'Second Wallet');
          await user.click(screen.getByRole('button', { name: 'Continue' }));
          await click(user, 'Sign in Second Wallet as Second key');
        } else {
          await click(user, 'Sign in New Key Wallet as New second key');
        }
      }

      await heading('Your new second key holds the lock');
      expect(w.testChain.stakeAccount(S)?.lockup).toEqual({ unixTimestamp: T, epoch: 0n, custodian: w.K2.address });
      expect(w.testChain.balance(w.A.address)).toBe(aBefore - networkFeeFor(3));
      expect(w.testChain.balance(w.K.address)).toBe(kBefore);
      expect(w.testChain.balance(w.K2.address)).toBe(0n);
      expect([main, second, newKey].map((port) => port.requests.length)).toEqual([1, 1, 1]);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'S3: funding the new key after the "main key pays" note: Check again builds it with the new key paying',
    async () => {
      const w = await world(0n);
      const S = await stake(w);
      const [main, second, newKey] = await Promise.all([
        wallet('Main Wallet', w.A),
        wallet('Second Wallet', w.K),
        wallet('New Key Wallet', w.K2),
      ]);
      const { user } = renderStakePage(w.chain, `/second-key/${S}`, [main, second, newKey]);
      await connectNewKey(user, 'New Key Wallet');
      await user.click(screen.getByRole('checkbox', { name: SEED_CHECK }));
      await click(user, 'Continue');
      await screen.findByText(/so your main key would pay and sign too/, undefined, WAIT);

      w.testChain.airdrop(w.K2.address, LAMPORTS_PER_SOL / 100n);
      await click(user, 'Check again');
      await screen.findByRole('button', { name: 'Sign in New Key Wallet as New second key' }, WAIT);
      expect(summarySigners(await theSummary())).toEqual(['new', 'second']);
      expect(screen.queryByText(/so your main key would pay and sign too/)).not.toBeInTheDocument();
      await click(user, 'Sign in New Key Wallet as New second key');
      await connectAndContinue(user, 'Second key', 'Second Wallet');
      await click(user, 'Sign in Second Wallet as Second key');
      await heading('Your new second key holds the lock');
      expect(main.requests).toHaveLength(0);
    },
    SCENARIO_TIMEOUT,
  );
});

describe('/second-key/:account: what it refuses, in plain words', () => {
  it(
    'R1: the main key cannot be the new second key: the slot refuses it, nothing is asked',
    async () => {
      const w = await world(LAMPORTS_PER_SOL / 100n);
      const S = await stake(w);
      const main = await wallet('Main Wallet', w.A);
      const { user } = renderStakePage(w.chain, `/second-key/${S}`, [main]);
      await heading('Connect your new second key');
      const slot = screen.getByRole('group', { name: 'New second key' });
      await user.click(within(slot).getByRole('button', { name: 'Connect a wallet as New second key' }));
      await user.click(within(slot).getByRole('button', { name: 'Main Wallet' }));
      expect(await within(slot).findByText('This account is already your Main key.')).toBeInTheDocument();
      expect(within(slot).getByText("Switch to your new second key's account in the wallet, then press Continue.")).toBeInTheDocument();
      expect(document.querySelector('[data-slot="new-second-key"]')).toBeNull();
      await user.click(screen.getByRole('checkbox', { name: SEED_CHECK }));
      // The page's Continue, not the slot's own (which looks again after switching accounts).
      const pageContinue = screen.getAllByRole('button', { name: 'Continue' }).find((button) => !slot.contains(button));
      if (pageContinue === undefined) throw new Error("no page's Continue");
      await user.click(pageContinue);
      expect(await screen.findByText(NEED_NEW_KEY)).toBeInTheDocument();
      expect(main.requests).toHaveLength(0);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'R2: the key that holds the lock now, or the key that manages staking, cannot be the new second key',
    async () => {
      const w = await world(LAMPORTS_PER_SOL / 100n);
      const service = await generateKeyPairSigner();
      const S = await stake(w, { unixTimestamp: T, epoch: 0n, custodian: w.K.address }, service.address);
      const [second, staking] = await Promise.all([wallet('Second Wallet', w.K), wallet('Service Wallet', service)]);
      const { user, ports } = renderStakePage(w.chain, `/second-key/${S}`, [second, staking]);

      await connectNewKey(user, 'Second Wallet');
      const problems = await screen.findByText('This is the second key that holds the lock now. Choose a wallet from a new seed phrase.');
      expect(problems.closest('[data-slot="new-key-problems"]')).toHaveAttribute('data-tone', 'danger');
      await user.click(screen.getByRole('checkbox', { name: SEED_CHECK }));
      await click(user, 'Continue');
      expect(await screen.findByText('Choose another wallet as your new second key.')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Hand the lock to your new second key' })).not.toBeInTheDocument();

      const slot = screen.getByRole('group', { name: 'New second key' });
      await user.click(within(slot).getByRole('button', { name: /^Disconnect/ }));
      await connect(user, 'New second key', 'Service Wallet');
      expect(
        await screen.findByText('This wallet manages staking for this stake account. Choose another wallet as your new second key.'),
      ).toBeInTheDocument();
      expect(second.requests).toHaveLength(0);
      expect(staking.requests).toHaveLength(0);
      expect(ports.secondKeys.getSnapshot()).toEqual([]);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'R3: no lock, or a lock an epoch holds: explained, with the way forward, and nothing to sign',
    async () => {
      const w = await world(0n);
      const open = await stake(w, { unixTimestamp: 0n, epoch: 0n, custodian: ZERO_ADDRESS });
      const byEpoch = await stake(w, { unixTimestamp: 0n, epoch: START_EPOCH + 5n, custodian: w.K.address });

      renderStakePage(w.chain, `/second-key/${open}`, []);
      await screen.findByText('This stake account has no lock that a second key holds, so there is no second key to change.', undefined, WAIT);
      expect(screen.getByRole('link', { name: 'Protect it' })).toHaveAttribute('href', `/protect?account=${open}`);
      expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
      cleanup();

      renderStakePage(w.chain, `/second-key/${byEpoch}`, []);
      await screen.findByText(
        `This lock is held until epoch ${String(START_EPOCH + 5n)}. Stakeward changes the second key only of a lock that ends on a date, so it leaves this one alone. The recovery card shows the command that can.`,
        undefined,
        WAIT,
      );
      expect(screen.getByRole('link', { name: 'Recovery card' })).toHaveAttribute('href', `/recovery/${byEpoch}`);
      expect(screen.queryByRole('group', { name: 'New second key' })).not.toBeInTheDocument();
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'R4: another key took the lock before Continue (a thief with the old key): refused in plain words, nothing asked, Back',
    async () => {
      const w = await world(LAMPORTS_PER_SOL / 100n);
      const S = await stake(w);
      const [second, newKey] = await Promise.all([wallet('Second Wallet', w.K), wallet('New Key Wallet', w.K2)]);
      const { user } = renderStakePage(w.chain, `/second-key/${S}`, [second, newKey]);
      await connectNewKey(user, 'New Key Wallet');
      await user.click(screen.getByRole('checkbox', { name: SEED_CHECK }));

      // The thief holds K too, and hands the lock to a key of their own first.
      const thief = await w.testChain.fundedKey();
      const handOver = buildTransaction(
        { kind: 'change-second-key', stakeAccount: S, secondKey: w.K.address, newSecondKey: thief.address },
        { feePayer: thief.address, lifetime: w.testChain.blockhashLifetime() },
      );
      expect((await w.testChain.send(handOver.bytes, [thief, w.K])).ok).toBe(true);

      await click(user, 'Continue');
      await heading('Second key change');
      const list = screen.getByRole('list', { name: 'Second key change' });
      expect(within(list).getByText('Another key holds this lock now. Only that key can hand it over.')).toBeInTheDocument();
      expect(second.requests).toHaveLength(0);
      expect(newKey.requests).toHaveLength(0);
      await click(user, 'Back');
      await heading('Connect your new second key');
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'R5: the thief moves the lock while this page simulates: the network refusal reads in plain words; Try again explains why',
    async () => {
      const w = await world(LAMPORTS_PER_SOL / 100n);
      const S = await stake(w);
      const thief = await w.testChain.fundedKey();
      const chain = new RaceChain(w.chain, async () => {
        // On the blockhash the page built with: LiteSVM keeps only the latest one valid, and a new one would expire it.
        const latest = { kind: 'blockhash' as const, blockhash: w.testChain.svm.latestBlockhash(), lastValidBlockHeight: 0n };
        const handOver = buildTransaction(
          { kind: 'change-second-key', stakeAccount: S, secondKey: w.K.address, newSecondKey: thief.address },
          { feePayer: thief.address, lifetime: latest },
        );
        expect((await w.testChain.send(handOver.bytes, [thief, w.K])).ok).toBe(true);
      });
      const [second, newKey] = await Promise.all([wallet('Second Wallet', w.K), wallet('New Key Wallet', w.K2)]);
      const { user } = renderStakePage(chain, `/second-key/${S}`, [second, newKey]);
      await connectNewKey(user, 'New Key Wallet');
      await user.click(screen.getByRole('checkbox', { name: SEED_CHECK }));
      await click(user, 'Continue');

      await heading('Second key change');
      const list = screen.getByRole('list', { name: 'Second key change' });
      // MissingRequiredSignature from the program, translated by core translateError (UX rule 8).
      expect(
        within(list).getByText('A key that must sign did not, or it no longer controls this stake. Check the connected wallets and try again.'),
      ).toBeInTheDocument();
      expect(newKey.requests).toHaveLength(0);
      await click(user, 'Try again');
      await heading('Second key change');
      expect(
        await within(screen.getByRole('list', { name: 'Second key change' })).findByText(
          'Another key holds this lock now. Only that key can hand it over.',
          undefined,
          WAIT,
        ),
      ).toBeInTheDocument();
      expect(second.requests).toHaveLength(0);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'R6: the change landed meanwhile (another tab): the plan finds it done, asks no wallet, and this device takes the new key',
    async () => {
      const w = await world(LAMPORTS_PER_SOL / 100n);
      const S = await stake(w);
      const [second, newKey] = await Promise.all([wallet('Second Wallet', w.K), wallet('New Key Wallet', w.K2)]);
      const { user, ports } = renderStakePage(w.chain, `/second-key/${S}`, [second, newKey]);
      await connectNewKey(user, 'New Key Wallet');
      await user.click(screen.getByRole('checkbox', { name: SEED_CHECK }));
      const { bytes } = buildTransaction(
        { kind: 'change-second-key', stakeAccount: S, secondKey: w.K.address, newSecondKey: w.K2.address },
        { feePayer: w.K2.address, lifetime: w.testChain.blockhashLifetime() },
      );
      expect((await w.testChain.send(bytes, [w.K2, w.K])).ok).toBe(true);

      await click(user, 'Continue');
      await heading('Your new second key holds the lock');
      expect(second.requests).toHaveLength(0);
      expect(newKey.requests).toHaveLength(0);
      expect(ports.secondKeys.getSnapshot()).toEqual([w.K2.address]);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'R7: the lock ends too soon to hand over: refused before any wallet is asked',
    async () => {
      const w = await world(LAMPORTS_PER_SOL / 100n);
      const S = await stake(w, { unixTimestamp: START_UNIX_TIMESTAMP + 30n, epoch: 0n, custodian: w.K.address });
      const [second, newKey] = await Promise.all([wallet('Second Wallet', w.K), wallet('New Key Wallet', w.K2)]);
      const { user } = renderStakePage(w.chain, `/second-key/${S}`, [second, newKey]);
      await connectNewKey(user, 'New Key Wallet');
      await user.click(screen.getByRole('checkbox', { name: SEED_CHECK }));
      await click(user, 'Continue');
      await heading('Second key change');
      expect(
        screen.getByText('The lock ends too soon to hand it over. Once it has ended, protect the stake again with your new second key.'),
      ).toBeInTheDocument();
      expect(newKey.requests).toHaveLength(0);
    },
    SCENARIO_TIMEOUT,
  );
});

describe('/second-key/:account and the wallets', () => {
  /** The choose step done, the signing step shown: K2's wallet is the first to sign. */
  async function toSigning(w: World, wallets: readonly TestWalletPort[]) {
    const S = await stake(w);
    const page = renderStakePage(w.chain, `/second-key/${S}`, wallets);
    await connectNewKey(page.user, 'New Key Wallet');
    await page.user.click(screen.getByRole('checkbox', { name: SEED_CHECK }));
    await click(page.user, 'Continue');
    await screen.findByRole('button', { name: 'Sign in New Key Wallet as New second key' }, WAIT);
    return { ...page, S };
  }

  it(
    'W1: the old key declines in its wallet: nothing is sent, Try again asks it again with the same bytes',
    async () => {
      const w = await world(LAMPORTS_PER_SOL / 100n);
      const [second, newKey] = await Promise.all([wallet('Second Wallet', w.K), wallet('New Key Wallet', w.K2)]);
      const { user, S } = await toSigning(w, [second, newKey]);
      second.once({ reject: true });
      await click(user, 'Sign in New Key Wallet as New second key');
      await connectAndContinue(user, 'Second key', 'Second Wallet');
      await click(user, 'Sign in Second Wallet as Second key');

      await screen.findByText('The request was declined in the wallet. Nothing was sent; you can try again.', undefined, WAIT);
      expect(w.testChain.stakeAccount(S)?.lockup.custodian).toBe(w.K.address);
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      await heading('Your new second key holds the lock');
      expect(second.requests).toHaveLength(2);
      expect(second.requests[1]?.transactions).toEqual(second.requests[0]?.transactions);
      expect(newKey.requests).toHaveLength(1);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'W2: a wallet that hands the lock to another key than the one shown: stopped before anything is sent',
    async () => {
      const w = await world(LAMPORTS_PER_SOL / 100n);
      const thief = await generateKeyPairSigner();
      const [second, newKey] = await Promise.all([wallet('Second Wallet', w.K), wallet('New Key Wallet', w.K2)]);
      const { user, S } = await toSigning(w, [second, newKey]);
      // A compromised wallet of the old key swaps the new second key for the thief's.
      second.once({
        modifyMessage: (bytes) =>
          editMessage(bytes, (message) => ({
            ...message,
            staticAccounts: message.staticAccounts.map((account) => (account === w.K2.address ? thief.address : account)),
          })),
      });
      await click(user, 'Sign in New Key Wallet as New second key');
      await connectAndContinue(user, 'Second key', 'Second Wallet');
      await click(user, 'Sign in Second Wallet as Second key');

      await screen.findByText('The wallet changed the transaction. Nothing was sent.', undefined, WAIT);
      expect(w.testChain.stakeAccount(S)?.lockup.custodian).toBe(w.K.address);
      await user.click(screen.getByRole('button', { name: 'Start again' }));
      await click(user, 'Sign in New Key Wallet as New second key');
      await click(user, 'Sign in Second Wallet as Second key');
      await heading('Your new second key holds the lock');
      expect(w.testChain.stakeAccount(S)?.lockup.custodian).toBe(w.K2.address);
    },
    SCENARIO_TIMEOUT,
  );
});

describe('/second-key/:account entry points', () => {
  it(
    'E1: /extend links to it, and the recovery card says "With Stakeward" for it',
    async () => {
      const w = await world(0n);
      const S = await stake(w, { unixTimestamp: START_UNIX_TIMESTAMP + 100n * DAY, epoch: 0n, custodian: w.K.address });
      const { user, location } = renderStakePage(w.chain, `/extend/${S}`, []);
      const link = await screen.findByRole('link', { name: 'Hand the lock to a new second key' }, WAIT);
      expect(link).toHaveAttribute('href', `/second-key/${S}`);
      await user.click(link);
      expect(location.history.at(-1)).toBe(`/second-key/${S}`);
      await heading('Connect your new second key');
      cleanup();

      renderStakePage(w.chain, `/recovery/${S}`, []);
      const section = await screen.findByRole('region', { name: 'If your second key is stolen' }, WAIT);
      const stakeward = within(section).getByRole('link', { name: `${window.location.origin}/second-key/${S}` });
      expect(stakeward).toHaveAttribute('href', `/second-key/${S}`);
      expect(section).toHaveTextContent(
        'With Stakeward: Change the second key: the old and the new second key sign in one transaction, and the lock keeps its end.',
      );
    },
    SCENARIO_TIMEOUT,
  );
});

/** Renders /app with these ports (this device after the change), as main.tsx would. */
async function renderApp(ports: Ports, path: string) {
  const location = memoryLocation({ path, record: true });
  render(
    <StrictMode>
      <Router hook={location.hook} searchHook={location.searchHook}>
        <PortsProvider ports={ports}>
          <AppPage loadHealth={() => Promise.resolve({ lastMonitorRunAt: new Date() })} />
        </PortsProvider>
      </Router>
    </StrictMode>,
  );
  await screen.findByRole('heading', { level: 1 }, WAIT);
}

/** Runs `race` once, right before the first simulation: something lands between the page's read and its simulation. */
class RaceChain extends CountingChain {
  private race: (() => Promise<void>) | null;

  constructor(inner: LiteSvmChain, race: () => Promise<void>) {
    super(inner);
    this.race = race;
  }

  override async simulate(transaction: ReadonlyUint8Array): Promise<SimulationResult> {
    const race = this.race;
    this.race = null;
    if (race !== null) await race();
    return super.simulate(transaction);
  }
}
