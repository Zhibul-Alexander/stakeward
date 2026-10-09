import type { Address, Blockhash, Nonce } from '@solana/kit';
import {
  buildTransaction,
  deriveNonceAccountAddress,
  inspectTransaction,
  summariesMatchExceptStakeAccount,
  ZERO_ADDRESS,
  type Lifetime,
  type Lockup,
  type TransactionAction,
  type TransactionSummary as InspectedSummary,
} from '@stakeward/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TransactionSummary, TransactionSummaryError } from './transaction-summary.tsx';

// Real inspector output: each summary comes from bytes built by core's buildTransaction, read back by
// inspectTransaction, exactly as a signing screen gets it. Addresses are random public keys.
const STAKE = 'AYA9kYsn7XVDTPARBfAuASypyyDGFJw1Xds2vHgW9DfW' as Address;
const STAKE_2 = '2Xtq6iZ2mXjxTNsv5FrYCzayG5qYRJwZ6837A1X3TjF6' as Address;
const MAIN = 'B1agBSrGRgub2jXMJEozYkRLRzFc9HLd5hHjSrCtuXu8' as Address;
const SECOND = '9DpLwZiYboWcwYFVtSjSksfaP9EqVoSuZw7Jofet96fi' as Address;
const OTHER = '57M4tyxx6Rk1gz3uYVvfoB3KdQGQkyveqqmZzJUdw3Sz' as Address;
const NEW_WALLET = '21KaHQkRg8ntwcEF3Q1Y5wooZ1GC372Eu4yFQc5LRRFH' as Address;
const BLOCKHASH = 'BZFufDqppShyDDC1njm4fMpRbfnLwrpzzwG6WGgcmsxb' as Blockhash;
const NONCE_VALUE = '6xL7jWSuZg4oBfsLyVNjEJ6EK7qJQAX2HswMTw3GF6ki' as Nonce;

const APRIL_2027 = 1_807_488_000n; // 12 April 2027 00:00 UTC
const JANUARY_2027 = 1_798_761_600n; // 1 January 2027 00:00 UTC
const NOW = { unixTimestamp: 1_791_000_000n, epoch: 850n }; // 3 October 2026
const NO_LOCK: Lockup = { unixTimestamp: 0n, epoch: 0n, custodian: ZERO_ADDRESS };
const LIVE: Lifetime = { kind: 'blockhash', blockhash: BLOCKHASH, lastValidBlockHeight: 1_000n };

async function inspected(action: TransactionAction, feePayer: Address, lifetime: Lifetime = LIVE): Promise<InspectedSummary> {
  const { bytes } = buildTransaction(action, { feePayer, lifetime });
  const result = await inspectTransaction(bytes);
  if (!result.ok) throw new Error(`inspector rejected the sample: ${result.error.message}`);
  return result.summary;
}

/** UX rule 4: the words custodian, withdrawer and staker never appear on screen (checked per text node). */
function forbiddenRoleWords(): string[] {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const found: string[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    if (/\b(?:custodian|withdrawer|staker)s?\b/i.test(text)) found.push(text);
  }
  return found;
}

/** Each signer card: its role name and its full address. */
function signers(): string[] {
  const list = screen.getByRole('heading', { name: 'Who signs' }).nextElementSibling as HTMLElement;
  return within(list)
    .getAllByRole('listitem')
    .map((item) => item.textContent);
}

const protect: TransactionAction = { kind: 'protect', stakeAccount: STAKE, mainKey: MAIN, secondKey: SECOND, lockUntil: APRIL_2027 };

/** True when `a` comes before `b` in the document. */
function before(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe('TransactionSummary', () => {
  it('protect: what changes, both keys sign, it cannot move SOL, never the seed phrase', async () => {
    render(<TransactionSummary summary={await inspected(protect, MAIN)} current={{ lockup: NO_LOCK, clock: NOW }} />);

    expect(screen.getByRole('heading', { level: 2, name: 'Protect this stake' })).toBeInTheDocument();
    expect(screen.getByText('Read from the exact bytes your wallets will sign.')).toBeInTheDocument();
    expect(screen.getByText(STAKE)).toBeInTheDocument();
    expect(screen.getByText('No lock')).toBeInTheDocument();
    expect(screen.getByText('Locked until 12 April 2027')).toBeInTheDocument();
    // What a Ledger calls the new second key, said under its row (D80: from its sources, not checked on a device).
    expect(screen.getByText('A Ledger should show this as “New authority”. Not yet checked on a device.')).toBeInTheDocument();
    expect(signers()).toEqual([
      `Main keyNot signed yetPays the network fee${MAIN}`,
      `Second keyNot signed yet${SECOND}`,
    ]);
    expect(screen.getByText('Up to 0.0000106 SOL')).toBeInTheDocument();
    expect(screen.getByText('This transaction cannot move your SOL.')).toBeInTheDocument();
    expect(screen.getByText('It cannot change who can withdraw. Only the lock and its second key change.')).toBeInTheDocument();
    expect(screen.getByText('Stakeward never asks for your seed phrase.')).toBeInTheDocument();
    expect(screen.getByText('Valid for about a minute. If it expires, sign again.')).toBeInTheDocument();
    // A recent blockhash without checks added by a wallet: nothing technical to fold away.
    expect(screen.queryByText('Technical details')).not.toBeInTheDocument();
    expect(screen.queryByText(/replaces the current second key/)).not.toBeInTheDocument();
    expect(forbiddenRoleWords()).toEqual([]);

    // A receipt, top to bottom: the stake account, what changes, who signs, the fee, what it cannot do, how long it lasts.
    const order = [
      screen.getByText('Stake account'),
      screen.getByText('What changes'),
      screen.getByText('Who signs'),
      screen.getByText('Network fee'),
      screen.getByText('What this transaction cannot do'),
      screen.getByText('Valid for about a minute. If it expires, sign again.'),
    ];
    for (let i = 1; i < order.length; i += 1) expect(before(order[i - 1] as Node, order[i] as Node)).toBe(true);
  });

  it('intro={false} leaves out the line about the bytes (/cosign says who sent it instead)', async () => {
    render(<TransactionSummary summary={await inspected(protect, MAIN)} intro={false} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Protect this stake' })).toBeInTheDocument();
    expect(screen.queryByText('Read from the exact bytes your wallets will sign.')).not.toBeInTheDocument();
  });

  it('protect over a lock held by another key warns that it replaces that key, before anything else', async () => {
    const current = { lockup: { unixTimestamp: APRIL_2027, epoch: 0n, custodian: OTHER }, clock: NOW };
    render(<TransactionSummary summary={await inspected(protect, MAIN)} current={current} />);
    const warning = screen.getByText('This replaces the current second key:');
    expect(screen.getAllByText(OTHER).length).toBeGreaterThan(0);
    // Warnings come first, never folded: above the stake account and what changes.
    expect(before(warning, screen.getByText('Stake account'))).toBe(true);
    expect(warning.closest('details')).toBeNull();
  });

  it('protect over a lock in force that ends later warns that it shortens the lock', async () => {
    const current = { lockup: { unixTimestamp: APRIL_2027, epoch: 0n, custodian: SECOND }, clock: NOW };
    render(<TransactionSummary summary={await inspected({ ...protect, lockUntil: JANUARY_2027 }, MAIN)} current={current} />);
    expect(screen.getByText('This makes the lock end sooner: on 1 January 2027 instead of 12 April 2027.')).toBeInTheDocument();
    // The same key keeps the lock: no "replaces" warning.
    expect(screen.queryByText(/replaces the current second key/)).not.toBeInTheDocument();
  });

  it('protect over a lock that already ended says nothing about shortening it', async () => {
    const current = { lockup: { unixTimestamp: NOW.unixTimestamp - 60n, epoch: 0n, custodian: SECOND }, clock: NOW };
    render(<TransactionSummary summary={await inspected(protect, MAIN)} current={current} />);
    expect(screen.queryByText(/makes the lock end sooner/)).not.toBeInTheDocument();
  });

  it('without on-chain context it shows only what the bytes do', async () => {
    render(<TransactionSummary summary={await inspected(protect, MAIN)} />);
    expect(screen.queryByText('Now')).not.toBeInTheDocument();
    expect(screen.getAllByText('After')).toHaveLength(2);
  });

  it('withdraw: the amount and where it goes; it can move SOL, so no "cannot move your SOL"', async () => {
    const withdraw: TransactionAction = {
      kind: 'withdraw',
      stakeAccount: STAKE,
      mainKey: MAIN,
      secondKey: SECOND,
      recipient: MAIN,
      lamports: 42_750_000_000n,
    };
    render(<TransactionSummary summary={await inspected(withdraw, MAIN)} />);

    expect(screen.getByRole('heading', { level: 2, name: 'Withdraw SOL' })).toBeInTheDocument();
    expect(screen.getByText('42.75 SOL leaves the stake account')).toBeInTheDocument();
    expect(screen.getByText('It can only send SOL to the address shown above.')).toBeInTheDocument();
    expect(screen.getByText('It does not change any key or the lock.')).toBeInTheDocument();
    expect(screen.queryByText('This transaction cannot move your SOL.')).not.toBeInTheDocument();
    expect(screen.getByText('Stakeward never asks for your seed phrase.')).toBeInTheDocument();
    expect(signers()).toEqual([
      `Main keyNot signed yetPays the network fee${MAIN}`,
      `Second keyNot signed yet${SECOND}`,
    ]);
    expect(screen.queryByText(/does not sign this transaction/)).not.toBeInTheDocument();
  });

  it('withdraw to a wallet that does not sign shows a red warning (the /cosign rule)', async () => {
    const withdraw: TransactionAction = {
      kind: 'withdraw',
      stakeAccount: STAKE,
      mainKey: MAIN,
      secondKey: SECOND,
      recipient: OTHER,
      lamports: 1_000_000_000n,
    };
    render(<TransactionSummary summary={await inspected(withdraw, MAIN)} />);
    const warning = screen.getByText(/The SOL goes to a wallet that does not sign this transaction/).closest('[data-slot="alert"]');
    expect(warning).toHaveAttribute('data-tone', 'danger');
    expect(warning).toHaveTextContent(OTHER);
  });

  it('rescue on a nonce: keys move to the new wallet, three signers, the new wallet pays, the lock stays', async () => {
    const nonceAccount = await deriveNonceAccountAddress(NEW_WALLET);
    const rescue: TransactionAction = { kind: 'rescue', stakeAccount: STAKE, mainKey: MAIN, secondKey: SECOND, newWallet: NEW_WALLET };
    const summary = await inspected(rescue, NEW_WALLET, {
      kind: 'nonce',
      nonceAccount,
      nonceAuthority: NEW_WALLET,
      nonceValue: NONCE_VALUE,
    });
    render(
      <TransactionSummary summary={summary} current={{ lockup: { unixTimestamp: APRIL_2027, epoch: 0n, custodian: SECOND }, clock: NOW }} />,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Move this stake to your new wallet' })).toBeInTheDocument();
    const controlledBy = screen.getByText('Controlled by').parentElement as HTMLElement;
    expect(controlledBy).toHaveTextContent(`NowMain key${MAIN}`);
    expect(controlledBy).toHaveTextContent(`AfterNew wallet${NEW_WALLET}`);
    expect(screen.getByText('Stays as it is')).toBeInTheDocument();
    expect(signers()).toEqual([
      `New walletNot signed yetPays the network fee${NEW_WALLET}`,
      `Second keyNot signed yet${SECOND}`,
      `Main keyNot signed yet${MAIN}`,
    ]);
    expect(screen.getByText('Up to 0.0000156 SOL')).toBeInTheDocument();
    expect(screen.getByText('It cannot move your SOL out of the stake account: only its keys change.')).toBeInTheDocument();
    expect(screen.getByText('It does not change the lock.')).toBeInTheDocument();
    expect(screen.getByText('Valid until it is sent or cancelled.')).toBeInTheDocument();
    // The link-signing account is a technical detail: under "Technical details", closed until opened.
    const technical = screen.getByText('Technical details').closest('details') as HTMLDetailsElement;
    expect(technical).not.toHaveAttribute('open');
    await userEvent.click(screen.getByText('Technical details'));
    expect(technical).toHaveAttribute('open');
    expect(within(technical).getByText('Link-signing account')).toBeVisible();
    expect(within(technical).getByText(nonceAccount)).toBeVisible();
    expect(forbiddenRoleWords()).toEqual([]);
  });

  it('extend to an earlier date warns that it shortens the lock', async () => {
    const extend: TransactionAction = { kind: 'extend', stakeAccount: STAKE, secondKey: SECOND, lockUntil: JANUARY_2027 };
    render(
      <TransactionSummary
        summary={await inspected(extend, SECOND)}
        current={{ lockup: { unixTimestamp: APRIL_2027, epoch: 0n, custodian: SECOND }, clock: NOW }}
      />,
    );
    expect(screen.getByText('This makes the lock end sooner: on 1 January 2027 instead of 12 April 2027.')).toBeInTheDocument();
  });

  it('unlock says the risk before signing', async () => {
    const unlock: TransactionAction = { kind: 'unlock', stakeAccount: STAKE, secondKey: SECOND };
    render(<TransactionSummary summary={await inspected(unlock, SECOND)} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Remove the lock early' })).toBeInTheDocument();
    expect(screen.getByText('After the lock is removed, anyone with your main key can withdraw this stake right away.')).toBeInTheDocument();
  });

  it('batch: one summary lists every stake account in full, with its balance, its lock now and its own warnings', async () => {
    const first = await inspected(protect, MAIN);
    const second = await inspected({ ...protect, stakeAccount: STAKE_2 }, MAIN);
    // The page passes `batch` only when the transactions differ in nothing but the stake account.
    expect(summariesMatchExceptStakeAccount([first, second])).toBe(true);
    const lockedByOther = { lockup: { unixTimestamp: APRIL_2027, epoch: 0n, custodian: OTHER }, clock: NOW };
    render(
      <TransactionSummary
        summary={first}
        batch={{
          accounts: [
            { address: STAKE, lamports: 3_200_000_000n, current: { lockup: NO_LOCK, clock: NOW } },
            { address: STAKE_2, lamports: null, current: lockedByOther },
          ],
          totalFeeLamports: first.networkFeeLamports + second.networkFeeLamports,
        }}
      />,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Protect 2 stake accounts' })).toBeInTheDocument();
    expect(screen.queryByText('Stake account')).not.toBeInTheDocument();
    const items = within(screen.getByRole('list', { name: 'Stake accounts (2)' })).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    const [one, two] = items as [HTMLElement, HTMLElement];
    expect(within(one).getByText(STAKE)).toBeInTheDocument();
    expect(within(one).getByText('3.2 SOL')).toBeInTheDocument();
    expect(within(one).getByText('Now: No lock')).toBeInTheDocument();
    expect(within(one).queryByText('This replaces the current second key:')).not.toBeInTheDocument();
    expect(within(two).getByText(STAKE_2)).toBeInTheDocument();
    expect(two.querySelector('[data-slot="sol-amount"]')).toBeNull();
    expect(within(two).getByText('Now: Locked until 12 April 2027')).toBeInTheDocument();
    // The warning belongs to the account it is about, and appears only there.
    expect(within(two).getByText('This replaces the current second key:')).toBeInTheDocument();
    expect(within(two).getByText(OTHER)).toBeInTheDocument();
    expect(screen.getAllByText('This replaces the current second key:')).toHaveLength(1);

    // "What changes" shows the After values only: each account's "now" is in its own line above.
    expect(screen.queryByText('Now')).not.toBeInTheDocument();
    expect(screen.getAllByText('After')).toHaveLength(2);
    expect(screen.getByText('Up to 0.0000212 SOL in total (0.0000106 SOL each)')).toBeInTheDocument();
    expect(screen.queryByText('Up to 0.0000106 SOL')).not.toBeInTheDocument();
    expect(signers()).toEqual([
      `Main keyNot signed yetPays the network fee${MAIN}`,
      `Second keyNot signed yet${SECOND}`,
    ]);
    expect(screen.getByText('Stakeward never asks for your seed phrase.')).toBeInTheDocument();
    expect(forbiddenRoleWords()).toEqual([]);
  });

  it('batch: accounts with the same lock now say "Now" once, in What changes, and not on each account', async () => {
    const first = await inspected(protect, MAIN);
    const now = { lockup: NO_LOCK, clock: NOW };
    render(
      <TransactionSummary
        summary={first}
        batch={{
          accounts: [
            { address: STAKE, lamports: 3_200_000_000n, current: now },
            { address: STAKE_2, lamports: 1_000_000_000n, current: now },
          ],
          totalFeeLamports: 2n * first.networkFeeLamports,
        }}
      />,
    );
    expect(screen.queryAllByText(/^Now: /)).toHaveLength(0);
    // "Now" stands in both rows of What changes (the lock and the second key), each said once for every account.
    expect(screen.getAllByText('Now')).toHaveLength(2);
    expect(screen.getByText('No lock')).toBeInTheDocument();
    expect(screen.getByText('None')).toBeInTheDocument();
    const items = within(screen.getByRole('list', { name: 'Stake accounts (2)' })).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([expect.stringContaining('3.2 SOL'), expect.stringContaining('1 SOL')]);
  });

  it('batch: a warning from the bytes alone is said once, and a single `current` is not used', async () => {
    const unlock: TransactionAction = { kind: 'unlock', stakeAccount: STAKE, secondKey: SECOND };
    const first = await inspected(unlock, SECOND);
    const locked = { lockup: { unixTimestamp: APRIL_2027, epoch: 0n, custodian: SECOND }, clock: NOW };
    render(
      <TransactionSummary
        summary={first}
        current={locked}
        batch={{
          accounts: [
            { address: STAKE, lamports: null, current: locked },
            { address: STAKE_2, lamports: null },
          ],
          totalFeeLamports: 2n * first.networkFeeLamports,
        }}
      />,
    );
    expect(
      screen.getAllByText('After the lock is removed, anyone with your main key can withdraw this stake right away.'),
    ).toHaveLength(1);
    expect(screen.getByText('Now: Locked until 12 April 2027')).toBeInTheDocument();
    expect(screen.getAllByText(/^Now: /)).toHaveLength(1);
    expect(screen.queryByText('Now')).not.toBeInTheDocument();
  });

  it('bytes the inspector rejects: do not sign, the reason in words, the raw message under Details', async () => {
    const result = await inspectTransaction(new Uint8Array([1, 2, 3]));
    if (result.ok) throw new Error('garbage was accepted');
    render(<TransactionSummaryError error={result.error} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Do not sign this transaction' })).toBeInTheDocument();
    expect(screen.getByText('This is not a valid transaction.')).toBeInTheDocument();
    expect(screen.getByText('Details')).toBeInTheDocument();
    expect(screen.getByText(result.error.message)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveAttribute('data-error', 'malformed');
  });
});
