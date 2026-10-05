// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { generateKeyPairSigner, type Address, type KeyPairSigner } from '@solana/kit';
import {
  buildTransaction,
  deriveNonceAccountAddress,
  formatUtcDate,
  inspectTransaction,
  U64_MAX,
  type StakeAccount,
  type TransactionAction,
} from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { START_EPOCH, START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { createTestWalletPort, type TestWalletPort } from '@stakeward/core/test/test-wallet-port';
import { changeStaker, deactivateAs, splitStake } from '@stakeward/core/test/thief';
import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import {
  click,
  connect,
  connectAndContinue,
  lastSignature,
  renderCosignPage,
  renderStakePage,
  SCENARIO_TIMEOUT,
  WAIT,
  type RoleName,
  type Scope,
} from './support/stake-pages.tsx';

// /rescue (F4, step 7 spec 9) end to end on the real stake program: the main key A may be stolen; the new wallet D,
// the main key and the second key K move each stake account to D on D's durable nonce. A thief who holds A changed
// one account's staker and deactivated it; the rescue needs nothing special for it.

const DAY = 86_400n;
const T = START_UNIX_TIMESTAMP + 30n * DAY;
const SOL = 1_000_000_000n;

type World = {
  testChain: TestChain;
  chain: LiteSvmChain;
  A: KeyPairSigner;
  K: KeyPairSigner;
  D: KeyPairSigner;
  vote: Address;
  newWallet: TestWalletPort;
  main: TestWalletPort;
  second: TestWalletPort;
};

async function world(): Promise<World> {
  const testChain = await TestChain.create();
  const [A, K, D, vote] = await Promise.all([
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    testChain.createVoteAccount(),
  ]);
  // A is never funded (a sweeper empties a stolen key); D gets 0.05 SOL from elsewhere.
  testChain.airdrop(D.address, 50_000_000n);
  const [newWallet, main, second] = await Promise.all([
    createTestWalletPort({ name: 'New Wallet', signers: [D] }),
    createTestWalletPort({ name: 'Main Wallet', signers: [A] }),
    createTestWalletPort({ name: 'Second Wallet', signers: [K] }),
  ]);
  return { testChain, chain: new LiteSvmChain(testChain), A, K, D, vote, newWallet, main, second };
}

/** A stake account of A (staker and withdrawer), locked by `custodian` until T, optionally delegated. */
function stake(w: World, options: { custodian?: Address; delegated?: boolean } = {}): Promise<Address> {
  return w.testChain.createStakeAccount({
    staker: w.A.address,
    withdrawer: w.A.address,
    ...(options.custodian === undefined ? {} : { lockup: { unixTimestamp: T, epoch: 0n, custodian: options.custodian } }),
    ...(options.delegated === true ? { delegateTo: { voteAccount: w.vote, stakerKey: w.A } } : {}),
  });
}

const heading = (name: string | RegExp, scope: Scope = screen) => scope.findByRole('heading', { name }, WAIT);

/** The stake accounts on the first step's run list, in order. */
function movableOrder(): string[] {
  const list = document.querySelector('[data-slot="rescue-movable"]');
  return [...(list?.querySelectorAll('[data-slot="account-row"]') ?? [])].map((row) => row.getAttribute('aria-label') ?? '');
}

const rowLabel = (address: Address) => `Stake account ${address.slice(0, 3)}...${address.slice(-3)}`;

/** Steps 1-3 with every key in this browser: the first step as read, the new wallet, then both keys sign here. */
async function throughKeys(
  user: UserEvent,
  options: { secondMode: 'here' | 'link'; chooseSecond?: Address; choices?: readonly Address[] } = { secondMode: 'here' },
) {
  await heading(en.rescue.stake.heading);
  await click(user, 'Continue');
  await heading(en.rescue.newWallet.heading);
  await connect(user, 'New wallet', 'New Wallet');
  await user.click(screen.getByRole('checkbox', { name: en.rescue.newWallet.seedCheck }));
  await screen.findByText(/^Your new wallet has /, undefined, WAIT);
  await click(user, 'Continue');
  await heading(en.rescue.keys.heading);
  if (options.choices !== undefined) {
    const chooser = screen.getByRole('radiogroup', { name: en.rescue.keys.chooseSecond });
    expect(within(chooser).getAllByRole('radio').map((radio) => radio.getAttribute('value'))).toEqual(options.choices);
  }
  if (options.chooseSecond !== undefined) {
    await user.click(screen.getByRole('radio', { name: options.chooseSecond }));
  }
  const mainWhere = screen.getByRole('radiogroup', { name: 'Where does your Main key sign?' });
  await user.click(within(mainWhere).getByRole('radio', { name: 'In this browser' }));
  const secondWhere = screen.getByRole('radiogroup', { name: 'Where does your Second key sign?' });
  await user.click(
    within(secondWhere).getByRole('radio', { name: options.secondMode === 'here' ? 'In this browser' : 'On another device, by link' }),
  );
  await click(user, 'Continue');
  await heading(en.rescue.move.heading);
}

/** The new wallet's link-signing account, set up from the move step (one request to the new wallet). */
async function setUpNonce(user: UserEvent) {
  await click(user, 'Create the link-signing account');
  await click(user, 'Sign in New Wallet as New wallet');
}

type Signer = { role: RoleName; wallet: string };

const NEW: Signer = { role: 'New wallet', wallet: 'New Wallet' };
const MAIN: Signer = { role: 'Main key', wallet: 'Main Wallet' };
const SECOND: Signer = { role: 'Second key', wallet: 'Second Wallet' };

/**
 * The signer whose turn it is among `signers`, and whether its key must be connected first. The new wallet (the fee
 * payer) signs first; the main key and the second key follow in message order, which depends on their addresses.
 */
function nextSigner(signers: readonly Signer[], scope: Scope = screen): Promise<{ signer: Signer; connect: boolean }> {
  return waitFor(() => {
    for (const signer of signers) {
      if (scope.queryByRole('button', { name: `Sign in ${signer.wallet} as ${signer.role}` }) !== null) return { signer, connect: false };
      if (scope.queryByText(`Connect your ${signer.role} to continue: it must sign these transactions.`) !== null) {
        return { signer, connect: true };
      }
    }
    throw new Error(`None of ${signers.map((signer) => signer.role).join(', ')} is asked yet`);
  }, WAIT);
}

/** Signs as `signers` in whatever order the round asks, connecting a key the first time it is asked for. */
async function signAll(
  user: UserEvent,
  signers: readonly Signer[],
  options: { scope?: Scope; before?: (signer: Signer) => void; after?: (signer: Signer) => Promise<void> } = {},
) {
  const scope = options.scope ?? screen;
  const remaining = [...signers];
  while (remaining.length > 0) {
    const { signer, connect } = await nextSigner(remaining, scope);
    if (connect) await connectAndContinue(user, signer.role, signer.wallet, scope);
    options.before?.(signer);
    await click(user, `Sign in ${signer.wallet} as ${signer.role}`, scope);
    await options.after?.(signer);
    remaining.splice(remaining.indexOf(signer), 1);
  }
}

/** One round with all three keys in this browser. */
async function signRound(user: UserEvent, round: number, total: number) {
  await screen.findByText(`Round ${String(round)} of ${String(total)}`, undefined, WAIT);
  await signAll(user, [NEW, MAIN, SECOND]);
}

function sameLockup(after: StakeAccount | null, before: StakeAccount | null) {
  expect(after?.lockup).toEqual(before?.lockup);
}

async function expectNonceRescue(wallet: TestWalletPort, D: Address, from = 0) {
  for (const request of wallet.requests.slice(from)) {
    const inspected = await inspectTransaction(request.transactions[0] ?? new Uint8Array());
    if (!inspected.ok) throw new Error(inspected.error.message);
    expect(inspected.summary.action.kind).toBe('rescue');
    expect(inspected.summary.feePayer).toBe(D);
    expect(inspected.summary.lifetime.kind).toBe('nonce');
  }
}

describe('/rescue: move the stake to a new wallet (F4)', () => {
  it(
    'DW7-1 (R1): three wallets move three accounts, one whose staker a thief changed and deactivated; the rest is left',
    async () => {
      const w = await world();
      const [K2, X] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
      const S1 = await stake(w, { custodian: w.K.address, delegated: true });
      const S2 = await stake(w, { custodian: w.K.address, delegated: true });
      w.testChain.warpToEpoch(START_EPOCH + 1n);
      // The thief, with A only: makes itself the staker of S2 and stops it staking.
      await changeStaker(w.testChain, { stake: S2, withdrawer: w.A, newStaker: X });
      await deactivateAs(w.testChain, { stake: S2, staker: X });
      const S3 = await stake(w);
      const S4 = await stake(w, { custodian: K2.address });
      const before = new Map([S1, S2, S3, S4].map((id) => [id, w.testChain.stakeAccount(id)]));
      expect(before.get(S2)?.staker).toBe(X.address);
      const { user, ports } = renderStakePage(w.chain, `/rescue?address=${w.A.address}`, [w.newWallet, w.main, w.second]);

      // Step 1, no wallet: the reassurance first, then the run order (unlocked first), then what this run leaves.
      await heading(en.rescue.stake.heading);
      await screen.findByText(en.rescue.stake.safeUntil.replace('{date}', formatUtcDate(T) ?? ''), undefined, WAIT);
      expect(screen.getAllByText(w.A.address).length).toBeGreaterThan(0);
      await waitFor(() => {
        expect(movableOrder()).toHaveLength(3);
      }, WAIT);
      const order = movableOrder();
      expect(order[0]).toBe(rowLabel(S3));
      expect(order.slice(1).sort()).toEqual([rowLabel(S1), rowLabel(S2)].sort());
      expect(screen.getByText(en.rescue.stake.unlocked)).toBeInTheDocument();
      const otherKey = document.querySelector<HTMLElement>('[data-slot="rescue-other-key"]');
      expect(otherKey).not.toBeNull();
      expect(within(otherKey as HTMLElement).getByRole('article', { name: rowLabel(S4) })).toBeInTheDocument();
      expect(within(otherKey as HTMLElement).getAllByText(K2.address).length).toBeGreaterThan(0);

      // Two second keys hold locks: K holds more, so it is offered first; the run uses K.
      await throughKeys(user, { secondMode: 'here', chooseSecond: w.K.address, choices: [w.K.address, K2.address] });
      expect(ports.secondKeys.getSnapshot()).toEqual([]);
      expect(screen.getAllByText(w.D.address).length).toBeGreaterThan(0);
      await setUpNonce(user);
      const nonceD = await deriveNonceAccountAddress(w.D.address);
      await signRound(user, 1, 3);
      await signRound(user, 2, 3);
      await signRound(user, 3, 3);

      await heading('3 stake accounts are safe');
      for (const id of [S1, S2, S3]) {
        const after = w.testChain.stakeAccount(id);
        expect(after?.staker).toBe(w.D.address);
        expect(after?.withdrawer).toBe(w.D.address);
        sameLockup(after, before.get(id) ?? null);
      }
      expect(w.testChain.stakeAccount(S4)).toEqual(before.get(S4));
      expect(w.testChain.balance(w.A.address)).toBe(0n);
      expect(w.newWallet.requests).toHaveLength(4);
      expect(w.main.requests).toHaveLength(3);
      expect(w.second.requests).toHaveLength(3);
      await expectNonceRescue(w.main, w.D.address);
      await expectNonceRescue(w.second, w.D.address);
      await expectNonceRescue(w.newWallet, w.D.address, 1);
      const values = new Set<string>();
      for (const request of w.main.requests) {
        const inspected = await inspectTransaction(request.transactions[0] ?? new Uint8Array());
        if (inspected.ok && inspected.summary.lifetime.kind === 'nonce') {
          expect(inspected.summary.lifetime.nonceAccount).toBe(nonceD);
          values.add(inspected.summary.lifetime.nonceValue);
        }
      }
      expect(values.size).toBe(3);
      // Written on this device only once the chain showed the moves: the second key, and the accounts it still locks.
      expect(ports.secondKeys.getSnapshot()).toEqual([w.K.address]);
      expect([...ports.protectedAccounts.getSnapshot()].sort()).toEqual([S1, S2].sort());

      // The old main key and the second key together can no longer withdraw.
      const payer = await w.testChain.fundedKey(1n);
      const theft: TransactionAction = {
        kind: 'withdraw',
        stakeAccount: S1,
        mainKey: w.A.address,
        secondKey: w.K.address,
        recipient: w.A.address,
        lamports: w.testChain.account(S1)?.lamports ?? 0n,
      };
      const { bytes } = buildTransaction(theft, { feePayer: payer.address, lifetime: w.testChain.blockhashLifetime() });
      expect((await w.testChain.send(bytes, [payer, w.A, w.K])).ok).toBe(false);

      // Earn rewards again: only S2 stopped staking; the new wallet delegates it back to the same validator.
      const delegateCard = (await heading(en.rescue.done.delegate.title)).closest<HTMLElement>('[data-slot="card"]');
      expect(delegateCard).not.toBeNull();
      const card = within(delegateCard as HTMLElement);
      expect(card.getByText(rowLabel(S2))).toBeInTheDocument();
      expect(card.queryByText(rowLabel(S1))).not.toBeInTheDocument();
      expect(card.getByText(w.vote)).toBeInTheDocument();
      await click(user, 'Review and sign', card);
      await click(user, 'Sign in New Wallet as New wallet', card);
      await waitFor(() => {
        const delegation = w.testChain.stakeAccount(S2)?.delegation;
        expect(delegation?.voter).toBe(w.vote);
        expect(delegation?.deactivationEpoch).toBe(U64_MAX);
      }, WAIT);
      expect(w.newWallet.requests).toHaveLength(5);

      // Close the link-signing account: the deposit goes back to the new wallet.
      w.chain.expireBlockhash();
      const deposit = w.testChain.balance(nonceD);
      const balanceBefore = w.testChain.balance(w.D.address);
      await click(user, 'Close it');
      await click(user, 'Sign in New Wallet as New wallet');
      await screen.findByText('Closed. The deposit went back to your New wallet.', undefined, WAIT);
      expect(w.testChain.account(nonceD)).toBeNull();
      expect(w.testChain.balance(w.D.address)).toBe(balanceBefore + deposit - 5_600n);

      // The Done screen's ways on: the new wallet's accounts and its alerts.
      expect(screen.getByRole('link', { name: en.rescue.done.view })).toHaveAttribute('href', `/app?address=${w.D.address}`);
      expect(screen.getByRole('link', { name: `${en.rescue.done.telegram} (opens in a new tab)` })).toHaveAttribute(
        'href',
        `/api/telegram/link?wallet=${w.D.address}`,
      );
    },
    SCENARIO_TIMEOUT * 2,
  );

  it(
    'R2: the second key signs each account by link on another device; this page moves on by itself',
    async () => {
      const w = await world();
      const S1 = await stake(w, { custodian: w.K.address });
      const S3 = await stake(w);
      const before = w.testChain.stakeAccount(S1);
      const { user, view } = renderStakePage(w.chain, `/rescue?address=${w.A.address}`, [w.newWallet, w.main]);

      await throughKeys(user, { secondMode: 'link' });
      await setUpNonce(user);
      for (const [round, account] of [
        [1, S3],
        [2, S1],
      ] as const) {
        await view.findByText(`Round ${String(round)} of 2`, undefined, WAIT);
        // Here only the new wallet and the main key sign; the second key signs last, by link.
        await signAll(user, [NEW, MAIN], { scope: view });

        // The link: QR code, the URL, and the transaction id = the new wallet's signature.
        const card = await waitFor(() => {
          const found = document.querySelector<HTMLElement>('[data-slot="link-card"]');
          expect(found).not.toBeNull();
          return found as HTMLElement;
        }, WAIT);
        expect(card.querySelector('svg[data-slot="qr-code"] path')?.getAttribute('d')).toMatch(/\S/);
        const url = within(card).getByLabelText<HTMLInputElement>('Signing link').value;
        const id = lastSignature(w.newWallet);
        expect(within(card).getByRole('link', { name: /on Solana Explorer/ })).toHaveAttribute('href', expect.stringContaining(`/tx/${id}`));

        // The other device: only the second key's wallet, its own key slots.
        const other = await createTestWalletPort({ name: 'Second Wallet', signers: [w.K] });
        const cosign = renderCosignPage(w.chain, new URL(url).hash, [other]);
        await cosign.view.findByText(en.cosign.ask.rescue, undefined, WAIT);
        expect(cosign.view.getAllByText(w.D.address).length).toBeGreaterThan(0);
        await connectAndContinue(cosign.user, 'Second key', 'Second Wallet', cosign.view);
        if (account === S1) {
          // What was: the lock as the chain shows it now, which the move keeps.
          const summary = document.querySelectorAll<HTMLElement>('[data-slot="signing-panel"] [data-slot="transaction-summary"]');
          expect([...summary].some((item) => within(item).queryAllByText(/^Locked until /).length > 0)).toBe(true);
        }
        await cosign.user.click(await cosign.view.findByRole('checkbox', { name: en.cosign.confirm.rescue }, WAIT));
        await click(cosign.user, 'Sign in Second Wallet as Second key', cosign.view);
        await heading(en.cosign.done.title, cosign.view);
        expect(other.requests).toHaveLength(1);
        cosign.unmount();
      }

      await heading('2 stake accounts are safe', view);
      for (const id of [S1, S3]) {
        expect(w.testChain.stakeAccount(id)?.withdrawer).toBe(w.D.address);
        expect(w.testChain.stakeAccount(id)?.staker).toBe(w.D.address);
      }
      sameLockup(w.testChain.stakeAccount(S1), before);
      expect(w.main.requests).toHaveLength(2);
      // The page never held the second key.
      expect(w.second.requests).toHaveLength(0);
    },
    SCENARIO_TIMEOUT * 2,
  );

  it(
    'R3: a split made while the run waits for the second key shows up on Look again and moves in a second run',
    async () => {
      const w = await world();
      const S1 = await stake(w, { custodian: w.K.address });
      const { user } = renderStakePage(w.chain, `/rescue?address=${w.A.address}`, [w.newWallet, w.main, w.second]);

      await throughKeys(user, { secondMode: 'here' });
      await setUpNonce(user);
      // The second key's wallet holds its answer while the thief splits S1.
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const made: { split: Address | null } = { split: null };
      await signAll(user, [NEW, MAIN, SECOND], {
        before: (signer) => {
          if (signer === SECOND) w.second.once({ delay: gate });
        },
        after: async (signer) => {
          if (signer !== SECOND) return;
          await waitFor(() => {
            expect(w.second.requests).toHaveLength(1);
          }, WAIT);
          made.split = await splitStake(w.testChain, { stake: S1, staker: w.A, lamports: SOL });
          release();
        },
      });
      const split = made.split;
      if (split === null) throw new Error('no split');
      expect(w.testChain.stakeAccount(split)?.lockup.custodian).toBe(w.K.address);

      await heading(en.rescue.done.titleOne);
      expect(w.testChain.stakeAccount(S1)?.withdrawer).toBe(w.D.address);
      expect(w.testChain.stakeAccount(split)?.withdrawer).toBe(w.A.address);

      await click(user, en.rescue.done.more);
      await heading(en.rescue.stake.heading);
      await waitFor(() => {
        expect(movableOrder()).toEqual([rowLabel(split)]);
      }, WAIT);
      await click(user, 'Continue');
      // The new wallet, the seed check and the modes are kept.
      await heading(en.rescue.newWallet.heading);
      await screen.findByText(/^Your new wallet has /, undefined, WAIT);
      await click(user, 'Continue');
      await heading(en.rescue.keys.heading);
      await click(user, 'Continue');
      await heading(en.rescue.move.heading);
      await signAll(user, [NEW, MAIN, SECOND]);

      await heading('2 stake accounts are safe');
      expect(w.testChain.stakeAccount(split)?.withdrawer).toBe(w.D.address);
      expect(w.testChain.stakeAccount(split)?.staker).toBe(w.D.address);
      expect(w.second.requests).toHaveLength(2);
    },
    SCENARIO_TIMEOUT * 2,
  );
});
