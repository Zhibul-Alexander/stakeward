// Matcher types for this tsconfig (src/test/setup.ts registers them at run time).
import '@testing-library/jest-dom/vitest';
import { generateKeyPairSigner, type Address, type KeyPairSigner } from '@solana/kit';
import { buildTransaction, formatSol, formatUtcDate, shortAddress, ZERO_ADDRESS } from '@stakeward/core';
import { LiteSvmChain } from '@stakeward/core/test/litesvm-chain';
import { START_EPOCH, START_UNIX_TIMESTAMP, TestChain } from '@stakeward/core/test/svm';
import { createTestWalletPort, type TestWalletPort } from '@stakeward/core/test/test-wallet-port';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createSecondKeyMemory } from '@/ports';
import {
  click,
  connectAndContinue,
  lastSignature,
  renderStakePage,
  SCENARIO_TIMEOUT,
  summarySigners,
  WAIT,
} from './support/stake-pages.tsx';

// /withdraw/:account (F3, live signing) end to end on the real stake program: LiteSvmChain answers like HttpChain and
// test wallets sign like Wallet Standard wallets. The page reads the account with no wallet; the engine asks for each
// key when it must sign.

const DAY = 86_400n;
const T = START_UNIX_TIMESTAMP + 30n * DAY;
/** Two signatures plus the fixed priority fee (core networkFeeFor(2)). */
const FEE_TWO_SIGNERS = 10_600n;

type World = { testChain: TestChain; chain: LiteSvmChain; A: KeyPairSigner; K: KeyPairSigner; vote: Address };

async function world(): Promise<World> {
  const testChain = await TestChain.create();
  const [A, K, vote] = await Promise.all([testChain.fundedKey(), generateKeyPairSigner(), testChain.createVoteAccount()]);
  return { testChain, chain: new LiteSvmChain(testChain), A, K, vote };
}

async function wallets(w: World): Promise<[TestWalletPort, TestWalletPort]> {
  return Promise.all([
    createTestWalletPort({ name: 'Main Wallet', signers: [w.A] }),
    createTestWalletPort({ name: 'Second Wallet', signers: [w.K] }),
  ]);
}

/** Undelegated, main key A, locked by the second key K until T. */
function lockedStake(w: World, delegated = false): Promise<Address> {
  return w.testChain.createStakeAccount({
    staker: w.A.address,
    withdrawer: w.A.address,
    lockup: { unixTimestamp: T, epoch: 0n, custodian: w.K.address },
    ...(delegated ? { delegateTo: { voteAccount: w.vote, stakerKey: w.A } } : {}),
  });
}

const heading = (name: string) => screen.findByRole('heading', { name }, WAIT);

describe('/withdraw/:account: withdraw a protected stake (F3)', () => {
  it(
    'DW6-1 (W1): withdraws the whole balance to the main key with both keys',
    async () => {
      const w = await world();
      const S = await lockedStake(w);
      const [main, second] = await wallets(w);
      const lamports = w.testChain.account(S)?.lamports ?? 0n;
      const { user } = renderStakePage(w.chain, `/withdraw/${S}`, [main, second]);

      await heading(`Withdraw ${formatSol(lamports)} to your main key`);
      expect(screen.getByText('Stakeward never asks for your seed phrase.')).toBeInTheDocument();
      const risk = document.querySelector<HTMLElement>('[data-risk="withdraw-compromised"]');
      expect(risk).not.toBeNull();
      expect(within(risk as HTMLElement).getByRole('link', { name: 'Rescue your stake instead' })).toHaveAttribute(
        'href',
        `/rescue?address=${w.A.address}`,
      );
      // Both keys in full before anything is asked (UX rule 9), each with what it does here (the KeyList).
      const keys = document.querySelector<HTMLElement>('dl[data-slot="key-list"]') as HTMLElement;
      expect([...keys.querySelectorAll('dt')].map((term) => term.textContent)).toEqual(['Main key', 'Second key']);
      expect(within(keys).getByText(w.A.address)).toBeInTheDocument();
      expect(within(keys).getByText(w.K.address)).toBeInTheDocument();
      expect(within(keys).getByText('Receives the SOL and pays the network fee')).toBeInTheDocument();
      // The lock's end stands on the account row right above; the second key's line says what it does here.
      expect(document.querySelector('[data-slot="lock-end"]')).toHaveTextContent(`until ${formatUtcDate(T) ?? ''}`);
      expect(within(keys).getByText('Co-signs this withdrawal')).toBeInTheDocument();
      // The risk stands right above the one filled button it guards (ActionBar, DECISIONS.md D109).
      const bar = (risk as HTMLElement).closest<HTMLElement>('[data-slot="action-bar"]') as HTMLElement;
      expect(within(bar).getByRole('button', { name: 'Review withdrawal' })).toHaveAttribute('data-variant', 'primary');
      // The way without the second key at hand (F3.4), and the same withdrawal with the Solana CLI.
      expect(screen.getByText('Second key not at hand? It can remove the lock alone, then your main key withdraws alone.')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Remove the lock first' })).toHaveAttribute('href', `/extend/${S}?remove`);
      expect(screen.getByRole('link', { name: 'Solana CLI commands' })).toHaveAttribute('href', `/recovery/${S}`);
      const balanceBefore = w.testChain.balance(w.A.address);

      await click(user, 'Review withdrawal');
      await connectAndContinue(user, 'Main key', 'Main Wallet');
      await screen.findByRole('button', { name: 'Sign in Main Wallet as Main key' }, WAIT);
      // While signing, F3 step 3 is said once, right above the Sign button it guards (SigningPanel `risk`, as on
      // /protect), with the way to Rescue.
      const signRisks = document.querySelectorAll<HTMLElement>('[data-risk="withdraw-compromised"]');
      expect(signRisks).toHaveLength(1);
      const signRisk = signRisks[0] as HTMLElement;
      expect(within(signRisk).getByRole('link', { name: 'Rescue your stake instead' })).toHaveAttribute('href', `/rescue?address=${w.A.address}`);
      const signBar = signRisk.closest<HTMLElement>('[data-slot="action-bar"]') as HTMLElement;
      expect(within(signBar).getByRole('button', { name: 'Sign in Main Wallet as Main key' })).toBeInTheDocument();
      const summaries = document.querySelectorAll<HTMLElement>('[data-slot="transaction-summary"]');
      expect(summaries).toHaveLength(1);
      const summary = summaries[0] as HTMLElement;
      expect(summary).toHaveAttribute('data-kind', 'withdraw');
      expect(within(summary).getAllByText(w.A.address).length).toBeGreaterThan(0);
      expect(summarySigners(summary)).toEqual(['main', 'second']);

      await click(user, 'Sign in Main Wallet as Main key');
      await connectAndContinue(user, 'Second key', 'Second Wallet');
      await click(user, 'Sign in Second Wallet as Second key');
      await heading(`${formatSol(lamports)} went to your main key`);

      expect(w.testChain.account(S)).toBeNull();
      expect(w.testChain.balance(w.A.address)).toBe(balanceBefore + lamports - FEE_TWO_SIGNERS);
      expect(main.requests).toHaveLength(1);
      expect(second.requests).toHaveLength(1);
      const signature = lastSignature(second);
      expect(screen.getByRole('link', { name: `View ${shortAddress(signature)} on Solana Explorer (opens in a new tab)` })).toHaveAttribute(
        'href',
        expect.stringContaining(`/tx/${signature}`),
      );
      expect(screen.getByRole('link', { name: 'Back to your accounts' })).toHaveAttribute('href', `/app?address=${w.A.address}`);
      // The re-read after the run finds no account; the Done screen says it, not "does not exist".
      await waitFor(() => {
        expect(screen.queryByText(/This stake account does not exist/)).not.toBeInTheDocument();
      });
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'W2: an active stake is deactivated by the main key alone, waits for the epoch, then withdraws with both keys',
    async () => {
      const w = await world();
      const S = await lockedStake(w, true);
      w.testChain.warpToEpoch(START_EPOCH + 1n);
      const [main, second] = await wallets(w);
      const { user } = renderStakePage(w.chain, `/withdraw/${S}`, [main, second]);

      await heading('First, stop staking');
      expect(screen.getByText(/^Staking stops at the end of this epoch, in about \d+ min\. Then you can withdraw\.$/)).toBeInTheDocument();
      // Only the main key signs a deactivation.
      const keys = document.querySelector<HTMLElement>('dl[data-slot="key-list"]') as HTMLElement;
      expect([...keys.querySelectorAll('dt')].map((term) => term.textContent)).toEqual(['Main key']);
      expect(within(keys).getByText('Signs alone')).toBeInTheDocument();
      await click(user, 'Review: stop staking');
      await connectAndContinue(user, 'Main key', 'Main Wallet');
      const summary = await waitFor(() => {
        const found = document.querySelector<HTMLElement>('[data-slot="transaction-summary"]');
        expect(found).not.toBeNull();
        return found as HTMLElement;
      }, WAIT);
      expect(summary).toHaveAttribute('data-kind', 'deactivate');
      expect(summarySigners(summary)).toEqual(['main']);
      await click(user, 'Sign in Main Wallet as Main key');

      await heading('Staking stops at the end of this epoch. Come back then to withdraw.');
      expect(main.requests).toHaveLength(1);
      expect(second.requests).toHaveLength(0);
      expect(w.testChain.stakeAccount(S)?.delegation?.deactivationEpoch).toBe(START_EPOCH + 1n);
      // The fresh read shows the wait, counted down to the estimated end of the epoch.
      await heading('Waiting for the epoch to end');
      expect(screen.getByRole('timer', { name: 'Withdraw opens in about' })).toBeInTheDocument();

      w.testChain.warpToEpoch(START_EPOCH + 2n);
      await click(user, 'Check again');
      const lamports = w.testChain.account(S)?.lamports ?? 0n;
      await heading(`Withdraw ${formatSol(lamports)} to your main key`);
      // The Done note of the deactivation is gone: the page says where the stake stands now.
      expect(screen.queryByText('Staking stops at the end of this epoch. Come back then to withdraw.')).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: `Withdraw ${formatSol(lamports)} to your main key` })).toHaveFocus();
      await click(user, 'Review withdrawal');
      await click(user, 'Sign in Main Wallet as Main key');
      await connectAndContinue(user, 'Second key', 'Second Wallet');
      await click(user, 'Sign in Second Wallet as Second key');
      await heading(`${formatSol(lamports)} went to your main key`);
      expect(w.testChain.account(S)).toBeNull();
      expect(main.requests).toHaveLength(2);
      expect(second.requests).toHaveLength(1);
    },
    SCENARIO_TIMEOUT,
  );
});

describe('/withdraw/:account: a stake delegated in this epoch', () => {
  it(
    'W2b: stopping a stake that has not started earning opens the withdrawal at once; no text says to wait for the epoch',
    async () => {
      const w = await world();
      // Delegated in START_EPOCH and read in it: activating.
      const S = await lockedStake(w, true);
      const [main, second] = await wallets(w);
      const { user } = renderStakePage(w.chain, `/withdraw/${S}`, [main, second]);

      await heading('First, stop staking');
      expect(screen.getByText('This stake has not started earning yet. Stop it now and withdraw right away.')).toBeInTheDocument();
      expect(screen.queryByText(/stops at the end of this epoch, in about/)).not.toBeInTheDocument();
      await click(user, 'Review: stop staking');
      await connectAndContinue(user, 'Main key', 'Main Wallet');
      // The summary agrees with the page: a stake that has not started earning does not wait for the epoch's end.
      const summary = await waitFor(() => {
        const found = document.querySelector<HTMLElement>('[data-slot="transaction-summary"][data-kind="deactivate"]');
        expect(found).not.toBeNull();
        return found as HTMLElement;
      }, WAIT);
      expect(within(summary).getByText('Stops at the end of this epoch, or at once if it has not started earning yet')).toBeInTheDocument();
      await click(user, 'Sign in Main Wallet as Main key');

      await heading('Staking stopped. You can withdraw now.');
      const delegation = w.testChain.stakeAccount(S)?.delegation;
      expect(delegation?.deactivationEpoch).toBe(START_EPOCH);
      expect(delegation?.activationEpoch).toBe(START_EPOCH);
      expect(screen.queryByText(/Come back then to withdraw/)).not.toBeInTheDocument();
      // The fresh read offers the withdrawal in the same epoch, with both keys.
      const lamports = w.testChain.account(S)?.lamports ?? 0n;
      await heading(`Withdraw ${formatSol(lamports)} to your main key`);
      await click(user, 'Review withdrawal');
      await click(user, 'Sign in Main Wallet as Main key');
      await connectAndContinue(user, 'Second key', 'Second Wallet');
      await click(user, 'Sign in Second Wallet as Second key');
      await heading(`${formatSol(lamports)} went to your main key`);
      expect(w.testChain.account(S)).toBeNull();
    },
    SCENARIO_TIMEOUT,
  );
});

describe('/withdraw/:account: no lock holds the stake now', () => {
  it(
    'W5: a lock that ended says when it ended; the main key signs alone',
    async () => {
      const w = await world();
      const ended = START_UNIX_TIMESTAMP - DAY;
      const S = await w.testChain.createStakeAccount({
        staker: w.A.address,
        withdrawer: w.A.address,
        lockup: { unixTimestamp: ended, epoch: 0n, custodian: w.K.address },
      });
      renderStakePage(w.chain, `/withdraw/${S}`, []);
      await screen.findByText(`Lock ended on ${formatUtcDate(ended) ?? ''}, so your main key signs alone.`, undefined, WAIT);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'W6: a stake that never had a lock does not speak of a lock that ended',
    async () => {
      const w = await world();
      const S = await w.testChain.createStakeAccount({ staker: w.A.address, withdrawer: w.A.address });
      renderStakePage(w.chain, `/withdraw/${S}`, []);
      await screen.findByText('No lock, so your main key signs alone.', undefined, WAIT);
      expect(screen.queryByText(/lock has ended/i)).not.toBeInTheDocument();
    },
    SCENARIO_TIMEOUT,
  );
});

describe('/withdraw/:account: an uncertain outcome', () => {
  it(
    'W4: Stop waiting leaves it uncertain; Check again says when the network cannot be read, then finds the withdrawal',
    async () => {
      const w = await world();
      const S = await w.testChain.createStakeAccount({ staker: w.A.address, withdrawer: w.A.address });
      const [main] = await wallets(w);
      const lamports = w.testChain.account(S)?.lamports ?? 0n;
      const { user } = renderStakePage(w.chain, `/withdraw/${S}`, [main]);

      await screen.findByText('No lock, so your main key signs alone.', undefined, WAIT);
      await click(user, 'Review withdrawal');
      await connectAndContinue(user, 'Main key', 'Main Wallet');
      const summary = await waitFor(() => {
        const found = document.querySelector<HTMLElement>('[data-slot="transaction-summary"]');
        expect(found).not.toBeNull();
        return found as HTMLElement;
      }, WAIT);
      expect(summarySigners(summary)).toEqual(['main']);
      w.chain.holdTransactions();
      await click(user, 'Sign in Main Wallet as Main key');
      // Sent, but the network has not executed it yet.
      await screen.findByText('Waiting for the network to confirm. This usually takes a few seconds, at most 2 minutes.', undefined, WAIT);
      await user.click(screen.getByRole('button', { name: 'Stop waiting' }));

      await heading('Not confirmed yet');
      const list = screen.getByRole('list', { name: 'Withdrawal' });
      expect(within(list).getByText('You stopped waiting. It may still go through: check again.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();

      w.chain.failNext('getAccounts', new TypeError('Failed to fetch'));
      await click(user, 'Check again');
      await screen.findByText('Could not read the network. Try again in a moment.', undefined, WAIT);

      w.chain.landHeld();
      await click(user, 'Check again');
      await heading(`${formatSol(lamports)} went to your main key`);
      expect(w.testChain.account(S)).toBeNull();
      expect(main.requests).toHaveLength(1);
    },
    SCENARIO_TIMEOUT,
  );
});

describe('/withdraw/:account: gates', () => {
  it(
    'W3a: a wallet that offers another main account is told which one the step needs, and is never asked to sign',
    async () => {
      const w = await world();
      const S = await lockedStake(w);
      const other = await generateKeyPairSigner();
      const wallet = await createTestWalletPort({ name: 'Two Accounts', signers: [other, w.A], exposed: [other.address] });
      const { user } = renderStakePage(w.chain, `/withdraw/${S}`, [wallet]);

      await click(user, 'Review withdrawal');
      await screen.findByText('Connect your Main key to sign.', undefined, WAIT);
      const slot = screen.getByRole('group', { name: 'Main key' });
      await user.click(within(slot).getByRole('button', { name: 'Connect a wallet as Main key' }));
      await user.click(within(slot).getByRole('button', { name: 'Two Accounts' }));
      await within(slot).findByText('This step needs this account. Switch to it in the wallet:', undefined, WAIT);
      expect(within(slot).getByText(w.A.address)).toBeInTheDocument();
      expect(wallet.requests).toHaveLength(0);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'W3b: another staking key: the page says so in full and offers no Deactivate',
    async () => {
      const w = await world();
      const X = await w.testChain.fundedKey();
      const S = await w.testChain.createStakeAccount({
        staker: X.address,
        withdrawer: w.A.address,
        delegateTo: { voteAccount: w.vote, stakerKey: X },
      });
      w.testChain.warpToEpoch(START_EPOCH + 1n);
      renderStakePage(w.chain, `/withdraw/${S}`, []);

      await heading('Another key manages staking');
      expect(screen.getByText(/^Stop staking with that key, or in your staking service, then come back\. Did not set this up\?/)).toBeInTheDocument();
      expect(screen.getAllByText(X.address).length).toBeGreaterThan(0);
      expect(screen.queryByRole('button', { name: /^Review/ })).not.toBeInTheDocument();
      // One block says it, with one way out (DECISIONS.md D109): no second warning on the row, no risk without a withdrawal.
      const rescue = screen.getByRole('link', { name: 'Rescue your stake' });
      expect(rescue).toHaveAttribute('href', `/rescue?address=${w.A.address}`);
      expect(rescue).toHaveAttribute('data-variant', 'primary');
      expect(document.querySelectorAll('[data-slot="alert"], [data-slot="row-warning"], [data-slot="risk-note"], [data-risk]')).toHaveLength(1);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'W3b2: another staking key under this device\'s own lock: the row says it may be theft, the block says the rest, one Rescue',
    async () => {
      const w = await world();
      const X = await w.testChain.fundedKey();
      const S = await w.testChain.createStakeAccount({
        staker: X.address,
        withdrawer: w.A.address,
        lockup: { unixTimestamp: T, epoch: 0n, custodian: w.K.address },
        delegateTo: { voteAccount: w.vote, stakerKey: X },
      });
      w.testChain.warpToEpoch(START_EPOCH + 1n);
      const secondKeys = createSecondKeyMemory(null);
      secondKeys.remember(w.K.address);
      renderStakePage(w.chain, `/withdraw/${S}`, [], { secondKeys });

      await heading('Another key manages staking');
      // The theft sign stays on the row (SECURITY-CHECK П6); the block does not say it a second time.
      const rowWarning = document.querySelector<HTMLElement>('[data-slot="row-warning"]') as HTMLElement;
      expect(rowWarning).toHaveTextContent('Another key can stop or move this stake. If you did not set this up, your main key may be stolen.');
      expect(screen.getByText('Stop staking with that key, or in your staking service, then come back.')).toBeInTheDocument();
      expect(screen.queryByText(/Did not set this up\?/)).not.toBeInTheDocument();
      expect(document.querySelectorAll('[data-slot="alert"]')).toHaveLength(1);
      // One way out: the block's filled Rescue, not a second link on the row.
      const rescues = screen.getAllByRole('link', { name: /rescue/i });
      expect(rescues).toHaveLength(1);
      expect(rescues[0]).toHaveTextContent('Rescue your stake');
      expect(rescues[0]).toHaveAttribute('data-variant', 'primary');
      expect(rescues[0]).toHaveAttribute('href', `/rescue?address=${w.A.address}`);
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'W3b3: another staking key while the stake stops: the row keeps its staking-service line',
    async () => {
      const w = await world();
      const X = await w.testChain.fundedKey();
      const S = await w.testChain.createStakeAccount({
        staker: X.address,
        withdrawer: w.A.address,
        lockup: { unixTimestamp: T, epoch: 0n, custodian: w.K.address },
        delegateTo: { voteAccount: w.vote, stakerKey: X },
      });
      w.testChain.warpToEpoch(START_EPOCH + 1n);
      const { bytes } = buildTransaction(
        { kind: 'deactivate', stakeAccount: S, staker: X.address },
        { feePayer: X.address, lifetime: w.testChain.blockhashLifetime() },
      );
      expect((await w.testChain.send(bytes, [X])).ok).toBe(true);
      // Opened on a device that does not know the second key: no theft line, but the other staking key is still said.
      renderStakePage(w.chain, `/withdraw/${S}`, []);

      await heading('Waiting for the epoch to end');
      const rowWarning = document.querySelector<HTMLElement>('[data-slot="row-warning"]') as HTMLElement;
      expect(rowWarning).toHaveTextContent('A staking service may manage this stake.');
      expect(screen.queryByRole('heading', { name: 'Another key manages staking' })).not.toBeInTheDocument();
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'W3c: a lock held by the main key itself is not supported',
    async () => {
      const w = await world();
      const S = await w.testChain.createStakeAccount({
        staker: w.A.address,
        withdrawer: w.A.address,
        lockup: { unixTimestamp: T, epoch: 0n, custodian: w.A.address },
      });
      renderStakePage(w.chain, `/withdraw/${S}`, []);
      await screen.findByText(/^Stakeward cannot withdraw this stake: its lock is held by the main key itself or by no key\./, undefined, WAIT);
      expect(screen.queryByRole('button', { name: /^Review/ })).not.toBeInTheDocument();
      // The command line's way, under Details.
      const details = screen.getByText('Details').closest('details') as HTMLElement;
      expect(details).toHaveTextContent('solana withdraw-stake --help names that option');
    },
    SCENARIO_TIMEOUT,
  );

  it.each(['not-an-address', ZERO_ADDRESS])('W3d: an invalid page address (%s) says so and reads nothing', async (param) => {
    const w = await world();
    const reads: string[] = [];
    const chain = new Proxy(w.chain, {
      get(target, property, receiver) {
        if (typeof property === 'string' && property.startsWith('get')) reads.push(property);
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    renderStakePage(chain, `/withdraw/${param}`, []);
    expect(await screen.findByText('This page address does not contain a valid stake account address.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to your accounts' })).toHaveAttribute('href', '/app');
    expect(reads).toEqual([]);
  }, SCENARIO_TIMEOUT);

  it(
    'W3e: a missing account says it does not exist',
    async () => {
      const w = await world();
      const missing = (await generateKeyPairSigner()).address;
      renderStakePage(w.chain, `/withdraw/${missing}`, []);
      await heading('This stake account does not exist. If you just withdrew from it, the SOL is with its main key.');
      expect(screen.queryByRole('button', { name: /^Review/ })).not.toBeInTheDocument();
    },
    SCENARIO_TIMEOUT,
  );

  it(
    'W3f: delegated again between the read and Review: refused as not inactive, no wallet asked',
    async () => {
      const w = await world();
      const S = await w.testChain.createStakeAccount({ staker: w.A.address, withdrawer: w.A.address });
      const [main, second] = await wallets(w);
      const { user } = renderStakePage(w.chain, `/withdraw/${S}`, [main, second]);
      await screen.findByText('No lock, so your main key signs alone.', undefined, WAIT);

      const { bytes } = buildTransaction(
        { kind: 'delegate', stakeAccount: S, staker: w.A.address, voteAccount: w.vote },
        { feePayer: w.A.address, lifetime: w.testChain.blockhashLifetime() },
      );
      expect((await w.testChain.send(bytes, [w.A])).ok).toBe(true);

      await click(user, 'Review withdrawal');
      await heading('Withdrawal not sent');
      const list = screen.getByRole('list', { name: 'Withdrawal' });
      expect(within(list).getByText('This stake is still staked or stopping. Wait until it is inactive.')).toBeInTheDocument();
      expect(main.requests).toHaveLength(0);
      expect(second.requests).toHaveLength(0);
      // Back to the page, which now offers to stop staking first.
      await click(user, 'Back');
      await heading('First, stop staking');
    },
    SCENARIO_TIMEOUT,
  );
});
